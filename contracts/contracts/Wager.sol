// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract Wager {
    address public factory;
    address public creator;
    uint256 public stake; // per participant
    uint256 public bond; // resolution bond per participant
    uint256 public feeBps = 100; // 1% = 100 / 10000
    address public treasury;

    address[] public participants;
    mapping(address => bool) public joined;
    mapping(address => uint8) public side; // 0 or 1
    // SPDX-License-Identifier: MIT
    pragma solidity ^0.8.19;

    contract Wager {
        address public factory;
        address public creator;
        uint256 public stake; // per participant
        uint256 public bond; // resolution bond per participant
        uint256 public feeBps = 100; // 1% = 100 / 10000
        address public treasury;
        uint256 public ownerSplitBps; // portion of fee that goes to owner (bps)

        address[] public participants;
        mapping(address => bool) public joined;
        mapping(address => uint8) public side; // 0 or 1
        mapping(address => bool) public attested;
        mapping(address => uint8) public attestationChoice;

        bool public locked;
        bool public settled;

        event Joined(address participant, uint8 side);
        event Locked();
        event Attested(address participant, uint8 chosenWinner);
        event Settled(address winner, uint256 amountToWinner, uint256 fee);

        constructor(address _creator, uint256 _stake, uint256 _bond, address _treasury, uint256 _ownerSplitBps) payable {
            factory = msg.sender;
            creator = _creator;
            stake = _stake;
            bond = _bond;
            treasury = _treasury;
            ownerSplitBps = _ownerSplitBps;
        }

        // join by providing stake + bond
        function join(uint8 _side) external payable {
            require(!locked, "Wager locked");
            require(!joined[msg.sender], "Already joined");
            require(msg.value == stake + bond, "Incorrect value");
            require(_side == 0 || _side == 1, "Invalid side");

            joined[msg.sender] = true;
            side[msg.sender] = _side;
            participants.push(msg.sender);

            emit Joined(msg.sender, _side);

            if (participants.length == 2) {
                locked = true;
                emit Locked();
            }
        }

        // participant attests to the winning side
        function attest(uint8 _winnerSide) external {
            require(locked && !settled, "Not active");
            require(joined[msg.sender], "Not participant");
            require(_winnerSide == 0 || _winnerSide == 1, "Invalid side");

            attested[msg.sender] = true;
            attestationChoice[msg.sender] = _winnerSide;
            emit Attested(msg.sender, _winnerSide);
        }

        // settle by consensus: caller provides winner side; attesters must match
        function settleByConsensus(uint8 _winnerSide) external {
            require(locked && !settled, "Not active");
            require(_winnerSide == 0 || _winnerSide == 1, "Invalid side");

            uint256 attesters = 0;
            for (uint i = 0; i < participants.length; i++) {
                address p = participants[i];
                if (attested[p]) {
                    require(attestationChoice[p] == _winnerSide, "Attestation mismatch");
                    attesters += 1;
                }
            }
            require(attesters > 0, "No attesters");

            // determine winner address: the participant whose chosen side equals _winnerSide
            address winner = address(0);
            for (uint i = 0; i < participants.length; i++) {
                address p = participants[i];
                if (side[p] == _winnerSide) {
                    winner = p;
                    break;
                }
            }
            require(winner != address(0), "No winner for side");

            uint256 totalStake = stake * participants.length;
            uint256 fee = (totalStake * feeBps) / 10000;
            uint256 payout = totalStake - fee;

            // distribute fee between owner and treasury
            uint256 ownerShare = 0;
            uint256 treasuryShare = fee;
            if (ownerSplitBps > 0) {
                ownerShare = (fee * ownerSplitBps) / 10000;
                treasuryShare = fee - ownerShare;
            }

            // bonds handling: refund bonds to attesters; forfeited bonds split among attesters
            uint256 totalForfeitedBonds = 0;
            for (uint i = 0; i < participants.length; i++) {
                address p = participants[i];
                if (!attested[p]) totalForfeitedBonds += bond;
            }

            uint256 perAttesterForfeitShare = attesters > 0 ? totalForfeitedBonds / attesters : 0;

            settled = true;

            // transfer fee shares
            if (ownerShare > 0 && creator != address(0)) payable(creator).transfer(ownerShare);
            if (treasuryShare > 0 && treasury != address(0)) payable(treasury).transfer(treasuryShare);

            // transfer payout to winner
            payable(winner).transfer(payout);

            // refund bonds to attesters (their bond + share of forfeited bonds)
            for (uint i = 0; i < participants.length; i++) {
                address p = participants[i];
                if (attested[p]) {
                    uint256 refund = bond + perAttesterForfeitShare;
                    if (refund > 0) payable(p).transfer(refund);
                }
            }

            emit Settled(winner, payout, fee);
        }

        // allow contract to receive ETH
        receive() external payable {}
    }
