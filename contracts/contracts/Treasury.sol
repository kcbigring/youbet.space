// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Owned.sol";

/// @title Treasury
/// @notice Collects the protocol fee from settled wagers. It never receives stakes
///         or resolution bonds — the house is economically neutral on disputes.
contract Treasury is Owned {
    event FeeReceived(address indexed from, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);

    constructor(address _owner) Owned(_owner) {}

    receive() external payable {
        emit FeeReceived(msg.sender, msg.value);
    }

    /// @notice Pull fees credited to this treasury by a settled wager.
    function collect(address wager) external {
        (bool ok, ) = wager.call(abi.encodeWithSignature("withdraw()"));
        require(ok, "collect failed");
    }

    function withdraw(address payable to, uint256 amount) external onlyOwner {
        require(to != address(0), "recipient required");
        require(amount <= address(this).balance, "insufficient balance");
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "transfer failed");
        emit Withdrawn(to, amount);
    }

    function balance() external view returns (uint256) {
        return address(this).balance;
    }
}
