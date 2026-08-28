// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Wager.sol";
import "./Owned.sol";
import "./GroupRegistry.sol";

/// @title WagerFactory
/// @notice Deploys individual `Wager` escrows and enforces the protocol-level risk
///         controls: per-person stake caps, total pot caps and the protocol fee.
/// @dev Per-user monthly volume limits are enforced off-chain by the API, which owns
///      the user identity that such a limit is scoped to.
contract WagerFactory is Owned {
    uint256 private constant BPS = 10_000;

    address public treasury;
    address public resolverRegistry;
    GroupRegistry public groupRegistry;

    /// @notice Protocol fee taken from the pot on settlement (100 bps = 1%).
    uint256 public feeBps = 100;
    /// @notice Ceiling on what one person can stake in a single wager.
    uint256 public maxStakeWei;
    /// @notice Ceiling on the total pot of a single wager.
    uint256 public maxPotWei;
    /// @notice Longest allowed window between the event ending and attestation closing.
    uint64 public maxResolutionWindow = 7 days;

    address[] public wagers;
    mapping(address => bool) public isWager;
    mapping(address => address[]) public wagersByCreator;
    mapping(uint256 => address[]) public wagersByGroup;

    struct CreateParams {
        uint256 groupId; // 0 = no group gating
        bytes32 termsHash;
        uint256 stake;
        uint256 bond;
        uint256 ownerSplitBps;
        uint256 attestationThresholdBps;
        uint64 fundingDeadline;
        uint64 eventDeadline;
        uint64 resolutionDeadline;
        uint8 maxParticipants;
        Wager.Resolution resolutionMethod;
    }

    event WagerCreated(
        address indexed wager,
        address indexed creator,
        uint256 indexed groupId,
        bytes32 termsHash,
        uint256 stake,
        uint256 bond,
        uint8 maxParticipants
    );
    event LimitsUpdated(uint256 maxStakeWei, uint256 maxPotWei, uint256 feeBps);
    event TreasuryUpdated(address treasury);
    event RegistriesUpdated(address groupRegistry, address resolverRegistry);

    constructor(
        address _owner,
        address _treasury,
        address _groupRegistry,
        address _resolverRegistry,
        uint256 _maxStakeWei,
        uint256 _maxPotWei
    ) Owned(_owner) {
        require(_treasury != address(0), "treasury required");
        treasury = _treasury;
        groupRegistry = GroupRegistry(_groupRegistry);
        resolverRegistry = _resolverRegistry;
        maxStakeWei = _maxStakeWei;
        maxPotWei = _maxPotWei;
    }

    // ------------------------------------------------------------------ admin

    function setLimits(uint256 _maxStakeWei, uint256 _maxPotWei, uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 1_000, "fee above 10%");
        maxStakeWei = _maxStakeWei;
        maxPotWei = _maxPotWei;
        feeBps = _feeBps;
        emit LimitsUpdated(_maxStakeWei, _maxPotWei, _feeBps);
    }

    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "treasury required");
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setRegistries(address _groupRegistry, address _resolverRegistry) external onlyOwner {
        groupRegistry = GroupRegistry(_groupRegistry);
        resolverRegistry = _resolverRegistry;
        emit RegistriesUpdated(_groupRegistry, _resolverRegistry);
    }

    function setMaxResolutionWindow(uint64 window) external onlyOwner {
        require(window >= 1 hours, "window too short");
        maxResolutionWindow = window;
    }

    // ----------------------------------------------------------------- create

    function createWager(CreateParams calldata p) external returns (address) {
        require(p.stake > 0, "stake required");
        require(p.maxParticipants >= 2, "need 2 participants");
        require(maxStakeWei == 0 || p.stake <= maxStakeWei, "stake above limit");

        uint256 potCeiling = p.stake * p.maxParticipants;
        require(maxPotWei == 0 || potCeiling <= maxPotWei, "pot above limit");
        require(p.resolutionDeadline - p.eventDeadline <= maxResolutionWindow, "resolution window too long");

        if (p.groupId != 0) {
            require(address(groupRegistry) != address(0), "no group registry");
            require(groupRegistry.isMember(p.groupId, msg.sender), "not a group member");
            (uint256 groupMaxStake, uint256 groupMaxPot) = groupRegistry.groupLimits(p.groupId);
            require(groupMaxStake == 0 || p.stake <= groupMaxStake, "stake above group limit");
            require(groupMaxPot == 0 || potCeiling <= groupMaxPot, "pot above group limit");
        }

        Wager wager = new Wager(
            Wager.Terms({
                creator: msg.sender,
                treasury: treasury,
                resolverRegistry: resolverRegistry,
                termsHash: p.termsHash,
                stake: p.stake,
                bond: p.bond,
                feeBps: feeBps,
                ownerSplitBps: p.ownerSplitBps,
                attestationThresholdBps: p.attestationThresholdBps,
                fundingDeadline: p.fundingDeadline,
                eventDeadline: p.eventDeadline,
                resolutionDeadline: p.resolutionDeadline,
                maxParticipants: p.maxParticipants,
                resolutionMethod: p.resolutionMethod
            })
        );

        address addr = address(wager);
        wagers.push(addr);
        isWager[addr] = true;
        wagersByCreator[msg.sender].push(addr);
        if (p.groupId != 0) wagersByGroup[p.groupId].push(addr);

        emit WagerCreated(addr, msg.sender, p.groupId, p.termsHash, p.stake, p.bond, p.maxParticipants);
        return addr;
    }

    // ------------------------------------------------------------------ views

    function wagerCount() external view returns (uint256) {
        return wagers.length;
    }

    function getWagers() external view returns (address[] memory) {
        return wagers;
    }

    function getWagersByCreator(address creator) external view returns (address[] memory) {
        return wagersByCreator[creator];
    }

    function getWagersByGroup(uint256 groupId) external view returns (address[] memory) {
        return wagersByGroup[groupId];
    }
}
