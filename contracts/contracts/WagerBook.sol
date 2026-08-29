// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Owned.sol";
import "./GroupRegistry.sol";

interface IResolverRegistry {
    function isResolver(address account) external view returns (bool);
}

/// @title WagerBook
/// @notice Every friendly wager, held in one contract and keyed by id.
/// @dev Replaces the earlier design of deploying a `Wager` contract per wager.
///      That cost ~2,000,000 gas each — 90% of it re-storing identical bytecode —
///      and, more importantly, gave every wager a fresh address. Paymasters
///      sponsor gas by allowlisting contract addresses, so a per-wager address
///      can never be allowlisted in advance, and `join` is precisely the call an
///      invited friend with no ETH needs sponsored. One fixed address fixes that.
///
///      Funds beyond the protocol fee are never held by the platform, and payouts
///      use the pull-payment pattern so one reverting recipient cannot brick
///      settlement for everyone else.
contract WagerBook is Owned {
    uint256 private constant BPS = 10_000;

    enum Status {
        None,
        Open, // accepting participants
        Locked, // funded, terms immutable
        Settled, // resolved, winners paid
        Refunded, // resolution failed, stakes returned
        Cancelled // never locked, everything returned
    }

    enum Resolution {
        Attestation,
        Oracle
    }

    struct Wager {
        address creator;
        bytes32 termsHash;
        uint128 stake;
        uint128 bond;
        uint256 groupId;
        uint16 feeBps;
        uint16 ownerSplitBps;
        uint16 attestationThresholdBps;
        uint64 fundingDeadline;
        uint64 eventDeadline;
        uint64 resolutionDeadline;
        uint8 maxParticipants;
        Resolution resolutionMethod;
        Status status;
        uint8 winningSide;
        uint32 resolverCount;
    }

    struct CreateParams {
        uint256 groupId; // 0 = no group gating
        bytes32 termsHash;
        uint128 stake;
        uint128 bond;
        uint16 ownerSplitBps;
        uint16 attestationThresholdBps;
        uint64 fundingDeadline;
        uint64 eventDeadline;
        uint64 resolutionDeadline;
        uint8 maxParticipants;
        Resolution resolutionMethod;
    }

    // ---------------------------------------------------------------- state

    uint256 public nextWagerId = 1;

    /// @dev Internal because the auto-generated getter for this struct blows the
    ///      stack; `getWager` returns it explicitly instead.
    mapping(uint256 => Wager) internal wagers;

    mapping(uint256 => address[]) internal participants;
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(uint256 => mapping(address => uint8)) public side;
    mapping(uint256 => mapping(address => bool)) public hasResolved;
    mapping(uint256 => mapping(address => uint8)) public resolutionChoice;
    mapping(uint256 => mapping(address => bool)) public conceded;
    mapping(uint256 => uint8[2]) public sideCount;
    mapping(uint256 => uint8[2]) public sideConcedeCount;
    mapping(uint256 => uint256[2]) public attestationCount;

    /// @notice Owed to an address across every wager, so one withdrawal collects
    ///         all winnings, refunds and bonds in a single transaction.
    mapping(address => uint256) public credits;

    mapping(address => uint256[]) internal wagersByCreator;
    mapping(uint256 => uint256[]) internal wagersByGroup;
    mapping(address => uint256[]) internal wagersByParticipant;

    // ---------------------------------------------------------- protocol config

    address public treasury;
    address public resolverRegistry;
    GroupRegistry public groupRegistry;

    /// @notice Protocol fee taken from the pot on settlement (100 bps = 1%).
    uint16 public feeBps = 100;
    uint256 public maxStakeWei;
    uint256 public maxPotWei;
    uint64 public maxResolutionWindow = 7 days;

    // --------------------------------------------------------------- events

    event WagerCreated(
        uint256 indexed wagerId,
        address indexed creator,
        uint256 indexed groupId,
        bytes32 termsHash,
        uint256 stake,
        uint256 bond,
        uint8 maxParticipants
    );
    event Joined(uint256 indexed wagerId, address indexed participant, uint8 side);
    event Locked(uint256 indexed wagerId, uint256 participantCount, uint256 pot);
    event Attested(uint256 indexed wagerId, address indexed participant, uint8 choice, bool conceded);
    event Settled(uint256 indexed wagerId, uint8 winningSide, uint256 distributed, uint256 fee, string method);
    event Refunded(uint256 indexed wagerId, uint256 participantCount);
    event Cancelled(uint256 indexed wagerId);
    event Credited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
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

    // ---------------------------------------------------------------- admin

    function setLimits(uint256 _maxStakeWei, uint256 _maxPotWei, uint16 _feeBps) external onlyOwner {
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

    // --------------------------------------------------------------- create

    function createWager(CreateParams calldata p) external returns (uint256) {
        require(p.stake > 0, "stake required");
        require(p.maxParticipants >= 2, "need 2 participants");
        require(p.attestationThresholdBps > 0 && p.attestationThresholdBps <= BPS, "bad threshold");
        require(p.ownerSplitBps <= BPS, "owner split too high");
        require(maxStakeWei == 0 || p.stake <= maxStakeWei, "stake above limit");

        uint256 potCeiling = uint256(p.stake) * p.maxParticipants;
        require(maxPotWei == 0 || potCeiling <= maxPotWei, "pot above limit");

        require(p.fundingDeadline > block.timestamp, "funding deadline passed");
        require(p.eventDeadline >= p.fundingDeadline, "event before funding");
        require(p.resolutionDeadline > p.eventDeadline, "resolution before event");
        require(p.resolutionDeadline - p.eventDeadline <= maxResolutionWindow, "resolution window too long");

        if (p.groupId != 0) {
            require(address(groupRegistry) != address(0), "no group registry");
            require(groupRegistry.isMember(p.groupId, msg.sender), "not a group member");
            (uint256 groupMaxStake, uint256 groupMaxPot) = groupRegistry.groupLimits(p.groupId);
            require(groupMaxStake == 0 || p.stake <= groupMaxStake, "stake above group limit");
            require(groupMaxPot == 0 || potCeiling <= groupMaxPot, "pot above group limit");
        }

        uint256 id = nextWagerId++;
        wagers[id] = Wager({
            creator: msg.sender,
            termsHash: p.termsHash,
            stake: p.stake,
            bond: p.bond,
            groupId: p.groupId,
            feeBps: feeBps,
            ownerSplitBps: p.ownerSplitBps,
            attestationThresholdBps: p.attestationThresholdBps,
            fundingDeadline: p.fundingDeadline,
            eventDeadline: p.eventDeadline,
            resolutionDeadline: p.resolutionDeadline,
            maxParticipants: p.maxParticipants,
            resolutionMethod: p.resolutionMethod,
            status: Status.Open,
            winningSide: 0,
            resolverCount: 0
        });

        wagersByCreator[msg.sender].push(id);
        if (p.groupId != 0) wagersByGroup[p.groupId].push(id);

        emit WagerCreated(id, msg.sender, p.groupId, p.termsHash, p.stake, p.bond, p.maxParticipants);
        return id;
    }

    // -------------------------------------------------------------- funding

    /// @notice Join wager `id` on `_side` by escrowing stake + resolution bond.
    function join(uint256 id, uint8 _side) external payable {
        Wager storage w = wagers[id];
        require(w.status == Status.Open, "not open");
        require(block.timestamp <= w.fundingDeadline, "funding closed");
        require(!joined[id][msg.sender], "already joined");
        require(_side < 2, "invalid side");
        require(msg.value == uint256(w.stake) + uint256(w.bond), "incorrect value");
        require(participants[id].length < w.maxParticipants, "wager full");

        joined[id][msg.sender] = true;
        side[id][msg.sender] = _side;
        participants[id].push(msg.sender);
        sideCount[id][_side] += 1;
        wagersByParticipant[msg.sender].push(id);

        emit Joined(id, msg.sender, _side);

        if (participants[id].length == w.maxParticipants) _lock(id);
    }

    /// @notice Lock once both sides are represented. Terms become immutable.
    function lock(uint256 id) external {
        Wager storage w = wagers[id];
        require(w.status == Status.Open, "not open");
        require(msg.sender == w.creator || block.timestamp > w.fundingDeadline, "creator or deadline");
        _lock(id);
    }

    function _lock(uint256 id) internal {
        require(sideCount[id][0] > 0 && sideCount[id][1] > 0, "both sides required");
        wagers[id].status = Status.Locked;
        emit Locked(id, participants[id].length, uint256(wagers[id].stake) * participants[id].length);
    }

    /// @notice Return every deposit if the wager never locked.
    function cancel(uint256 id) external {
        Wager storage w = wagers[id];
        require(w.status == Status.Open, "not open");
        require(block.timestamp > w.fundingDeadline || msg.sender == w.creator, "funding still open");
        require(sideCount[id][0] == 0 || sideCount[id][1] == 0 || msg.sender == w.creator, "lockable");

        w.status = Status.Cancelled;
        uint256 refund = uint256(w.stake) + uint256(w.bond);
        address[] storage list = participants[id];
        for (uint256 i = 0; i < list.length; i++) {
            _credit(list[i], refund);
        }
        emit Cancelled(id);
    }

    // ----------------------------------------------------------- resolution

    /// @notice Attest to the side that won.
    function attest(uint256 id, uint8 _winningSide) external {
        require(block.timestamp >= wagers[id].eventDeadline, "event not over");
        require(_winningSide < 2, "invalid side");
        _recordResolution(id, msg.sender, _winningSide, false);
    }

    /// @notice Concede: the opposing side won. Available as soon as the wager
    ///         locks, so a loser can settle up early.
    function concede(uint256 id) external {
        require(joined[id][msg.sender], "not participant");
        _recordResolution(id, msg.sender, side[id][msg.sender] == 0 ? 1 : 0, true);
    }

    function _recordResolution(uint256 id, address participant, uint8 choice, bool isConcession) internal {
        Wager storage w = wagers[id];
        require(w.status == Status.Locked, "not active");
        require(joined[id][participant], "not participant");
        require(!hasResolved[id][participant], "already resolved");
        require(block.timestamp <= w.resolutionDeadline, "resolution window closed");

        hasResolved[id][participant] = true;
        resolutionChoice[id][participant] = choice;
        w.resolverCount += 1;
        attestationCount[id][choice] += 1;

        if (isConcession) {
            conceded[id][participant] = true;
            sideConcedeCount[id][side[id][participant]] += 1;
        }

        emit Attested(id, participant, choice, isConcession);

        // Level 2 — every member of a side conceded, so the other side won.
        uint8 losing = side[id][participant];
        if (isConcession && sideConcedeCount[id][losing] == sideCount[id][losing]) {
            // Nobody disputed the outcome, so no one owed an attestation.
            _settle(id, losing == 0 ? 1 : 0, "concede", true);
            return;
        }

        // Level 3 — group attestation reached the configured threshold.
        if (attestationCount[id][choice] >= _threshold(id)) {
            _settle(id, choice, "attestation", false);
        }
    }

    /// @notice Level 1 — an approved oracle resolver reports the outcome.
    function resolveByOracle(uint256 id, uint8 _winningSide) external {
        Wager storage w = wagers[id];
        require(w.status == Status.Locked, "not active");
        require(w.resolutionMethod == Resolution.Oracle, "not an oracle wager");
        require(block.timestamp >= w.eventDeadline, "event not over");
        require(_winningSide < 2, "invalid side");
        require(resolverRegistry != address(0), "no registry");
        require(IResolverRegistry(resolverRegistry).isResolver(msg.sender), "not a resolver");
        _settle(id, _winningSide, "oracle", true);
    }

    /// @notice After the resolution window closes without a threshold, return
    ///         stakes. Bonds of non-attesters go to those who did attest.
    function expire(uint256 id) external {
        Wager storage w = wagers[id];
        require(w.status == Status.Locked, "not active");
        require(block.timestamp > w.resolutionDeadline, "resolution window open");

        w.status = Status.Refunded;
        address[] storage list = participants[id];
        for (uint256 i = 0; i < list.length; i++) {
            _credit(list[i], w.stake);
        }
        _distributeBonds(id, w.resolverCount);
        emit Refunded(id, list.length);
    }

    /// @notice Attestations required for a side to settle this wager.
    function threshold(uint256 id) external view returns (uint256) {
        return _threshold(id);
    }

    function _threshold(uint256 id) internal view returns (uint256) {
        // Smallest k where k/n is strictly greater than the threshold fraction,
        // so a simple majority (5000 bps) of two participants requires both.
        uint256 n = participants[id].length;
        uint256 required = (n * wagers[id].attestationThresholdBps) / BPS + 1;
        if (required > n) required = n;
        return required;
    }

    // ----------------------------------------------------------- settlement

    function _settle(uint256 id, uint8 _winningSide, string memory method, bool refundAllBonds) internal {
        Wager storage w = wagers[id];
        w.status = Status.Settled;
        w.winningSide = _winningSide;

        address[] storage list = participants[id];
        uint256 potTotal = uint256(w.stake) * list.length;
        uint256 fee = (potTotal * w.feeBps) / BPS;
        uint256 ownerShare = (fee * w.ownerSplitBps) / BPS;
        uint256 treasuryShare = fee - ownerShare;
        uint256 distributable = potTotal - fee;

        uint256 winners = sideCount[id][_winningSide];
        uint256 share = distributable / winners;
        uint256 dust = distributable - (share * winners);

        bool dustPaid;
        for (uint256 i = 0; i < list.length; i++) {
            address p = list[i];
            if (side[id][p] != _winningSide) continue;
            uint256 amount = share;
            if (!dustPaid) {
                amount += dust;
                dustPaid = true;
            }
            _credit(p, amount);
        }

        if (ownerShare > 0) _credit(w.creator, ownerShare);
        if (treasuryShare > 0) _credit(treasury, treasuryShare);

        _distributeBonds(id, refundAllBonds ? list.length : w.resolverCount);

        emit Settled(id, _winningSide, distributable, fee, method);
    }

    /// @dev Refunds bonds to participants who met their resolution duty and
    ///      splits forfeited bonds among them. The platform never takes a bond.
    function _distributeBonds(uint256 id, uint256 duesMet) internal {
        uint256 bond = wagers[id].bond;
        if (bond == 0) return;

        address[] storage list = participants[id];

        // Nobody participated in resolution — return every bond rather than
        // confiscate.
        if (duesMet == 0) {
            for (uint256 i = 0; i < list.length; i++) {
                _credit(list[i], bond);
            }
            return;
        }

        bool everyoneMetDuty = duesMet == list.length;
        uint256 forfeited = (list.length - duesMet) * bond;
        uint256 perResolver = forfeited / duesMet;
        uint256 dust = forfeited - (perResolver * duesMet);

        bool dustPaid;
        for (uint256 i = 0; i < list.length; i++) {
            address p = list[i];
            if (!everyoneMetDuty && !hasResolved[id][p]) continue;
            uint256 amount = bond + perResolver;
            if (!dustPaid) {
                amount += dust;
                dustPaid = true;
            }
            _credit(p, amount);
        }
    }

    function _credit(address account, uint256 amount) internal {
        if (amount == 0) return;
        credits[account] += amount;
        emit Credited(account, amount);
    }

    /// @notice Withdraw everything owed to the caller, across every wager.
    function withdraw() external returns (uint256) {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "nothing to withdraw");
        credits[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
        return amount;
    }

    // ----------------------------------------------------------------- views

    function getWager(uint256 id) external view returns (Wager memory) {
        return wagers[id];
    }

    function getParticipants(uint256 id) external view returns (address[] memory) {
        return participants[id];
    }

    function participantCount(uint256 id) external view returns (uint256) {
        return participants[id].length;
    }

    function pot(uint256 id) external view returns (uint256) {
        return uint256(wagers[id].stake) * participants[id].length;
    }

    function wagerCount() external view returns (uint256) {
        return nextWagerId - 1;
    }

    function getWagersByCreator(address creator) external view returns (uint256[] memory) {
        return wagersByCreator[creator];
    }

    function getWagersByGroup(uint256 groupId) external view returns (uint256[] memory) {
        return wagersByGroup[groupId];
    }

    function getWagersByParticipant(address participant) external view returns (uint256[] memory) {
        return wagersByParticipant[participant];
    }

    /// @notice Everything a client needs to render a wager in one call.
    function summary(
        uint256 id
    )
        external
        view
        returns (
            Status status,
            uint8 winningSide,
            uint256 participantsCount,
            uint256 potTotal,
            uint256 required,
            uint256 forSide0,
            uint256 forSide1
        )
    {
        Wager storage w = wagers[id];
        return (
            w.status,
            w.winningSide,
            participants[id].length,
            uint256(w.stake) * participants[id].length,
            _threshold(id),
            attestationCount[id][0],
            attestationCount[id][1]
        );
    }

    /// @notice One participant's full state, so a client needs a single call
    ///         per person rather than five.
    function participantState(
        uint256 id,
        address account
    )
        external
        view
        returns (bool isParticipant, uint8 chosenSide, bool resolved, uint8 choice, bool didConcede)
    {
        return (
            joined[id][account],
            side[id][account],
            hasResolved[id][account],
            resolutionChoice[id][account],
            conceded[id][account]
        );
    }
}
