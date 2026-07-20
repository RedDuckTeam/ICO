import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as readline from 'node:readline';

import hre from 'hardhat';
import { parseEther } from 'viem';

/**
 * Deploys the core stack — Token, Whitelist, ICO — and configures the sale
 * rules with example values. Price oracles are network-specific (real
 * Chainlink feed / Uniswap V3 pool addresses), so registering payment
 * tokens is left as a documented next step rather than hardcoded here.
 *
 * Works against any network configured in hardhat.config.ts: `localhost`
 * for local testing, `sepolia` for a public testnet, `mainnet` for
 * production (gated behind an interactive confirmation — see
 * `confirmIfMainnet`).
 */
async function main() {
  const network = hre.network.name;
  console.log(`Network: ${network}`);
  await confirmIfMainnet(network);

  const [deployer] = await hre.viem.getWalletClients();
  console.log(`Deploying with ${deployer.account.address}`);

  const saleToken = await hre.viem.deployContract('Token', [
    'Demo Sale Token',
    'DEMO',
    parseEther('1000000'),
  ]);
  console.log(`Token:     ${saleToken.address}`);

  const whitelist = await hre.viem.deployContract('Whitelist');
  console.log(`Whitelist: ${whitelist.address}`);

  const ico = await hre.viem.deployContract('ICO', [
    saleToken.address,
    whitelist.address,
  ]);
  console.log(`ICO:       ${ico.address}`);

  const now = BigInt(Math.floor(Date.now() / 1000));
  const day = 24n * 60n * 60n;

  const tgeDate = now + 21n * day; // must be after the sale's end time

  await ico.write.setRules([
    parseEther('0.001'), // token price: 0.001 ETH
    parseEther('0.1'), // min purchase (ETH equivalent)
    parseEther('10'), // max purchase (ETH equivalent)
    parseEther('500000'), // token cap
    tgeDate,
    30n * day, // 30-day cliff after the TGE date
    365n * day, // 1-year linear vesting after the cliff
    1000n, // 10% unlocked at TGE (basis points)
  ]);
  console.log('Sale rules configured.');

  const deploymentFile = saveDeployment(network, {
    Token: saleToken.address,
    Whitelist: whitelist.address,
    ICO: ico.address,
  });

  console.log(`
Deployment record written to ${deploymentFile}

Next steps:

  1. Register payment sources — pick one adapter per accepted asset:

     // Plain Chainlink feed (works for any pair Chainlink covers well)
     const ethOracle = await deploy('ChainlinkPriceOracle', [
       '<ETH/USD feed address>',
       24 * 60 * 60, // max staleness, seconds
     ]);
     await ico.write.acceptPaymentToken([ICO_ETH_SENTINEL, ethOracle.address]);

     // Chainlink + Uniswap V3 TWAP, cross-checked (for a thinner market)
     const twapOracle = await deploy('TwapPriceOracle', [
       '<pool address>', '<token address>', '<USDC address>', 900,
     ]);
     const securedOracle = await deploy('SecuredPriceOracle', [
       chainlinkOracle.address, twapOracle.address, 500, // 5% max deviation
     ]);
     await ico.write.acceptPaymentToken([tokenAddress, securedOracle.address]);

  2. Whitelist buyers:      whitelist.write.addToWhitelist([<buyer>])
  3. Start the sale:        ico.write.startSale([<start>, <end>])${
    network === 'mainnet' || network === 'sepolia'
      ? `
  4. Verify the contracts:  npm run verify:${network} -- <address> <constructor args...>`
      : ''
  }
`);
}

/** Blocks a `mainnet` deploy behind a typed confirmation — real funds, no undo. */
async function confirmIfMainnet(network: string): Promise<void> {
  if (network !== 'mainnet' || process.env.SKIP_MAINNET_CONFIRM === 'true') {
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(
      '\n⚠️  Deploying to MAINNET with real funds. Type "deploy" to continue: ',
      resolve,
    );
  });
  rl.close();

  if (answer.trim() !== 'deploy') {
    throw new Error('Mainnet deployment cancelled.');
  }
}

/** Writes deployed addresses to `deployments/<network>.json` for later reference. */
function saveDeployment(
  network: string,
  addresses: Record<string, string>,
): string {
  const dir = path.join(__dirname, '..', 'deployments');
  mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `${network}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      { network, deployedAt: new Date().toISOString(), ...addresses },
      null,
      2,
    ),
  );

  return path.relative(path.join(__dirname, '..'), file);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
