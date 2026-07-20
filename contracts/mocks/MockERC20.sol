// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Freely mintable ERC-20 with configurable decimals, for tests only.
contract MockERC20 is ERC20 {
    uint8 private _decimals;

    /// @param initialSupply Whole supply, minted to the deployer.
    /// @param decimals_ Decimals `decimals()` will report.
    constructor(
        string memory name,
        string memory symbol,
        uint256 initialSupply,
        uint8 decimals_
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(msg.sender, initialSupply);
    }

    /// @notice Configured decimals, overriding ERC20's default of 18.
    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    /// @notice Mints `amount` to `to`. Unrestricted — test-only.
    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }
}
