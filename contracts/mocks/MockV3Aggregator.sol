// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Minimal stand-in for a Chainlink price feed, for tests only.
/// `updateAnswer` lets tests simulate price changes and staleness.
contract MockV3Aggregator is AggregatorV3Interface {
    uint8 private _decimals;
    int256 private _latestAnswer;
    uint256 private _latestTimestamp;
    uint80 private _latestRoundId;
    uint80 private _answeredInRound;

    /// @param decimals_ Decimals `decimals()` will report.
    /// @param initialAnswer Starting price, in `decimals_` decimals.
    constructor(uint8 decimals_, int256 initialAnswer) {
        _decimals = decimals_;
        _latestAnswer = initialAnswer;
        _latestTimestamp = block.timestamp;
        _latestRoundId = 1;
        _answeredInRound = 1;
    }

    /// @notice Configured decimals.
    function decimals() external view override returns (uint8) {
        return _decimals;
    }

    /// @notice The latest round set via the constructor or `updateAnswer`.
    function latestRoundData()
        external
        view
        override
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        )
    {
        return (
            _latestRoundId,
            _latestAnswer,
            _latestTimestamp,
            _latestTimestamp,
            _answeredInRound
        );
    }

    /// @notice Publishes a new round with `newAnswer` at the current
    /// block's timestamp.
    function updateAnswer(int256 newAnswer) external {
        _latestAnswer = newAnswer;
        _latestTimestamp = block.timestamp;
        _latestRoundId++;
        _answeredInRound = _latestRoundId;
    }

    /// @notice Simulates a round that never got answered, to test the
    /// `answeredInRound < roundId` staleness guard.
    function setUnanswered() external {
        _latestRoundId++;
    }
}
