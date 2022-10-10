// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./lib/helpers/InputHelpers.sol";
import "./WeightedMath.sol";
import "./GamutToken.sol";
import "./lib/helpers/Decoder.sol";

contract Pool is WeightedMath, GamutToken {
    using Decoder for bytes;
    using FixedPoint for uint256;
    using SafeCast for uint256;

    IERC20 internal immutable _token0;
    IERC20 internal immutable _token1;

    enum JoinKind {
        INIT,
        EXACT_TOKENS_IN_FOR_HPT_OUT,
        EXACT_TOKEN_IN_FOR_HPT_OUT
    }

    bool public immutable canChangeSwapFee;
    address private immutable _router;
    address public immutable _owner;

    uint256 private constant _MINIMUM_HPT = 1e6;

    // 1e18 corresponds to 1.0, or a 100% fee
    uint256 private constant _MIN_SWAP_FEE_PERCENTAGE = 1e12; // 0.0001%
    uint256 private constant _MAX_SWAP_FEE_PERCENTAGE = 1e17; // 10%

    uint256 private constant _MIN_WEIGHT = 2e17; // 20%

    uint256 private _swapFeePercentage;

    uint256 private _weight0;
    uint256 private _weight1;

    // All token balances are normalized to behave as if the token had 18 decimals. We assume a token's decimals will
    // not change throughout its lifetime, and store the corresponding scaling factor for each at construction time.
    // These factors are always greater than or equal to one: tokens with more than 18 decimals are not supported.
    uint256 internal immutable _scalingFactor0;
    uint256 internal immutable _scalingFactor1;

    // Balance management
    uint112 private _balance0;
    uint112 private _balance1;

    // lastChangeBlock stores the last block in which either of the pool token changed its total balance.
    uint32 private _lastChangeBlock;

    event SwapFeePercentageChanged(uint256 swapFeePercentage);

    modifier onlyRouter() {
        _require(msg.sender == _router, Errors.CALLER_NOT_ROUTER);
        _;
    }

    struct NewPoolParams {
        address router;
        IERC20 token0;
        IERC20 token1;
        uint256 weight0;
        uint256 weight1;
        uint256 swapFeePercentage;
        bool changeSwapFeeEnabled;
        address owner;
    }

    constructor(NewPoolParams memory params) {
        _setSwapFeePercentage(params.swapFeePercentage);

        _router = params.router;
        _owner = params.owner;

        canChangeSwapFee = params.changeSwapFeeEnabled;

        _token0 = params.token0;
        _token1 = params.token1;

        _scalingFactor0 = _computeScalingFactor(params.token0);
        _scalingFactor1 = _computeScalingFactor(params.token1);

        // Ensure each normalized weight is above them minimum and find the token index of the maximum weight
        _require(params.weight0 >= _MIN_WEIGHT, Errors.MIN_WEIGHT);
        _require(params.weight1 >= _MIN_WEIGHT, Errors.MIN_WEIGHT);

        // Ensure that the sum of weights is ONE
        uint256 weightSum = params.weight0 + params.weight1;
        _require(
            weightSum == FixedPoint.ONE,
            Errors.NORMALIZED_WEIGHT_INVARIANT
        );

        _weight0 = params.weight0;
        _weight1 = params.weight1;

        //----------- Start EtherAuthority 7-Oct-2022 --------------
         string memory strToken0 = string(abi.encodePacked(_token0.symbol(), "/"));
         string memory strToken1 = string(abi.encodePacked(strToken0,_token1.symbol()));
         string memory strGToken = string(abi.encodePacked("Gamut ", strToken1));
         string memory strPoolName = string(abi.encodePacked(strGToken, " Pool"));
       
        ERC20.setName(strPoolName);
        ERC20.setSymbol("Gamut-LP");
        //----------- End EtherAuthority 7-Oct-2022 -----------------



    }

    // Getters / Setters

    function getRouter() public view returns (address) {
        return _router;
    }

    function getSwapFeePercentage() public view returns (uint256) {
        return _swapFeePercentage;
    }

    function getWeights() external view returns (uint256[] memory) {
        return _weights();
    }

    function _weights() private view returns (uint256[] memory) {
        uint256[] memory weights = new uint256[](2);
        weights[0] = _weights(true);
        weights[1] = _weights(false);
        return weights;
    }

    function _weights(bool token0) private view returns (uint256) {
        return token0 ? _weight0 : _weight1;
    }

    /**
     * @dev Determines whether tokenIn is _token0 or _token1 in the pool,
     * based on the result, returns weight of Input and Output token as well as their scaling factor.
     *
     * true when tokenIn is _token0, false otherwise.
     */
    function getWeightsAndScalingFactors(IERC20 tokenIn)
        private
        view
        returns (
            bool tokenInIsToken0,
            uint256 weightIn,
            uint256 weightOut,
            uint256 scalingFactorTokenIn,
            uint256 scalingFactorTokenOut
        )
    {
        tokenInIsToken0 = tokenIn == _token0;
        weightIn = _weights(tokenInIsToken0);
        weightOut = _weights(!tokenInIsToken0);
        scalingFactorTokenIn = _scalingFactor(tokenInIsToken0);
        scalingFactorTokenOut = _scalingFactor(!tokenInIsToken0);
    }

    /**
     * @dev Returns an ordered/sorted array with all the tokens and balances in a Pool
     */
    function getPoolTokensAndBalances()
        external
        view
        returns (IERC20[] memory tokens, uint256[] memory balances)
    {
        (
            uint112 balance0,
            uint112 balance1,

        ) = getPoolBalancesAndChangeBlock();

        tokens = new IERC20[](2);
        tokens[0] = _token0;
        tokens[1] = _token1;

        balances = new uint256[](2);
        balances[0] = uint256(balance0);
        balances[1] = uint256(balance1);
    }

    function getPoolBalancesAndChangeBlock()
        public
        view
        returns (
            uint112 balance0,
            uint112 balance1,
            uint32 lastChangeBlock
        )
    {
        balance0 = _balance0;
        balance1 = _balance1;
        lastChangeBlock = _lastChangeBlock;
    }

    // Caller must be the Pool owner
    function setSwapFeePercentage(uint256 swapFeePercentage) external {
        _require(msg.sender == _owner, Errors.CALLER_NOT_POOL_OWNER);
        _require(canChangeSwapFee, Errors.CANNOT_MODIFY_SWAP_FEE);
        _setSwapFeePercentage(swapFeePercentage);
    }

    function _setSwapFeePercentage(uint256 swapFeePercentage) private {
        _require(
            swapFeePercentage >= _MIN_SWAP_FEE_PERCENTAGE,
            Errors.MIN_SWAP_FEE_PERCENTAGE
        );
        _require(
            swapFeePercentage <= _MAX_SWAP_FEE_PERCENTAGE,
            Errors.MAX_SWAP_FEE_PERCENTAGE
        );

        _swapFeePercentage = swapFeePercentage;
        emit SwapFeePercentageChanged(swapFeePercentage);
    }

    /**
     * @dev Sets the balances of Pool's tokens and updates the lastChangeBlock.
     */
    function setPoolBalancesAndLastChangeBlock(
        uint256 balance0,
        uint256 balance1
    ) external onlyRouter {
        _balance0 = uint112(balance0);
        _balance1 = uint112(balance1);
        _lastChangeBlock = uint32(block.number);
    }

    // Swap Hooks

    function onSwap(
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 protocolSwapFeePercentage
    ) public onlyRouter returns (uint256, uint256) {
        (
            ,
            ,
            ,
            uint256 scalingFactorTokenIn,
            uint256 scalingFactorTokenOut
        ) = getWeightsAndScalingFactors(tokenIn);

        // All token amounts are upscaled.
        balanceTokenIn = _upscale(balanceTokenIn, scalingFactorTokenIn);
        balanceTokenOut = _upscale(balanceTokenOut, scalingFactorTokenOut);

        uint256 protocolFeeAmount;

        (amountIn, protocolFeeAmount) = _calcPoolAndProtocolSwapFee(
            amountIn,
            protocolSwapFeePercentage,
            scalingFactorTokenIn
        );

        uint256 amountOut = _calcSwapOut(
            tokenIn,
            amountIn,
            balanceTokenIn,
            balanceTokenOut
        );
        _updateWeights(tokenIn, balanceTokenOut, balanceTokenOut - amountOut);

        // amountOut tokens are exiting the Pool, so we round down.
        return (
            _downscaleDown(amountOut, scalingFactorTokenOut),
            protocolFeeAmount
        );
    }

    /**
     * @dev Same as `onSwap`, except it doesn't upscale 'balances' as it already receives upscaled 'balances' and,
     * it downScales 'amountIn' as fee calculation requires 'amountIn' without any type of scaling
     */
    function _onVirtualSwap(
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 protocolSwapFeePercentage
    ) private returns (uint256 amountOut, uint256 protocolFeeAmount) {
        (, , , uint256 scalingFactorTokenIn, ) = getWeightsAndScalingFactors(
            tokenIn
        );

        amountIn = _downscaleDown(amountIn, scalingFactorTokenIn);

        (amountIn, protocolFeeAmount) = _calcPoolAndProtocolSwapFee(
            amountIn,
            protocolSwapFeePercentage,
            scalingFactorTokenIn
        );

        amountOut = _calcSwapOut(
            tokenIn,
            amountIn,
            balanceTokenIn,
            balanceTokenOut
        );

        _updateWeights(tokenIn, balanceTokenOut, balanceTokenOut - amountOut);
    }

    function _calcPoolAndProtocolSwapFee(
        uint256 amountIn,
        uint256 protocolSwapFeePercentage,
        uint256 scalingFactorTokenIn
    ) private view returns (uint256, uint256) {
        amountIn = _upscale(amountIn, scalingFactorTokenIn);
        uint256 feeAmount = amountIn.mulUp(getSwapFeePercentage());
        uint256 protocolFeeAmount = feeAmount.mulUp(protocolSwapFeePercentage);
        amountIn = amountIn - feeAmount;

        return (amountIn, protocolFeeAmount);
    }

    function _calcSwapOut(
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    ) private view returns (uint256 amountOut) {
        (
            ,
            uint256 weightIn,
            uint256 weightOut,
            ,

        ) = getWeightsAndScalingFactors(tokenIn);

        amountOut = WeightedMath._calcOutGivenIn(
            balanceTokenIn, // Current balance of token In
            weightIn,
            balanceTokenOut, //Current balance of token Out
            weightOut,
            amountIn
        );
    }

    function _updateWeights(
        IERC20 tokenIn,
        uint256 balanceOutOld,
        uint256 balanceOutNew
    ) private {
        (
            bool tokenInIsToken0,
            uint256 weightIn,
            uint256 weightOut,
            ,

        ) = getWeightsAndScalingFactors(tokenIn);

        (uint256 weightInNew, uint256 weightOutNew) = _calculateNewWeights(
            weightIn,
            weightOut,
            balanceOutOld,
            balanceOutNew
        );

        _weight0 = tokenInIsToken0 ? weightInNew : weightOutNew;
        _weight1 = !tokenInIsToken0 ? weightInNew : weightOutNew;
    }

    // Join Hook

    function onJoinPool(
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        external
        onlyRouter
        returns (
            uint256[] memory amountsIn,
            uint256[] memory protocolSwapFeeAmount
        )
    {
        uint256 hptAmountOut;
        if (totalSupply() == 0) {
            (hptAmountOut, amountsIn) = _onInitializePool(userData);

            // On initialization, we lock _MINIMUM_HPT by minting it for the zero address. This HPT acts as a minimum
            // as it will never be burned, which reduces potential issues with rounding, and also prevents the Pool from
            // ever being fully drained.
            _require(hptAmountOut >= _MINIMUM_HPT, Errors.MINIMUM_HPT);
            _mint(address(0), _MINIMUM_HPT);
            _mint(recipient, hptAmountOut - _MINIMUM_HPT);

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn);

            // There are no protocol swap fee amounts during initialization
            protocolSwapFeeAmount = new uint256[](2);
        } else {
            _upscaleArray(balances);

            uint256 minHPTAmountOut;

            (
                hptAmountOut,
                amountsIn,
                protocolSwapFeeAmount,
                minHPTAmountOut
            ) = _onJoinPool(
                sender,
                recipient,
                balances,
                protocolSwapFeePercentage,
                userData
            );

            _require(
                hptAmountOut >= minHPTAmountOut,
                Errors.HPT_OUT_MIN_AMOUNT
            );

            _mint(recipient, hptAmountOut);

            // amountsIn are amounts entering the Pool, so we round up.
            _downscaleUpArray(amountsIn);
        }
    }

    /**
     * @dev Called when the Pool is joined for the first time; that is, when the HPT total supply is zero.
     *
     * Returns the amount of HPT to mint, and the token amounts the Pool will receive in return.
     *
     * Minted HPT will be sent to `recipient`, except for _MINIMUM_HPT, which will be deducted from this amount and sent
     * to the zero address instead. This will cause that HPT to remain forever locked there, preventing total BTP from
     * ever dropping below that value, and ensuring `_onInitializePool` can only be called once in the entire Pool's
     * lifetime.
     *
     * The tokens granted to the Pool will be transferred from `sender`. These amounts are considered upscaled and will
     * be downscaled (rounding up) before being returned to the Vault.
     */
    function _onInitializePool(bytes memory userData)
        private
        view
        returns (uint256, uint256[] memory)
    {
        Pool.JoinKind kind = userData.joinKind();
        _require(kind == Pool.JoinKind.INIT, Errors.UNINITIALIZED);

        uint256[] memory amountsIn = userData.initialAmountsIn();
        InputHelpers.ensureInputLengthMatch(amountsIn.length, 2);

        _upscaleArray(amountsIn);

        uint256[] memory weights = _weights();

        uint256 invariant = WeightedMath._calculateInvariant(
            weights,
            amountsIn
        );

        // Set the initial HPT to the value of the invariant times the number of tokens. This makes HPT supply more
        // consistent in Pools with similar compositions but different number of tokens.
        uint256 hptAmountOut = invariant * 2;

        return (hptAmountOut, amountsIn);
    }

    /**
     * @dev Called whenever the Pool is joined after the first initialization join (see `_onInitializePool`).
     *
     * Returns the amount of HPT to mint, the token amounts that the Pool will receive in return, and the number of
     * tokens to pay in protocol swap fees.
     *
     * Minted HPT will be sent to `recipient`.
     *
     * The tokens granted to the Pool will be transferred from `sender`. These amounts are considered upscaled and will
     * be downscaled (rounding up) before being returned to the Vault.
     */
    function _onJoinPool(
        address,
        address,
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        private
        returns (
            uint256,
            uint256[] memory,
            uint256[] memory,
            uint256
        )
    {
        uint256[] memory weights = _weights();

        Pool.JoinKind kind = userData.joinKind();

        if (kind == Pool.JoinKind.EXACT_TOKENS_IN_FOR_HPT_OUT) {
            return
                _joinExactTokensInForHPTOut(
                    balances,
                    protocolSwapFeePercentage,
                    userData
                );
        } else if (kind == Pool.JoinKind.EXACT_TOKEN_IN_FOR_HPT_OUT) {
            return
                _joinTokenInForHPTOut(
                    balances,
                    weights,
                    protocolSwapFeePercentage,
                    userData
                );
        } else {
            _revert(Errors.UNHANDLED_JOIN_KIND);
        }
    }

    function _joinExactTokensInForHPTOut(
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        private
        returns (
            uint256 hptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory protocolSwapFeeAmount,
            uint256 minHPTAmountOut
        )
    {
        (amountsIn, minHPTAmountOut) = userData.exactTokensInForHptOut();

        InputHelpers.ensureInputLengthMatch(amountsIn.length, 2);

        _upscaleArray(amountsIn);

        /**
        * To store amountIn with which, we are actually joining the pool, 'amountsIn' provided by the user 
        * might be different than the amount which we are using to calculate LP tokens.
      
        * amountsIn and actualJoinAmountsIn will be different only when user is joining the pool 
        * with different weights than the pool currently has.
        */
        uint256[] memory actualJoinAmountsIn = new uint256[](2);
        actualJoinAmountsIn[0] = amountsIn[0];
        actualJoinAmountsIn[1] = amountsIn[1];

        protocolSwapFeeAmount = new uint256[](2);

        uint256 amountsInRatio = amountsIn[0].divDown(amountsIn[1]);
        uint256 poolBalancesRatio = balances[0].divDown(balances[1]);

        if (amountsInRatio != poolBalancesRatio) {
            (actualJoinAmountsIn, protocolSwapFeeAmount) = _unEqualJoin(
                balances,
                amountsIn,
                actualJoinAmountsIn,
                protocolSwapFeeAmount,
                protocolSwapFeePercentage,
                amountsInRatio,
                poolBalancesRatio
            );
        }

        hptAmountOut = _calculateHptOut(balances, actualJoinAmountsIn);
    }

    function _unEqualJoin(
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256[] memory actualJoinAmountsIn,
        uint256[] memory protocolSwapFeeAmount,
        uint256 protocolSwapFeePercentage,
        uint256 amountsInRatio,
        uint256 poolBalancesRatio
    ) private returns (uint256[] memory, uint256[] memory) {
        uint256 amountOut;

        // When ratio of amounts In provided by the user is greater than the pool balances ratio
        if (amountsInRatio > poolBalancesRatio) {
            // Local copies to avoid stack too deep
            uint256 balancesIn = balances[0];
            uint256 balancesOut = balances[1];
            uint256 amountTokenIn = amountsIn[0];
            uint256 amountTokenOut = amountsIn[1];

            uint256 amountsInForVirtualSwap = _calculateVirtualSwapAmountIn(
                balancesIn,
                balancesOut,
                amountTokenIn,
                amountTokenOut,
                _weight0,
                _weight1
            );

            // 'amountOut' is the result of 'onVirtualSwap'
            // 'amountsInForVirtualSwap' is the input amount used when calling 'onVirtualSwap'
            (
                amountOut,
                amountsInForVirtualSwap,
                protocolSwapFeeAmount
            ) = _doVirtualSwap(
                amountTokenIn,
                amountTokenOut,
                amountsInForVirtualSwap,
                _token0,
                protocolSwapFeePercentage,
                balancesIn,
                balancesOut
            );
            actualJoinAmountsIn[0] = amountTokenIn - amountsInForVirtualSwap;
            actualJoinAmountsIn[1] = amountTokenOut + amountOut;
        } else {
            uint256 balancesIn = balances[1];
            uint256 balancesOut = balances[0];
            uint256 amountTokenIn = amountsIn[1];
            uint256 amountTokenOut = amountsIn[0];

            uint256 amountsInForVirtualSwap = _calculateVirtualSwapAmountIn(
                balancesIn,
                balancesOut,
                amountTokenIn,
                amountTokenOut,
                _weight1,
                _weight0
            );

            // 'amountOut' is the result of 'onVirtualSwap'
            // 'amountsInForVirtualSwap' is the input amount used when calling 'onVirtualSwap'
            (
                amountOut,
                amountsInForVirtualSwap,
                protocolSwapFeeAmount
            ) = _doVirtualSwap(
                amountTokenIn,
                amountTokenOut,
                amountsInForVirtualSwap,
                _token1,
                protocolSwapFeePercentage,
                balancesIn,
                balancesOut
            );

            actualJoinAmountsIn[0] = amountTokenOut + amountOut;
            actualJoinAmountsIn[1] = amountTokenIn - amountsInForVirtualSwap;
        }
        return (actualJoinAmountsIn, protocolSwapFeeAmount);
    }

    function _joinTokenInForHPTOut(
        uint256[] memory balances,
        uint256[] memory weights,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        private
        returns (
            uint256 hptAmountOut,
            uint256[] memory amountsIn,
            uint256[] memory protocolSwapFeeAmount,
            uint256 minHPTAmountOut
        )
    {
        uint256 amountIn;
        uint256 tokenIndex;
        (amountIn, tokenIndex, minHPTAmountOut) = userData
            .exactTokenInForHptOut();
        _require(tokenIndex < 2, Errors.OUT_OF_BOUNDS);

        // Storing in local variables to avoid stack too deep
        uint256[] memory _balances = balances;
        uint256 _protocolSwapFeePercentage = protocolSwapFeePercentage;

        amountsIn = new uint256[](2);
        amountsIn[tokenIndex] = amountIn;

        _upscaleArray(amountsIn);

        uint256 amountInForVirtualSwap;

        // Block scope to avoid stack too deep
        {
            // Calculating "actual" amountIn (of the token which user is providing) according to the
            // weight of that token in the pool
            uint256 actualAmountIn = weights[tokenIndex].mulDown(
                amountsIn[tokenIndex]
            );

            // 'amountInForVirtualSwap' contains the extra amount of tokens user is providing to join the pool,
            // we will swap this amount for the other token
            amountInForVirtualSwap = amountsIn[tokenIndex] - actualAmountIn;
        }

        // Determing which is tokenIn and which is tokenOut
        (
            IERC20 tokenInForVirtualSwap,
            IERC20 tokenOutForVirtualSwap
        ) = tokenIndex == 0 ? (_token0, _token1) : (_token1, _token0);

        // We have the Pool balances, but we don't know which one is 'token in' or 'token out'
        uint256 balanceIn;
        uint256 balanceOut;

        // Because token 0 has a smaller address than token 1
        if (tokenInForVirtualSwap < tokenOutForVirtualSwap) {
            // in is _token0, out is _token1
            balanceIn = _balances[0];
            balanceOut = _balances[1];
        } else {
            // in is _token1, out is _token0
            balanceOut = _balances[0];
            balanceIn = _balances[1];
        }

        uint256 amountOut;
        protocolSwapFeeAmount = new uint256[](2);

        // 'amountOut' is the result of 'onVirtualSwap'
        // 'amountsInForVirtualSwap' is the input amount used when calling 'onVirtualSwap'
        (
            amountOut,
            amountInForVirtualSwap,
            protocolSwapFeeAmount
        ) = _doVirtualSwap(
            amountsIn[tokenIndex],
            0,
            amountInForVirtualSwap,
            tokenInForVirtualSwap,
            _protocolSwapFeePercentage,
            balanceIn,
            balanceOut
        );

        // To store 'virtual join amounts' for '_calculateHptOut'
        uint256[] memory virtualAmountsInForTokensJoin = new uint256[](2);
        (
            virtualAmountsInForTokensJoin[0],
            virtualAmountsInForTokensJoin[1]
        ) = tokenIndex == 0
            ? (amountsIn[tokenIndex] - amountInForVirtualSwap, amountOut)
            : (amountOut, amountsIn[tokenIndex] - amountInForVirtualSwap);

        hptAmountOut = _calculateHptOut(
            _balances,
            virtualAmountsInForTokensJoin
        );
    }

    function _calculateHptOut(
        uint256[] memory balances,
        uint256[] memory actualJoinAmountsIn
    ) private view returns (uint256 hptAmountOut) {
        hptAmountOut = WeightedMath._calcHptOutGivenExactTokensIn(
            balances,
            _weights(),
            actualJoinAmountsIn,
            totalSupply(),
            getSwapFeePercentage()
        );
    }

    function _doVirtualSwap(
        uint256 amountIn,
        uint256 amountOutIn,
        uint256 amountInForVirtualSwap,
        IERC20 tokenInForVirtualSwap,
        uint256 protocolSwapFeePercentage,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut
    )
        private
        returns (
            uint256 amountOut,
            uint256 amountInLastForVirtualSwap,
            uint256[] memory protocolSwapFeeAmount
        )
    {
        (
            bool tokenInIsToken0,
            uint256 weightIn,
            ,
            ,

        ) = getWeightsAndScalingFactors(tokenInForVirtualSwap);

        uint256 protocolSwapFee;
        for (uint256 i = 0; i < 3; i++) {
            if (i != 2) {
                amountOut = _calcSwapOut(
                    tokenInForVirtualSwap,
                    amountInForVirtualSwap,
                    balanceTokenIn,
                    balanceTokenOut
                );

                amountInForVirtualSwap = _calculateNextIterationAmountIn(
                    amountIn,
                    // AmountOutIn should be zero incase of single token join
                    amountOutIn,
                    amountInForVirtualSwap,
                    weightIn,
                    amountOut,
                    balanceTokenIn,
                    balanceTokenOut
                );
            } else {
                (amountOut, protocolSwapFee) = _onVirtualSwap(
                    tokenInForVirtualSwap,
                    amountInForVirtualSwap,
                    balanceTokenIn,
                    balanceTokenOut,
                    protocolSwapFeePercentage
                );
            }
        }
        protocolSwapFeeAmount = new uint256[](2);

        // Will pay protocol swap fee in amountIn token
        uint256 protocolFeeTokenIndex = tokenInIsToken0 ? 0 : 1;
        protocolSwapFeeAmount[protocolFeeTokenIndex] = protocolSwapFee;
        amountInLastForVirtualSwap = amountInForVirtualSwap;
    }

    // Exit Hook

    function onExitPool(
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    ) external onlyRouter returns (uint256[] memory, uint256[] memory) {
        _upscaleArray(balances);
        (
            uint256 hptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory protocolSwapFeeAmount
        ) = _onExitPool(
                sender,
                recipient,
                balances,
                protocolSwapFeePercentage,
                userData
            );

        _burn(sender, hptAmountIn);

        _downscaleDownArray(amountsOut);

        return (amountsOut, protocolSwapFeeAmount);
    }

    /**
     * @dev Called whenever the Pool is exited.
     *
     * Returns the amount of HPT to burn, the token amounts for each Pool token that the Pool will grant in return, and
     * the number of tokens to pay in protocol swap fees.
     *
     * HPT will be burnt from `sender`.
     *
     * The Pool will grant tokens to `recipient`. These amounts are considered upscaled and will be downscaled
     * (rounding down) before being returned to the Vault.
     */
    function _onExitPool(
        address,
        address,
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        private
        returns (
            uint256 hptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory protocolSwapFeeAmount
        )
    {
        (hptAmountIn, amountsOut, protocolSwapFeeAmount) = _doExit(
            balances,
            protocolSwapFeePercentage,
            userData
        );
        return (hptAmountIn, amountsOut, protocolSwapFeeAmount);
    }

    function _doExit(
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        private
        returns (
            uint256 hptAmountIn,
            uint256[] memory amountsOut,
            uint256[] memory protocolSwapFeeAmount
        )
    {
        // Note that there is no minimum amountOut parameter: this is handled by `Router.exitPool`.
        uint256 weightInputToken0;
        (hptAmountIn, weightInputToken0) = userData.exactHptInForTokensOut();

        // Ensure that the input weight is not more than 1
        _require(
            weightInputToken0 <= FixedPoint.ONE,
            Errors.NORMALIZED_WEIGHT_INVARIANT
        );

        uint256 weightInputToken1 = ONE - weightInputToken0;

        // 'amountsOut' contains amount of both tokens in the pool according to the pool ratio
        amountsOut = WeightedMath._calcTokensOutGivenExactHptIn(
            balances,
            hptAmountIn,
            totalSupply()
        );

        protocolSwapFeeAmount = new uint256[](2);
        uint256 protocolSwapFee;

        // If user wants to exit with weights that are different than pool's
        if (!(_weight0 == weightInputToken0 && _weight1 == weightInputToken1)) {
            uint256 amountOut;

            if (_weight0 > weightInputToken0) {
                uint256 amountInForVirtualSwap = amountsOut[0]
                    .divDown(_weight0)
                    .mulDown(_weight0 - weightInputToken0);

                (amountOut, protocolSwapFee) = _onVirtualSwap(
                    _token0,
                    amountInForVirtualSwap,
                    balances[0] - amountsOut[0],
                    balances[1] - amountsOut[1],
                    protocolSwapFeePercentage
                );

                amountsOut[0] = amountsOut[0] - amountInForVirtualSwap;
                amountsOut[1] = amountsOut[1] + amountOut;

                // Will pay protocol swap fee in amountIn token
                // 0 index, cause token in will be _token0
                protocolSwapFeeAmount[0] = protocolSwapFee;
            } else {
                uint256 amountInForVirtualSwap = amountsOut[1]
                    .divDown(_weight1)
                    .mulDown(_weight1 - weightInputToken1);

                (amountOut, protocolSwapFee) = _onVirtualSwap(
                    _token1,
                    amountInForVirtualSwap,
                    balances[1] - amountsOut[1],
                    balances[0] - amountsOut[0],
                    protocolSwapFeePercentage
                );

                amountsOut[1] = amountsOut[1] - amountInForVirtualSwap;
                amountsOut[0] = amountsOut[0] + amountOut;

                // Will pay protocol swap fee in amountIn token
                // 1 index, cause token in will be _token1
                protocolSwapFeeAmount[1] = protocolSwapFee;
            }
        }
    }

    // Helpers

    // Scaling

    /**
     * @dev Returns a scaling factor that, when multiplied to a token amount for `token`, normalizes its balance as if
     * it had 18 decimals.
     */
    function _computeScalingFactor(IERC20 token)
        private
        view
        returns (uint256)
    {
        // Tokens that don't implement the `decimals` method are not supported.
        uint256 tokenDecimals = ERC20(address(token)).decimals();

        // Tokens with more than 18 decimals are not supported.
        uint256 decimalsDifference = 18 - tokenDecimals;
        return 10**decimalsDifference;
    }

    /**
     * @dev Returns the scaling factor for one of the Pool's tokens.
     */
    function _scalingFactor(bool token0) private view returns (uint256) {
        return token0 ? _scalingFactor0 : _scalingFactor1;
    }

    /**
     * @dev Applies `scalingFactor` to `amount`, resulting in a larger or equal value depending on whether it needed
     * scaling or not.
     */
    function _upscale(uint256 amount, uint256 scalingFactor)
        private
        pure
        returns (uint256)
    {
        return amount * scalingFactor;
    }

    /**
     * @dev Same as `_upscale`, but for an entire array (of two elements). This function does not return anything, but
     * instead *mutates* the `amounts` array.
     */
    function _upscaleArray(uint256[] memory amounts) private view {
        amounts[0] = amounts[0] * _scalingFactor(true);
        amounts[1] = amounts[1] * _scalingFactor(false);
    }

    /**
     * @dev Reverses the `scalingFactor` applied to `amount`, resulting in a smaller or equal value depending on
     * whether it needed scaling or not. The result is rounded down.
     */
    function _downscaleDown(uint256 amount, uint256 scalingFactor)
        private
        pure
        returns (uint256)
    {
        return Math.divDown(amount, scalingFactor);
    }

    /**
     * @dev Same as `_downscaleDown`, but for an entire array (of two elements). This function does not return anything,
     * but instead *mutates* the `amounts` array.
     */
    function _downscaleDownArray(uint256[] memory amounts) private view {
        amounts[0] = Math.divDown(amounts[0], _scalingFactor(true));
        amounts[1] = Math.divDown(amounts[1], _scalingFactor(false));
    }

    /**
     * @dev Reverses the `scalingFactor` applied to `amount`, resulting in a smaller or equal value depending on
     * whether it needed scaling or not. The result is rounded up.
     */
    function _downscaleUp(uint256 amount, uint256 scalingFactor)
        private
        pure
        returns (uint256)
    {
        return Math.divUp(amount, scalingFactor);
    }

    /**
     * @dev Same as `_downscaleUp`, but for an entire array (of two elements). This function does not return anything,
     * but instead *mutates* the `amounts` array.
     */
    function _downscaleUpArray(uint256[] memory amounts) private view {
        amounts[0] = Math.divUp(amounts[0], _scalingFactor(true));
        amounts[1] = Math.divUp(amounts[1], _scalingFactor(false));
    }
}
