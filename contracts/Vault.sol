// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "./lib/math/Math.sol";
import "./lib/helpers/ZygnusErrors.sol";
import "./lib/openzeppelin/IERC20.sol";
import "./lib/helpers/AssetHelpers.sol";
import "./lib/openzeppelin/SafeERC20.sol";
import "./lib/openzeppelin/Address.sol";
import "./interfaces/IWETH.sol";

abstract contract Vault is AssetHelpers {
    using SafeERC20 for IERC20;
    using Address for address payable;

    /**
     * @dev Receives `amount` of `asset` from `sender`.
     *
     * If `asset` is ETH, the funds will be wrapped into WETH.
     *
     * WARNING: this function does not check that the contract caller has actually supplied any ETH - it is up to the
     * caller of this function to check that this is true to prevent the Vault from using its own ETH (though the Vault
     * typically doesn't hold any).
     */
    function _receiveAsset(
        address asset,
        uint256 amount,
        address sender
    ) internal {
        if (amount == 0) {
            return;
        }

        if (_isETH(asset)) {
            // The ETH amount to receive is deposited into the WETH contract, which will in turn mint WETH for
            // the Vault at a 1:1 ratio.

            // A check for this condition is also introduced by the compiler, but this one provides a revert reason.
            // Note we're checking for the Vault's total balance, *not* ETH sent in this transaction.
            _require(address(this).balance >= amount, Errors.INSUFFICIENT_ETH);
            _WETH().deposit{value: amount}();
        } else {
            IERC20 token = _asIERC20(asset);

            if (amount > 0) {
                token.safeTransferFrom(sender, address(this), amount);
            }
        }
    }

    /**
     * @dev Sends `amount` of `asset` to `recipient`.
     *
     * If `asset` is ETH,  the funds are instead sent directly after unwrapping WETH.
     */
    function _sendAsset(
        address asset,
        uint256 amount,
        address payable recipient
    ) internal {
        if (amount == 0) {
            return;
        }
        if (_isETH(asset)) {
            // First, the Vault withdraws deposited ETH from the WETH contract, by burning the same amount of WETH
            // from the Vault. This receipt will be handled by the Vault's `receive`.
            _WETH().withdraw(amount);

            // Then, the withdrawn ETH is sent to the recipient.
            recipient.sendValue(amount);
        } else {
            IERC20 token = _asIERC20(asset);
            token.safeTransfer(recipient, amount);
        }
    }

    /**
     * @dev Returns excess ETH back to the contract caller, assuming `amountUsed` has been spent. Reverts
     * if the caller sent less ETH than `amountUsed`.
     *
     * Because the caller might not know exactly how much ETH a Vault action will require, they may send extra.
     * Note that this excess value is returned *to the contract caller* (msg.sender).
     */
    function _handleRemainingEth(uint256 amountUsed) internal {
        _require(msg.value >= amountUsed, Errors.INSUFFICIENT_ETH);

        uint256 excess = msg.value - amountUsed;
        if (excess > 0) {
            payable(msg.sender).sendValue(excess);
        }
    }

    function _payFeeAmount(
        address protocolFeeCollector,
        IERC20 token,
        uint256 amount
    ) internal {
        if (amount > 0) {
            // If token to pay fee in is ETH, then pay fee to protocol fee collector in Weth
            token = _translateToIERC20(address(token));
            token.safeTransfer(protocolFeeCollector, amount);
        }
    }

    /**
     * @dev Enables the Vault to receive ETH. This is required for it to be able to unwrap WETH, which sends ETH to the
     * caller.
     *
     * Any ETH sent to the Vault outside of the WETH unwrapping mechanism would be forever locked inside the Vault, so
     * we prevent that from happening. Other mechanisms used to send ETH to the Vault (such as being the recipient of an
     * ETH swap, Pool exit or withdrawal, contract self-destruction, or receiving the block mining reward) will result
     * in locked funds, but are not otherwise a security or soundness issue. This check only exists as an attempt to
     * prevent user error.
     */
    receive() external payable {
        _require(msg.sender == address(_WETH()), Errors.ETH_TRANSFER);
    }
}
