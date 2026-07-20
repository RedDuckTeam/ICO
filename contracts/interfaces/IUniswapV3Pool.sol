// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal slice of the Uniswap V3 pool interface needed to read a
/// time-weighted average price. Copied locally to avoid depending on the
/// full Uniswap V3 core package.
interface IUniswapV3Pool {
    /// @notice The pool's first token, by address ordering.
    function token0() external view returns (address);

    /// @notice The pool's second token, by address ordering.
    function token1() external view returns (address);

    /// @notice Returns the cumulative tick at each requested point in the
    /// past, used to derive a time-weighted average tick over an interval.
    /// @param secondsAgos How many seconds before now to read each point at.
    /// @return tickCumulatives Cumulative tick at each requested point.
    /// @return secondsPerLiquidityCumulativeX128s Unused by this template.
    function observe(
        uint32[] calldata secondsAgos
    )
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        );
}
