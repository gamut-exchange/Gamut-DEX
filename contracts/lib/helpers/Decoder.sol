// SPDX-License-Identifier: MIT
pragma solidity 0.8.11;

import "../../lib/openzeppelin/IERC20.sol";
import "../../Pool.sol";

library Decoder {
    function joinKind(bytes memory self) internal pure returns (Pool.JoinKind) {
        return abi.decode(self, (Pool.JoinKind));
    }

    // Joins

    function initialAmountsIn(bytes memory self)
        internal
        pure
        returns (uint256[] memory amountsIn)
    {
        (, amountsIn) = abi.decode(self, (Pool.JoinKind, uint256[]));
    }

    function exactTokensInForHptOut(bytes memory self)
        internal
        pure
        returns (uint256[] memory amountsIn, uint256 minHPTAmountOut)
    {
        (, amountsIn, minHPTAmountOut) = abi.decode(
            self,
            (Pool.JoinKind, uint256[], uint256)
        );
    }

    function exactTokenInForHptOut(bytes memory self)
        internal
        pure
        returns (
            uint256 amountIn,
            uint256 tokenIndex,
            uint256 minHPTAmountOut
        )
    {
        (, amountIn, tokenIndex, minHPTAmountOut) = abi.decode(
            self,
            (Pool.JoinKind, uint256, uint256, uint256)
        );
    }

    // Exit

    function exactHptInForTokensOut(bytes memory self)
        internal
        pure
        returns (uint256 hptAmountIn, uint256 weightInputToken0)
    {
        (hptAmountIn, weightInputToken0) = abi.decode(self, (uint256, uint256));
    }
}
