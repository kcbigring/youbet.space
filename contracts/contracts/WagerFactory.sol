// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "./Wager.sol";

contract WagerFactory {
    address public treasury;
    address[] public wagers;

    event WagerCreated(address indexed wagerAddress, address creator, uint256 stake, uint256 bond);

    constructor(address _treasury) {
        treasury = _treasury;
    }

    function createWager(uint256 stake, uint256 bond, uint256 ownerSplitBps) external returns (address) {
        Wager w = new Wager(msg.sender, stake, bond, treasury, ownerSplitBps);
        wagers.push(address(w));
        emit WagerCreated(address(w), msg.sender, stake, bond);
        return address(w);
    }

    function getWagers() external view returns (address[] memory) {
        return wagers;
    }
}
