// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../lib/openzeppelin/IERC20.sol";

/**
 * @dev Interface for managing pool balances, swapping, adding and removing liquidity.
 */
interface IPool {
    /**
     * @dev Called by the Router when a user calls `Router.joinPool` to add liquidity to this Pool. Returns how many of
     * each token the user should provide, as well as the amount of protocol swap fees (0 incase of no Virtual swap during the join)  to be sent to the Protocol Fees Collector.
     * The Vault will then take tokens from `sender` and add them to the Pool's balances, as well as sent
     * the reported amount in protocol fees to the Protocol fees collector, which the pool should calculate based on `protocolSwapFeePercentage`.
     *
     * `sender` is the account performing the join (from which tokens will be withdrawn), and `recipient` is the account
     * designated to receive any benefits (typically pool shares).
     */
    function onJoinPool(
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        external
        returns (
            uint256[] memory amountsIn,
            uint256[] memory protocolSwapFeeAmount
        );

    /**
     * @dev Called by the Router when a user calls `Router.exitPool` to remove liquidity from this Pool. Returns how many
     * tokens the Vault should deduct from the Pool's balances, as well as the amount of protocol swap fees (0 incase of no Virtual swap during the exit) the Vault should sent
     * to the Protocol Fees Collector. The Vault will then take tokens from the Pool's balances and send them to `recipient`,
     * as well as sent the reported amount in protocol swap fees to the Protocol fees collector, which the pool
     * should calculate based on `protocolSwapFeePercentage`.
     *
     * `sender` is the account performing the exit (typically the pool shareholder), and `recipient` is the account
     * to which the Vault will send the proceeds.
     */
    function onExitPool(
        address sender,
        address recipient,
        uint256[] memory balances,
        uint256 protocolSwapFeePercentage,
        bytes memory userData
    )
        external
        returns (
            uint256[] memory amountsOut,
            uint256[] memory dueProtocolFeeAmounts
        );

    /**
     * @dev Called by the Router when a user calls `Router.swap` or `Router.batchSwap` to trade tokens from this Pool.
     * Returns amount of output token user should receive, as well as the amount of protocol swap fees.
     */
    function onSwap(
        IERC20 tokenIn,
        uint256 amountIn,
        uint256 balanceTokenIn,
        uint256 balanceTokenOut,
        uint256 protocolSwapFeePercentage
    ) external returns (uint256, uint256);

    /**
     * @dev Called by the Router whenever someone Joins/ Exits the pool or when a trade occurs.
     */
    function setPoolBalancesAndLastChangeBlock(
        uint256 balance0,
        uint256 balance1
    ) external;

    function getPoolTokensAndBalances()
        external
        view
        returns (IERC20[] memory tokens, uint256[] memory balances);
}
