// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @notice Directly settable price source, for isolating tests that combine
/// oracles (e.g. `SecuredPriceOracle`) from the specifics of any one
/// concrete price feed implementation.
contract MockPriceOracle is IPriceOracle {
    uint256 private _price;

    /// @param initialPrice Starting value `getPrice` returns.
    constructor(uint256 initialPrice) {
        _price = initialPrice;
    }

    /// @notice Overwrites the price `getPrice` returns.
    function setPrice(uint256 price_) external {
        _price = price_;
    }

    /// @notice Returns whatever price was last set.
    function getPrice() external view returns (uint256) {
        return _price;
    }
}
