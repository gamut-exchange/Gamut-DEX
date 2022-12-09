// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

interface IGamutFactory {
    function getPool(address tokenA, address tokenB)
        external
        view
        returns (address pool);

    function getProtocolFeesCollector() external view returns (address);

    function _getProtocolSwapFeePercentage() external view returns (uint256);
}
