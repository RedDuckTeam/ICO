import { time } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import hre from 'hardhat';
import { formatEther, formatUnits, parseEther, parseUnits } from 'viem';

/**
 * End-to-end check against real, deployed contract instances on whatever
 * node `--network` points at (a local Hardhat node by default) — not the
 * fixture-based unit tests, which redeploy fresh contracts per test via an
 * in-process EVM. This script deploys once, then drives the same lifecycle
 * a real client would: whitelist, price oracles, an ETH purchase, an ERC-20
 * purchase, TGE, vesting claims, and settlement — all as separate mined
 * transactions against persistent on-chain state.
 */
async function main() {
  const [deployer, buyer1, buyer2] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  const log = (msg: string) => console.log(`\n=== ${msg} ===`);
  const eth = (v: bigint) => `${formatEther(v)} ETH`;

  // ---- Deploy ----
  log('Deploying');

  const saleToken = await hre.viem.deployContract('Token', [
    'Smoke Test Token',
    'SMOKE',
    parseEther('1000000'),
  ]);
  const whitelist = await hre.viem.deployContract('Whitelist');
  const ico = await hre.viem.deployContract('ICO', [
    saleToken.address,
    whitelist.address,
  ]);

  const paymentToken = await hre.viem.deployContract('MockERC20', [
    'Mock USD',
    'mUSD',
    parseUnits('1000000', 6),
    6,
  ]);
  const ethFeed = await hre.viem.deployContract('MockV3Aggregator', [
    8,
    2000n * 10n ** 8n, // $2000/ETH
  ]);
  const paymentFeed = await hre.viem.deployContract('MockV3Aggregator', [
    8,
    1n * 10n ** 8n, // $1/mUSD
  ]);
  const ethOracle = await hre.viem.deployContract('ChainlinkPriceOracle', [
    ethFeed.address,
    24n * 60n * 60n,
  ]);
  const paymentOracle = await hre.viem.deployContract('ChainlinkPriceOracle', [
    paymentFeed.address,
    24n * 60n * 60n,
  ]);

  console.log(`Token:          ${saleToken.address}`);
  console.log(`Whitelist:      ${whitelist.address}`);
  console.log(`ICO:            ${ico.address}`);
  console.log(`Payment token:  ${paymentToken.address}`);
  console.log(`ETH oracle:     ${ethOracle.address}`);
  console.log(`Payment oracle: ${paymentOracle.address}`);

  // ---- Configure ----
  log('Configuring');

  const ETH_ADDRESS = await ico.read.ETH_ADDRESS();
  await ico.write.acceptPaymentToken([ETH_ADDRESS, ethOracle.address]);
  await ico.write.acceptPaymentToken([
    paymentToken.address,
    paymentOracle.address,
  ]);
  await whitelist.write.addToWhitelist([buyer1.account.address]);
  await whitelist.write.addToWhitelist([buyer2.account.address]);
  await paymentToken.write.transfer([
    buyer2.account.address,
    parseUnits('10000', 6),
  ]);

  const now = BigInt(await time.latest());
  const startTime = now + 60n;
  const endTime = startTime + 3600n;
  const tgeDate = endTime + 3600n;
  const cliffDuration = 600n;
  const vestingDuration = 3600n;

  await ico.write.setRules([
    parseEther('0.001'), // token price
    parseEther('0.01'), // min purchase
    parseEther('5'), // max purchase
    parseEther('100000'), // token cap
    tgeDate,
    cliffDuration,
    vestingDuration,
    1000n, // 10% unlocked at TGE
  ]);
  console.log('Rules set.');

  // ---- Sale ----
  log('Running the sale');

  await ico.write.startSale([startTime, endTime]);
  await time.increaseTo(startTime + 1n);
  console.log(`Sale open: ${await ico.read.isSaleOpen()}`);

  await ico.write.buyWithETH({
    value: parseEther('1'),
    account: buyer1.account,
  });
  const vesting1 = await ico.read.getVesting([buyer1.account.address]);
  console.log(
    `buyer1 bought with ETH -> vested total: ${formatEther(vesting1.total)} SMOKE`,
  );

  const paymentAmount = parseUnits('2000', 6); // ~1 ETH worth at $2000/ETH
  await paymentToken.write.approve([ico.address, paymentAmount], {
    account: buyer2.account,
  });
  await ico.write.buyWithERC20([paymentToken.address, paymentAmount], {
    account: buyer2.account,
  });
  const vesting2 = await ico.read.getVesting([buyer2.account.address]);
  console.log(
    `buyer2 bought with mUSD -> vested total: ${formatEther(vesting2.total)} SMOKE`,
  );

  // ---- End sale + TGE ----
  log('Ending the sale and executing TGE');

  await time.increaseTo(endTime + 1n);
  await ico.write.updateSaleStatus();
  console.log(`Sale state after window closes: ${await ico.read.state()}`);

  const tokensSold = await ico.read.tokensSold();
  await saleToken.write.approve([ico.address, tokensSold]);
  await ico.write.executeTGE();
  console.log(
    `TGE executed; ${formatEther(tokensSold)} SMOKE pulled into the ICO.`,
  );

  // ---- Claim at TGE ----
  log('Claiming at the TGE date');

  await time.increaseTo(tgeDate);
  await ico.write.claimTokens({ account: buyer1.account });
  await ico.write.claimTokens({ account: buyer2.account });

  const tgeBalance1 = await saleToken.read.balanceOf([buyer1.account.address]);
  const tgeBalance2 = await saleToken.read.balanceOf([buyer2.account.address]);
  console.log(`buyer1 balance at TGE: ${formatEther(tgeBalance1)} SMOKE`);
  console.log(`buyer2 balance at TGE: ${formatEther(tgeBalance2)} SMOKE`);

  // ---- Claim after full vesting ----
  log('Claiming after the vesting period ends');

  await time.increaseTo(tgeDate + cliffDuration + vestingDuration);
  await ico.write.claimTokens({ account: buyer1.account });
  await ico.write.claimTokens({ account: buyer2.account });

  const finalBalance1 = await saleToken.read.balanceOf([
    buyer1.account.address,
  ]);
  const finalBalance2 = await saleToken.read.balanceOf([
    buyer2.account.address,
  ]);
  console.log(`buyer1 final balance: ${formatEther(finalBalance1)} SMOKE`);
  console.log(`buyer2 final balance: ${formatEther(finalBalance2)} SMOKE`);

  if (finalBalance1 !== vesting1.total || finalBalance2 !== vesting2.total) {
    throw new Error('Claimed amount does not match the vested total.');
  }

  // ---- Settlement ----
  log('Owner settlement');

  const ethBefore = await publicClient.getBalance({
    address: deployer.account.address,
  });
  await ico.write.withdrawFunds();
  const ethAfter = await publicClient.getBalance({
    address: deployer.account.address,
  });
  console.log(`Owner ETH balance: ${eth(ethBefore)} -> ${eth(ethAfter)}`);

  const paymentBefore = await paymentToken.read.balanceOf([
    deployer.account.address,
  ]);
  await ico.write.withdrawERC20([paymentToken.address]);
  const paymentAfter = await paymentToken.read.balanceOf([
    deployer.account.address,
  ]);
  console.log(
    `Owner mUSD balance: ${formatUnits(paymentBefore, 6)} -> ${formatUnits(paymentAfter, 6)}`,
  );

  // TGE only ever pulls in `tokensSold`, so under normal operation there is
  // nothing left to sweep once buyers have claimed everything. Simulate a
  // surplus (e.g. an accidental extra transfer) to exercise the rescue path.
  const surplus = parseEther('500');
  await saleToken.write.transfer([ico.address, surplus]);

  const unsoldBefore = await saleToken.read.balanceOf([
    deployer.account.address,
  ]);
  await ico.write.withdrawUnsoldTokens();
  const unsoldAfter = await saleToken.read.balanceOf([
    deployer.account.address,
  ]);
  console.log(
    `Owner SMOKE balance: ${formatEther(unsoldBefore)} -> ${formatEther(unsoldAfter)}`,
  );

  if (unsoldAfter - unsoldBefore !== surplus) {
    throw new Error('Recovered surplus does not match what was sent in.');
  }

  log('All good — full lifecycle completed against deployed contracts.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
