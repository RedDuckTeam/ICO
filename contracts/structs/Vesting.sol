// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Per-buyer vesting position, created on the first purchase and
/// topped up by every purchase after that.
/// @param total Total tokens purchased by the buyer, across all purchases.
/// @param claimed Tokens already claimed by the buyer.
/// @param tgeAmount Portion of `total` unlocked immediately at the TGE date.
/// @param cliffEnd Timestamp when linear vesting starts for this buyer
///        (fixed at the first purchase: TGE date + cliff duration).
struct Vesting {
    uint256 total;
    uint256 claimed;
    uint256 tgeAmount;
    uint256 cliffEnd;
}
