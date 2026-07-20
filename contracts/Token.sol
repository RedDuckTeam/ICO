// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title Token
/// @notice The ERC-20 token being sold. The whole supply is minted once to
/// the deployer, who then transfers the for-sale portion to the ICO contract.
contract Token is ERC20 {
    /// @param name_ Token name.
    /// @param symbol_ Token symbol.
    /// @param initialSupply Whole supply, minted to the deployer.
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 initialSupply
    ) ERC20(name_, symbol_) {
        _mint(msg.sender, initialSupply);
    }
}
