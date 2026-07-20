// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Lifecycle of the sale.
///
///   NotStarted -> Active -> Ended
///                   ^  \_____/
///                   |  Paused (stopSale / resumeSale)
///
/// `Active` also ends itself once the time window elapses or the token cap
/// is reached — see `ICO.isSaleOpen`.
enum SaleState {
    NotStarted,
    Active,
    Paused,
    Ended
}
