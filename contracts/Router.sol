// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./lib/helpers/InputHelpers.sol";
import "./Vault.sol";
import "./interfaces/IHedgeFactory.sol";
import "./interfaces/IPool.sol";
import "./lib/openzeppelin/SafeCast.sol";
import "./lib/openzeppelin/ReentrancyGuard.sol";
import "./lib/openzeppelin/Ownable.sol";

contract Router is Vault, ReentrancyGuard, Ownable {
    IHedgeFactory public Factory;
    using SafeCast for uint256;

    enum PoolBalanceChangeKind {
        JOIN,
        EXIT
    }

    struct JoinPoolRequest {
        IERC20[] tokens;
        uint256[] maxAmountsIn;
        bytes userData;
    }
    struct ExitPoolRequest {
        IERC20[] tokens;
        uint256[] minAmountsOut;
        bytes userData;
    }

    // This has the exact same layout as JoinPoolRequest and ExitPoolRequest, except the `maxAmountsIn` and
    // `minAmountsOut` are called `limits`. Internally we use this struct for both since these two functions are quite
    // similar, but expose the others to callers for clarity.
    struct PoolBalanceChange {
        IERC20[] tokens;
        uint256[] limits;
        bytes userData;
    }

    struct SwapRequest {
        IERC20 tokenIn;
        IERC20 tokenOut;
        uint256 amount;
        address from;
        address to;
    }

    /**
     * @dev `tokenIn` and `tokenOut` are either token addresses, or zero address (for ETH).
     * Note that Pools never interact with ETH directly: it will be wrapped to or unwrapped from WETH by the Router.
     */
    struct SingleSwap {
        address tokenIn;
        address tokenOut;
        uint256 amount;
    }

    /**
     * @dev Data for each individual swap executed by `batchSwap`. The asset in and out fields are indexes into the
     * `assets` array passed to that function, and ETH assets are converted to WETH.
     *
     * If `amount` is zero, the multihop mechanism is used to determine the actual amount based on the amount in/out
     * from the previous swap, depending on the swap kind.
     */
    struct BatchSwapStep {
        uint256 assetInIndex;
        uint256 assetOutIndex;
        uint256 amount;
    }

    /**
     * @dev All tokens in a swap are either sent from the `sender` account to the Vault, or from the Vault to the
     * `recipient` account.
     */
    struct FundManagement {
        address sender;
        address payable recipient;
    }

    event FactoryAddressSet(address factoryAddress);

    event PoolBalanceChanged(
        address indexed liquidityProvider,
        IERC20[] tokens,
        int256[] deltas,
        uint256[] protocolFeeAmounts
    );

    /**
     * @dev Emitted for each individual swap performed by `swap` or `batchSwap`.
     */
    event Swap(
        IERC20 indexed tokenIn,
        IERC20 indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolSwapFeeAmount
    );

    constructor(IWETH _weth) AssetHelpers(_weth) {}

    function setHedgeFactory(IHedgeFactory _factory) external onlyOwner {
        _require(address(_factory) != address(0), Errors.ZERO_TOKEN);
        _require(address(Factory) == address(0), Errors.FACTORY_ALREADY_SET);
        Factory = _factory;
        emit FactoryAddressSet(address(_factory));
    }

    /**
     * @dev Converts a JoinPoolRequest into a PoolBalanceChange, with no runtime cost.
     */
    function _toPoolBalanceChange(JoinPoolRequest memory request)
        private
        pure
        returns (PoolBalanceChange memory change)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            change := request
        }
    }

    /**
     * @dev Converts an ExitPoolRequest into a PoolBalanceChange, with no runtime cost.
     */
    function _toPoolBalanceChange(ExitPoolRequest memory request)
        private
        pure
        returns (PoolBalanceChange memory change)
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            change := request
        }
    }

    function joinPool(address recipient, JoinPoolRequest memory request)
        external
        payable
    {
        _require(recipient != address(0), Errors.ZERO_ADDRESS);

        // This function doesn't have the nonReentrant modifier: it is applied to `_joinOrExit` instead.

        _joinOrExit(
            PoolBalanceChangeKind.JOIN,
            msg.sender,
            payable(recipient),
            _toPoolBalanceChange(request)
        );
    }

    function exitPool(address sender, ExitPoolRequest memory request) external {
        _require(sender != address(0), Errors.ZERO_ADDRESS);

        // This function doesn't have the nonReentrant modifier: it is applied to `_joinOrExit` instead.
        _joinOrExit(
            PoolBalanceChangeKind.EXIT,
            sender,
            payable(msg.sender),
            _toPoolBalanceChange(request)
        );
    }

    /**
     * @dev Implements both `joinPool` and `exitPool`, based on `kind`.
     */
    function _joinOrExit(
        PoolBalanceChangeKind kind,
        address sender,
        address payable recipient,
        PoolBalanceChange memory change
    ) private nonReentrant {
        // This function uses a large number of stack variables (sender and recipient, balances, amounts, fees,
        // etc.), which leads to 'stack too deep' issues. It relies on private functions with seemingly arbitrary
        // interfaces to work around this limitation.
        InputHelpers.ensureInputLengthMatch(2, change.limits.length);

        // We first check that the caller passed the Pool's tokens in the correct order, and retrieve the
        // current balance for each.
        IERC20[] memory tokens = _translateToIERC20(change.tokens);

        // Getting pool address from tokens array because in case of ETH join, any one index of change.tokens array will
        // have zero address
        address pool = Factory.getPool(address(tokens[0]), address(tokens[1]));

        uint256[] memory balances = _validateTokensAndGetBalances(tokens, pool);

        // The bulk of the work is done here: the corresponding Pool hook is called, its final balances are computed,
        // assets are transferred, and fees are paid.
        (
            uint256[] memory finalBalances,
            uint256[] memory amountsInOrOut,
            uint256[] memory paidProtocolSwapFeeAmounts
        ) = _callPoolBalanceChange(
                kind,
                sender,
                recipient,
                change,
                balances,
                pool
            );

        IPool(pool).setPoolBalancesAndLastChangeBlock(
            finalBalances[0],
            finalBalances[1]
        );

        // Amounts in are positive, out are negative
        bool positive = kind == PoolBalanceChangeKind.JOIN;

        emit PoolBalanceChanged(
            sender,
            tokens, // We can unsafely cast to int256 because balances are actually stored as uint112
            _unsafeCastToInt256(amountsInOrOut, positive),
            paidProtocolSwapFeeAmounts
        );
    }

    /**
     * @dev Calls the corresponding Pool hook to get the amounts in/out plus protocol fee amounts, and performs the
     * associated token transfers and fee payments, returning the Pool's final balances.
     */
    function _callPoolBalanceChange(
        PoolBalanceChangeKind kind,
        address sender,
        address payable recipient,
        PoolBalanceChange memory change,
        uint256[] memory balances,
        address pool
    )
        private
        returns (
            uint256[] memory finalBalances,
            uint256[] memory amountsInOrOut,
            uint256[] memory protocolFeeAmounts
        )
    {
        (amountsInOrOut, protocolFeeAmounts) = kind ==
            PoolBalanceChangeKind.JOIN
            ? IPool(pool).onJoinPool(
                sender,
                recipient,
                balances,
                Factory._getProtocolSwapFeePercentage(),
                change.userData
            )
            : IPool(pool).onExitPool(
                sender,
                recipient,
                balances,
                Factory._getProtocolSwapFeePercentage(),
                change.userData
            );

        // The Router ignores the `recipient` in joins and the `sender` in exits: it is up to the Pool to keep track of
        // their participation.
        finalBalances = kind == PoolBalanceChangeKind.JOIN
            ? _processJoinPoolTransfers(
                sender,
                change,
                balances,
                amountsInOrOut,
                protocolFeeAmounts
            )
            : _processExitPoolTransfers(
                recipient,
                change,
                balances,
                amountsInOrOut,
                protocolFeeAmounts
            );
    }

    /**
     * @dev Transfers `amountsIn` from `sender`, checking that they are within their accepted limits, and pays
     * protocol swap fees.
     *
     * Returns the Pool's final balances, which are the current balances plus `amountsIn` minus protocol
     * swap fees.
     */
    function _processJoinPoolTransfers(
        address sender,
        PoolBalanceChange memory change,
        uint256[] memory balances,
        uint256[] memory amountsIn,
        uint256[] memory protocolFeeAmounts
    ) private returns (uint256[] memory finalBalances) {
        // We need to track how much of the received ETH was used and wrapped into WETH to return any excess.
        uint256 wrappedEth = 0;

        finalBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < 2; ++i) {
            uint256 amountIn = amountsIn[i];

            _require(amountIn <= change.limits[i], Errors.JOIN_ABOVE_MAX);

            _receiveAsset(address(change.tokens[i]), amountIn, sender);

            if (_isETH(address(change.tokens[i]))) {
                wrappedEth = wrappedEth + amountIn;
            }

            uint256 feeAmount = protocolFeeAmounts[i];
            _payFeeAmount(
                Factory.getProtocolFeesCollector(),
                change.tokens[i],
                feeAmount
            );

            // Compute the new Pool balances. Note that the fee amount might be larger than `amountIn`,
            // resulting in an overall decrease of the Pool's balance for a token.
            finalBalances[i] = (amountIn >= feeAmount) // This lets us skip checked arithmetic
                ? balances[i] + (amountIn - feeAmount)
                : balances[i] - (feeAmount - amountIn);
        }

        // Handle any used and remaining ETH.
        _handleRemainingEth(wrappedEth);
    }

    /**
     * @dev Transfers `amountsOut` to `recipient`, checking that they are within their accepted limits, and pays
     * protocol swap fees from the Pool.
     *
     * Returns the Pool's final balances, which are the current `balances` minus `amountsOut` and fees paid
     */
    function _processExitPoolTransfers(
        address payable recipient,
        PoolBalanceChange memory change,
        uint256[] memory balances,
        uint256[] memory amountsOut,
        uint256[] memory dueProtocolFeeAmounts
    ) private returns (uint256[] memory finalBalances) {
        finalBalances = new uint256[](balances.length);
        for (uint256 i = 0; i < 2; ++i) {
            uint256 amountOut = amountsOut[i];
            _require(amountOut >= change.limits[i], Errors.EXIT_BELOW_MIN);
            // Send tokens to the recipient
            _sendAsset(address(change.tokens[i]), amountOut, recipient);

            uint256 feeAmount = dueProtocolFeeAmounts[i];
            _payFeeAmount(
                Factory.getProtocolFeesCollector(),
                change.tokens[i],
                feeAmount
            );

            // Compute the new Pool balances. A Pool's token balance always decreases after an exit (potentially by 0).
            finalBalances[i] = balances[i] - (amountOut + feeAmount);
        }
    }

    // Swap

    function swap(
        SingleSwap memory singleSwap,
        FundManagement memory funds,
        uint256 limit,
        uint256 deadline
    ) external payable nonReentrant returns (uint256 amountCalculated) {
        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        _require(block.timestamp <= deadline, Errors.SWAP_DEADLINE);

        // This revert reason is for consistency with `batchSwap`: an equivalent `swap` performed using that function
        // would result in this error.
        _require(singleSwap.amount > 0, Errors.UNKNOWN_AMOUNT_IN_FIRST_SWAP);

        IERC20 tokenIn = _translateToIERC20(singleSwap.tokenIn);
        IERC20 tokenOut = _translateToIERC20(singleSwap.tokenOut);
        _require(tokenIn != tokenOut, Errors.CANNOT_SWAP_SAME_TOKEN);

        // Initializing each struct field one-by-one uses less gas than setting all at once.
        SwapRequest memory poolRequest;
        poolRequest.tokenIn = tokenIn;
        poolRequest.tokenOut = tokenOut;
        poolRequest.amount = singleSwap.amount;
        poolRequest.from = funds.sender;
        poolRequest.to = funds.recipient;

        uint256 amountIn;
        uint256 amountOut;
        uint256 protocolSwapFeeAmount;

        (
            amountCalculated,
            amountIn,
            amountOut,
            protocolSwapFeeAmount
        ) = _swapWithPool(poolRequest);
        _require(amountOut >= limit, Errors.SWAP_LIMIT);

        _receiveAsset(singleSwap.tokenIn, amountIn, funds.sender);
        _sendAsset(singleSwap.tokenOut, amountOut, funds.recipient);

        _payFeeAmount(
            Factory.getProtocolFeesCollector(),
            tokenIn,
            protocolSwapFeeAmount
        );

        // If the asset in is ETH, then `amountIn` ETH was wrapped into WETH.
        _handleRemainingEth(_isETH(singleSwap.tokenIn) ? amountIn : 0);
    }

    /**
     * @dev Performs a swap according to the parameters specified in `request`, calling the Pool's contract hook and
     * updating the Pool's balance.
     *
     * Returns the amount of tokens going into or out of the Vault as a result of this swap, depending on the swap kind.
     */
    function _swapWithPool(SwapRequest memory request)
        private
        returns (
            uint256 amountCalculated,
            uint256 amountIn,
            uint256 amountOut,
            uint256 protocolSwapFeeAmount
        )
    {
        // Get the calculated amount from the Pool and update its balances
        address pool = Factory.getPool(
            address(request.tokenIn),
            address(request.tokenOut)
        );
        (amountCalculated, protocolSwapFeeAmount) = _processPoolSwapRequest(
            request,
            pool
        );

        amountIn = request.amount;
        amountOut = amountCalculated;
        emit Swap(
            request.tokenIn,
            request.tokenOut,
            amountIn,
            amountOut,
            protocolSwapFeeAmount
        );
    }

    function _processPoolSwapRequest(SwapRequest memory request, address pool)
        private
        returns (uint256 amountCalculated, uint256 protocolSwapFeeAmount)
    {
        (, uint256[] memory balances) = IPool(pool).getPoolTokensAndBalances();

        // We have the Pool balances, but we don't know which one is 'token in' or 'token out'.
        uint256 tokenInBalance;
        uint256 tokenOutBalance;

        // Cause token 0 has a smaller address than token 1
        if (request.tokenIn < request.tokenOut) {
            // in is 0, out is 1
            tokenInBalance = balances[0];
            tokenOutBalance = balances[1];
        } else {
            // in is 1, out is 0
            tokenOutBalance = balances[0];
            tokenInBalance = balances[1];
        }

        // Perform the swap request and compute the new balances for 'token in' and 'token out' after the swap
        (
            tokenInBalance,
            tokenOutBalance,
            amountCalculated,
            protocolSwapFeeAmount
        ) = _callPoolOnSwapHook(request, pool, tokenInBalance, tokenOutBalance);

        // Update pool balances
        // We check the token ordering again to update respective token balances
        request.tokenIn < request.tokenOut
            ? IPool(pool).setPoolBalancesAndLastChangeBlock(
                tokenInBalance,
                tokenOutBalance
            ) // in is A, out is B
            : IPool(pool).setPoolBalancesAndLastChangeBlock(
                tokenOutBalance,
                tokenInBalance
            ); // in is B, out is A
    }

    /**
     * @dev Calls the onSwap hook of a Pool
     */
    function _callPoolOnSwapHook(
        SwapRequest memory request,
        address pool,
        uint256 tokenInBalance,
        uint256 tokenOutBalance
    )
        private
        returns (
            uint256 newTokenInBalance,
            uint256 newTokenOutBalance,
            uint256 amountCalculated,
            uint256 protocolSwapFeeAmount
        )
    {
        // Perform the swap request callback, and compute the new balances for 'token in' and 'token out' after the swap
        (amountCalculated, protocolSwapFeeAmount) = IPool(pool).onSwap(
            request.tokenIn,
            request.amount,
            tokenInBalance,
            tokenOutBalance,
            Factory._getProtocolSwapFeePercentage()
        );

        newTokenInBalance =
            tokenInBalance +
            (request.amount - protocolSwapFeeAmount);
        newTokenOutBalance = tokenOutBalance - (amountCalculated);
    }

    function batchSwap(
        BatchSwapStep[] memory swaps,
        address[] memory assets,
        FundManagement memory funds,
        int256[] memory limits,
        uint256 deadline
    ) external payable nonReentrant returns (int256[] memory assetDeltas) {
        // The deadline is timestamp-based: it should not be relied upon for sub-minute accuracy.
        // solhint-disable-next-line not-rely-on-time
        _require(block.timestamp <= deadline, Errors.SWAP_DEADLINE);

        InputHelpers.ensureInputLengthMatch(assets.length, limits.length);

        uint256[] memory protocolSwapFees = new uint256[](assets.length - 1);

        // Perform the swaps, updating the Pool token balances and computing the net Vault asset deltas.
        (assetDeltas, protocolSwapFees) = _swapWithPools(swaps, assets, funds);

        // Process asset deltas, by either transferring assets from the sender (for positive deltas) or to the recipient
        // (for negative deltas).
        uint256 wrappedEth = 0;
        for (uint256 i = 0; i < assets.length; ++i) {
            address asset = assets[i];
            int256 delta = assetDeltas[i];
            _require(delta <= limits[i], Errors.SWAP_LIMIT);

            if (delta > 0) {
                uint256 toReceive = uint256(delta);
                _receiveAsset(asset, toReceive, funds.sender);

                if (_isETH(asset)) {
                    wrappedEth = wrappedEth + toReceive;
                }
            } else if (delta < 0) {
                uint256 toSend = uint256(-delta);
                _sendAsset(asset, toSend, funds.recipient);
            }

            _payFeeAmount(
                Factory.getProtocolFeesCollector(),
                IERC20(asset),
                protocolSwapFees[i]
            );
        }

        // Handle any used and remaining ETH.
        _handleRemainingEth(wrappedEth);
    }

    /**
     * @dev Performs all `swaps`, calling swap hooks on the Pool contracts and updating their balances. Does not cause
     * any transfer of tokens - instead it returns the net Vault token deltas: positive if the Vault should receive
     * tokens, and negative if it should send them.
     */
    function _swapWithPools(
        BatchSwapStep[] memory swaps,
        address[] memory assets,
        FundManagement memory funds
    )
        private
        returns (int256[] memory assetDeltas, uint256[] memory protocolSwapFees)
    {
        assetDeltas = new int256[](assets.length);

        // Because protocol swap fee is not charged on 'amountOut'
        protocolSwapFees = new uint256[](assets.length - 1);

        // These variables could be declared inside the loop, but that causes the compiler to allocate memory on each
        // loop iteration, increasing gas costs.
        BatchSwapStep memory batchSwapStep;
        SwapRequest memory poolRequest;

        // These store data about the previous swap here to implement multihop logic across swaps.
        IERC20 previousTokenCalculated;
        uint256 previousAmountCalculated;

        for (uint256 i = 0; i < swaps.length; ++i) {
            batchSwapStep = swaps[i];

            bool withinBounds = batchSwapStep.assetInIndex < assets.length &&
                batchSwapStep.assetOutIndex < assets.length;
            _require(withinBounds, Errors.OUT_OF_BOUNDS);

            IERC20 tokenIn = _translateToIERC20(
                assets[batchSwapStep.assetInIndex]
            );
            IERC20 tokenOut = _translateToIERC20(
                assets[batchSwapStep.assetOutIndex]
            );
            _require(tokenIn != tokenOut, Errors.CANNOT_SWAP_SAME_TOKEN);

            // Sentinel value for multihop logic
            if (batchSwapStep.amount == 0) {
                // When the amount given is zero, we use the calculated amount for the previous swap, as long as the
                // current swap's given token is the previous calculated token. This makes it possible to swap a
                // given amount of token A for token B, and then use the resulting token B amount to swap for token C.
                _require(i > 0, Errors.UNKNOWN_AMOUNT_IN_FIRST_SWAP);
                bool usingPreviousToken = previousTokenCalculated == tokenIn;
                _require(
                    usingPreviousToken,
                    Errors.MALCONSTRUCTED_MULTIHOP_SWAP
                );
                batchSwapStep.amount = previousAmountCalculated;
            }

            // Initializing each struct field one-by-one uses less gas than setting all at once
            poolRequest.tokenIn = tokenIn;
            poolRequest.tokenOut = tokenOut;
            poolRequest.amount = batchSwapStep.amount;
            poolRequest.from = funds.sender;
            poolRequest.to = funds.recipient;

            uint256 amountIn;
            uint256 amountOut;
            uint256 protocolSwapFeeAmount;

            (
                previousAmountCalculated,
                amountIn,
                amountOut,
                protocolSwapFeeAmount
            ) = _swapWithPool(poolRequest);

            previousTokenCalculated = tokenOut;

            // Accumulate Vault deltas across swaps
            assetDeltas[batchSwapStep.assetInIndex] =
                assetDeltas[batchSwapStep.assetInIndex] +
                amountIn.toInt256();
            assetDeltas[batchSwapStep.assetOutIndex] =
                assetDeltas[batchSwapStep.assetOutIndex] -
                amountOut.toInt256();
            protocolSwapFees[
                batchSwapStep.assetInIndex
            ] += protocolSwapFeeAmount;
        }
    }

    /**
     * @dev Returns the total balance for `pool's` `expectedTokens`.
     *
     * `expectedTokens` must exactly equal the token array returned by `getPoolTokensAndBalances`: both arrays must have the
     * same length, elements and order.
     */
    function _validateTokensAndGetBalances(
        IERC20[] memory expectedTokens,
        address pool
    ) private view returns (uint256[] memory) {
        (IERC20[] memory actualTokens, uint256[] memory balances) = IPool(pool)
            .getPoolTokensAndBalances();

        for (uint256 i = 0; i < actualTokens.length; ++i) {
            _require(
                actualTokens[i] == expectedTokens[i],
                Errors.TOKENS_MISMATCH
            );
        }

        return balances;
    }

    /**
     * @dev Casts an array of uint256 to int256, setting the sign of the result according to the `positive` flag,
     * without checking whether the values fit in the signed 256 bit range.
     */
    function _unsafeCastToInt256(uint256[] memory values, bool positive)
        private
        pure
        returns (int256[] memory signedValues)
    {
        signedValues = new int256[](values.length);
        for (uint256 i = 0; i < values.length; i++) {
            signedValues[i] = positive ? int256(values[i]) : -int256(values[i]);
        }
    }
}
