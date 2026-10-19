// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {ERC4626} from '@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {TestMarket} from './TestMarket.sol';
contract LendingPool is ERC4626, ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Loan {
        address borrower;
        uint256 principal;
        uint256 interest;
        uint256 collateral;
        uint64 lastAccrued;
        uint64 maturity;
    }
    mapping(bytes32 => Loan) public loans;
    uint256 public outstandingPrincipal;
    uint256 public badDebt;
    uint256 public feeRevenue;
    bytes32[] public loanIds;
    TestMarket public immutable market;
    address public immutable treasury;
    address public immutable guardian;
    bool public paused;
    uint256 public constant APR_BPS = 800;
    uint256 public constant MAX_LTV_BPS = 5000;
    uint256 public constant LIQUIDATION_LTV_BPS = 6500;
    uint256 public constant LIQUIDATOR_BPS = 500;
    uint256 public constant INTEREST_SPREAD_BPS = 2000;
    event LoanChanged(
        bytes32 indexed id,
        address indexed borrower,
        uint256 principal,
        uint256 interest,
        uint256 collateral
    );
    event Liquidated(bytes32 indexed id, uint256 repaid, uint256 collateralSeized, uint256 shortfall);
    constructor(
        address usd_,
        address market_,
        address treasury_,
        address guardian_
    ) ERC20('Capora Lending Liquidity', 'clSHARE') ERC4626(IERC20(usd_)) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        market = TestMarket(market_);
        treasury = treasury_;
        guardian = guardian_;
    }
    function _decimalsOffset() internal pure override returns (uint8) {
        return 6;
    }
    function totalAssets() public view override returns (uint256 assets) {
        assets = IERC20(asset()).balanceOf(address(this)) + outstandingPrincipal;
        for (uint256 i = 0; i < loanIds.length; i++) {
            Loan memory l = loans[loanIds[i]];
            uint256 interest = debt(loanIds[i]) - l.principal;
            assets += interest - (interest * INTEREST_SPREAD_BPS) / 10000;
        }
    }
    function maxWithdraw(address owner) public view override returns (uint256) {
        return Math.min(super.maxWithdraw(owner), IERC20(asset()).balanceOf(address(this)));
    }
    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 shares = super.maxRedeem(owner);
        uint256 cash = IERC20(asset()).balanceOf(address(this));
        return previewRedeem(shares) <= cash ? shares : Math.min(shares, convertToShares(cash));
    }
    function setPaused(bool value) external {
        require(msg.sender == guardian, 'GUARDIAN_ONLY');
        paused = value;
    }
    function invest(uint256 amount, uint256 minimum) external nonReentrant returns (uint256 shares) {
        require(!paused, 'PAUSED');
        shares = deposit(amount, msg.sender);
        require(shares >= minimum && shares > 0, 'SHARE_SLIPPAGE');
    }
    function redeemWithMin(uint256 shares, uint256 minimum) external nonReentrant returns (uint256 assets) {
        assets = redeem(shares, msg.sender, msg.sender);
        require(assets >= minimum, 'SLIPPAGE');
    }
    function debt(bytes32 id) public view returns (uint256) {
        Loan memory l = loans[id];
        return
            l.principal +
            l.interest +
            (l.principal * APR_BPS * (block.timestamp - l.lastAccrued)) / (365 days * 10000);
    }
    function health(bytes32 id) public view returns (uint256) {
        uint256 d = debt(id);
        return
            d == 0
                ? type(uint256).max
                : (((loans[id].collateral * market.freshPrice()) / 1e6) * LIQUIDATION_LTV_BPS) / d;
    }
    function _accrue(Loan storage l) internal {
        l.interest += (l.principal * APR_BPS * (block.timestamp - l.lastAccrued)) / (365 days * 10000);
        l.lastAccrued = uint64(block.timestamp);
    }
    function open(bytes32 id, uint256 collateral, uint256 amount, uint64 maturity) external nonReentrant {
        require(
            !paused && loans[id].borrower == address(0) && id != bytes32(0) && loanIds.length < 128,
            'PAUSED_DUPLICATE_OR_CAP'
        );
        require(amount > 0 && maturity > block.timestamp && maturity <= block.timestamp + 365 days, 'TERMS');
        require(amount <= (((collateral * market.freshPrice()) / 1e6) * MAX_LTV_BPS) / 10000, 'LTV');
        require(IERC20(asset()).balanceOf(address(this)) >= amount, 'INSUFFICIENT_LIQUIDITY');
        loans[id] = Loan(msg.sender, amount, 0, collateral, uint64(block.timestamp), maturity);
        loanIds.push(id);
        outstandingPrincipal += amount;
        market.risk().safeTransferFrom(msg.sender, address(this), collateral);
        IERC20(asset()).safeTransfer(msg.sender, amount);
        emit LoanChanged(id, msg.sender, amount, 0, collateral);
    }
    function addCollateral(bytes32 id, uint256 amount) external nonReentrant {
        Loan storage l = loans[id];
        require(l.borrower == msg.sender && amount > 0, 'BORROWER_ONLY');
        l.collateral += amount;
        market.risk().safeTransferFrom(msg.sender, address(this), amount);
        emit LoanChanged(id, msg.sender, l.principal, l.interest, l.collateral);
    }
    function _repay(Loan storage l, uint256 amount) internal returns (uint256 actual) {
        _accrue(l);
        actual = Math.min(amount, l.principal + l.interest);
        require(actual > 0, 'NO_DEBT');
        uint256 interestPaid = Math.min(actual, l.interest);
        uint256 principalPaid = actual - interestPaid;
        l.interest -= interestPaid;
        l.principal -= principalPaid;
        outstandingPrincipal -= principalPaid;
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), actual);
        uint256 fee = (interestPaid * INTEREST_SPREAD_BPS) / 10000;
        if (fee > 0) {
            feeRevenue += fee;
            IERC20(asset()).safeTransfer(treasury, fee);
        }
    }
    function repay(bytes32 id, uint256 amount) external nonReentrant {
        Loan storage l = loans[id];
        require(l.borrower == msg.sender, 'BORROWER_ONLY');
        _repay(l, amount);
        emit LoanChanged(id, msg.sender, l.principal, l.interest, l.collateral);
    }
    function withdrawCollateral(bytes32 id, uint256 amount) external nonReentrant {
        Loan storage l = loans[id];
        require(l.borrower == msg.sender && amount > 0 && amount <= l.collateral, 'BORROWER_OR_AMOUNT');
        _accrue(l);
        l.collateral -= amount;
        require(
            l.principal + l.interest == 0 ||
                l.principal + l.interest <=
                    (((l.collateral * market.freshPrice()) / 1e6) * MAX_LTV_BPS) / 10000,
            'LTV'
        );
        market.risk().safeTransfer(msg.sender, amount);
        emit LoanChanged(id, msg.sender, l.principal, l.interest, l.collateral);
    }
    function liquidate(bytes32 id, uint256 maximum) external nonReentrant {
        Loan storage l = loans[id];
        uint256 p = market.freshPrice();
        require(
            debt(id) > 0 && (health(id) < 10000 || block.timestamp > uint256(l.maturity) + 1 days),
            'HEALTHY'
        );
        uint256 payableDebt = Math.min(
            debt(id),
            (((l.collateral * p) / 1e6) * 10000) / (10000 + LIQUIDATOR_BPS)
        );
        uint256 paid = _repay(l, Math.min(maximum, payableDebt));
        uint256 seized = Math.min(
            l.collateral,
            Math.mulDiv(paid, 1e6 * (10000 + LIQUIDATOR_BPS), p * 10000, Math.Rounding.Ceil)
        );
        l.collateral -= seized;
        market.risk().safeTransfer(msg.sender, seized);
        uint256 loss;
        if (l.collateral <= 1) {
            loss = l.principal;
            outstandingPrincipal -= loss;
            badDebt += loss + l.interest;
            l.principal = 0;
            l.interest = 0;
        }
        emit Liquidated(id, paid, seized, loss);
    }
}
