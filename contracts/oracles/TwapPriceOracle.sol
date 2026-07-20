// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IUniswapV3Pool} from "../interfaces/IUniswapV3Pool.sol";
import {IPriceOracle} from "../interfaces/IPriceOracle.sol";
import {TickMath} from "../libraries/TickMath.sol";

/// @title TwapPriceOracle
/// @notice Prices `baseToken` in terms of `quoteToken` using a Uniswap V3
/// pool's time-weighted average price (TWAP) over `twapInterval` seconds,
/// normalized to 18 decimals.
///
/// A TWAP is expensive to move: an attacker would need to hold a distorted
/// price for the *entire* window, not just for one block, which is what
/// makes it a useful building block against flash-loan style manipulation.
/// Its weakness is the opposite of a push oracle's: it reacts slowly and is
/// only as good as the pool's liquidity and observation history.
contract TwapPriceOracle is IPriceOracle {
    /// @notice Pool the TWAP is read from.
    IUniswapV3Pool public immutable pool;
    /// @notice Asset `getPrice` quotes one whole unit of.
    address public immutable baseToken;
    /// @notice Asset `getPrice` denominates the answer in.
    address public immutable quoteToken;

    /// @notice Length of the averaging window, in seconds.
    uint32 public immutable twapInterval;

    /// @dev Whether `baseToken` is `pool.token0()` (vs. `token1()`).
    bool private immutable _baseIsToken0;
    uint8 private immutable _baseDecimals;
    uint8 private immutable _quoteDecimals;

    /// @dev `baseToken_`/`quoteToken_` don't match `pool_`'s actual tokens.
    error InvalidPoolTokens();
    /// @dev The pool reported a zero ratio for the averaged tick.
    error TwapPriceUnavailable();

    /// @param pool_ Uniswap V3 pool trading `baseToken_` against `quoteToken_`.
    /// @param baseToken_ Asset to price.
    /// @param quoteToken_ Asset to price it in.
    /// @param twapInterval_ Averaging window, in seconds.
    constructor(
        address pool_,
        address baseToken_,
        address quoteToken_,
        uint32 twapInterval_
    ) {
        IUniswapV3Pool _pool = IUniswapV3Pool(pool_);
        address token0 = _pool.token0();
        address token1 = _pool.token1();

        bool baseIsToken0 = token0 == baseToken_ && token1 == quoteToken_;
        bool baseIsToken1 = token1 == baseToken_ && token0 == quoteToken_;
        if (!baseIsToken0 && !baseIsToken1) revert InvalidPoolTokens();

        pool = _pool;
        baseToken = baseToken_;
        quoteToken = quoteToken_;
        twapInterval = twapInterval_;
        _baseIsToken0 = baseIsToken0;
        _baseDecimals = IERC20Metadata(baseToken_).decimals();
        _quoteDecimals = IERC20Metadata(quoteToken_).decimals();
    }

    /// @return price How much `quoteToken` (scaled to 1e18) one whole
    /// `baseToken` is worth, averaged over the last `twapInterval` seconds.
    /// Composed from two independent steps: read the mean tick, then price
    /// it — kept separate so each can be reasoned about (and unit-tested)
    /// on its own.
    function getPrice() external view returns (uint256) {
        int24 meanTick = _meanTick();
        uint256 rawRatio = _rawRatioAtTick(meanTick);

        // The pool's ratio doesn't know about either token's decimals yet —
        // rescale from a raw-unit ratio to a whole-token ratio.
        return Math.mulDiv(rawRatio, 10 ** _baseDecimals, 10 ** _quoteDecimals);
    }

    /// @dev Time-weighted average tick over the last `twapInterval` seconds,
    /// read from the pool's cumulative tick observations.
    function _meanTick() private view returns (int24) {
        uint32[] memory secondsAgos = new uint32[](2);
        secondsAgos[0] = twapInterval;
        secondsAgos[1] = 0;

        (int56[] memory tickCumulatives, ) = pool.observe(secondsAgos);
        int56 delta = tickCumulatives[1] - tickCumulatives[0];

        return int24(delta / int56(uint56(twapInterval)));
    }

    /// @dev Raw-unit ratio of quote per base at `tick`, as a 1e18
    /// fixed-point number — i.e. before either token's decimals are
    /// accounted for.
    function _rawRatioAtTick(int24 tick) private view returns (uint256) {
        uint160 sqrtPriceX96 = TickMath.getSqrtRatioAtTick(tick);

        // sqrtPriceX96 = sqrt(token1/token0) * 2^96, so squaring and
        // descaling gives token1/token0 as a 1e18 fixed-point number.
        uint256 poolRatio = Math.mulDiv(
            uint256(sqrtPriceX96),
            uint256(sqrtPriceX96) * 1e18,
            1 << 192
        );
        if (poolRatio == 0) revert TwapPriceUnavailable();

        return _baseIsToken0 ? poolRatio : Math.mulDiv(1e18, 1e18, poolRatio);
    }
}
