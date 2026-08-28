// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./Owned.sol";

/// @title ResolverRegistry
/// @notice Allowlist of trusted oracle resolver services (sports data, price feeds)
///         permitted to report outcomes for oracle-resolved wagers.
contract ResolverRegistry is Owned {
    mapping(address => bool) private _resolvers;
    mapping(address => string) public resolverName;

    event ResolverSet(address indexed resolver, bool allowed, string name);

    constructor(address _owner) Owned(_owner) {}

    function setResolver(address resolver, bool allowed, string calldata name) external onlyOwner {
        require(resolver != address(0), "resolver required");
        _resolvers[resolver] = allowed;
        resolverName[resolver] = name;
        emit ResolverSet(resolver, allowed, name);
    }

    function isResolver(address account) external view returns (bool) {
        return _resolvers[account];
    }
}
