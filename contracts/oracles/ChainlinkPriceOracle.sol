// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title ChainlinkPriceOracle
/// @notice Wraps a single Chainlink-style price feed behind the `IPriceOracle`
/// interface, normalizing its answer to 18 decimals and rejecting stale or
/// invalid rounds.
///
/// This is the simplest and most common oracle choice: fast, feed-maintainer
/// pays the gas for updates, and (for major pairs) backed by many independent
/// data sources. Its main weakness is that it is a single external
/// dependency — see `SecuredPriceOracle` for a way to cross-check it.
contract ChainlinkPriceOracle is IPriceOracle {
    /// @notice The wrapped Chainlink-style feed.
    AggregatorV3Interface public immutable feed;

    /// @notice Reject answers older than this many seconds.
    uint256 public immutable maxStaleness;

    /// @dev The feed's answer is zero, negative, or its round doesn't exist.
    error InvalidPrice();
    /// @dev The round hasn't actually been answered (`answeredInRound < roundId`).
    error StalePrice();
    /// @dev The answer is older than `maxStaleness`.
    error PriceTooOld();

    /// @param feed_ Chainlink-style feed to wrap.
    /// @param maxStaleness_ Maximum answer age accepted, in seconds.
    constructor(address feed_, uint256 maxStaleness_) {
        feed = AggregatorV3Interface(feed_);
        maxStaleness = maxStaleness_;
    }

    /// @notice `feed`'s latest valid answer, scaled to 18 decimals.
    /// @dev Reverts instead of returning a price that fails any check.
    function getPrice() external view returns (uint256) {
        (
            uint80 roundId,
            int256 answer,
            ,
            uint256 updatedAt,
            uint80 answeredInRound
        ) = feed.latestRoundData();

        if (answer <= 0 || roundId == 0) revert InvalidPrice();
        if (answeredInRound < roundId) revert StalePrice();
        if (block.timestamp - updatedAt > maxStaleness) revert PriceTooOld();

        uint8 decimals = feed.decimals();
        return uint256(answer) * (10 ** (18 - decimals));
    }
}
