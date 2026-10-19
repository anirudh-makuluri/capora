// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ERC4626} from '@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {TestMarket} from './TestMarket.sol';
import {PurchaseEscrow} from './PurchaseEscrow.sol';
contract ManagedFund is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;
    TestMarket public immutable market;
    address public immutable manager;
    address public immutable feeRecipient;
    string public strategy;
    uint16 public immutable managementFeeBps;
    uint16 public immutable maxAllocationBps;
    uint256 public immutable maxTrade;
    uint256 public immutable dailyTradeLimit;
    uint16 public immutable dailyLossBps;
    uint256 public lastFeeAt;
    uint256 public tradeDay;
    uint256 public tradedToday;
    uint256 public dayStartNav;
    bool public paused;
    bool public subscriptionsOpen = true;
    PurchaseEscrow public immutable purchaseEscrow;
    uint256 public immutable dailyExpenseLimit;
    uint256 public expenseDay;
    uint256 public expensesToday;
    event Rebalanced(bool buy, uint256 amount, uint256 output, uint256 nav, string explanation);
    event ManagementFee(uint256 shares, uint256 elapsed);
    constructor(
        address usd_,
        address market_,
        address manager_,
        address fees_,
        string memory name_,
        string memory strategy_,
        uint16 fee_,
        uint16 allocation_,
        uint256 trade_,
        uint256 daily_,
        uint16 loss_,
        address escrow_,
        uint256 expense_
    ) ERC20(name_, 'cfSHARE') ERC4626(IERC20(usd_)) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        require(
            fee_ <= 500 &&
                allocation_ <= 8000 &&
                allocation_ > 0 &&
                trade_ > 0 &&
                daily_ >= trade_ &&
                loss_ <= 1000,
            'RISK_LIMITS'
        );
        market = TestMarket(market_);
        manager = manager_;
        feeRecipient = fees_;
        strategy = strategy_;
        managementFeeBps = fee_;
        maxAllocationBps = allocation_;
        maxTrade = trade_;
        dailyTradeLimit = daily_;
        dailyLossBps = loss_;
        lastFeeAt = block.timestamp;
        purchaseEscrow = PurchaseEscrow(escrow_);
        dailyExpenseLimit = expense_;
        require(expense_ <= daily_, 'EXPENSE_BUDGET');
    }
    modifier onlyManager() {
        require(msg.sender == manager, 'MANAGER_ONLY');
        _;
    }
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
    function totalAssets() public view override returns (uint256) {
        uint256 position = market.risk().balanceOf(address(this));
        return
            IERC20(asset()).balanceOf(address(this)) +
            (position == 0 ? 0 : (position * market.freshPrice()) / 1e6);
    }
    function accrueFee() public {
        uint256 elapsed = block.timestamp - lastFeeAt;
        lastFeeAt = block.timestamp;
        uint256 denominator = 365 days * 10000;
        uint256 rate = elapsed * managementFeeBps;
        require(rate < denominator, 'FEE_INTERVAL_EXCEEDED');
        uint256 shares = (totalSupply() * rate) / (denominator - rate);
        if (shares > 0) {
            _mint(feeRecipient, shares);
            emit ManagementFee(shares, elapsed);
        }
    }
    function controls(bool pause_, bool open_) external onlyManager {
        paused = pause_;
        subscriptionsOpen = open_;
    }
    event IntelligenceExpense(bytes32 indexed purchase, uint256 amount, uint256 expensesToday);
    function buyIntelligence(
        bytes32 id,
        address seller,
        uint128 amount,
        uint64 deadline,
        uint16 feeBps
    ) external onlyManager nonReentrant {
        require(!paused && address(purchaseEscrow) != address(0) && amount > 0, 'EXPENSE_DISABLED');
        uint256 day = block.timestamp / 1 days;
        if (day != expenseDay) {
            expenseDay = day;
            expensesToday = 0;
        }
        require(expensesToday + amount <= dailyExpenseLimit, 'OPERATING_BUDGET');
        expensesToday += amount;
        IERC20(asset()).forceApprove(address(purchaseEscrow), amount);
        purchaseEscrow.fund(id, seller, amount, deadline, feeBps);
        IERC20(asset()).forceApprove(address(purchaseEscrow), 0);
        emit IntelligenceExpense(id, amount, expensesToday);
    }
    function maxDeposit(address receiver) public view override returns (uint256) {
        return paused || !subscriptionsOpen ? 0 : super.maxDeposit(receiver);
    }
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (tradeDay == block.timestamp / 1 days) dayStartNav += assets;
        super._deposit(caller, receiver, assets, shares);
    }
    function _withdraw(
        address caller,
        address receiver,
        address owner,
        uint256 assets,
        uint256 shares
    ) internal override {
        if (tradeDay == block.timestamp / 1 days)
            dayStartNav = dayStartNav > assets ? dayStartNav - assets : 0;
        super._withdraw(caller, receiver, owner, assets, shares);
    }
    function maxMint(address receiver) public view override returns (uint256) {
        return paused || !subscriptionsOpen ? 0 : super.maxMint(receiver);
    }
    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner), IERC20(asset()).balanceOf(address(this)));
    }
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 shares = super.maxRedeem(owner);
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        return previewRedeem(shares) <= cash ? shares : Math.min(shares, convertToShares(cash));
    }
    function deposit(uint256 assets, address receiver) public override returns (uint256) {
        accrueFee();
        require(receiver == msg.sender, 'SELF_ONLY');
        return super.deposit(assets, receiver);
    }
    function mint(uint256 shares, address receiver) public override returns (uint256) {
        accrueFee();
        require(receiver == msg.sender, 'SELF_ONLY');
        return super.mint(shares, receiver);
    }
    function withdraw(uint256 assets, address receiver, address owner) public override returns (uint256) {
        accrueFee();
        return super.withdraw(assets, receiver, owner);
    }
    function redeem(uint256 shares, address receiver, address owner) public override returns (uint256) {
        accrueFee();
        return super.redeem(shares, receiver, owner);
    }
    function invest(uint256 amount, uint256 minShares) external nonReentrant returns (uint256 shares) {
        shares = deposit(amount, msg.sender);
        require(shares >= minShares && shares > 0, 'SHARE_SLIPPAGE');
    }
    function redeemWithMin(uint256 shares, uint256 minAssets) external nonReentrant returns (uint256 assets) {
        assets = redeem(shares, msg.sender, msg.sender);
        require(assets >= minAssets, 'REDEMPTION_SLIPPAGE');
    }
    function rebalance(
        bool buy,
        uint256 amount,
        uint256 minimum,
        uint256 deadline,
        string calldata explanation
    ) external onlyManager nonReentrant {
        require(
            !paused && amount > 0 && bytes(explanation).length > 0 && bytes(explanation).length <= 500,
            'PAUSED_OR_REASON'
        );
        accrueFee();
        uint256 nav = totalAssets();
        uint256 day = block.timestamp / 1 days;
        if (day != tradeDay) {
            tradeDay = day;
            tradedToday = 0;
            dayStartNav = nav;
        }
        require(nav >= (dayStartNav * (10000 - dailyLossBps)) / 10000, 'DAILY_LOSS');
        uint256 value = buy ? amount : (amount * market.freshPrice()) / 1e6;
        require(value <= maxTrade && tradedToday + value <= dailyTradeLimit, 'TRADE_BUDGET');
        require(minimum >= (market.quote(buy, amount) * 99) / 100, 'MINIMUM_TOO_LOW');
        tradedToday += value;
        IERC20 input = buy ? IERC20(asset()) : market.risk();
        input.forceApprove(address(market), amount);
        uint256 output = market.swap(buy, amount, minimum, deadline);
        input.forceApprove(address(market), 0);
        uint256 afterNav = totalAssets();
        require(
            (market.risk().balanceOf(address(this)) * market.freshPrice()) / 1e6 <=
                (afterNav * maxAllocationBps) / 10000,
            'ALLOCATION_LIMIT'
        );
        require(afterNav >= (nav * (10000 - dailyLossBps)) / 10000, 'TRADE_LOSS');
        emit Rebalanced(buy, amount, output, afterNav, explanation);
    }
}
