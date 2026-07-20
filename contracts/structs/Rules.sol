// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Economic parameters of the sale, configured by the owner before
/// it starts.
/// @param tokenPrice Price of one whole sale token, denominated in ETH
///        (18 decimals).
/// @param minPurchase Minimum purchase per transaction, in ETH equivalent.
/// @param maxPurchase Maximum purchase per transaction, in ETH equivalent.
/// @param tokenCap Maximum number of token base units that can be sold.
/// @param tgeDate Token Generation Event date — the moment tokens start
///        becoming claimable.
/// @param cliffDuration Period after the TGE date during which no linear
///        vesting accrues (the TGE-unlocked portion is still claimable).
/// @param vestingDuration Duration of the linear vesting after the cliff.
/// @param initialUnlockBps Share of each purchase unlocked immediately at
///        the TGE date, in basis points (10000 = 100%).
struct Rules {
    uint256 tokenPrice;
    uint256 minPurchase;
    uint256 maxPurchase;
    uint256 tokenCap;
    uint256 tgeDate;
    uint256 cliffDuration;
    uint256 vestingDuration;
    uint256 initialUnlockBps;
}
