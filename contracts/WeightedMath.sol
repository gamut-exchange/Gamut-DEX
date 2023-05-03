// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./lib/math/Math.sol";
import "./lib/math/FixedPoint.sol";
import "./lib/openzeppelin/SafeCast.sol";

/* solhint-disable private-vars-leading-underscore */

contract WeightedMath {
    using FixedPoint for uint256;
    using SafeCast for uint256;

    uint256 internal constant ONE = 1e18; // 18 decimal places

    // Invariant is used to initiate the HPT amount and,
    // because there is a minimum HPT, we round down the invariant.
    function _calculateInvariant(
        uint256[] memory normalizedWeights,
        uint256[] memory balances
    ) internal pure returns (uint256 invariant) {
        /**********************************************************************************************
        // invariant               _____                                                             //
        // wi = weight index i      | |      wi                                                      //
        // bi = balance index i     | |  bi ^   = i                                                  //
        // i = invariant                                                                             //
        **********************************************************************************************/

        invariant = FixedPoint.ONE;
        for (uint256 i = 0; i < normalizedWeights.length; i++) {
            invariant = invariant.mulDown(
                balances[i].powDown(normalizedWeights[i])
            );
        }

        _require(invariant > 0, Errors.ZERO_INVARIANT);
    }

    // Computes how many tokens can be taken out of a pool if `amountIn` are sent, given the
    // current balances and weights.
    function _calcOutGivenIn(
        uint256 balanceIn,
        uint256 weightIn,
        uint256 balanceOut,
        uint256 weightOut,
        uint256 amountIn
    ) internal pure returns (uint256) {
        _require(amountIn > 0, Errors.ZERO_AMOUNT_IN);
        _require(balanceIn > 0 && balanceOut > 0, Errors.EMPTY_POOL_BALANCES);
        uint256 exponentFracFraction = balanceIn.divDown(balanceIn + amountIn);
        uint256 exponentFraction = (ONE - exponentFracFraction).divDown(
            ONE + exponentFracFraction
        );

        uint256 exponentNumerator = weightIn -
            (weightIn.mulDown(exponentFraction));
        uint256 exponentDenominator = weightOut +
            (weightIn.mulDown(exponentFraction));

        uint256 exponent = exponentNumerator.divDown(exponentDenominator);

        uint256 amountOut = ONE - exponentFracFraction.powUp(exponent);
        amountOut = balanceOut.mulDown(amountOut);
        _require(amountOut < balanceOut, Errors.INSUFFICIENT_POOL_BALANCES);
        return amountOut;
    }

    function _calculateNewWeights(
        uint256 weightInOld,
        uint256 weightOutOld,
        uint256 balanceOutOld,
        uint256 balanceOutNew,
        uint256 balanceInOld,
        uint256 balanceInNew
    ) internal pure returns (uint256 weightInNew, uint256 weightOutNew) {
        uint256 baseWeightInNew;
        uint256 baseWeightOutNew;
        uint256 numerator;
        uint256 denominator;
        if (weightInOld < weightOutOld) {
            denominator = weightInOld.divDown(weightOutOld) + ONE;
            numerator = (ONE - (ONE.divDown(balanceInNew).mulUp(balanceInOld)))
                     * weightInOld;    
        } else {
            denominator = weightOutOld.divDown(weightInOld) + ONE;
            numerator = ((balanceOutOld.divDown(balanceOutNew)) - ONE)
                        * weightOutOld;
        }

        baseWeightOutNew = numerator / denominator;
        baseWeightInNew = numerator / denominator;
        weightOutNew = weightOutOld + baseWeightOutNew;
        weightInNew = weightInOld - baseWeightInNew;
    }

    // Join hook

    function _calcHptOutGivenExactTokensIn(
        uint256[] memory balances,
        uint256[] memory normalizedWeights,
        uint256[] memory amountsIn,
        uint256 hptTotalSupply,
        uint256 swapFee
    ) internal pure returns (uint256) {
        // HPT out, so we round down overall.

        uint256[] memory balanceRatiosWithFee = new uint256[](amountsIn.length);

        uint256 invariantRatioWithFees = 0;
        for (uint256 i = 0; i < balances.length; i++) {
            balanceRatiosWithFee[i] = (balances[i] + amountsIn[i]).divDown(
                balances[i]
            );
            invariantRatioWithFees =
                invariantRatioWithFees +
                (balanceRatiosWithFee[i].mulDown(normalizedWeights[i]));
        }

        uint256 invariantRatio = FixedPoint.ONE;
        for (uint256 i = 0; i < balances.length; i++) {
            uint256 amountInWithoutFee;

            if (balanceRatiosWithFee[i] > invariantRatioWithFees) {
                uint256 nonTaxableAmount = balances[i].mulDown(
                    invariantRatioWithFees - FixedPoint.ONE
                );
                uint256 taxableAmount = amountsIn[i] - nonTaxableAmount;
                amountInWithoutFee =
                    nonTaxableAmount +
                    (taxableAmount.mulDown(FixedPoint.ONE - swapFee));
            } else {
                amountInWithoutFee = amountsIn[i];
            }

            uint256 balanceRatio = (balances[i] + amountInWithoutFee).divDown(
                balances[i]
            );

            invariantRatio = invariantRatio.mulDown(
                balanceRatio.powDown(normalizedWeights[i])
            );
        }

        if (invariantRatio >= FixedPoint.ONE) {
            return hptTotalSupply.mulDown(invariantRatio - FixedPoint.ONE);
        } else {
            return 0;
        }
    }

    function _calculateVirtualSwapAmountIn(
        uint256 balanceIn,
        uint256 balanceOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 weightIn,
        uint256 weightOut
    ) internal pure returns (uint256 amountsInForVirtualSwap) {
        uint256 priceToken1OverToken0 = (
            (amountIn + balanceIn).divDown(weightIn)
        ).divDown((amountOut + balanceOut).divDown(weightOut));

        // Multiplying 'amountIn' by 0.5
        uint256 x = (amountIn * 500000000000000000).divDown(
            (amountOut * priceToken1OverToken0)
        );

        // Adding 'x' with 0.5
        uint256 weightToken0Input = ONE.divDown(x + 500000000000000000).mulDown(
            x
        );
        uint256 v = weightToken0Input - weightIn;

        amountsInForVirtualSwap = (
            (((amountIn * ONE) / weightToken0Input).mulDown(v))
        );
    }

    function _calculateNextIterationAmountIn(
        uint256 amountIn,
        uint256 amountOutIn,
        uint256 amountInForVirtualSwap,
        uint256 weightIn,
        uint256 amountOut,
        uint256 tokenTotalIn,
        uint256 tokenTotalOut
    ) internal pure returns (uint256) {
        uint256 tempTokenInBalance = tokenTotalIn + amountInForVirtualSwap;
        uint256 tempTokenOutBalance = tokenTotalOut - amountOut;

        uint256 tempVirtualBalancesRatio = tempTokenOutBalance.divDown(
            tempTokenInBalance
        );

        // Here 'amountOut' is the amount we got from '_calcSwapOut', and 'amountOutIn' is the amount of the 'amountOut'
        // token type provided by user
        // @Note 'amountOutIn' would be 0 in single join
        uint256 tempAmountInOutRatio = (amountOut + amountOutIn).divDown(
            amountIn - amountInForVirtualSwap
        );

        uint256 ratioDifferenceInPercentage = tempVirtualBalancesRatio.divDown(
            tempAmountInOutRatio
        );
        uint256 finalPercentage = uint256(
            ONE.toInt256() +
                ((ratioDifferenceInPercentage.toInt256() - ONE.toInt256()) *
                    weightIn.toInt256()) /
                ONE.toInt256()
        );
        amountInForVirtualSwap = amountInForVirtualSwap.mulDown(
            finalPercentage
        );
        return amountInForVirtualSwap;
    }

    // Exit hook

    function _calcTokensOutGivenExactHptIn(
        uint256[] memory balances,
        uint256 hptAmountIn,
        uint256 totalHPT
    ) internal pure returns (uint256[] memory) {
        /**********************************************************************************************
        // exactHPTInForTokensOut                                                                    //
        // (per token)                                                                               //
        // aO = amountOut                  /        hptIn         \                                  //
        // b = balance           a0 = b * | ---------------------  |                                 //
        // hptIn = hptAmountIn             \       totalHPT       /                                  //
        // hpt = totalHPT                                                                            //
        **********************************************************************************************/

        // Since we're computing an amount out, we round down overall. This means rounding down on both the
        // multiplication and division.

        uint256 hptRatio = hptAmountIn.divDown(totalHPT);
        uint256[] memory amountsOut = new uint256[](balances.length);
        for (uint256 i = 0; i < balances.length; i++) {
            amountsOut[i] = balances[i].mulDown(hptRatio);
        }

        return amountsOut;
    }
}
