// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../structs/Vesting.sol";
import "../structs/Rules.sol";
import "../enums/SaleState.sol";

/// @notice Errors and events of the ICO contract, grouped by concern.
interface IICO {
    // ------ SALE STATE ------

    /// @dev Sale is past `NotStarted`.
    error SaleAlreadyStarted();
    /// @dev Sale isn't open right now.
    error SaleNotActive();
    /// @dev `resumeSale` called while not paused.
    error SaleNotPaused();
    /// @dev Sale hasn't ended yet.
    error SaleNotEnded();
    /// @dev Time window closed while paused, so it can't be resumed.
    error SaleWindowClosed();
    /// @dev `startSale` called before `setRules`.
    error RulesNotSet();
    /// @dev Start/end timestamps don't form a valid window.
    error InvalidTimeRange();

    // ------ PURCHASES ------

    /// @dev No tokens left to sell.
    error ExceedsCap();
    /// @dev No price oracle registered for this payment token.
    error TokenNotAccepted();
    /// @dev Payment token already has a registered oracle.
    error TokenAlreadyAccepted();
    /// @dev Amount falls outside `[minPurchase, maxPurchase]`.
    error InvalidPurchaseAmount();
    /// @dev `minPurchase >= maxPurchase`.
    error InvalidPurchaseLimits();
    /// @dev Buyer isn't whitelisted.
    error NotVerified();

    // ------ CLAIMS ------

    /// @dev Nothing currently unlocked for the caller.
    error NothingToClaim();
    /// @dev `executeTGE` already ran.
    error TgeAlreadyExecuted();
    /// @dev Claim attempted before `executeTGE` has run.
    error TgeNotExecuted();
    /// @dev Owner doesn't hold enough sale tokens to fund the TGE.
    error InsufficientTokenBalance();

    // ------ VALIDATION ------

    /// @dev A required address argument is the zero address.
    error ZeroAddress();
    /// @dev A required amount argument is zero.
    error ZeroAmount();
    /// @dev `initialUnlockBps` is zero or above 10000 (100%).
    error InvalidUnlockBps();
    /// @dev TGE date isn't after the reference time it's checked against.
    error InvalidTgeDate();

    // ------ TRANSFERS ------

    /// @dev A native ETH transfer reverted.
    error ETHTransferFailed();
    /// @dev Nothing available to withdraw.
    error NothingToWithdraw();
    /// @dev Sale token withdrawal attempted via `withdrawERC20`; use
    /// `withdrawUnsoldTokens` instead.
    error UseWithdrawUnsoldTokens();

    /// @notice Sale rules were configured.
    event RulesUpdated(
        uint256 tokenPrice,
        uint256 minPurchase,
        uint256 maxPurchase,
        uint256 tokenCap
    );
    /// @notice `token` became payable via `oracle`.
    event PaymentTokenAccepted(address indexed token, address oracle);
    /// @notice `token` no longer accepted as payment.
    event PaymentTokenRemoved(address indexed token);
    /// @notice Sale opened for `[startTime, endTime)`.
    event SaleStarted(uint256 startTime, uint256 endTime);
    /// @notice Sale paused.
    event SalePaused();
    /// @notice Sale resumed after a pause.
    event SaleResumed();
    /// @notice Sale ended, by any path (manual, time, or cap).
    event SaleEnded();
    /// @notice `buyer` bought `tokenAmount` sale tokens, paying
    /// `paymentAmount` of `paymentToken` (`ETH_ADDRESS` for ETH).
    event TokensPurchased(
        address indexed buyer,
        address indexed paymentToken,
        uint256 paymentAmount,
        uint256 tokenAmount
    );
    /// @notice TGE ran; `totalTokensDistributed` sale tokens were pulled
    /// into the contract for buyers to claim.
    event TgeExecuted(uint256 totalTokensDistributed);
    /// @notice `user` claimed `amount` sale tokens.
    event TokensClaimed(address indexed user, uint256 amount);
    /// @notice `amount` of `token` (`ETH_ADDRESS` for ETH) sent to `to`.
    event FundsWithdrawn(address indexed token, address indexed to, uint256 amount);
    /// @notice `amount` unsold sale tokens sent to `to`.
    event UnsoldTokensWithdrawn(address indexed to, uint256 amount);
}
