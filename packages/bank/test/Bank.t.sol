// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {CaporaUSD} from '../contracts/CaporaUSD.sol';
import {AgentWallet, WalletFactory} from '../contracts/AgentWallet.sol';
import {PurchaseEscrow} from '../contracts/PurchaseEscrow.sol';
import {ManagedFund} from '../contracts/ManagedFund.sol';
import {TestMarket} from '../contracts/TestMarket.sol';
import {LendingPool} from '../contracts/LendingPool.sol';
import {PublicChit} from '../contracts/PublicChit.sol';
interface Vm {
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function chainId(uint256) external;
}
contract BankTest {
    Vm constant vm = Vm(address(uint160(uint256(keccak256('hevm cheat code')))));
    CaporaUSD usd;
    CaporaUSD risk;
    TestMarket market;
    WalletFactory wallets;
    address constant alice = address(0xa11ce);
    address constant bob = address(0xb0b);
    address constant treasury = address(0xfee);
    function setUp() public {
        vm.chainId(84532);
        vm.warp(1000000);
        usd = new CaporaUSD(address(this), address(this));
        risk = new CaporaUSD(address(this), address(this));
        market = new TestMarket(address(usd), address(risk), address(this));
        market.setPrice(2e6);
        wallets = new WalletFactory(address(this), address(this));
        usd.mintOnce(keccak256('alice'), alice, 1000e6);
        usd.mintOnce(keccak256('bob'), bob, 1000e6);
        risk.mintOnce(keccak256('risk-a'), alice, 1000e6);
        risk.mintOnce(keccak256('risk-b'), bob, 1000e6);
        usd.mintOnce(keccak256('market-u'), address(market), 1000e6);
        risk.mintOnce(keccak256('market-r'), address(market), 1000e6);
    }
    function testMintExactlyOnce() public {
        usd.mintOnce(keccak256('twenty'), alice, 20e6);
        usd.mintOnce(keccak256('twenty'), alice, 20e6);
        require(usd.balanceOf(alice) == 1020e6, 'DUPLICATE_MINT');
        vm.expectRevert();
        usd.mintOnce(keccak256('twenty'), bob, 20e6);
        vm.expectRevert();
        vm.prank(alice);
        usd.mintOnce(keccak256('attack'), alice, 20e6);
    }
    function testInvestorCashFlowsDoNotBecomeManagerTradingLosses() public {
        ManagedFund f = new ManagedFund(
            address(usd),
            address(market),
            alice,
            treasury,
            'Flows',
            'Cash flow adjusted loss budget',
            0,
            6000,
            20e6,
            100e6,
            100,
            address(0),
            0
        );
        vm.prank(bob);
        usd.approve(address(f), 100e6);
        vm.prank(bob);
        f.invest(100e6, 1);
        vm.prank(alice);
        f.rebalance(true, 20e6, 9900000, block.timestamp + 60, 'Bounded initial allocation');
        vm.prank(bob);
        f.withdraw(50e6, bob, bob);
        vm.prank(alice);
        f.rebalance(
            false,
            9970000,
            19700000,
            block.timestamp + 60,
            'Unwind after a normal investor withdrawal'
        );
        require(market.risk().balanceOf(address(f)) == 0, 'WITHDRAWAL_MISCLASSIFIED_AS_LOSS');
    }
    function testDistinctIdempotentWalletsAndReplayProtection() public {
        address a = wallets.create(keccak256('a'));
        address b = wallets.create(keccak256('b'));
        require(a != b && wallets.create(keccak256('a')) == a, 'WALLET_IDENTITY');
        usd.mintOnce(keccak256('wallet-topup'), a, 20e6);
        wallets.allow(address(usd), usd.transfer.selector, true);
        AgentWallet(payable(a)).execute(
            keccak256('send'),
            address(usd),
            abi.encodeCall(usd.transfer, (b, 1e6))
        );
        require(usd.balanceOf(b) == 1e6, 'NO_TRANSFER');
        vm.expectRevert();
        AgentWallet(payable(a)).execute(
            keccak256('send'),
            address(usd),
            abi.encodeCall(usd.transfer, (b, 1e6))
        );
        vm.expectRevert();
        vm.prank(alice);
        AgentWallet(payable(a)).execute(
            keccak256('unauthorized'),
            address(usd),
            abi.encodeCall(usd.transfer, (alice, 1e6))
        );
        AgentWallet(payable(a)).setRevoked(true);
        vm.expectRevert();
        AgentWallet(payable(a)).execute(
            keccak256('revoked'),
            address(usd),
            abi.encodeCall(usd.transfer, (b, 1e6))
        );
    }
    function testEscrowSettlementAndRefund() public {
        PurchaseEscrow e = new PurchaseEscrow(address(usd), address(this), address(this), treasury);
        vm.prank(alice);
        usd.approve(address(e), 100e6);
        vm.prank(alice);
        e.fund(keccak256('sale'), bob, 20e6, uint64(block.timestamp + 60), 250);
        e.start(keccak256('sale'));
        e.release(keccak256('sale'), keccak256('verified-result'));
        require(usd.balanceOf(bob) == 1019500000 && usd.balanceOf(treasury) == 500000, 'WRONG_SPLIT');
        vm.expectRevert();
        e.release(keccak256('sale'), keccak256('again'));
        vm.prank(alice);
        e.fund(keccak256('expire'), bob, 20e6, uint64(block.timestamp + 60), 250);
        vm.expectRevert();
        e.refund(keccak256('expire'));
        vm.warp(block.timestamp + 61);
        e.refund(keccak256('expire'));
        require(usd.balanceOf(alice) == 980e6, 'REFUND');
    }
    function testFundRealSwapSharesAndLiquidityBound() public {
        ManagedFund f = new ManagedFund(
            address(usd),
            address(market),
            alice,
            treasury,
            'Test fund',
            'Controlled allocation',
            100,
            6000,
            20e6,
            100e6,
            100,
            address(0),
            0
        );
        vm.prank(bob);
        usd.approve(address(f), 100e6);
        vm.prank(bob);
        uint256 shares = f.invest(100e6, 100e12);
        require(shares == 100e12, 'SHARE_DECIMALS');
        vm.prank(alice);
        f.rebalance(true, 20e6, 9900000, block.timestamp + 60, 'Buy bounded inventory');
        require(risk.balanceOf(address(f)) == 9970000, 'NO_REAL_SWAP');
        require(f.totalAssets() == 99940000, 'NAV');
        vm.expectRevert();
        vm.prank(bob);
        f.redeemWithMin(shares, 1);
        vm.prank(alice);
        f.rebalance(false, 9970000, 19700000, block.timestamp + 60, 'Restore withdrawal liquidity');
        vm.prank(bob);
        uint256 returned = f.redeemWithMin(shares, 99e6);
        require(returned >= 99e6, 'REDEMPTION');
    }
    function testFundLimitsAndStalePrices() public {
        ManagedFund f = new ManagedFund(
            address(usd),
            address(market),
            alice,
            treasury,
            'Test',
            'Strategy',
            0,
            5000,
            20e6,
            20e6,
            100,
            address(0),
            0
        );
        vm.prank(bob);
        usd.approve(address(f), 100e6);
        vm.prank(bob);
        f.invest(100e6, 1);
        vm.expectRevert();
        vm.prank(bob);
        f.rebalance(true, 1e6, 1, block.timestamp + 60, 'Unauthorized');
        vm.expectRevert();
        vm.prank(alice);
        f.rebalance(true, 21e6, 1, block.timestamp + 60, 'Over trade cap');
        vm.warp(block.timestamp + 3601);
        vm.expectRevert();
        vm.prank(alice);
        f.rebalance(true, 1e6, 1, block.timestamp + 60, 'Stale oracle');
    }
    function testLoanBackedByDepositsAndRepayment() public {
        LendingPool p = new LendingPool(address(usd), address(market), treasury, address(this));
        vm.prank(alice);
        risk.approve(address(p), 100e6);
        vm.expectRevert();
        vm.prank(alice);
        p.open(keccak256('no-liquidity'), 100e6, 50e6, uint64(block.timestamp + 100));
        vm.prank(bob);
        usd.approve(address(p), 200e6);
        vm.prank(bob);
        p.invest(200e6, 1);
        vm.expectRevert();
        vm.prank(alice);
        p.open(keccak256('high-ltv'), 10e6, 50e6, uint64(block.timestamp + 100));
        vm.prank(alice);
        p.open(keccak256('loan'), 100e6, 50e6, uint64(block.timestamp + 100));
        vm.expectRevert();
        p.liquidate(keccak256('loan'), 50e6);
        vm.warp(block.timestamp + 100);
        vm.prank(alice);
        usd.approve(address(p), 100e6);
        vm.prank(alice);
        p.repay(keccak256('loan'), 100e6);
        vm.prank(alice);
        p.withdrawCollateral(keccak256('loan'), 100e6);
        require(p.outstandingPrincipal() == 0 && risk.balanceOf(alice) == 1000e6, 'DEBT_OR_COLLATERAL');
    }
    function testLiquidationRequiresActualPriceDrop() public {
        LendingPool p = new LendingPool(address(usd), address(market), treasury, address(this));
        vm.prank(bob);
        usd.approve(address(p), 200e6);
        vm.prank(bob);
        p.invest(200e6, 1);
        vm.prank(alice);
        risk.approve(address(p), 100e6);
        vm.prank(alice);
        p.open(keccak256('risky'), 100e6, 100e6, uint64(block.timestamp + 100));
        market.setPrice(1600000);
        market.setPrice(1280000);
        vm.prank(bob);
        usd.approve(address(p), 100e6);
        vm.prank(bob);
        p.liquidate(keccak256('risky'), 100e6);
        require(p.outstandingPrincipal() == 0, 'LIQUIDATION');
    }
    function testChitFullAuctionCycleAndNoRepeatWinner() public {
        address a = wallets.create(keccak256('member-a'));
        address b = wallets.create(keccak256('member-b'));
        usd.mintOnce(keccak256('chit-a-u'), a, 100e6);
        usd.mintOnce(keccak256('chit-b-u'), b, 100e6);
        risk.mintOnce(keccak256('chit-a-r'), a, 100e6);
        risk.mintOnce(keccak256('chit-b-r'), b, 100e6);
        PublicChit.Terms memory t = PublicChit.Terms(
            2,
            10e6,
            4000,
            100,
            60,
            30,
            30,
            30,
            uint64(block.timestamp + 100)
        );
        PublicChit c = new PublicChit(address(usd), address(market), address(wallets), a, treasury, t);
        vm.prank(a);
        usd.approve(address(c), 100e6);
        vm.prank(a);
        risk.approve(address(c), 100e6);
        vm.prank(a);
        c.join(100e6);
        vm.expectRevert();
        vm.prank(a);
        c.join(0);
        vm.prank(b);
        usd.approve(address(c), 100e6);
        vm.prank(b);
        risk.approve(address(c), 100e6);
        vm.prank(b);
        c.join(100e6);
        vm.prank(a);
        c.contribute();
        vm.prank(b);
        c.contribute();
        bytes32 salt = keccak256('salt');
        vm.prank(a);
        c.commitBid(keccak256(abi.encode(block.chainid, address(c), uint16(1), a, uint256(2e6), salt)));
        vm.prank(b);
        c.commitBid(keccak256(abi.encode(block.chainid, address(c), uint16(1), b, uint256(3e6), salt)));
        vm.warp(block.timestamp + 91);
        vm.prank(a);
        c.revealBid(2e6, salt);
        vm.prank(b);
        c.revealBid(3e6, salt);
        vm.warp(block.timestamp + 30);
        c.finalize();
        (, bool won, , , , ) = _member(c, b);
        require(won, 'HIGHEST_DISCOUNT_DID_NOT_WIN');
        vm.expectRevert();
        vm.prank(b);
        c.commitBid(keccak256('repeat'));
        vm.prank(a);
        c.contribute();
        vm.prank(b);
        c.contribute();
        vm.warp(block.timestamp + 121);
        c.finalize();
        require(c.completed(), 'FULL_CYCLE');
        vm.prank(a);
        c.claim();
        vm.prank(b);
        c.claim();
        vm.prank(a);
        c.exit();
        vm.prank(b);
        c.exit();
        require(usd.balanceOf(address(c)) == 0, 'CHIT_CONSERVATION');
    }
    function _member(
        PublicChit c,
        address w
    ) internal view returns (bool, bool, uint16, uint256, uint256, uint256) {
        (bool j, bool won, uint16 i, uint256 b, uint256 s) = c.membership(w);
        return (j, won, i, b, s, 0);
    }
    function testFuzzEscrowConservesEveryIntegerUnit(uint64 input, uint16 feeInput) public {
        uint128 amount = uint128((uint256(input) % 100e6) + 1);
        uint16 fee = feeInput % 1001;
        PurchaseEscrow e = new PurchaseEscrow(address(usd), address(this), address(this), treasury);
        vm.prank(alice);
        usd.approve(address(e), amount);
        vm.prank(alice);
        e.fund(keccak256('fuzz'), bob, amount, uint64(block.timestamp + 100), fee);
        e.start(keccak256('fuzz'));
        e.release(keccak256('fuzz'), keccak256('result'));
        uint256 paidFee = (uint256(amount) * fee) / 10000;
        require(
            usd.balanceOf(bob) == 1000e6 + amount - paidFee && usd.balanceOf(treasury) == paidFee,
            'CONSERVATION'
        );
        require(usd.balanceOf(address(e)) == 0, 'ESCROW_DUST');
    }
    function testEscrowAuthorityDisputeAndPause() public {
        PurchaseEscrow e = new PurchaseEscrow(address(usd), address(this), address(this), treasury);
        vm.prank(alice);
        usd.approve(address(e), 20e6);
        vm.prank(alice);
        e.fund(keccak256('disputed'), bob, 20e6, uint64(block.timestamp + 100), 250);
        vm.expectRevert();
        vm.prank(alice);
        e.start(keccak256('disputed'));
        e.start(keccak256('disputed'));
        e.dispute(keccak256('disputed'));
        vm.expectRevert();
        e.release(keccak256('disputed'), keccak256('result'));
        e.resolveDispute(keccak256('disputed'), false, bytes32(0));
        e.refund(keccak256('disputed'));
        require(usd.balanceOf(alice) == 1000e6, 'DISPUTE_REFUND');
        e.pause(true);
        vm.expectRevert();
        vm.prank(alice);
        e.fund(keccak256('paused'), bob, 1, uint64(block.timestamp + 100), 0);
    }
    function testFundInflationDefenseAndManagementFeeRecipient() public {
        ManagedFund f = new ManagedFund(
            address(usd),
            address(market),
            alice,
            treasury,
            'Defense',
            'Donation resistance',
            100,
            6000,
            20e6,
            100e6,
            100,
            address(0),
            0
        );
        vm.prank(alice);
        usd.approve(address(f), 1);
        vm.prank(alice);
        f.invest(1, 1);
        vm.prank(alice);
        usd.transfer(address(f), 100e6);
        vm.prank(bob);
        usd.approve(address(f), 100e6);
        vm.prank(bob);
        uint256 shares = f.invest(100e6, 1);
        require(shares > 0, 'VICTIM_ZERO_SHARES');
        uint256 attackerShares = f.balanceOf(alice);
        vm.prank(alice);
        uint256 returned = f.redeemWithMin(attackerShares, 0);
        require(returned < 100e6, 'DONATION_ATTACK_PROFIT');
        vm.warp(block.timestamp + 365 days);
        f.accrueFee();
        require(f.balanceOf(treasury) > 0, 'FEE_RECIPIENT');
    }
    function testFundExpenseIsBoundedAndEscrowBacked() public {
        PurchaseEscrow e = new PurchaseEscrow(address(usd), address(this), address(this), treasury);
        ManagedFund f = new ManagedFund(
            address(usd),
            address(market),
            alice,
            treasury,
            'Research',
            'Bounded analytics expenses',
            0,
            6000,
            20e6,
            100e6,
            100,
            address(e),
            1e6
        );
        vm.prank(bob);
        usd.approve(address(f), 100e6);
        vm.prank(bob);
        f.invest(100e6, 1);
        vm.prank(alice);
        f.buyIntelligence(keccak256('intel'), bob, 1e6, uint64(block.timestamp + 60), 250);
        require(f.totalAssets() == 99e6 && usd.balanceOf(address(e)) == 1e6, 'EXPENSE_NOT_REAL');
        vm.expectRevert();
        vm.prank(alice);
        f.buyIntelligence(keccak256('over'), bob, 1, uint64(block.timestamp + 60), 250);
        e.start(keccak256('intel'));
        e.refund(keccak256('intel'));
        require(f.totalAssets() == 100e6, 'FUND_REFUND');
    }
    function testLoanPartialRepayAndStaleOracleRecovery() public {
        LendingPool p = new LendingPool(address(usd), address(market), treasury, address(this));
        vm.prank(bob);
        usd.approve(address(p), 200e6);
        vm.prank(bob);
        p.invest(200e6, 1);
        vm.prank(alice);
        risk.approve(address(p), 100e6);
        vm.prank(alice);
        p.open(keccak256('partial'), 100e6, 50e6, uint64(block.timestamp + 10000));
        vm.expectRevert();
        vm.prank(bob);
        p.withdrawCollateral(keccak256('partial'), 1);
        vm.warp(block.timestamp + 3601);
        vm.expectRevert();
        vm.prank(alice);
        p.open(keccak256('stale'), 1e6, 1, uint64(block.timestamp + 100));
        vm.prank(alice);
        usd.approve(address(p), 100e6);
        vm.prank(alice);
        p.repay(keccak256('partial'), 10e6);
        require(p.debt(keccak256('partial')) > 40e6, 'INTEREST_MISSING');
        vm.prank(alice);
        p.repay(keccak256('partial'), 100e6);
        vm.prank(alice);
        p.withdrawCollateral(keccak256('partial'), 100e6);
        vm.expectRevert();
        vm.prank(alice);
        p.repay(keccak256('partial'), 1);
    }
    function testLoanInsolvencyIsRecognizedWithoutMinting() public {
        LendingPool p = new LendingPool(address(usd), address(market), treasury, address(this));
        vm.prank(bob);
        usd.approve(address(p), 200e6);
        vm.prank(bob);
        p.invest(200e6, 1);
        vm.prank(alice);
        risk.approve(address(p), 100e6);
        vm.prank(alice);
        p.open(keccak256('loss'), 100e6, 100e6, uint64(block.timestamp + 100));
        for (uint256 i = 0; i < 8; i++) market.setPrice((market.price() * 80) / 100);
        vm.prank(bob);
        usd.approve(address(p), 100e6);
        vm.prank(bob);
        p.liquidate(keccak256('loss'), 100e6);
        require(p.badDebt() > 0 && p.totalAssets() < 200e6, 'INSOLVENCY_HIDDEN');
    }
    function _newChit(uint256 security) internal returns (PublicChit c, address a, address b) {
        a = wallets.create(keccak256('default-a'));
        b = wallets.create(keccak256('default-b'));
        usd.mintOnce(keccak256('default-a-u'), a, 100e6);
        usd.mintOnce(keccak256('default-b-u'), b, 100e6);
        risk.mintOnce(keccak256('default-a-r'), a, 100e6);
        risk.mintOnce(keccak256('default-b-r'), b, 100e6);
        c = new PublicChit(
            address(usd),
            address(market),
            address(wallets),
            a,
            treasury,
            PublicChit.Terms(2, 10e6, 4000, 100, 60, 30, 30, 30, uint64(block.timestamp + 100))
        );
        vm.prank(a);
        usd.approve(address(c), 100e6);
        vm.prank(a);
        risk.approve(address(c), 100e6);
        vm.prank(a);
        c.join(security);
        vm.prank(b);
        usd.approve(address(c), 100e6);
        vm.prank(b);
        risk.approve(address(c), 100e6);
        vm.prank(b);
        c.join(security);
    }
    function testChitBondDefaultRecoveryAndNoEarlyExit() public {
        (PublicChit c, address a, address b) = _newChit(20e6);
        vm.prank(a);
        c.contribute();
        vm.expectRevert();
        vm.prank(a);
        c.exit();
        vm.warp(block.timestamp + 91);
        vm.expectRevert();
        vm.prank(b);
        c.contribute();
        c.recoverDefault(b, 0, block.timestamp + 60);
        vm.warp(block.timestamp + 30);
        c.finalize();
        require(c.currentRound() == 2, 'DEFAULT_NOT_RECOVERED');
    }
    function testChitSecurityAndInvalidBidCannotReleasePrize() public {
        (PublicChit c, address a, address b) = _newChit(0);
        vm.prank(a);
        c.contribute();
        vm.prank(b);
        c.contribute();
        bytes32 salt = keccak256('bad-bid');
        vm.prank(a);
        c.commitBid(keccak256(abi.encode(block.chainid, address(c), uint16(1), a, uint256(9e6), salt)));
        vm.warp(block.timestamp + 91);
        vm.expectRevert();
        vm.prank(a);
        c.revealBid(9e6, salt);
        vm.warp(block.timestamp + 30);
        vm.expectRevert();
        c.finalize();
        require(usd.balanceOf(address(c)) == 40e6, 'UNSECURED_PAYOUT');
    }
    function testUnfilledPublicChitCancelsAndReturnsBond() public {
        address a = wallets.create(keccak256('unfilled'));
        usd.mintOnce(keccak256('unfilled-cash'), a, 10e6);
        PublicChit c = new PublicChit(
            address(usd),
            address(market),
            address(wallets),
            a,
            treasury,
            PublicChit.Terms(2, 10e6, 4000, 100, 60, 30, 30, 30, uint64(block.timestamp + 100))
        );
        vm.prank(a);
        usd.approve(address(c), 10e6);
        vm.prank(a);
        c.join(0);
        vm.warp(block.timestamp + 101);
        c.cancelUnfilled();
        vm.prank(a);
        c.exit();
        require(usd.balanceOf(a) == 10e6, 'CANCELED_REFUND');
    }
}
