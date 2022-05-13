// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./lib/helpers/InputHelpers.sol";
import "./lib/openzeppelin/ReentrancyGuard.sol";
import "./lib/openzeppelin/SafeERC20.sol";
import "./lib/openzeppelin/Ownable.sol";

/**
 * @dev Any tokens charged as protocol fees are sent to this contract,
 * where they may be withdrawn by authorized entities.
 */
contract ProtocolFeesCollector is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    uint256 private constant _MAX_PROTOCOL_SWAP_FEE_PERCENTAGE = 50e16; // 50%

    // The protocol swap fee is charged whenever a swap occurs, as a percentage of the swap fee charged by the Pool.
    uint256 private _protocolSwapFeePercentage;

    event SwapFeePercentageChanged(uint256 newSwapFeePercentage);

    function withdrawCollectedFees(
        IERC20[] calldata tokens,
        uint256[] calldata amounts,
        address recipient
    ) external nonReentrant onlyOwner {
        InputHelpers.ensureInputLengthMatch(tokens.length, amounts.length);

        for (uint256 i = 0; i < tokens.length; ++i) {
            IERC20 token = tokens[i];
            uint256 amount = amounts[i];
            token.safeTransfer(recipient, amount);
        }
    }

    function setSwapFeePercentage(uint256 newProtocolSwapFeePercentage)
        external
        onlyOwner
    {
        _require(
            newProtocolSwapFeePercentage <= _MAX_PROTOCOL_SWAP_FEE_PERCENTAGE,
            Errors.SWAP_FEE_PERCENTAGE_TOO_HIGH
        );
        _protocolSwapFeePercentage = newProtocolSwapFeePercentage;
        emit SwapFeePercentageChanged(newProtocolSwapFeePercentage);
    }

    /**
     * @dev Returns the protocol swap fee percentage.
     */

    function getProtocolSwapFeePercentage() external view returns (uint256) {
        return _protocolSwapFeePercentage;
    }

    function getCollectedFeeAmounts(IERC20[] memory tokens)
        external
        view
        returns (uint256[] memory feeAmounts)
    {
        feeAmounts = new uint256[](tokens.length);
        for (uint256 i = 0; i < tokens.length; ++i) {
            feeAmounts[i] = tokens[i].balanceOf(address(this));
        }
    }
}
