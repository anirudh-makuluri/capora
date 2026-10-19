// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {Math} from '@openzeppelin/contracts/utils/math/Math.sol';
import {TestMarket} from './TestMarket.sol';
interface IRegisteredWallets {
    function isWallet(address) external view returns (bool);
}
/// @notice Public auction chit. Immutable terms, transparent commit/reveal and bounded default recovery.
contract PublicChit is ReentrancyGuard {
    using SafeERC20 for IERC20;
    struct Terms {
        uint16 members;
        uint128 installment;
        uint16 maxDiscountBps;
        uint16 commissionBps;
        uint32 contributionSeconds;
        uint32 commitSeconds;
        uint32 revealSeconds;
        uint32 graceSeconds;
        uint64 joinDeadline;
    }
    struct Member {
        bool joined;
        bool won;
        uint16 index;
        uint256 bond;
        uint256 security;
    }
    struct Round {
        uint256 paid;
        uint64 start;
        bool finalized;
        address winner;
        uint256 discount;
        uint256 payout;
        uint256 dividend;
        uint256 commission;
        uint256 remainder;
    }
    Terms public terms;
    IERC20 public immutable usd;
    TestMarket public immutable market;
    IRegisteredWallets public immutable registry;
    address public immutable organizer;
    address public immutable treasury;
    address[] public members;
    mapping(address => Member) public membership;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => bool)) public contributed;
    mapping(uint256 => mapping(address => bytes32)) public commitments;
    mapping(uint256 => mapping(address => uint256)) public bids;
    mapping(uint256 => mapping(address => bool)) public revealed;
    mapping(address => uint256) public credits;
    uint16 public currentRound;
    bool public canceled;
    bool public completed;
    event Joined(address indexed wallet, uint256 bond, uint256 security);
    event Contribution(uint256 indexed round, address indexed wallet, uint256 amount, bool recovered);
    event Committed(uint256 indexed round, address indexed wallet, bytes32 commitment);
    event Revealed(uint256 indexed round, address indexed wallet, uint256 discount);
    event Award(
        uint256 indexed round,
        address indexed winner,
        uint256 payout,
        uint256 discount,
        uint256 dividend,
        uint256 commission,
        uint256 remainder
    );
    event DefaultRecovered(
        uint256 indexed round,
        address indexed wallet,
        uint256 bondUsed,
        uint256 collateralSold,
        uint256 remainingShortfall
    );
    event Claimed(address indexed wallet, uint256 amount);
    constructor(
        address usd_,
        address market_,
        address registry_,
        address organizer_,
        address treasury_,
        Terms memory t
    ) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        require(
            t.members >= 2 && t.members <= 24 && t.installment > 0 && t.installment <= 1000e6,
            'MEMBERS_OR_AMOUNT'
        );
        require(
            t.maxDiscountBps <= 4000 &&
                t.commissionBps <= 500 &&
                t.contributionSeconds >= 60 &&
                t.commitSeconds >= 30 &&
                t.revealSeconds >= 30 &&
                t.graceSeconds >= 30 &&
                t.joinDeadline > block.timestamp,
            'TERMS'
        );
        usd = IERC20(usd_);
        market = TestMarket(market_);
        registry = IRegisteredWallets(registry_);
        organizer = organizer_;
        treasury = treasury_;
        terms = t;
    }
    function memberCount() external view returns (uint256) {
        return members.length;
    }
    function join(uint256 security) external nonReentrant {
        require(
            !canceled &&
                currentRound == 0 &&
                block.timestamp <= terms.joinDeadline &&
                members.length < terms.members,
            'CLOSED'
        );
        require(registry.isWallet(msg.sender) && !membership[msg.sender].joined, 'REGISTERED_ONCE');
        membership[msg.sender] = Member(true, false, uint16(members.length), terms.installment, security);
        members.push(msg.sender);
        usd.safeTransferFrom(msg.sender, address(this), terms.installment);
        if (security > 0) market.risk().safeTransferFrom(msg.sender, address(this), security);
        emit Joined(msg.sender, terms.installment, security);
        if (members.length == terms.members) {
            currentRound = 1;
            rounds[1].start = uint64(block.timestamp);
        }
    }
    function cancelUnfilled() external {
        require(currentRound == 0 && block.timestamp > terms.joinDeadline, 'NOT_CANCELABLE');
        canceled = true;
    }
    function topUpSecurity(uint256 amount) external nonReentrant {
        require(membership[msg.sender].joined && amount > 0 && !completed && !canceled, 'MEMBER_ONLY');
        membership[msg.sender].security += amount;
        market.risk().safeTransferFrom(msg.sender, address(this), amount);
    }
    function topUpBond(uint256 amount) external nonReentrant {
        require(membership[msg.sender].joined && amount > 0 && !completed && !canceled, 'MEMBER_ONLY');
        membership[msg.sender].bond += amount;
        usd.safeTransferFrom(msg.sender, address(this), amount);
    }
    function contributionDeadline() public view returns (uint256) {
        return uint256(rounds[currentRound].start) + terms.contributionSeconds;
    }
    function commitDeadline() public view returns (uint256) {
        return contributionDeadline() + terms.commitSeconds;
    }
    function revealDeadline() public view returns (uint256) {
        return commitDeadline() + terms.revealSeconds;
    }
    function contribute() external nonReentrant {
        require(
            currentRound > 0 && !completed && !canceled && block.timestamp <= contributionDeadline(),
            'CONTRIBUTION_CLOSED'
        );
        require(
            membership[msg.sender].joined && !contributed[currentRound][msg.sender],
            'MEMBER_OR_DUPLICATE'
        );
        contributed[currentRound][msg.sender] = true;
        rounds[currentRound].paid += terms.installment;
        usd.safeTransferFrom(msg.sender, address(this), terms.installment);
        emit Contribution(currentRound, msg.sender, terms.installment, false);
    }
    function securityRequired(address) public view returns (uint256) {
        uint256 future = uint256(terms.members - currentRound) * terms.installment;
        return Math.mulDiv(future, 15000 * 1e6, market.freshPrice() * 10000, Math.Rounding.Ceil);
    }
    function commitBid(bytes32 commitment) external {
        Member memory m = membership[msg.sender];
        require(
            currentRound > 0 && !completed && m.joined && !m.won && contributed[currentRound][msg.sender],
            'INELIGIBLE'
        );
        require(
            rounds[currentRound].paid == uint256(terms.members) * terms.installment &&
                block.timestamp <= commitDeadline(),
            'FUNDING_OR_DEADLINE'
        );
        require(commitment != bytes32(0) && commitments[currentRound][msg.sender] == bytes32(0), 'DUPLICATE');
        commitments[currentRound][msg.sender] = commitment;
        emit Committed(currentRound, msg.sender, commitment);
    }
    function revealBid(uint256 discount, bytes32 salt) external {
        require(
            block.timestamp > commitDeadline() &&
                block.timestamp <= revealDeadline() &&
                !revealed[currentRound][msg.sender],
            'REVEAL_WINDOW'
        );
        require(
            commitments[currentRound][msg.sender] ==
                keccak256(abi.encode(block.chainid, address(this), currentRound, msg.sender, discount, salt)),
            'COMMITMENT'
        );
        require(
            discount <= (uint256(terms.members) * terms.installment * terms.maxDiscountBps) / 10000 &&
                membership[msg.sender].security >= securityRequired(msg.sender),
            'BID_OR_SECURITY'
        );
        bids[currentRound][msg.sender] = discount;
        revealed[currentRound][msg.sender] = true;
        emit Revealed(currentRound, msg.sender, discount);
    }
    function recoverDefault(address wallet, uint256 minOutput, uint256 deadline) external nonReentrant {
        require(
            currentRound > 0 && !completed && block.timestamp > contributionDeadline() + terms.graceSeconds,
            'GRACE_PERIOD'
        );
        Member storage m = membership[wallet];
        require(m.joined && !contributed[currentRound][wallet], 'NOT_DEFAULTED');
        uint256 used = Math.min(m.bond, terms.installment);
        m.bond -= used;
        uint256 missing = terms.installment - used;
        uint256 sold;
        if (missing > 0 && m.security > 0) {
            uint256 needed = Math.mulDiv(
                missing,
                1e6 * 10000,
                market.freshPrice() * 9970,
                Math.Rounding.Ceil
            );
            sold = Math.min(needed, m.security);
            m.security -= sold;
            require(minOutput >= (market.quote(false, sold) * 99) / 100, 'SLIPPAGE');
            market.risk().forceApprove(address(market), sold);
            uint256 output = market.swap(false, sold, minOutput, deadline);
            market.risk().forceApprove(address(market), 0);
            uint256 applied = Math.min(missing, output);
            missing -= applied;
            used += applied;
            if (output > applied) credits[wallet] += output - applied;
        }
        // Partial recoveries stay visibly short; subsequent top-ups can complete this obligation.
        m.bond += used;
        if (missing == 0) {
            m.bond -= terms.installment;
            contributed[currentRound][wallet] = true;
            rounds[currentRound].paid += terms.installment;
            emit Contribution(currentRound, wallet, terms.installment, true);
        }
        emit DefaultRecovered(currentRound, wallet, used, sold, missing);
    }
    function finalize() external nonReentrant {
        uint16 round = currentRound;
        Round storage r = rounds[round];
        require(round > 0 && !completed && block.timestamp > revealDeadline() && !r.finalized, 'NOT_READY');
        uint256 pool = uint256(terms.members) * terms.installment;
        require(r.paid == pool, 'SHORTFALL');
        address winner;
        uint256 best;
        // Join order resolves equal discounts. If nobody reveals, the first eligible secured member wins at zero discount.
        for (uint256 i = 0; i < members.length; i++) {
            address w = members[i];
            if (membership[w].won || !revealed[round][w]) continue;
            if (winner == address(0) || bids[round][w] > best) {
                winner = w;
                best = bids[round][w];
            }
        }
        if (winner == address(0))
            for (uint256 i = 0; i < members.length; i++) {
                address w = members[i];
                if (!membership[w].won && membership[w].security >= securityRequired(w)) {
                    winner = w;
                    break;
                }
            }
        require(
            winner != address(0) && membership[winner].security >= securityRequired(winner),
            'SECURITY_SHORTFALL'
        );
        uint256 commission = (pool * terms.commissionBps) / 10000;
        uint256 dividend = best / terms.members;
        uint256 remainder = best - dividend * terms.members;
        uint256 payout = pool - best - commission;
        require(
            payout >= (pool * (10000 - terms.maxDiscountBps - terms.commissionBps)) / 10000,
            'PAYOUT_FLOOR'
        );
        membership[winner].won = true;
        r.finalized = true;
        r.winner = winner;
        r.discount = best;
        r.payout = payout;
        r.dividend = dividend;
        r.commission = commission;
        r.remainder = remainder;
        credits[winner] += payout;
        for (uint256 i = 0; i < members.length; i++) credits[members[i]] += dividend;
        // Organizer earns the disclosed commission; integer remainder goes to the disclosed platform treasury.
        credits[organizer] += commission;
        credits[treasury] += remainder;
        emit Award(round, winner, payout, best, dividend, commission, remainder);
        if (round == terms.members) completed = true;
        else {
            currentRound++;
            rounds[currentRound].start = uint64(block.timestamp);
        }
    }
    function claim() external nonReentrant {
        uint256 amount = credits[msg.sender];
        require(amount > 0, 'NO_CREDIT');
        credits[msg.sender] = 0;
        usd.safeTransfer(msg.sender, amount);
        emit Claimed(msg.sender, amount);
    }
    function exit() external nonReentrant {
        require(completed || canceled, 'COMMITTED_UNTIL_END');
        Member storage m = membership[msg.sender];
        require(m.joined, 'MEMBER_ONLY');
        uint256 bond = m.bond;
        uint256 security = m.security;
        m.bond = 0;
        m.security = 0;
        if (bond > 0) usd.safeTransfer(msg.sender, bond);
        if (security > 0) market.risk().safeTransfer(msg.sender, security);
    }
}
