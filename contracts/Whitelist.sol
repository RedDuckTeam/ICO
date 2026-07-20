// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {IWhitelist} from "./interfaces/IWhitelist.sol";

/// @title Whitelist
/// @notice Minimal owner-managed verification registry.
///
/// The ICO checks `isVerified(buyer)` before every purchase. In a real
/// project this is where an off-chain KYC/AML process would surface its
/// result on-chain: a backend verifies the user and then calls
/// `addToWhitelist`. For very large buyer lists, a Merkle-proof approach
/// (store one root, verify a proof per purchase) is cheaper than adding
/// addresses one by one — this template favors the simpler, more readable
/// registry since it makes the state easy to inspect and reason about.
contract Whitelist is Ownable, IWhitelist {
    /// @notice Emitted whenever `user`'s verification status changes.
    event WhitelistUpdated(address indexed user, bool isVerified);

    mapping(address => bool) private _isVerified;

    constructor() Ownable(msg.sender) {}

    /// @notice Whether `user` is verified.
    function isVerified(address user) external view returns (bool) {
        return _isVerified[user];
    }

    /// @notice Verifies `user`, allowing them to buy.
    function addToWhitelist(address user) external onlyOwner {
        _isVerified[user] = true;
        emit WhitelistUpdated(user, true);
    }

    /// @notice Revokes `user`'s verification.
    function removeFromWhitelist(address user) external onlyOwner {
        _isVerified[user] = false;
        emit WhitelistUpdated(user, false);
    }

    /// @notice Batch variant to save transactions when onboarding many
    /// buyers at once.
    function addBatchToWhitelist(address[] calldata users) external onlyOwner {
        for (uint256 i = 0; i < users.length; i++) {
            _isVerified[users[i]] = true;
            emit WhitelistUpdated(users[i], true);
        }
    }
}
