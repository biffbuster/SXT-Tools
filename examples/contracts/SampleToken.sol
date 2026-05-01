// SPDX-License-Identifier: MIT
// Deliberately flawed sample contract for the pre-deploy-audit skill demo.
// DO NOT DEPLOY. This contract contains intentional vulnerabilities so the
// audit skill has something to find.
pragma solidity ^0.7.6;

contract SampleToken {
    string public name = "SampleToken";
    string public symbol = "SMPL";
    uint8 public decimals = 18;
    uint256 public totalSupply;

    address public owner;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(uint256 initialSupply) {
        owner = msg.sender;
        totalSupply = initialSupply;
        balanceOf[msg.sender] = initialSupply;
        emit Transfer(address(0), msg.sender, initialSupply);
    }

    // Vulnerability 1: no access control on mint.
    // Anyone can mint themselves unlimited supply.
    function mint(address to, uint256 amount) public {
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    // Vulnerability 2: classic reentrancy.
    // External call before state update.
    function withdraw(uint256 amount) public {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "send failed");
        balanceOf[msg.sender] -= amount;
    }

    // Vulnerability 3: pragma is below 0.8.0, no built-in overflow checks.
    function transfer(address to, uint256 value) public returns (bool) {
        balanceOf[msg.sender] -= value; // can underflow on insufficient balance
        balanceOf[to] += value;
        emit Transfer(msg.sender, to, value);
        return true;
    }

    function approve(address spender, uint256 value) public returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    // Vulnerability 4: ownership transfer with no two-step or zero-address check.
    function transferOwnership(address newOwner) public {
        require(msg.sender == owner, "not owner");
        owner = newOwner;
    }
}
