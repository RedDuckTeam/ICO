import {
  loadFixture,
  time,
} from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';

const DECIMALS = 8;
const PRICE = 2000n * 10n ** 8n; // $2000
const MAX_STALENESS = 24n * 60n * 60n; // 1 day

async function deployFixture() {
  const feed = await hre.viem.deployContract('MockV3Aggregator', [
    DECIMALS,
    PRICE,
  ]);
  const oracle = await hre.viem.deployContract('ChainlinkPriceOracle', [
    feed.address,
    MAX_STALENESS,
  ]);

  return { feed, oracle };
}

describe('ChainlinkPriceOracle', () => {
  it('normalizes the feed price to 18 decimals', async () => {
    const { oracle } = await loadFixture(deployFixture);

    expect(await oracle.read.getPrice()).to.equal(2000n * 10n ** 18n);
  });

  it('tracks price updates', async () => {
    const { feed, oracle } = await loadFixture(deployFixture);

    await feed.write.updateAnswer([2500n * 10n ** 8n]);

    expect(await oracle.read.getPrice()).to.equal(2500n * 10n ** 18n);
  });

  it('rejects a non-positive answer', async () => {
    const { feed, oracle } = await loadFixture(deployFixture);

    await feed.write.updateAnswer([0n]);

    await expect(oracle.read.getPrice()).to.be.rejectedWith('InvalidPrice');
  });

  it('rejects an answer older than maxStaleness', async () => {
    const { oracle } = await loadFixture(deployFixture);

    await time.increase(MAX_STALENESS + 1n);

    await expect(oracle.read.getPrice()).to.be.rejectedWith('PriceTooOld');
  });

  it('rejects an unanswered round', async () => {
    const { feed, oracle } = await loadFixture(deployFixture);

    await feed.write.setUnanswered();

    await expect(oracle.read.getPrice()).to.be.rejectedWith('StalePrice');
  });
});
