// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {AccessControl} from '@openzeppelin/contracts/access/AccessControl.sol';
import {ReentrancyGuard} from '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import {IERC20} from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import {SafeERC20} from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
interface IWalletAuthority {
    function executor() external view returns (address);
    function allowed(address, bytes4) external view returns (bool);
}
/// @notice Custodial smart account. The trusted executor authorizes typed actions off chain.
/// No delegatecall, arbitrary native sends, or raw signing surface is exposed to agents.
contract AgentWallet is ReentrancyGuard {
    using SafeERC20 for IERC20;
    IWalletAuthority public immutable authority;
    bytes32 public immutable identity;
    mapping(bytes32 => bool) public executed;
    bool public revoked;
    event Action(bytes32 indexed id, address indexed target, bytes4 selector);
    constructor(bytes32 identity_) {
        authority = IWalletAuthority(msg.sender);
        identity = identity_;
    }
    modifier onlyExecutor() {
        require(msg.sender == authority.executor(), 'EXECUTOR_ONLY');
        _;
    }
    function setRevoked(bool value) external onlyExecutor {
        revoked = value;
    }
    function execute(
        bytes32 id,
        address target,
        bytes calldata data
    ) external onlyExecutor nonReentrant returns (bytes memory) {
        require(!revoked && id != bytes32(0) && !executed[id], 'REVOKED_OR_REPLAY');
        require(data.length >= 4 && authority.allowed(target, bytes4(data[:4])), 'METHOD_NOT_ALLOWED');
        executed[id] = true;
        (bool success, bytes memory result) = target.call(data);
        if (!success)
            assembly ('memory-safe') {
                revert(add(result, 32), mload(result))
            }
        emit Action(id, target, bytes4(data[:4]));
        return result;
    }
    receive() external payable {}
}
contract WalletFactory is AccessControl {
    address public immutable executor;
    mapping(bytes32 => address) public wallets;
    mapping(address => bool) public isWallet;
    mapping(address => mapping(bytes4 => bool)) public allowedMethods;
    address public bankFactory;
    mapping(address => bool) public funds;
    mapping(address => bool) public chits;
    event WalletCreated(bytes32 indexed identity, address indexed wallet);
    constructor(address admin, address executor_) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        executor = executor_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }
    function allow(address target, bytes4 selector, bool value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(target.code.length > 0, 'NO_CONTRACT');
        allowedMethods[target][selector] = value;
    }
    function setBankFactory(address value) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(bankFactory == address(0) && value.code.length > 0, 'FACTORY_ONCE');
        bankFactory = value;
    }
    function registerEntity(address target, bool fund) external {
        require(msg.sender == bankFactory && target.code.length > 0, 'FACTORY_ONLY');
        if (fund) funds[target] = true;
        else chits[target] = true;
    }
    function allowed(address target, bytes4 selector) external view returns (bool) {
        if (allowedMethods[target][selector]) return true;
        if (funds[target])
            return
                selector == bytes4(keccak256('invest(uint256,uint256)')) ||
                selector == bytes4(keccak256('redeemWithMin(uint256,uint256)')) ||
                selector == bytes4(keccak256('rebalance(bool,uint256,uint256,uint256,string)')) ||
                selector == bytes4(keccak256('buyIntelligence(bytes32,address,uint128,uint64,uint16)')) ||
                selector == bytes4(keccak256('controls(bool,bool)'));
        if (chits[target])
            return
                selector == bytes4(keccak256('join(uint256)')) ||
                selector == bytes4(keccak256('contribute()')) ||
                selector == bytes4(keccak256('commitBid(bytes32)')) ||
                selector == bytes4(keccak256('revealBid(uint256,bytes32)')) ||
                selector == bytes4(keccak256('claim()')) ||
                selector == bytes4(keccak256('topUpSecurity(uint256)')) ||
                selector == bytes4(keccak256('topUpBond(uint256)')) ||
                selector == bytes4(keccak256('finalize()')) ||
                selector == bytes4(keccak256('exit()')) ||
                selector == bytes4(keccak256('cancelUnfilled()')) ||
                selector == bytes4(keccak256('recoverDefault(address,uint256,uint256)'));
        return false;
    }
    function create(bytes32 identity) external returns (address wallet) {
        require(msg.sender == executor && identity != bytes32(0), 'EXECUTOR_ONLY');
        wallet = wallets[identity];
        if (wallet != address(0)) return wallet;
        wallet = address(new AgentWallet{salt: identity}(identity));
        wallets[identity] = wallet;
        isWallet[wallet] = true;
        emit WalletCreated(identity, wallet);
    }
}
