// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IResolverRegistry {
    function isResolver(address account) external view returns (bool);
}

/// @title Wager
/// @notice A single two-sided friendly wager between known participants.
/// @dev Funds are never held by the platform beyond the protocol fee. Payouts use
///      the pull-payment pattern so a single reverting recipient cannot brick settlement.
contract Wager {
    enum Status {
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

    uint256 private constant BPS = 10_000;

    address public immutable factory;
    address public immutable creator;
    address public immutable treasury;
    address public immutable resolverRegistry;

    /// @notice Hash of the off-chain wager terms (proposition, side labels, metadata).
    bytes32 public immutable termsHash;

    uint256 public immutable stake;
    uint256 public immutable bond;
    uint256 public immutable feeBps;
    /// @notice Share of the protocol fee routed to the wager creator.
    uint256 public immutable ownerSplitBps;
    /// @notice Fraction of participants that must agree for attestation to settle.
    uint256 public immutable attestationThresholdBps;

    uint64 public immutable fundingDeadline;
    uint64 public immutable eventDeadline;
    uint64 public immutable resolutionDeadline;
    uint8 public immutable maxParticipants;

    Resolution public immutable resolutionMethod;

    Status public status;
    uint8 public winningSide;

    address[] public participants;
    mapping(address => bool) public joined;
    mapping(address => uint8) public side;
    mapping(address => bool) public hasResolved;
    mapping(address => uint8) public resolutionChoice;
    mapping(address => bool) public conceded;
    mapping(address => uint256) public credits;

    uint8[2] public sideCount;
    uint8[2] public sideConcedeCount;
    uint256[2] public attestationCount;
    uint256 public resolverCount;

    event Joined(address indexed participant, uint8 side);
    event Locked(uint256 participantCount, uint256 pot);
    event Attested(address indexed participant, uint8 choice, bool conceded);
    event Settled(uint8 winningSide, uint256 distributed, uint256 fee, string method);
    event Refunded(uint256 participantCount);
    event Cancelled();
    event Credited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    struct Terms {
        address creator;
        address treasury;
        address resolverRegistry;
        bytes32 termsHash;
        uint256 stake;
        uint256 bond;
        uint256 feeBps;
        uint256 ownerSplitBps;
        uint256 attestationThresholdBps;
        uint64 fundingDeadline;
        uint64 eventDeadline;
        uint64 resolutionDeadline;
        uint8 maxParticipants;
        Resolution resolutionMethod;
    }

    constructor(Terms memory t) {
        require(t.creator != address(0), "creator required");
        require(t.treasury != address(0), "treasury required");
        require(t.stake > 0, "stake required");
        require(t.feeBps <= BPS, "fee too high");
        require(t.ownerSplitBps <= BPS, "owner split too high");
        require(t.attestationThresholdBps > 0 && t.attestationThresholdBps <= BPS, "bad threshold");
        require(t.maxParticipants >= 2, "need 2 participants");
        require(t.fundingDeadline > block.timestamp, "funding deadline passed");
        require(t.eventDeadline >= t.fundingDeadline, "event before funding");
        require(t.resolutionDeadline > t.eventDeadline, "resolution before event");

        factory = msg.sender;
        creator = t.creator;
        treasury = t.treasury;
        resolverRegistry = t.resolverRegistry;
        termsHash = t.termsHash;
        stake = t.stake;
        bond = t.bond;
        feeBps = t.feeBps;
        ownerSplitBps = t.ownerSplitBps;
        attestationThresholdBps = t.attestationThresholdBps;
        fundingDeadline = t.fundingDeadline;
        eventDeadline = t.eventDeadline;
        resolutionDeadline = t.resolutionDeadline;
        maxParticipants = t.maxParticipants;
        resolutionMethod = t.resolutionMethod;
        status = Status.Open;
    }

    // ---------------------------------------------------------------- funding

    /// @notice Join the wager on `_side` by escrowing stake + resolution bond.
    function join(uint8 _side) external payable {
        require(status == Status.Open, "not open");
        require(block.timestamp <= fundingDeadline, "funding closed");
        require(!joined[msg.sender], "already joined");
        require(_side < 2, "invalid side");
        require(msg.value == stake + bond, "incorrect value");
        require(participants.length < maxParticipants, "wager full");

        joined[msg.sender] = true;
        side[msg.sender] = _side;
        participants.push(msg.sender);
        sideCount[_side] += 1;

        emit Joined(msg.sender, _side);

        if (participants.length == maxParticipants) _lock();
    }

    /// @notice Lock the wager once both sides are represented. Terms become immutable.
    function lock() external {
        require(status == Status.Open, "not open");
        require(msg.sender == creator || block.timestamp > fundingDeadline, "creator or deadline");
        _lock();
    }

    function _lock() internal {
        require(sideCount[0] > 0 && sideCount[1] > 0, "both sides required");
        status = Status.Locked;
        emit Locked(participants.length, stake * participants.length);
    }

    /// @notice Return every deposit if the wager never locked (one-sided or unfunded).
    function cancel() external {
        require(status == Status.Open, "not open");
        require(block.timestamp > fundingDeadline || msg.sender == creator, "funding still open");
        require(sideCount[0] == 0 || sideCount[1] == 0 || msg.sender == creator, "lockable");

        status = Status.Cancelled;
        for (uint256 i = 0; i < participants.length; i++) {
            _credit(participants[i], stake + bond);
        }
        emit Cancelled();
    }

    // ------------------------------------------------------------- resolution

    /// @notice Attest to the side that won. Counts toward the attestation threshold.
    function attest(uint8 _winningSide) external {
        require(block.timestamp >= eventDeadline, "event not over");
        require(_winningSide < 2, "invalid side");
        _recordResolution(msg.sender, _winningSide, false);
    }

    /// @notice Concede: acknowledge that the opposing side won. Available as soon as
    ///         the wager locks, so a loser can settle up early.
    function concede() external {
        require(joined[msg.sender], "not participant");
        _recordResolution(msg.sender, side[msg.sender] == 0 ? 1 : 0, true);
    }

    function _recordResolution(address participant, uint8 choice, bool isConcession) internal {
        require(status == Status.Locked, "not active");
        require(joined[participant], "not participant");
        require(!hasResolved[participant], "already resolved");
        require(block.timestamp <= resolutionDeadline, "resolution window closed");

        hasResolved[participant] = true;
        resolutionChoice[participant] = choice;
        resolverCount += 1;
        attestationCount[choice] += 1;

        if (isConcession) {
            conceded[participant] = true;
            sideConcedeCount[side[participant]] += 1;
        }

        emit Attested(participant, choice, isConcession);

        // Level 2 — every member of a side conceded, so the other side won outright.
        uint8 losing = side[participant];
        if (isConcession && sideConcedeCount[losing] == sideCount[losing]) {
            // Nobody disputed the outcome, so no one owes an attestation: all bonds return.
            _settle(losing == 0 ? 1 : 0, "concede", true);
            return;
        }

        // Level 3 — group attestation reached the configured threshold.
        if (attestationCount[choice] >= _threshold()) {
            _settle(choice, "attestation", false);
        }
    }

    /// @notice Level 1 — an approved oracle resolver reports the outcome.
    function resolveByOracle(uint8 _winningSide) external {
        require(status == Status.Locked, "not active");
        require(resolutionMethod == Resolution.Oracle, "not an oracle wager");
        require(block.timestamp >= eventDeadline, "event not over");
        require(_winningSide < 2, "invalid side");
        require(resolverRegistry != address(0), "no registry");
        require(IResolverRegistry(resolverRegistry).isResolver(msg.sender), "not a resolver");
        _settle(_winningSide, "oracle", true);
    }

    /// @notice After the resolution window closes without a threshold, return stakes.
    ///         Bonds of non-attesters are redistributed to those who did attest.
    function expire() external {
        require(status == Status.Locked, "not active");
        require(block.timestamp > resolutionDeadline, "resolution window open");

        status = Status.Refunded;
        for (uint256 i = 0; i < participants.length; i++) {
            _credit(participants[i], stake);
        }
        _distributeBonds(resolverCount);
        emit Refunded(participants.length);
    }

    /// @notice Attestations required for a side to settle the wager.
    function threshold() external view returns (uint256) {
        return _threshold();
    }

    function _threshold() internal view returns (uint256) {
        // Smallest k where k/n is strictly greater than the threshold fraction, so a
        // simple majority (5000 bps) of two participants requires both of them.
        uint256 required = (participants.length * attestationThresholdBps) / BPS + 1;
        if (required > participants.length) required = participants.length;
        return required;
    }

    // ------------------------------------------------------------- settlement

    function _settle(uint8 _winningSide, string memory method, bool refundAllBonds) internal {
        status = Status.Settled;
        winningSide = _winningSide;

        uint256 potTotal = stake * participants.length;
        uint256 fee = (potTotal * feeBps) / BPS;
        uint256 ownerShare = (fee * ownerSplitBps) / BPS;
        uint256 treasuryShare = fee - ownerShare;
        uint256 distributable = potTotal - fee;

        uint256 winners = sideCount[_winningSide];
        uint256 share = distributable / winners;
        uint256 dust = distributable - (share * winners);

        bool dustPaid;
        for (uint256 i = 0; i < participants.length; i++) {
            address p = participants[i];
            if (side[p] != _winningSide) continue;
            uint256 amount = share;
            if (!dustPaid) {
                amount += dust;
                dustPaid = true;
            }
            _credit(p, amount);
        }

        if (ownerShare > 0) _credit(creator, ownerShare);
        if (treasuryShare > 0) _credit(treasury, treasuryShare);

        // Oracle wagers impose no attestation duty, so every bond comes back.
        _distributeBonds(refundAllBonds ? participants.length : resolverCount);

        emit Settled(_winningSide, distributable, fee, method);
    }

    /// @dev Refunds bonds to participants who met their resolution duty and splits
    ///      forfeited bonds among them. The platform never takes a bond.
    function _distributeBonds(uint256 duesMet) internal {
        if (bond == 0) return;

        // Nobody participated in resolution — return every bond rather than confiscate.
        if (duesMet == 0) {
            for (uint256 i = 0; i < participants.length; i++) {
                _credit(participants[i], bond);
            }
            return;
        }

        bool everyoneMetDuty = duesMet == participants.length;
        uint256 forfeited = (participants.length - duesMet) * bond;
        uint256 perResolver = forfeited / duesMet;
        uint256 dust = forfeited - (perResolver * duesMet);

        bool dustPaid;
        for (uint256 i = 0; i < participants.length; i++) {
            address p = participants[i];
            if (!everyoneMetDuty && !hasResolved[p]) continue;
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

    /// @notice Withdraw everything owed to the caller.
    function withdraw() external returns (uint256) {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "nothing to withdraw");
        credits[msg.sender] = 0;
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(msg.sender, amount);
        return amount;
    }

    // ------------------------------------------------------------------ views

    function participantCount() external view returns (uint256) {
        return participants.length;
    }

    function getParticipants() external view returns (address[] memory) {
        return participants;
    }

    function pot() external view returns (uint256) {
        return stake * participants.length;
    }

    /// @notice Everything a client needs to render the wager in one call.
    function summary()
        external
        view
        returns (
            Status _status,
            uint8 _winningSide,
            uint256 _participants,
            uint256 _pot,
            uint256 _required,
            uint256 _forSide0,
            uint256 _forSide1
        )
    {
        return (
            status,
            winningSide,
            participants.length,
            stake * participants.length,
            _threshold(),
            attestationCount[0],
            attestationCount[1]
        );
    }
}
