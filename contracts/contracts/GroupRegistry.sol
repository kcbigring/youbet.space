// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title GroupRegistry
/// @notice On-chain membership for private friend groups. Rich group data (names,
///         avatars, comments, reputation) lives in Postgres; this contract holds only
///         what the escrow layer must trust: who may wager with whom, and the group's
///         default risk limits.
contract GroupRegistry {
    struct Group {
        address owner;
        bytes32 metadataHash; // hash of the off-chain group record
        uint256 maxStakeWei; // per-person, per-wager cap
        uint256 maxPotWei; // total pot cap
        uint32 memberCount;
        bool exists;
    }

    uint256 public nextGroupId = 1;

    mapping(uint256 => Group) public groups;
    mapping(uint256 => mapping(address => bool)) public isMember;

    event GroupCreated(uint256 indexed groupId, address indexed owner, bytes32 metadataHash);
    event MemberAdded(uint256 indexed groupId, address indexed member);
    event MemberRemoved(uint256 indexed groupId, address indexed member);
    event LimitsUpdated(uint256 indexed groupId, uint256 maxStakeWei, uint256 maxPotWei);
    event GroupOwnerChanged(uint256 indexed groupId, address indexed newOwner);

    modifier onlyGroupOwner(uint256 groupId) {
        require(groups[groupId].exists, "no such group");
        require(groups[groupId].owner == msg.sender, "not group owner");
        _;
    }

    function createGroup(bytes32 metadataHash, uint256 maxStakeWei, uint256 maxPotWei) external returns (uint256) {
        uint256 groupId = nextGroupId++;
        groups[groupId] = Group({
            owner: msg.sender,
            metadataHash: metadataHash,
            maxStakeWei: maxStakeWei,
            maxPotWei: maxPotWei,
            memberCount: 0,
            exists: true
        });
        emit GroupCreated(groupId, msg.sender, metadataHash);
        _addMember(groupId, msg.sender);
        return groupId;
    }

    function addMember(uint256 groupId, address member) external onlyGroupOwner(groupId) {
        _addMember(groupId, member);
    }

    function addMembers(uint256 groupId, address[] calldata members) external onlyGroupOwner(groupId) {
        for (uint256 i = 0; i < members.length; i++) {
            _addMember(groupId, members[i]);
        }
    }

    function _addMember(uint256 groupId, address member) internal {
        require(member != address(0), "member required");
        if (isMember[groupId][member]) return;
        isMember[groupId][member] = true;
        groups[groupId].memberCount += 1;
        emit MemberAdded(groupId, member);
    }

    function removeMember(uint256 groupId, address member) external onlyGroupOwner(groupId) {
        require(isMember[groupId][member], "not a member");
        require(member != groups[groupId].owner, "cannot remove owner");
        isMember[groupId][member] = false;
        groups[groupId].memberCount -= 1;
        emit MemberRemoved(groupId, member);
    }

    function setLimits(uint256 groupId, uint256 maxStakeWei, uint256 maxPotWei) external onlyGroupOwner(groupId) {
        groups[groupId].maxStakeWei = maxStakeWei;
        groups[groupId].maxPotWei = maxPotWei;
        emit LimitsUpdated(groupId, maxStakeWei, maxPotWei);
    }

    function transferGroupOwnership(uint256 groupId, address newOwner) external onlyGroupOwner(groupId) {
        require(newOwner != address(0), "owner required");
        _addMember(groupId, newOwner);
        groups[groupId].owner = newOwner;
        emit GroupOwnerChanged(groupId, newOwner);
    }

    function groupLimits(uint256 groupId) external view returns (uint256 maxStakeWei, uint256 maxPotWei) {
        Group storage g = groups[groupId];
        return (g.maxStakeWei, g.maxPotWei);
    }
}
