// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ERC20} from '@openzeppelin/contracts/token/ERC20/ERC20.sol';
import {AccessControl} from '@openzeppelin/contracts/access/AccessControl.sol';
/// @notice Demo accounting token. No redeemability, backing or market peg.
contract CaporaUSD is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256('MINTER_ROLE');
    mapping(bytes32 => bytes32) public mintIntents;
    event TopUpMinted(bytes32 indexed intent, address indexed wallet, uint256 amount);
    constructor(address admin, address minter) ERC20('Capora USD (TESTNET)', 'cUSD') {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, minter);
    }
    function decimals() public pure override returns (uint8) {
        return 6;
    }
    function mintOnce(bytes32 intent, address wallet, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(
            intent != bytes32(0) && wallet != address(0) && amount > 0 && amount <= 1000e6,
            'INVALID_MINT'
        );
        bytes32 commitment = keccak256(abi.encode(wallet, amount));
        if (mintIntents[intent] != bytes32(0)) {
            require(mintIntents[intent] == commitment, 'INTENT_CHANGED');
            return;
        }
        mintIntents[intent] = commitment;
        _mint(wallet, amount);
        emit TopUpMinted(intent, wallet, amount);
    }
}
contract TestCollateral is CaporaUSD {
    constructor(address admin, address minter) CaporaUSD(admin, minter) {}
    function name() public pure override returns (string memory) {
        return 'Capora Test Collateral';
    }
    function symbol() public pure override returns (string memory) {
        return 'cRISK';
    }
}
