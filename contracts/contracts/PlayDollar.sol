// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PlayDollar
/// @notice Play money for the alpha, denominated in dollars but worth nothing.
///         Six decimals so the same amounts work unchanged against real USDC
///         later, by swapping the token address and deploying none of this.
/// @dev Deployed on mainnet as well as testnet, because the wallet people
///      actually use only works on mainnet. Nothing of value is ever wagered:
///      this token has no market, no backing, and anyone can mint it. The name
///      and symbol say so plainly, and deliberately avoid "USD" so it can never
///      be mistaken for a stablecoin.
/// @dev Anyone may `drip()` themselves a fixed allowance once per interval. This
///      exists only so a friend arriving from an invite link has something to
///      bet with; it has no place on a network where the token means anything.
contract PlayDollar {
    string public constant name = "youbet Play Money (no value)";
    string public constant symbol = "PLAY";
    uint8 public constant decimals = 6;

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    address public owner;

    /// @notice How much a single drip hands out. $500 covers the plan's
    ///         per-user monthly limit with room to spare.
    uint256 public dripAmount = 500_000_000; // 500.000000
    uint256 public dripInterval = 1 days;
    mapping(address => uint256) public lastDrip;

    /// Founding bonus, paid once, on an account's first ever drip. Being early
    /// is worth something and the amount says how early: the first ten get ten
    /// times what the next ninety do. After that the bonus is gone for good and
    /// everyone simply gets the daily drip.
    uint256 public constant FOUNDER_SLOTS = 10;
    uint256 public constant EARLY_SLOTS = 100;
    uint256 public founderBonus = 10_000_000_000; // 10,000.000000
    uint256 public earlyBonus = 1_000_000_000; // 1,000.000000

    /// How many accounts have claimed a first drip. Also the position the next
    /// one will take.
    uint256 public claimed;
    mapping(address => bool) public hasClaimed;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Dripped(address indexed to, uint256 amount);
    event FoundingBonus(address indexed to, uint256 amount, uint256 position);

    constructor(address _owner) {
        require(_owner != address(0), "owner required");
        owner = _owner;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "not owner");
        _;
    }

    function transfer(address to, uint256 value) external returns (bool) {
        _transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) external returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transferFrom(address from, address to, uint256 value) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            require(allowed >= value, "insufficient allowance");
            allowance[from][msg.sender] = allowed - value;
        }
        _transfer(from, to, value);
        return true;
    }

    function _transfer(address from, address to, uint256 value) internal {
        require(to != address(0), "transfer to zero");
        uint256 balance = balanceOf[from];
        require(balance >= value, "insufficient balance");
        unchecked {
            balanceOf[from] = balance - value;
            balanceOf[to] += value;
        }
        emit Transfer(from, to, value);
    }

    /// @notice Self-service test money, rate-limited per address.
    function drip() external {
        require(block.timestamp >= lastDrip[msg.sender] + dripInterval, "already dripped today");
        lastDrip[msg.sender] = block.timestamp;

        uint256 amount = dripAmount;

        if (!hasClaimed[msg.sender]) {
            hasClaimed[msg.sender] = true;
            uint256 position = claimed;
            claimed = position + 1;

            uint256 bonus = position < FOUNDER_SLOTS
                ? founderBonus
                : (position < EARLY_SLOTS ? earlyBonus : 0);

            if (bonus > 0) {
                amount += bonus;
                emit FoundingBonus(msg.sender, bonus, position + 1);
            }
        }

        _mint(msg.sender, amount);
        emit Dripped(msg.sender, amount);
    }

    /// @notice What this address would receive from `drip()` right now, so the
    ///         app can say "you would be number 7" before anyone commits.
    function previewDrip(address account)
        external
        view
        returns (uint256 amount, uint256 position, uint256 bonus)
    {
        if (hasClaimed[account]) return (dripAmount, 0, 0);
        position = claimed + 1;
        bonus = claimed < FOUNDER_SLOTS ? founderBonus : (claimed < EARLY_SLOTS ? earlyBonus : 0);
        return (dripAmount + bonus, position, bonus);
    }

    /// @notice Fund someone directly — used to top up a new account the moment
    ///         it is created, so an invited friend never sees an empty wallet.
    function mint(address to, uint256 value) external onlyOwner {
        _mint(to, value);
    }

    function _mint(address to, uint256 value) internal {
        totalSupply += value;
        balanceOf[to] += value;
        emit Transfer(address(0), to, value);
    }

    function setDrip(uint256 amount, uint256 interval) external onlyOwner {
        dripAmount = amount;
        dripInterval = interval;
    }

    function setBonuses(uint256 founder, uint256 early) external onlyOwner {
        founderBonus = founder;
        earlyBonus = early;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "owner required");
        owner = newOwner;
    }
}
