// SPDX-License-Identifier: MIT

pragma solidity 0.8.11;

import "./lib/openzeppelin/ERC20.sol";

contract GamutToken is ERC20 {
    constructor() ERC20("Gamut Token", "HT") {}
}
