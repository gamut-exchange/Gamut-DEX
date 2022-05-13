// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IProtocolFeesCollector {
    function getProtocolSwapFeePercentage() external view returns (uint256);
}
