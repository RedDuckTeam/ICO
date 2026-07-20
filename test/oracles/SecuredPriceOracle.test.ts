import { loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
import { parseEther } from 'viem';

const MAX_DEVIATION_BPS = 500n; // 5%

async function deployFixture() {
  const primary = await hre.viem.deployContract('MockPriceOracle', [
    parseEther('2000'),
  ]);
  const twap = await hre.viem.deployContract('MockPriceOracle', [
    parseEther('2000'),
  ]);

  const secured = await hre.viem.deployContract('SecuredPriceOracle', [
    primary.address,
    twap.address,
    MAX_DEVIATION_BPS,
  ]);

  return { primary, twap, secured };
}

describe('SecuredPriceOracle', () => {
  it('returns the primary price when the sources agree', async () => {
    const { secured } = await loadFixture(deployFixture);

    expect(await secured.read.getPrice()).to.equal(parseEther('2000'));
  });

  it('tolerates a small deviation between the two sources', async () => {
    const { primary, secured } = await loadFixture(deployFixture);

    // ~3% above the TWAP — under the 5% bound
    await primary.write.setPrice([parseEther('2060')]);

    expect(await secured.read.getPrice()).to.equal(parseEther('2060'));
  });

  it('reverts when the deviation exceeds the bound', async () => {
    const { primary, secured } = await loadFixture(deployFixture);

    // 10% above the TWAP — over the 5% bound
    await primary.write.setPrice([parseEther('2200')]);

    await expect(secured.read.getPrice()).to.be.rejectedWith(
      'PriceDeviationTooHigh',
    );
  });

  it('exposes the current deviation even when within bounds', async () => {
    const { primary, secured } = await loadFixture(deployFixture);

    await primary.write.setPrice([parseEther('2020')]);

    // deviation = |2020-2000| / avg(2020,2000) ≈ 0.995% ≈ 99 bps
    const deviation = await secured.read.getCurrentDeviationBps();
    expect(deviation > 90n && deviation < 110n).to.equal(true);
  });

  it('rejects a max deviation above 100%', async () => {
    const { primary, twap } = await loadFixture(deployFixture);

    await expect(
      hre.viem.deployContract('SecuredPriceOracle', [
        primary.address,
        twap.address,
        10_001n,
      ]),
    ).to.be.rejectedWith('InvalidDeviation');
  });
});
