// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interface the ICO uses to check whether a buyer passed
/// verification. Any contract implementing it can act as the verification
/// source — an owner-managed list (as in this template), a Merkle-tree
/// checker, or an on-chain KYC registry.
interface IWhitelist {
    /// @notice Whether `user` passed verification and may buy.
    function isVerified(address user) external view returns (bool);
}
