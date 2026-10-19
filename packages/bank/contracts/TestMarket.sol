// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {AccessControl} from '@openzeppelin/contracts/access/AccessControl.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
/// @notice Artificial test-market inventory and disclosed operator price model, NOT a production oracle/DEX.
/// Both assets use six decimals. Inventory must be seeded; a swap never mints output.
contract TestMarket is AccessControl, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable usd;
    IERC20 public immutable risk;
    uint256 public price;
    uint256 public updatedAt;
    uint256 public constant MAX_AGE = 1 hours;
    uint256 public constant SWAP_FEE_BPS = 30;
    event Price(uint256 value, uint256 timestamp);
    event Swap(address indexed trader, bool buy, uint256 input, uint256 output);
    constructor(address usd_, address risk_, address admin) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        usd = IERC20(usd_);
        risk = IERC20(risk_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
    function setPrice(uint256 value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(value >= 1e4 && value <= 10000e6, 'PRICE_RANGE');
        if (price > 0)
            require(value >= (price * 80) / 100 && value <= (price * 120) / 100, 'CIRCUIT_BREAKER');
        price = value;
        updatedAt = block.timestamp;
        emit Price(value, block.timestamp);
    }
    function freshPrice() public view returns (uint256) {
        require(price > 0 && block.timestamp <= updatedAt + MAX_AGE, 'STALE_PRICE');
        return price;
    }
    function quote(bool buy, uint256 amount) public view returns (uint256) {
        uint256 p = freshPrice();
        return ((buy ? (amount * 1e6) / p : (amount * p) / 1e6) * (10000 - SWAP_FEE_BPS)) / 10000;
    }
    function swap(
        bool buy,
        uint256 amount,
        uint256 minimum,
        uint256 deadline
    ) external nonReentrant returns (uint256 output) {
        require(
            amount > 0 && block.timestamp <= deadline && deadline <= block.timestamp + 10 minutes,
            'DEADLINE'
        );
        output = quote(buy, amount);
        require(output >= minimum && output > 0, 'SLIPPAGE');
        IERC20 input = buy ? usd : risk;
        IERC20 out = buy ? risk : usd;
        require(out.balanceOf(address(this)) >= output, 'MARKET_LIQUIDITY');
        input.safeTransferFrom(msg.sender, address(this), amount);
        out.safeTransfer(msg.sender, output);
        emit Swap(msg.sender, buy, amount, output);
    }
}
