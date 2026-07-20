// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal Chainlink price feed interface.
/// Copied locally so the template has no dependency on the full
/// Chainlink contracts package. On a live network you would point
/// adapters at real Chainlink aggregator addresses.
interface AggregatorV3Interface {
    /// @notice Number of decimals the feed's answers are scaled to.
    function decimals() external view returns (uint8);

    /// @notice Latest reported round.
    /// @return roundId ID of the round.
    /// @return answer Reported price, in the feed's own decimals.
    /// @return startedAt Timestamp the round started.
    /// @return updatedAt Timestamp the answer was last updated.
    /// @return answeredInRound Round in which the answer was computed;
    /// below `roundId` if the round hasn't actually been answered yet.
    function latestRoundData()
        external
        view
        returns (
            uint80 roundId,
            int256 answer,
            uint256 startedAt,
            uint256 updatedAt,
            uint80 answeredInRound
        );
}
