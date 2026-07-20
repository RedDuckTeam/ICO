import { loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
import { parseEther } from 'viem';

const TWAP_INTERVAL = 15 * 60; // 15 minutes

async function deployTokens() {
  const token18a = await hre.viem.deployContract('MockERC20', [
    'Token A (18)',
    'TKA',
    parseEther('1000000'),
    18,
  ]);
  const token18b = await hre.viem.deployContract('MockERC20', [
    'Token B (18)',
    'TKB',
    parseEther('1000000'),
    18,
  ]);
  const token6 = await hre.viem.deployContract('MockERC20', [
    'Stable (6)',
    'STB',
    1_000_000n * 10n ** 6n,
    6,
  ]);

  return { token18a, token18b, token6 };
}

describe('TwapPriceOracle', () => {
  it('prices 1:1 at tick 0 when both tokens share the same decimals', async () => {
    const { token18a, token18b } = await loadFixture(deployTokens);

    const pool = await hre.viem.deployContract('MockUniswapV3Pool', [
      token18a.address,
      token18b.address,
    ]);
    await pool.write.setTick([0]);

    const oracle = await hre.viem.deployContract('TwapPriceOracle', [
      pool.address,
      token18a.address, // base = token0
      token18b.address, // quote = token1
      TWAP_INTERVAL,
    ]);

    expect(await oracle.read.getPrice()).to.equal(parseEther('1'));
  });

  it('accounts for a decimals difference between base and quote', async () => {
    const { token18a, token6 } = await loadFixture(deployTokens);

    const pool = await hre.viem.deployContract('MockUniswapV3Pool', [
      token18a.address, // token0, 18 decimals
      token6.address, // token1, 6 decimals
    ]);
    await pool.write.setTick([0]);

    const oracle = await hre.viem.deployContract('TwapPriceOracle', [
      pool.address,
      token18a.address, // base = token0 (18 decimals)
      token6.address, // quote = token1 (6 decimals)
      TWAP_INTERVAL,
    ]);

    // Raw amounts are 1:1 at tick 0; base's raw unit is 10^12 times finer
    // than quote's, so 1 whole base token is worth 10^12 whole quote
    // tokens — i.e. 1e12 in human terms, or 1e30 at 1e18 fixed point.
    expect(await oracle.read.getPrice()).to.equal(10n ** 30n);
  });

  it('works symmetrically when the base token is token1', async () => {
    const { token18a, token18b } = await loadFixture(deployTokens);

    const pool = await hre.viem.deployContract('MockUniswapV3Pool', [
      token18a.address,
      token18b.address,
    ]);
    await pool.write.setTick([0]);

    const oracle = await hre.viem.deployContract('TwapPriceOracle', [
      pool.address,
      token18b.address, // base = token1
      token18a.address, // quote = token0
      TWAP_INTERVAL,
    ]);

    expect(await oracle.read.getPrice()).to.equal(parseEther('1'));
  });

  it('increases with tick when the base token is token0', async () => {
    const { token18a, token18b } = await loadFixture(deployTokens);

    const pool = await hre.viem.deployContract('MockUniswapV3Pool', [
      token18a.address,
      token18b.address,
    ]);
    const oracle = await hre.viem.deployContract('TwapPriceOracle', [
      pool.address,
      token18a.address,
      token18b.address,
      TWAP_INTERVAL,
    ]);

    await pool.write.setTick([0]);
    const priceAtZero = await oracle.read.getPrice();

    await pool.write.setTick([10_000]);
    const priceAtHigherTick = await oracle.read.getPrice();

    expect(priceAtHigherTick > priceAtZero).to.equal(true);
  });

  it('decreases with tick when the base token is token1 (inverse price)', async () => {
    const { token18a, token18b } = await loadFixture(deployTokens);

    const pool = await hre.viem.deployContract('MockUniswapV3Pool', [
      token18a.address,
      token18b.address,
    ]);
    const oracle = await hre.viem.deployContract('TwapPriceOracle', [
      pool.address,
      token18b.address, // base = token1
      token18a.address,
      TWAP_INTERVAL,
    ]);

    await pool.write.setTick([0]);
    const priceAtZero = await oracle.read.getPrice();

    await pool.write.setTick([10_000]);
    const priceAtHigherTick = await oracle.read.getPrice();

    expect(priceAtHigherTick < priceAtZero).to.equal(true);
  });

  it('rejects a base/quote pair that does not match the pool', async () => {
    const { token18a, token18b, token6 } = await loadFixture(deployTokens);

    const pool = await hre.viem.deployContract('MockUniswapV3Pool', [
      token18a.address,
      token18b.address,
    ]);

    await expect(
      hre.viem.deployContract('TwapPriceOracle', [
        pool.address,
        token18a.address,
        token6.address, // not token1 of this pool
        TWAP_INTERVAL,
      ]),
    ).to.be.rejectedWith('InvalidPoolTokens');
  });
});
