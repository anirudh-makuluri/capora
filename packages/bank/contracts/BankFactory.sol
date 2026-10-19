// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ManagedFund} from './ManagedFund.sol';
import {PublicChit, IRegisteredWallets} from './PublicChit.sol';
interface IEntityRegistry {
    function registerEntity(address, bool) external;
}
contract FundDeployer {
    address immutable factory = msg.sender;
    function deploy(
        address usd,
        address market,
        address manager,
        address treasury,
        string calldata name,
        string calldata strategy,
        uint16 fee,
        uint16 allocation,
        uint256 trade,
        uint256 daily,
        uint16 loss,
        address escrow,
        uint256 expense
    ) external returns (address) {
        require(msg.sender == factory, 'FACTORY_ONLY');
        return
            address(
                new ManagedFund(
                    usd,
                    market,
                    manager,
                    treasury,
                    name,
                    strategy,
                    fee,
                    allocation,
                    trade,
                    daily,
                    loss,
                    escrow,
                    expense
                )
            );
    }
}
contract ChitDeployer {
    address immutable factory = msg.sender;
    function deploy(
        address usd,
        address market,
        address registry,
        address organizer,
        address treasury,
        PublicChit.Terms calldata terms
    ) external returns (address) {
        require(msg.sender == factory, 'FACTORY_ONLY');
        return address(new PublicChit(usd, market, registry, organizer, treasury, terms));
    }
}
/// @notice Public factory; creation is restricted to registered Capora accounts.
contract BankFactory {
    address public immutable usd;
    address public immutable market;
    address public immutable registry;
    address public immutable treasury;
    address public immutable escrow;
    mapping(bytes32 => address) public entities;
    address[] public funds;
    address[] public chits;
    FundDeployer immutable fundDeployer;
    ChitDeployer immutable chitDeployer;
    event Created(bytes32 indexed id, address indexed entity, address indexed creator, bool fund);
    constructor(address usd_, address market_, address registry_, address treasury_, address escrow_) {
        require(block.chainid == 84532, 'BASE_SEPOLIA_ONLY');
        usd = usd_;
        market = market_;
        registry = registry_;
        treasury = treasury_;
        escrow = escrow_;
        fundDeployer = new FundDeployer();
        chitDeployer = new ChitDeployer();
    }
    function createFund(
        bytes32 id,
        string calldata name,
        string calldata strategy,
        uint16 fee,
        uint16 allocation,
        uint256 trade,
        uint256 daily,
        uint16 loss,
        uint256 expense
    ) external returns (address entity) {
        require(
            IRegisteredWallets(registry).isWallet(msg.sender) && entities[id] == address(0),
            'REGISTERED_ONCE'
        );
        require(
            bytes(name).length > 0 &&
                bytes(name).length <= 80 &&
                bytes(strategy).length > 0 &&
                bytes(strategy).length <= 1000,
            'DESCRIPTION'
        );
        entity = fundDeployer.deploy(
            usd,
            market,
            msg.sender,
            treasury,
            name,
            strategy,
            fee,
            allocation,
            trade,
            daily,
            loss,
            escrow,
            expense
        );
        entities[id] = entity;
        funds.push(entity);
        IEntityRegistry(registry).registerEntity(entity, true);
        emit Created(id, entity, msg.sender, true);
    }
    function createChit(bytes32 id, PublicChit.Terms calldata terms) external returns (address entity) {
        require(
            IRegisteredWallets(registry).isWallet(msg.sender) && entities[id] == address(0),
            'REGISTERED_ONCE'
        );
        entity = chitDeployer.deploy(usd, market, registry, msg.sender, treasury, terms);
        entities[id] = entity;
        chits.push(entity);
        IEntityRegistry(registry).registerEntity(entity, false);
        emit Created(id, entity, msg.sender, false);
    }
    function counts() external view returns (uint256, uint256) {
        return (funds.length, chits.length);
    }
}
