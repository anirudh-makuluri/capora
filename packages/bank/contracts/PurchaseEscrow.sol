// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {AccessControl} from '@openzeppelin/contracts/access/AccessControl.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Pausable} from '@openzeppelin/contracts/utils/Pausable.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
contract PurchaseEscrow is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;
    bytes32 public constant ATTESTOR_ROLE = keccak256('ATTESTOR_ROLE');
    enum State {
        None,
        Funded,
        Executing,
        Released,
        Refunded,
        Disputed
    }
    struct Purchase {
        address buyer;
        address seller;
        uint128 amount;
        uint64 deadline;
        uint16 feeBps;
        State state;
        bytes32 resultHash;
    }
    IERC20 public immutable token;
    address public immutable treasury;
    mapping(bytes32 => Purchase) public purchases;
    event Funded(
        bytes32 indexed id,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint16 feeBps
    );
    event Resolved(bytes32 indexed id, State state, uint256 sellerAmount, uint256 fee, bytes32 resultHash);
    constructor(address token_, address admin, address attestor, address treasury_) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        token = IERC20(token_);
        treasury = treasury_;
        require(treasury_ != address(0), 'ZERO_TREASURY');
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(ATTESTOR_ROLE, attestor);
    }
    function pause(bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (value) _pause();
        else _unpause();
    }
    function fund(
        bytes32 id,
        address seller,
        uint128 amount,
        uint64 deadline,
        uint16 feeBps
    ) external nonReentrant whenNotPaused {
        require(purchases[id].state == State.None && id != bytes32(0), 'DUPLICATE');
        require(
            amount > 0 &&
                seller != address(0) &&
                deadline > block.timestamp &&
                deadline <= block.timestamp + 1 days &&
                feeBps <= 1000,
            'INVALID_TERMS'
        );
        purchases[id] = Purchase(msg.sender, seller, amount, deadline, feeBps, State.Funded, bytes32(0));
        token.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(id, msg.sender, seller, amount, feeBps);
    }
    function start(bytes32 id) external onlyRole(ATTESTOR_ROLE) whenNotPaused {
        Purchase storage p = purchases[id];
        require(p.state == State.Funded && block.timestamp < p.deadline, 'STALE');
        p.state = State.Executing;
    }
    function release(
        bytes32 id,
        bytes32 resultHash
    ) external onlyRole(ATTESTOR_ROLE) nonReentrant whenNotPaused {
        Purchase storage p = purchases[id];
        require(p.state == State.Executing && resultHash != bytes32(0), 'INVALID_STATE');
        p.state = State.Released;
        p.resultHash = resultHash;
        uint256 fee = (uint256(p.amount) * p.feeBps) / 10000;
        token.safeTransfer(p.seller, p.amount - fee);
        if (fee > 0) token.safeTransfer(treasury, fee);
        emit Resolved(id, p.state, p.amount - fee, fee, resultHash);
    }
    function refund(bytes32 id) external nonReentrant {
        Purchase storage p = purchases[id];
        require(
            (p.state == State.Funded && block.timestamp >= p.deadline) ||
                (p.state == State.Executing && hasRole(ATTESTOR_ROLE, msg.sender)),
            'NOT_REFUNDABLE'
        );
        p.state = State.Refunded;
        token.safeTransfer(p.buyer, p.amount);
        emit Resolved(id, p.state, 0, 0, bytes32(0));
    }
    function dispute(bytes32 id) external onlyRole(ATTESTOR_ROLE) {
        require(purchases[id].state == State.Executing, 'INVALID_STATE');
        purchases[id].state = State.Disputed;
    }
    function resolveDispute(
        bytes32 id,
        bool fulfilled,
        bytes32 resultHash
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(purchases[id].state == State.Disputed, 'INVALID_STATE');
        // Only returns to an attested state. No arbitrary recipient or amount override.
        require(!fulfilled || resultHash != bytes32(0), 'RESULT_REQUIRED');
        purchases[id].state = State.Executing;
    }
}
