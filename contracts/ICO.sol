// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IICO} from "./interfaces/IICO.sol";
import {IWhitelist} from "./interfaces/IWhitelist.sol";
import {IPriceOracle} from "./interfaces/IPriceOracle.sol";
import {Rules} from "./structs/Rules.sol";
import {Vesting} from "./structs/Vesting.sol";
import {SaleState} from "./enums/SaleState.sol";

/// @title ICO — a token sale with whitelisting, oracle pricing and vesting
///
/// @notice A self-contained example of the mechanisms a real token sale is
/// typically built from, layered on top of the canonical "send money, get
/// tokens" idea:
///
///  - **Whitelisting**: only addresses verified through an `IWhitelist`
///    contract may buy (see `Whitelist.sol`).
///  - **Oracle pricing**: the sale token is always priced in ETH, but buyers
///    may also pay in any registered ERC-20. The payment amount is converted
///    to its ETH equivalent through `IPriceOracle` price sources — see
///    `oracles/` for a plain Chainlink adapter, a Uniswap V3 TWAP adapter,
///    and a combination of the two.
///  - **Vesting**: purchases do not deliver tokens immediately. They record
///    a vesting position; a portion unlocks at the Token Generation Event
///    (TGE) and the remainder vests linearly after a cliff.
///
/// Lifecycle: the owner configures `setRules`, registers payment assets with
/// `acceptPaymentToken`, whitelists buyers, then calls `startSale`. Buyers
/// purchase with `buyWithETH` / `buyWithERC20` while the sale is open. Once
/// the sale is over, the owner runs `executeTGE`, after which buyers
/// `claimTokens` on their own schedule, and the owner withdraws proceeds and
/// unsold tokens.
///
/// @dev Educational code — unaudited, do not use in production as-is.
contract ICO is Ownable, ReentrancyGuard, IICO {
    using SafeERC20 for IERC20;

    /// @notice Sentinel used as the "payment token" key for the ETH/USD
    /// price oracle in `paymentOracles`. ERC-20 payments are always
    /// converted to an ETH equivalent, so an ETH/USD source is required as
    /// soon as any ERC-20 payment token is accepted.
    address public constant ETH_ADDRESS = address(1);

    /// @notice The token being sold.
    IERC20 public immutable saleToken;

    /// @notice Buyer verification source.
    IWhitelist public immutable whitelist;

    /// @dev Sale configuration; zeroed out (and rejected by `onlyWithRulesSet`
    /// checks) until `setRules` runs.
    Rules private _rules;

    /// @notice Stored lifecycle state. May lag the real-time condition —
    /// see `isSaleOpen` for the value purchase/withdrawal guards actually use.
    SaleState public state = SaleState.NotStarted;

    /// @notice Timestamp the sale opens, set once by `startSale`.
    uint256 public startTime;
    /// @notice Timestamp the sale closes, set once by `startSale`.
    uint256 public endTime;

    /// @notice Total sale-token base units sold so far.
    uint256 public tokensSold;
    /// @notice Total sale-token base units claimed so far.
    uint256 public totalTokensClaimed;
    /// @notice Whether `executeTGE` has run.
    bool public tgeExecuted;

    /// @dev Per-buyer vesting position.
    mapping(address => Vesting) private _vestings;

    /// @notice Accepted payment token => the price oracle used to value it
    /// in USD. The ETH/USD oracle is registered under `ETH_ADDRESS`.
    mapping(address => IPriceOracle) public paymentOracles;

    /// @param saleToken_ ERC-20 being sold.
    /// @param whitelist_ Verification source purchases are checked against.
    constructor(
        address saleToken_,
        address whitelist_
    ) Ownable(msg.sender) validAddress(saleToken_) validAddress(whitelist_) {
        saleToken = IERC20(saleToken_);
        whitelist = IWhitelist(whitelist_);
    }

    // ------ MODIFIERS ------

    /// @dev Reverts if `addr` is the zero address.
    modifier validAddress(address addr) {
        if (addr == address(0)) revert ZeroAddress();
        _;
    }

    /// @dev Reverts if `amount` is zero.
    modifier validAmount(uint256 amount) {
        if (amount == 0) revert ZeroAmount();
        _;
    }

    /// @dev Reverts once the sale has left `NotStarted`.
    modifier onlyBeforeStart() {
        if (state != SaleState.NotStarted) revert SaleAlreadyStarted();
        _;
    }

    /// @dev Reverts if `user` isn't whitelisted.
    modifier onlyVerified(address user) {
        if (!whitelist.isVerified(user)) revert NotVerified();
        _;
    }

    /// @dev Active means both "not paused" and "still within the time
    /// window and cap" — a sale nobody called `updateSaleStatus` on yet is
    /// still correctly rejected here.
    modifier onlySaleOpen() {
        if (state != SaleState.Active || _isSaleWindowOver()) {
            revert SaleNotActive();
        }
        _;
    }

    /// @dev Reverts unless the sale has ended — explicitly, or because its
    /// time window/cap condition is already met regardless of `state`.
    modifier onlySaleEnded() {
        bool ended = state == SaleState.Ended ||
            (state != SaleState.NotStarted && _isSaleWindowOver());
        if (!ended) revert SaleNotEnded();
        _;
    }

    // ------ ADMIN: CONFIGURATION ------

    /// @notice Configures the sale's price, limits, cap and vesting
    /// schedule. Only callable before the sale starts — rules are immutable
    /// once buyers can rely on them.
    /// @param tokenPrice Price of one whole sale token, in wei.
    /// @param minPurchase Minimum purchase per transaction, ETH-denominated.
    /// @param maxPurchase Maximum purchase per transaction, ETH-denominated.
    /// @param tokenCap Maximum sale-token base units that can be sold.
    /// @param tgeDate Token Generation Event timestamp.
    /// @param cliffDuration Seconds after `tgeDate` before linear vesting starts.
    /// @param vestingDuration Seconds of linear vesting after the cliff.
    /// @param initialUnlockBps Share of each purchase unlocked at TGE, in
    /// basis points (10000 = 100%).
    function setRules(
        uint256 tokenPrice,
        uint256 minPurchase,
        uint256 maxPurchase,
        uint256 tokenCap,
        uint256 tgeDate,
        uint256 cliffDuration,
        uint256 vestingDuration,
        uint256 initialUnlockBps
    )
        external
        onlyOwner
        onlyBeforeStart
        validAmount(tokenPrice)
        validAmount(tokenCap)
    {
        if (minPurchase >= maxPurchase) revert InvalidPurchaseLimits();
        if (initialUnlockBps == 0 || initialUnlockBps > 10_000) {
            revert InvalidUnlockBps();
        }
        if (tgeDate <= block.timestamp) revert InvalidTgeDate();

        _rules = Rules({
            tokenPrice: tokenPrice,
            minPurchase: minPurchase,
            maxPurchase: maxPurchase,
            tokenCap: tokenCap,
            tgeDate: tgeDate,
            cliffDuration: cliffDuration,
            vestingDuration: vestingDuration,
            initialUnlockBps: initialUnlockBps
        });

        emit RulesUpdated(tokenPrice, minPurchase, maxPurchase, tokenCap);
    }

    /// @notice Registers an accepted payment asset together with the price
    /// oracle used to value it in USD. Register the ETH/USD oracle under
    /// `ETH_ADDRESS` before accepting any ERC-20 payment token — every
    /// ERC-20 payment is converted to its ETH equivalent using both prices.
    /// @param paymentToken Asset to accept (or `ETH_ADDRESS` for ETH itself).
    /// @param oracle Price source used to value `paymentToken` in USD.
    function acceptPaymentToken(
        address paymentToken,
        address oracle
    ) external onlyOwner validAddress(paymentToken) validAddress(oracle) {
        if (address(paymentOracles[paymentToken]) != address(0)) {
            revert TokenAlreadyAccepted();
        }

        paymentOracles[paymentToken] = IPriceOracle(oracle);
        emit PaymentTokenAccepted(paymentToken, oracle);
    }

    /// @notice Stops accepting `paymentToken` for new purchases.
    /// @param paymentToken Asset to deregister.
    function removePaymentToken(address paymentToken) external onlyOwner {
        if (address(paymentOracles[paymentToken]) == address(0)) {
            revert TokenNotAccepted();
        }

        delete paymentOracles[paymentToken];
        emit PaymentTokenRemoved(paymentToken);
    }

    // ------ ADMIN: LIFECYCLE ------

    /// @notice Opens the sale for the `[startTime_, endTime_)` window.
    /// Requires `setRules` to have run and `tgeDate` to fall after `endTime_`.
    /// @param startTime_ Timestamp purchases become possible.
    /// @param endTime_ Timestamp purchases stop being possible.
    function startSale(
        uint256 startTime_,
        uint256 endTime_
    ) external onlyOwner onlyBeforeStart {
        if (_rules.tokenPrice == 0) revert RulesNotSet();
        if (endTime_ <= startTime_ || startTime_ < block.timestamp) {
            revert InvalidTimeRange();
        }
        if (_rules.tgeDate <= endTime_) revert InvalidTgeDate();

        startTime = startTime_;
        endTime = endTime_;
        state = SaleState.Active;

        emit SaleStarted(startTime_, endTime_);
    }

    /// @notice Emergency pause — buyers cannot purchase while paused.
    function pauseSale() external onlyOwner {
        if (state != SaleState.Active) revert SaleNotActive();

        state = SaleState.Paused;
        emit SalePaused();
    }

    /// @notice Lifts a pause, provided the time window hasn't closed meanwhile.
    function resumeSale() external onlyOwner {
        if (state != SaleState.Paused) revert SaleNotPaused();
        if (_isSaleWindowOver()) revert SaleWindowClosed();

        state = SaleState.Active;
        emit SaleResumed();
    }

    /// @notice Ends the sale early. Not required otherwise — the sale also
    /// ends itself once the time window elapses or the cap sells out.
    function endSale() external onlyOwner {
        if (state != SaleState.Active && state != SaleState.Paused) {
            revert SaleNotActive();
        }

        state = SaleState.Ended;
        emit SaleEnded();
    }

    /// @notice Permissionless keeper function that finalizes `state` once
    /// the time window has elapsed, purely for external consumers reading
    /// the state variable — purchase and withdrawal guards already check
    /// the real-time condition themselves and do not depend on this.
    function updateSaleStatus() external {
        if (state == SaleState.Active && _isSaleWindowOver()) {
            state = SaleState.Ended;
            emit SaleEnded();
        }
    }

    // ------ BUY ------

    /// @notice Buys sale tokens with ETH at the fixed `tokenPrice`. Records
    /// a vesting position rather than transferring tokens immediately.
    /// Surplus ETH beyond the token cap is refunded in the same transaction.
    function buyWithETH()
        external
        payable
        nonReentrant
        onlySaleOpen
        onlyVerified(msg.sender)
        validAmount(msg.value)
    {
        if (msg.value < _rules.minPurchase || msg.value > _rules.maxPurchase) {
            revert InvalidPurchaseAmount();
        }

        uint256 remaining = _remainingTokens();
        if (remaining == 0) revert ExceedsCap();

        uint256 tokenAmount = _tokensFor(msg.value);
        uint256 ethCost = msg.value;

        if (tokenAmount > remaining) {
            tokenAmount = remaining;
            ethCost = _ethCostFor(tokenAmount);
        }

        _recordPurchase(msg.sender, ETH_ADDRESS, ethCost, tokenAmount);

        uint256 refund = msg.value - ethCost;
        if (refund > 0) {
            (bool success, ) = payable(msg.sender).call{value: refund}("");
            if (!success) revert ETHTransferFailed();
        }
    }

    /// @notice Buys sale tokens with a registered ERC-20. The amount is
    /// converted to an ETH equivalent via price oracles, checked against
    /// the purchase limits, then the exact cost is pulled from the buyer.
    /// @param paymentToken Asset to pay with; must be registered via `acceptPaymentToken`.
    /// @param amount Raw units of `paymentToken` to spend.
    function buyWithERC20(
        address paymentToken,
        uint256 amount
    )
        external
        nonReentrant
        onlySaleOpen
        onlyVerified(msg.sender)
        validAddress(paymentToken)
        validAmount(amount)
    {
        uint256 ethEquivalent = _ethValueOf(paymentToken, amount);
        if (
            ethEquivalent < _rules.minPurchase ||
            ethEquivalent > _rules.maxPurchase
        ) {
            revert InvalidPurchaseAmount();
        }

        uint256 remaining = _remainingTokens();
        if (remaining == 0) revert ExceedsCap();

        uint256 tokenAmount = (ethEquivalent * 1e18) / _rules.tokenPrice;
        if (tokenAmount > remaining) {
            tokenAmount = remaining;
            ethEquivalent = _ethCostFor(tokenAmount);
        }

        uint256 actualCost = _paymentValueOf(paymentToken, ethEquivalent);

        IERC20(paymentToken).safeTransferFrom(
            msg.sender,
            address(this),
            actualCost
        );

        _recordPurchase(msg.sender, paymentToken, actualCost, tokenAmount);
    }

    // ------ CLAIM ------

    /// @notice Claims every token currently unlocked for the caller: the
    /// TGE portion plus whatever has linearly vested since the cliff ended.
    function claimTokens() external nonReentrant {
        if (!tgeExecuted) revert TgeNotExecuted();

        uint256 claimable = getClaimableTokens(msg.sender);
        if (claimable == 0) revert NothingToClaim();

        _vestings[msg.sender].claimed += claimable;
        totalTokensClaimed += claimable;
        saleToken.safeTransfer(msg.sender, claimable);

        emit TokensClaimed(msg.sender, claimable);
    }

    // ------ ADMIN: SETTLEMENT ------

    /// @notice Token Generation Event: pulls every sold token from the owner
    /// into this contract so buyers can claim. One-shot; requires the sale
    /// to be over and the owner to hold (and have approved) enough tokens.
    function executeTGE() external onlyOwner onlySaleEnded {
        if (tgeExecuted) revert TgeAlreadyExecuted();
        if (saleToken.balanceOf(owner()) < tokensSold) {
            revert InsufficientTokenBalance();
        }

        saleToken.safeTransferFrom(owner(), address(this), tokensSold);
        tgeExecuted = true;

        emit TgeExecuted(tokensSold);
    }

    /// @notice Sends raised ETH to the owner after the sale has ended.
    function withdrawFunds() external onlyOwner nonReentrant onlySaleEnded {
        uint256 balance = address(this).balance;
        if (balance == 0) revert NothingToWithdraw();

        (bool success, ) = payable(owner()).call{value: balance}("");
        if (!success) revert ETHTransferFailed();

        emit FundsWithdrawn(ETH_ADDRESS, owner(), balance);
    }

    /// @notice Sends a raised ERC-20 payment asset to the owner after the
    /// sale has ended. Use `withdrawUnsoldTokens` for the sale token itself.
    /// @param paymentToken Raised asset to withdraw.
    function withdrawERC20(address paymentToken) external onlyOwner onlySaleEnded {
        if (paymentToken == address(saleToken)) {
            revert UseWithdrawUnsoldTokens();
        }

        uint256 balance = IERC20(paymentToken).balanceOf(address(this));
        if (balance == 0) revert NothingToWithdraw();

        IERC20(paymentToken).safeTransfer(owner(), balance);

        emit FundsWithdrawn(paymentToken, owner(), balance);
    }

    /// @notice Returns sale tokens that are not reserved for buyers (i.e.
    /// anything above sold-but-unclaimed) to the owner.
    function withdrawUnsoldTokens() external onlyOwner onlySaleEnded {
        uint256 contractBalance = saleToken.balanceOf(address(this));
        uint256 unclaimed = tokensSold - totalTokensClaimed;

        if (contractBalance <= unclaimed) revert NothingToWithdraw();

        uint256 withdrawable = contractBalance - unclaimed;
        saleToken.safeTransfer(owner(), withdrawable);

        emit UnsoldTokensWithdrawn(owner(), withdrawable);
    }

    // ------ VIEWS ------

    /// @notice Current sale configuration.
    function getRules() external view returns (Rules memory) {
        return _rules;
    }

    /// @notice `user`'s vesting position.
    function getVesting(address user) external view returns (Vesting memory) {
        return _vestings[user];
    }

    /// @notice Whether a purchase would succeed right now.
    function isSaleOpen() external view returns (bool) {
        return state == SaleState.Active && !_isSaleWindowOver();
    }

    /// @notice Sale-token base units still available for sale.
    function remainingTokens() external view returns (uint256) {
        return _remainingTokens();
    }

    /// @notice Whether `paymentToken` has a registered price oracle.
    function isTokenAccepted(address paymentToken) external view returns (bool) {
        return address(paymentOracles[paymentToken]) != address(0);
    }

    /// @notice Amount `user` could claim right now.
    /// @dev unlocked(t) = tgeAmount + (total - tgeAmount) * min(t - cliffEnd, D) / D
    /// where `D` = vestingDuration; claimable = unlocked(t) - alreadyClaimed.
    function getClaimableTokens(address user) public view returns (uint256) {
        Vesting memory vesting = _vestings[user];

        if (
            vesting.total == 0 ||
            !tgeExecuted ||
            block.timestamp < _rules.tgeDate
        ) {
            return 0;
        }

        uint256 vestedAmount = 0;
        if (block.timestamp >= vesting.cliffEnd) {
            uint256 elapsed = block.timestamp - vesting.cliffEnd;
            if (elapsed > _rules.vestingDuration) {
                elapsed = _rules.vestingDuration;
            }
            vestedAmount =
                ((vesting.total - vesting.tgeAmount) * elapsed) /
                _rules.vestingDuration;
        }

        uint256 unlocked = vesting.tgeAmount + vestedAmount;
        return unlocked > vesting.claimed ? unlocked - vesting.claimed : 0;
    }

    // ------ PRIVATE ------

    /// @dev Whether the time window has elapsed or the cap is sold out.
    function _isSaleWindowOver() private view returns (bool) {
        return
            block.timestamp >= endTime ||
            tokensSold >= _rules.tokenCap;
    }

    /// @dev Sale-token base units not yet sold.
    function _remainingTokens() private view returns (uint256) {
        return _rules.tokenCap - tokensSold;
    }

    /// @dev Sale-token base units `ethAmount` wei buys at the fixed price.
    function _tokensFor(uint256 ethAmount) private view returns (uint256) {
        return (ethAmount * 1e18) / _rules.tokenPrice;
    }

    /// @dev Inverse of `_tokensFor`: wei cost of `tokenAmount` base units.
    function _ethCostFor(uint256 tokenAmount) private view returns (uint256) {
        return (tokenAmount * _rules.tokenPrice) / 1e18;
    }

    /// @dev Credits `tokenAmount` to `buyer`'s vesting position, tallies
    /// the sale, and ends it if the cap is now met.
    function _recordPurchase(
        address buyer,
        address paymentToken,
        uint256 paymentAmount,
        uint256 tokenAmount
    ) private {
        Vesting storage vesting = _vestings[buyer];

        if (vesting.total == 0) {
            vesting.cliffEnd = _rules.tgeDate + _rules.cliffDuration;
        }

        vesting.total += tokenAmount;
        vesting.tgeAmount += (tokenAmount * _rules.initialUnlockBps) / 10_000;

        tokensSold += tokenAmount;

        emit TokensPurchased(buyer, paymentToken, paymentAmount, tokenAmount);

        if (tokensSold >= _rules.tokenCap) {
            state = SaleState.Ended;
            emit SaleEnded();
        }
    }

    /// @dev Scales a raw `token` amount up to an 18-decimal (WAD) value —
    /// the common precision every oracle price is already expressed in.
    function _toWad(address token, uint256 amount) private view returns (uint256) {
        uint8 decimals = IERC20Metadata(token).decimals();
        return amount * (10 ** (18 - decimals));
    }

    /// @dev Inverse of `_toWad`: scales a WAD value back down to `token`'s
    /// own decimals.
    function _fromWad(address token, uint256 wadAmount) private view returns (uint256) {
        uint8 decimals = IERC20Metadata(token).decimals();
        return wadAmount / (10 ** (18 - decimals));
    }

    /// @dev ETH value of `amount` units of `paymentToken`, via two oracle
    /// reads (payment token/USD and ETH/USD) around a WAD-scaled amount.
    function _ethValueOf(
        address paymentToken,
        uint256 amount
    ) private view returns (uint256) {
        uint256 paymentTokenUsd = _oraclePrice(paymentToken);
        uint256 ethUsd = _oraclePrice(ETH_ADDRESS);

        return Math.mulDiv(_toWad(paymentToken, amount), paymentTokenUsd, ethUsd);
    }

    /// @dev Inverse of `_ethValueOf`: how many units of `paymentToken` a
    /// given ETH-denominated amount is worth.
    function _paymentValueOf(
        address paymentToken,
        uint256 ethAmount
    ) private view returns (uint256) {
        uint256 paymentTokenUsd = _oraclePrice(paymentToken);
        uint256 ethUsd = _oraclePrice(ETH_ADDRESS);

        uint256 wadAmount = Math.mulDiv(ethAmount, ethUsd, paymentTokenUsd);
        return _fromWad(paymentToken, wadAmount);
    }

    /// @dev `token`'s USD price (WAD-scaled); reverts if no oracle is registered.
    function _oraclePrice(address token) private view returns (uint256) {
        IPriceOracle oracle = paymentOracles[token];
        if (address(oracle) == address(0)) revert TokenNotAccepted();
        return oracle.getPrice();
    }
}
