import { time } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import hre from 'hardhat';
import { parseEther, parseUnits } from 'viem';

// Sale parameters used across tests
export const TOKEN_PRICE = parseEther('0.001'); // 1 sale token costs 0.001 ETH
export const MIN_PURCHASE = parseEther('0.1');
export const MAX_PURCHASE = parseEther('10');
export const TOKEN_CAP = parseEther('500000');
export const INITIAL_UNLOCK_BPS = 1000n; // 10%
export const CLIFF_DURATION = 30n * 24n * 60n * 60n; // 30 days
export const VESTING_DURATION = 365n * 24n * 60n * 60n; // 1 year

export const ETH_PRICE_USD = 2000n * 10n ** 8n; // $2000, 8 feed decimals
export const PAYMENT_TOKEN_PRICE_USD = 1n * 10n ** 8n; // $1, 8 feed decimals
export const PRICE_FEED_DECIMALS = 8;
export const PAYMENT_TOKEN_DECIMALS = 6;
export const ORACLE_MAX_STALENESS = 24n * 60n * 60n;

export const ETH_ADDRESS = '0x0000000000000000000000000000000000000001';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const SaleState = {
  NotStarted: 0,
  Active: 1,
  Paused: 2,
  Ended: 3,
} as const;

export function tokensFor(ethAmount: bigint): bigint {
  return (ethAmount * parseEther('1')) / TOKEN_PRICE;
}

export function tgeAmountFor(totalTokens: bigint): bigint {
  return (totalTokens * INITIAL_UNLOCK_BPS) / 10000n;
}

export async function deployICOFixture() {
  const [owner, buyer1, buyer2, outsider] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const saleToken = await hre.viem.deployContract('Token', [
    'Demo Token',
    'DEMO',
    parseEther('1000000'),
  ]);

  const whitelist = await hre.viem.deployContract('Whitelist');

  const ico = await hre.viem.deployContract('ICO', [
    saleToken.address,
    whitelist.address,
  ]);

  // ETH/USD price source
  const ethFeed = await hre.viem.deployContract('MockV3Aggregator', [
    PRICE_FEED_DECIMALS,
    ETH_PRICE_USD,
  ]);
  const ethOracle = await hre.viem.deployContract('ChainlinkPriceOracle', [
    ethFeed.address,
    ORACLE_MAX_STALENESS,
  ]);

  // A stablecoin payment option, priced via Chainlink too
  const paymentToken = await hre.viem.deployContract('MockERC20', [
    'Mock USD',
    'mUSD',
    parseUnits('1000000', PAYMENT_TOKEN_DECIMALS),
    PAYMENT_TOKEN_DECIMALS,
  ]);
  const paymentFeed = await hre.viem.deployContract('MockV3Aggregator', [
    PRICE_FEED_DECIMALS,
    PAYMENT_TOKEN_PRICE_USD,
  ]);
  const paymentOracle = await hre.viem.deployContract('ChainlinkPriceOracle', [
    paymentFeed.address,
    ORACLE_MAX_STALENESS,
  ]);

  await ico.write.acceptPaymentToken([ETH_ADDRESS, ethOracle.address]);
  await ico.write.acceptPaymentToken([
    paymentToken.address,
    paymentOracle.address,
  ]);

  await whitelist.write.addToWhitelist([buyer1.account.address]);
  await whitelist.write.addToWhitelist([buyer2.account.address]);

  await paymentToken.write.transfer([
    buyer1.account.address,
    parseUnits('100000', PAYMENT_TOKEN_DECIMALS),
  ]);

  const now = BigInt(await time.latest());
  const startTime = now + 3600n;
  const endTime = startTime + 7n * 24n * 3600n;
  const tgeDate = endTime + 24n * 3600n;

  await ico.write.setRules([
    TOKEN_PRICE,
    MIN_PURCHASE,
    MAX_PURCHASE,
    TOKEN_CAP,
    tgeDate,
    CLIFF_DURATION,
    VESTING_DURATION,
    INITIAL_UNLOCK_BPS,
  ]);

  return {
    ico,
    saleToken,
    whitelist,
    paymentToken,
    ethFeed,
    ethOracle,
    paymentFeed,
    paymentOracle,
    owner,
    buyer1,
    buyer2,
    outsider,
    publicClient,
    startTime,
    endTime,
    tgeDate,
  };
}

export async function openSale(
  ico: Awaited<ReturnType<typeof deployICOFixture>>['ico'],
  startTime: bigint,
  endTime: bigint,
) {
  await ico.write.startSale([startTime, endTime]);
  await time.increaseTo(startTime + 1n);
}
