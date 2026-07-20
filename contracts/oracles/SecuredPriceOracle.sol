// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IPriceOracle} from "../interfaces/IPriceOracle.sol";

/// @title SecuredPriceOracle
/// @notice Combines a fast push oracle (e.g. `ChainlinkPriceOracle`) with a
/// manipulation-resistant TWAP (e.g. `TwapPriceOracle`) and only accepts the
/// push price if it does not deviate from the TWAP by more than
/// `maxDeviationBps`.
///
/// This is the standard "belt and suspenders" pattern for pricing an asset
/// that trades on a DEX pool with meaningfully lower liquidity than the top
/// pairs Chainlink covers well: the TWAP catches a push oracle that has
/// gone stale or wrong, while the push oracle keeps the price responsive
/// between TWAP updates. Reverts, rather than silently degrading, when the
/// two sources disagree — callers must decide how to handle that.
contract SecuredPriceOracle is IPriceOracle {
    /// @notice Basis-point denominator (100% = `BPS`).
    uint256 public constant BPS = 10_000;

    /// @notice Fast source returned by `getPrice` when within bounds.
    IPriceOracle public immutable primaryOracle;
    /// @notice Manipulation-resistant source `primaryOracle` is checked against.
    IPriceOracle public immutable twapOracle;
    /// @notice Largest allowed gap between the two sources, in basis points.
    uint256 public immutable maxDeviationBps;

    /// @dev `maxDeviationBps_` passed to the constructor exceeds `BPS`.
    error InvalidDeviation();
    /// @dev The two sources disagree by more than `maxDeviationBps`.
    error PriceDeviationTooHigh(
        uint256 primaryPrice,
        uint256 twapPrice,
        uint256 deviationBps
    );

    /// @param primaryOracle_ Fast price source.
    /// @param twapOracle_ Price source `primaryOracle_` is cross-checked against.
    /// @param maxDeviationBps_ Largest tolerated gap between them, in basis points.
    constructor(
        address primaryOracle_,
        address twapOracle_,
        uint256 maxDeviationBps_
    ) {
        if (maxDeviationBps_ > BPS) revert InvalidDeviation();

        primaryOracle = IPriceOracle(primaryOracle_);
        twapOracle = IPriceOracle(twapOracle_);
        maxDeviationBps = maxDeviationBps_;
    }

    /// @notice `primaryOracle`'s price, after confirming it's within
    /// `maxDeviationBps` of `twapOracle`'s.
    function getPrice() external view returns (uint256) {
        uint256 primaryPrice = primaryOracle.getPrice();
        uint256 twapPrice = twapOracle.getPrice();

        uint256 deviationBps = _deviationBps(primaryPrice, twapPrice);
        if (deviationBps > maxDeviationBps) {
            revert PriceDeviationTooHigh(
                primaryPrice,
                twapPrice,
                deviationBps
            );
        }

        return primaryPrice;
    }

    /// @notice How far apart the two sources currently are, in basis points
    /// of their average. Useful for off-chain monitoring even when the
    /// deviation is still within bounds.
    function getCurrentDeviationBps() external view returns (uint256) {
        return _deviationBps(primaryOracle.getPrice(), twapOracle.getPrice());
    }

    /// @dev Relative gap between `priceA` and `priceB`, in basis points of
    /// their average; `BPS` (100%) if their average is zero.
    function _deviationBps(
        uint256 priceA,
        uint256 priceB
    ) private pure returns (uint256) {
        uint256 diff = priceA > priceB ? priceA - priceB : priceB - priceA;
        uint256 avg = (priceA + priceB) / 2;
        if (avg == 0) return BPS;

        return (diff * BPS) / avg;
    }
}
