// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUniswapV3Pool} from "../interfaces/IUniswapV3Pool.sol";

/// @notice Minimal stand-in for a Uniswap V3 pool, for tests only.
/// Instead of simulating real swaps, tests set the average tick directly
/// via `setTick` and the mock synthesizes a matching `observe()` response,
/// which is all `TwapPriceOracle` reads.
contract MockUniswapV3Pool is IUniswapV3Pool {
    address public token0;
    address public token1;
    int24 private _tick;

    constructor(address token0_, address token1_) {
        token0 = token0_;
        token1 = token1_;
    }

    /// @notice Sets the tick that `observe` will report as the average over
    /// any requested interval (i.e. simulates a perfectly flat price).
    function setTick(int24 tick_) external {
        _tick = tick_;
    }

    /// @notice Synthesizes cumulative ticks for a flat price at `_tick`.
    /// @param secondsAgos How many seconds before now to read each point at.
    /// @return tickCumulatives `_tick * secondsAgos[i]` for each requested point.
    /// @return secondsPerLiquidityCumulativeX128s Always zero — unused by `TwapPriceOracle`.
    function observe(
        uint32[] calldata secondsAgos
    )
        external
        view
        returns (
            int56[] memory tickCumulatives,
            uint160[] memory secondsPerLiquidityCumulativeX128s
        )
    {
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);

        // A flat tick over time means tickCumulative(t) = tick * t; the
        // oracle only ever looks at the *difference* between two points,
        // so the arbitrary base doesn't matter.
        for (uint256 i = 0; i < secondsAgos.length; i++) {
            int256 secondsAgo = int256(uint256(secondsAgos[i]));
            tickCumulatives[i] = int56(int256(_tick) * -secondsAgo);
        }
    }
}
