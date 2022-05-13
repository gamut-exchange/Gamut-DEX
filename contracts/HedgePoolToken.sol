// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "./lib/openzeppelin/ERC20.sol";

contract HedgePoolToken is ERC20 {
    constructor() ERC20("Hedge Pool Token", "HT") {}
}
