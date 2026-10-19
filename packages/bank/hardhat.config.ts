import { defineConfig } from 'hardhat/config';
export default defineConfig({
  solidity: { version: '0.8.30', settings: { optimizer: { enabled: true, runs: 1 }, viaIR: true, evmVersion: 'cancun' } },
  networks: { default: { type: 'edr-simulated', chainType: 'l1', chainId: 84532 } },
});
