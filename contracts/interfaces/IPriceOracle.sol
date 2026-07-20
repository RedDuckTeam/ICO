// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Common interface for every price source the ICO can use.
/// Implementations decide *how* the price is produced (a Chainlink feed, a
/// Uniswap TWAP, a combination of both, ...); the ICO only ever asks
/// `getPrice()` and does not care which one it is talking to.
interface IPriceOracle {
    /// @return price The USD price of one whole unit (1e18) of the
    /// underlying asset, itself scaled to 18 decimals.
    function getPrice() external view returns (uint256 price);
}
