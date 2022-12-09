// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

// solhint-disable

/**
 * @dev Reverts if `condition` is false, with a revert reason containing `errorCode`. Only codes up to 999 are
 * supported.
 */
function _require(bool condition, uint256 errorCode) pure {
    if (!condition) _revert(errorCode);
}

/**
 * @dev Reverts with a revert reason containing `errorCode`. Only codes up to 999 are supported.
 */
function _revert(uint256 errorCode) pure {
    // We're going to dynamically create a revert string based on the error code, with the following format:
    // 'ZYG#{errorCode}'
    // where the code is left-padded with zeroes to three digits (so they range from 000 to 999).
    //
    // We don't have revert strings embedded in the contract to save bytecode size: it takes much less space to store a
    // number (8 to 16 bits) than the individual string characters.
    //
    // The dynamic string creation algorithm that follows could be implemented in Solidity, but assembly allows for a
    // much denser implementation, again saving bytecode size. Given this function unconditionally reverts, this is a
    // safe place to rely on it without worrying about how its usage might affect e.g. memory contents.
    assembly {
        // First, we need to compute the ASCII representation of the error code. We assume that it is in the 0-999
        // range, so we only need to convert three digits. To convert the digits to ASCII, we add 0x30, the value for
        // the '0' character.

        let units := add(mod(errorCode, 10), 0x30)

        errorCode := div(errorCode, 10)
        let tenths := add(mod(errorCode, 10), 0x30)

        errorCode := div(errorCode, 10)
        let hundreds := add(mod(errorCode, 10), 0x30)

        // With the individual characters, we can now construct the full string. The "ZYG#" part is a known constant
        // (0x42414c23): we simply shift this by 24 (to provide space for the 3 bytes of the error code), and add the
        // characters to it, each shifted by a multiple of 8.
        // The revert reason is then shifted left by 200 bits (256 minus the length of the string, 7 characters * 8 bits
        // per character = 56) to locate it in the most significant part of the 256 slot (the beginning of a byte
        // array).

        let revertReason := shl(
            200,
            add(
                0x5a594723000000,
                add(add(units, shl(8, tenths)), shl(16, hundreds))
            )
        )

        // We can now encode the reason in memory, which can be safely overwritten as we're about to revert. The encoded
        // message will have the following layout:
        // [ revert reason identifier ] [ string location offset ] [ string length ] [ string contents ]

        // The Solidity revert reason identifier is 0x08c739a0, the function selector of the Error(string) function. We
        // also write zeroes to the next 28 bytes of memory, but those are about to be overwritten.
        mstore(
            0x0,
            0x08c379a000000000000000000000000000000000000000000000000000000000
        )
        // Next is the offset to the location of the string, which will be placed immediately after (20 bytes away).
        mstore(
            0x04,
            0x0000000000000000000000000000000000000000000000000000000000000020
        )
        // The string length is fixed: 7 characters.
        mstore(0x24, 7)
        // Finally, the string itself is stored.
        mstore(0x44, revertReason)

        // Even if the string is only 7 bytes long, we need to return a full 32 byte slot containing it. The length of
        // the encoded message is therefore 4 + 32 + 32 + 32 = 100.
        revert(0, 100)
    }
}

library Errors {
    // Math
    uint256 internal constant MUL_OVERFLOW = 0;
    uint256 internal constant ZERO_DIVISION = 1;
    uint256 internal constant DIV_INTERNAL = 2;
    uint256 internal constant X_OUT_OF_BOUNDS = 3;
    uint256 internal constant Y_OUT_OF_BOUNDS = 4;
    uint256 internal constant PRODUCT_OUT_OF_BOUNDS = 5;
    uint256 internal constant INVALID_EXPONENT = 6;

    // Input
    uint256 internal constant OUT_OF_BOUNDS = 100;
    uint256 internal constant INPUT_LENGTH_MISMATCH = 101;
    uint256 internal constant ZERO_TOKEN = 102;
    uint256 internal constant ZERO_AMOUNT_IN = 103;
    uint256 internal constant ZERO_ADDRESS = 104;

    // Pools
    uint256 internal constant CALLER_NOT_POOL_OWNER = 200;
    uint256 internal constant CANNOT_MODIFY_SWAP_FEE = 201;
    uint256 internal constant MAX_SWAP_FEE_PERCENTAGE = 202;
    uint256 internal constant MIN_SWAP_FEE_PERCENTAGE = 203;
    uint256 internal constant MINIMUM_HPT = 204;
    uint256 internal constant CALLER_NOT_ROUTER = 205;
    uint256 internal constant UNINITIALIZED = 206;
    uint256 internal constant HPT_OUT_MIN_AMOUNT = 207;

    uint256 internal constant MIN_WEIGHT = 300;
    uint256 internal constant EMPTY_POOL_BALANCES = 301;
    uint256 internal constant INSUFFICIENT_POOL_BALANCES = 302;
    uint256 internal constant NORMALIZED_WEIGHT_INVARIANT = 303;
    uint256 internal constant UNHANDLED_JOIN_KIND = 304;
    uint256 internal constant ZERO_INVARIANT = 305;

    // Lib
    uint256 internal constant REENTRANCY = 400;
    uint256 internal constant SAFE_ERC20_CALL_FAILED = 401;
    uint256 internal constant SAFE_CAST_VALUE_CANT_FIT_INT256 = 402;

    // Router
    uint256 internal constant FACTORY_ALREADY_SET = 500;
    uint256 internal constant EXIT_BELOW_MIN = 501;
    uint256 internal constant JOIN_ABOVE_MAX = 502;
    uint256 internal constant SWAP_LIMIT = 503;
    uint256 internal constant SWAP_DEADLINE = 504;
    uint256 internal constant CANNOT_SWAP_SAME_TOKEN = 505;
    uint256 internal constant UNKNOWN_AMOUNT_IN_FIRST_SWAP = 506;
    uint256 internal constant MALCONSTRUCTED_MULTIHOP_SWAP = 507;
    uint256 internal constant INSUFFICIENT_ETH = 508;
    uint256 internal constant ETH_TRANSFER = 509;
    uint256 internal constant TOKENS_MISMATCH = 510;

    // Fees
    uint256 internal constant SWAP_FEE_PERCENTAGE_TOO_HIGH = 600;

    // Factory
    uint256 internal constant IDENTICAL_ADDRESSES = 700;
    uint256 internal constant POOL_EXISTS = 701;
}
