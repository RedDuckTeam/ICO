import { type HardhatUserConfig } from 'hardhat/config';

import '@nomicfoundation/hardhat-toolbox-viem';
import 'dotenv/config';

const { MAINNET_RPC_URL, SEPOLIA_RPC_URL, PRIVATE_KEY, ETHERSCAN_API_KEY } =
  process.env;

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.28',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: 'http://127.0.0.1:8545',
    },
    // Mainnet/Sepolia only appear once their RPC URL and a deployer key are
    // configured, so `npx hardhat run ... --network mainnet` fails fast with
    // "unknown network" instead of silently doing nothing if `.env` is unset.
    ...(MAINNET_RPC_URL && PRIVATE_KEY
      ? {
          mainnet: {
            url: MAINNET_RPC_URL,
            accounts: [PRIVATE_KEY],
          },
        }
      : {}),
    ...(SEPOLIA_RPC_URL && PRIVATE_KEY
      ? {
          sepolia: {
            url: SEPOLIA_RPC_URL,
            accounts: [PRIVATE_KEY],
          },
        }
      : {}),
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY ?? '',
  },
};

export default config;
