import {
  loadFixture,
  time,
} from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';
import hre from 'hardhat';
import { getAddress, parseEther, parseUnits } from 'viem';

import {
  CLIFF_DURATION,
  ETH_ADDRESS,
  INITIAL_UNLOCK_BPS,
  MAX_PURCHASE,
  MIN_PURCHASE,
  PAYMENT_TOKEN_DECIMALS,
  SaleState,
  TOKEN_CAP,
  TOKEN_PRICE,
  VESTING_DURATION,
  ZERO_ADDRESS,
  deployICOFixture,
  openSale,
  tgeAmountFor,
  tokensFor,
} from './shared';

describe('ICO', () => {
  describe('deployment', () => {
    it('deploys with the sale token, whitelist and NotStarted state', async () => {
      const { ico, saleToken, whitelist } = await loadFixture(
        deployICOFixture,
      );

      expect(await ico.read.saleToken()).to.equal(
        getAddress(saleToken.address),
      );
      expect(await ico.read.whitelist()).to.equal(
        getAddress(whitelist.address),
      );
      expect(await ico.read.state()).to.equal(SaleState.NotStarted);
      expect(await ico.read.tgeExecuted()).to.equal(false);
    });

    it('rejects zero addresses', async () => {
      const { whitelist, saleToken } = await loadFixture(deployICOFixture);

      await expect(
        hre.viem.deployContract('ICO', [ZERO_ADDRESS, whitelist.address]),
      ).to.be.rejectedWith('ZeroAddress');
      await expect(
        hre.viem.deployContract('ICO', [saleToken.address, ZERO_ADDRESS]),
      ).to.be.rejectedWith('ZeroAddress');
    });
  });

  describe('setRules', () => {
    it('stores the configured rules', async () => {
      const { ico } = await loadFixture(deployICOFixture);

      const rules = await ico.read.getRules();
      expect(rules.tokenPrice).to.equal(TOKEN_PRICE);
      expect(rules.minPurchase).to.equal(MIN_PURCHASE);
      expect(rules.maxPurchase).to.equal(MAX_PURCHASE);
      expect(rules.tokenCap).to.equal(TOKEN_CAP);
      expect(rules.cliffDuration).to.equal(CLIFF_DURATION);
      expect(rules.vestingDuration).to.equal(VESTING_DURATION);
      expect(rules.initialUnlockBps).to.equal(INITIAL_UNLOCK_BPS);
    });

    it('rejects min >= max purchase limits', async () => {
      const { ico, tgeDate } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.setRules([
          TOKEN_PRICE,
          MAX_PURCHASE,
          MIN_PURCHASE,
          TOKEN_CAP,
          tgeDate,
          CLIFF_DURATION,
          VESTING_DURATION,
          INITIAL_UNLOCK_BPS,
        ]),
      ).to.be.rejectedWith('InvalidPurchaseLimits');
    });

    it('rejects an unlock percentage above 100%', async () => {
      const { ico, tgeDate } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.setRules([
          TOKEN_PRICE,
          MIN_PURCHASE,
          MAX_PURCHASE,
          TOKEN_CAP,
          tgeDate,
          CLIFF_DURATION,
          VESTING_DURATION,
          10001n,
        ]),
      ).to.be.rejectedWith('InvalidUnlockBps');
    });

    it('rejects a TGE date in the past', async () => {
      const { ico } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.setRules([
          TOKEN_PRICE,
          MIN_PURCHASE,
          MAX_PURCHASE,
          TOKEN_CAP,
          1n,
          CLIFF_DURATION,
          VESTING_DURATION,
          INITIAL_UNLOCK_BPS,
        ]),
      ).to.be.rejectedWith('InvalidTgeDate');
    });

    it('is owner-only', async () => {
      const { ico, buyer1, tgeDate } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.setRules(
          [
            TOKEN_PRICE,
            MIN_PURCHASE,
            MAX_PURCHASE,
            TOKEN_CAP,
            tgeDate,
            CLIFF_DURATION,
            VESTING_DURATION,
            INITIAL_UNLOCK_BPS,
          ],
          { account: buyer1.account },
        ),
      ).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });

    it('cannot be changed after the sale starts', async () => {
      const { ico, startTime, endTime, tgeDate } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      await expect(
        ico.write.setRules([
          TOKEN_PRICE,
          MIN_PURCHASE,
          MAX_PURCHASE,
          TOKEN_CAP,
          tgeDate,
          CLIFF_DURATION,
          VESTING_DURATION,
          INITIAL_UNLOCK_BPS,
        ]),
      ).to.be.rejectedWith('SaleAlreadyStarted');
    });
  });

  describe('payment tokens', () => {
    it('registers and removes a payment token', async () => {
      const { ico, paymentToken, paymentOracle } = await loadFixture(
        deployICOFixture,
      );

      expect(await ico.read.isTokenAccepted([paymentToken.address])).to.equal(
        true,
      );

      await ico.write.removePaymentToken([paymentToken.address]);
      expect(await ico.read.isTokenAccepted([paymentToken.address])).to.equal(
        false,
      );

      await expect(
        ico.write.removePaymentToken([paymentToken.address]),
      ).to.be.rejectedWith('TokenNotAccepted');

      await ico.write.acceptPaymentToken([
        paymentToken.address,
        paymentOracle.address,
      ]);
      await expect(
        ico.write.acceptPaymentToken([
          paymentToken.address,
          paymentOracle.address,
        ]),
      ).to.be.rejectedWith('TokenAlreadyAccepted');
    });
  });

  describe('startSale', () => {
    it('opens the sale', async () => {
      const { ico, startTime, endTime } = await loadFixture(deployICOFixture);

      await ico.write.startSale([startTime, endTime]);

      expect(await ico.read.state()).to.equal(SaleState.Active);
      expect(await ico.read.startTime()).to.equal(startTime);
      expect(await ico.read.endTime()).to.equal(endTime);
    });

    it('rejects when rules are not set', async () => {
      const { saleToken, whitelist, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      const freshICO = await hre.viem.deployContract('ICO', [
        saleToken.address,
        whitelist.address,
      ]);

      await expect(
        freshICO.write.startSale([startTime, endTime]),
      ).to.be.rejectedWith('RulesNotSet');
    });

    it('rejects an inverted time range', async () => {
      const { ico, startTime } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.startSale([startTime, startTime - 1n]),
      ).to.be.rejectedWith('InvalidTimeRange');
    });

    it('rejects an end time on or after the TGE date', async () => {
      const { ico, startTime, tgeDate } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.startSale([startTime, tgeDate + 1n]),
      ).to.be.rejectedWith('InvalidTgeDate');
    });

    it('cannot be started twice', async () => {
      const { ico, startTime, endTime } = await loadFixture(deployICOFixture);
      await ico.write.startSale([startTime, endTime]);

      await expect(
        ico.write.startSale([startTime + 10n, endTime]),
      ).to.be.rejectedWith('SaleAlreadyStarted');
    });
  });

  describe('pause / resume / end', () => {
    it('blocks purchases while paused and resumes correctly', async () => {
      const { ico, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      await ico.write.pauseSale();
      expect(await ico.read.state()).to.equal(SaleState.Paused);

      await expect(
        ico.write.buyWithETH({
          value: parseEther('1'),
          account: buyer1.account,
        }),
      ).to.be.rejectedWith('SaleNotActive');

      await ico.write.resumeSale();
      expect(await ico.read.state()).to.equal(SaleState.Active);
    });

    it('cannot resume a sale that is not paused', async () => {
      const { ico, startTime, endTime } = await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      await expect(ico.write.resumeSale()).to.be.rejectedWith(
        'SaleNotPaused',
      );
    });

    it('ends the sale early on demand', async () => {
      const { ico, startTime, endTime } = await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      await ico.write.endSale();
      expect(await ico.read.state()).to.equal(SaleState.Ended);
    });
  });

  describe('buyWithETH', () => {
    it('rejects purchases before the sale starts', async () => {
      const { ico, buyer1 } = await loadFixture(deployICOFixture);

      await expect(
        ico.write.buyWithETH({
          value: parseEther('1'),
          account: buyer1.account,
        }),
      ).to.be.rejectedWith('SaleNotActive');
    });

    it('rejects non-whitelisted buyers', async () => {
      const { ico, outsider, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      await expect(
        ico.write.buyWithETH({
          value: parseEther('1'),
          account: outsider.account,
        }),
      ).to.be.rejectedWith('NotVerified');
    });

    it('records a vesting position at the fixed price', async () => {
      const { ico, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      const ethAmount = parseEther('1');
      const expectedTokens = tokensFor(ethAmount);

      await ico.write.buyWithETH({
        value: ethAmount,
        account: buyer1.account,
      });

      const vesting = await ico.read.getVesting([buyer1.account.address]);
      expect(vesting.total).to.equal(expectedTokens);
      expect(vesting.tgeAmount).to.equal(tgeAmountFor(expectedTokens));
      expect(vesting.claimed).to.equal(0n);
      expect(await ico.read.tokensSold()).to.equal(expectedTokens);
    });

    it('accumulates repeat purchases in one position', async () => {
      const { ico, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      await ico.write.buyWithETH({
        value: parseEther('1'),
        account: buyer1.account,
      });
      await ico.write.buyWithETH({
        value: parseEther('2'),
        account: buyer1.account,
      });

      const vesting = await ico.read.getVesting([buyer1.account.address]);
      expect(vesting.total).to.equal(tokensFor(parseEther('3')));
    });

    it('enforces min and max purchase limits', async () => {
      const { ico, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      await expect(
        ico.write.buyWithETH({
          value: MIN_PURCHASE - 1n,
          account: buyer1.account,
        }),
      ).to.be.rejectedWith('InvalidPurchaseAmount');

      await expect(
        ico.write.buyWithETH({
          value: MAX_PURCHASE + 1n,
          account: buyer1.account,
        }),
      ).to.be.rejectedWith('InvalidPurchaseAmount');
    });

    it('clamps to the token cap, refunds the surplus and ends the sale', async () => {
      const { ico, buyer1, publicClient, startTime, endTime, tgeDate } =
        await loadFixture(deployICOFixture);

      const smallCap = parseEther('5000'); // = 5 ETH worth
      await ico.write.setRules([
        TOKEN_PRICE,
        MIN_PURCHASE,
        MAX_PURCHASE,
        smallCap,
        tgeDate,
        CLIFF_DURATION,
        VESTING_DURATION,
        INITIAL_UNLOCK_BPS,
      ]);
      await openSale(ico, startTime, endTime);

      const balanceBefore = await publicClient.getBalance({
        address: buyer1.account.address,
      });

      await ico.write.buyWithETH({
        value: parseEther('10'),
        account: buyer1.account,
      });

      const vesting = await ico.read.getVesting([buyer1.account.address]);
      expect(vesting.total).to.equal(smallCap);
      expect(await ico.read.remainingTokens()).to.equal(0n);
      expect(await ico.read.state()).to.equal(SaleState.Ended);

      const balanceAfter = await publicClient.getBalance({
        address: buyer1.account.address,
      });
      const spent = balanceBefore - balanceAfter;
      expect(spent > parseEther('5')).to.equal(true);
      expect(spent < parseEther('5.01')).to.equal(true);
    });
  });

  describe('buyWithERC20', () => {
    it('rejects tokens without a registered oracle', async () => {
      const { ico, saleToken, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);

      await expect(
        ico.write.buyWithERC20([saleToken.address, parseEther('1')], {
          account: buyer1.account,
        }),
      ).to.be.rejectedWith('TokenNotAccepted');
    });

    it('converts the payment through price oracles and pulls the exact cost', async () => {
      const { ico, paymentToken, buyer1, startTime, endTime } =
        await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      // $2000 in a $1 stable token = 1 ETH at $2000/ETH = 1000 sale tokens
      const paymentAmount = parseUnits('2000', PAYMENT_TOKEN_DECIMALS);
      await paymentToken.write.approve([ico.address, paymentAmount], {
        account: buyer1.account,
      });

      const balanceBefore = await paymentToken.read.balanceOf([
        buyer1.account.address,
      ]);

      await ico.write.buyWithERC20([paymentToken.address, paymentAmount], {
        account: buyer1.account,
      });

      const vesting = await ico.read.getVesting([buyer1.account.address]);
      expect(vesting.total).to.equal(tokensFor(parseEther('1')));

      const balanceAfter = await paymentToken.read.balanceOf([
        buyer1.account.address,
      ]);
      expect(balanceBefore - balanceAfter).to.equal(paymentAmount);
      expect(await paymentToken.read.balanceOf([ico.address])).to.equal(
        paymentAmount,
      );
    });

    it('rejects purchases without sufficient allowance', async () => {
      const { ico, paymentToken, buyer1, startTime, endTime } =
        await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      await expect(
        ico.write.buyWithERC20(
          [paymentToken.address, parseUnits('2000', PAYMENT_TOKEN_DECIMALS)],
          { account: buyer1.account },
        ),
      ).to.be.rejected;
    });

    it('rejects stale oracle data', async () => {
      const { ico, paymentToken, buyer1, startTime, endTime } =
        await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      await time.increase(25n * 3600n); // past MAX_ORACLE_STALENESS (1 day)

      const paymentAmount = parseUnits('2000', PAYMENT_TOKEN_DECIMALS);
      await paymentToken.write.approve([ico.address, paymentAmount], {
        account: buyer1.account,
      });

      await expect(
        ico.write.buyWithERC20([paymentToken.address, paymentAmount], {
          account: buyer1.account,
        }),
      ).to.be.rejectedWith('PriceTooOld');
    });
  });

  describe('TGE and claiming', () => {
    async function runFullSale() {
      const fixture = await loadFixture(deployICOFixture);
      const { ico, saleToken, buyer1, buyer2, startTime, endTime, tgeDate } =
        fixture;

      await openSale(ico, startTime, endTime);
      await ico.write.buyWithETH({
        value: parseEther('1'),
        account: buyer1.account,
      });
      await ico.write.buyWithETH({
        value: parseEther('2'),
        account: buyer2.account,
      });

      await ico.write.endSale();

      const totalSold = await ico.read.tokensSold();
      await saleToken.write.approve([ico.address, totalSold]);

      return { ...fixture, totalSold };
    }

    it('rejects TGE while the sale is running', async () => {
      const { ico, startTime, endTime } = await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      await expect(ico.write.executeTGE()).to.be.rejectedWith('SaleNotEnded');
    });

    it('pulls all sold tokens into the contract at TGE', async () => {
      const { ico, saleToken, totalSold } = await runFullSale();

      await ico.write.executeTGE();

      expect(await ico.read.tgeExecuted()).to.equal(true);
      expect(await saleToken.read.balanceOf([ico.address])).to.equal(
        totalSold,
      );

      await expect(ico.write.executeTGE()).to.be.rejectedWith(
        'TgeAlreadyExecuted',
      );
    });

    it('unlocks nothing before the TGE date', async () => {
      const { ico, buyer1 } = await runFullSale();
      await ico.write.executeTGE();

      expect(
        await ico.read.getClaimableTokens([buyer1.account.address]),
      ).to.equal(0n);

      await expect(
        ico.write.claimTokens({ account: buyer1.account }),
      ).to.be.rejectedWith('NothingToClaim');
    });

    it('rejects claims before TGE is executed', async () => {
      const { ico, buyer1 } = await runFullSale();

      await expect(
        ico.write.claimTokens({ account: buyer1.account }),
      ).to.be.rejectedWith('TgeNotExecuted');
    });

    it('unlocks exactly the TGE percentage at the TGE date', async () => {
      const { ico, saleToken, buyer1, tgeDate } = await runFullSale();
      await ico.write.executeTGE();
      await time.increaseTo(tgeDate);

      const totalBought = tokensFor(parseEther('1'));
      const tgePortion = tgeAmountFor(totalBought);

      expect(
        await ico.read.getClaimableTokens([buyer1.account.address]),
      ).to.equal(tgePortion);

      await ico.write.claimTokens({ account: buyer1.account });

      expect(
        await saleToken.read.balanceOf([buyer1.account.address]),
      ).to.equal(tgePortion);

      await expect(
        ico.write.claimTokens({ account: buyer1.account }),
      ).to.be.rejectedWith('NothingToClaim');
    });

    it('vests linearly after the cliff and fully at the end', async () => {
      const { ico, saleToken, buyer1, tgeDate } = await runFullSale();
      await ico.write.executeTGE();

      const totalBought = tokensFor(parseEther('1'));
      const tgePortion = tgeAmountFor(totalBought);

      await time.increaseTo(tgeDate + CLIFF_DURATION + VESTING_DURATION / 2n);
      const midClaimable = await ico.read.getClaimableTokens([
        buyer1.account.address,
      ]);
      expect(midClaimable > tgePortion).to.equal(true);
      expect(midClaimable < totalBought).to.equal(true);

      await time.increaseTo(tgeDate + CLIFF_DURATION + VESTING_DURATION);
      expect(
        await ico.read.getClaimableTokens([buyer1.account.address]),
      ).to.equal(totalBought);

      await ico.write.claimTokens({ account: buyer1.account });
      expect(
        await saleToken.read.balanceOf([buyer1.account.address]),
      ).to.equal(totalBought);

      const vesting = await ico.read.getVesting([buyer1.account.address]);
      expect(vesting.claimed).to.equal(totalBought);
    });

    it('returns zero claimable for accounts that never bought', async () => {
      const { ico, outsider } = await runFullSale();
      await ico.write.executeTGE();

      expect(
        await ico.read.getClaimableTokens([outsider.account.address]),
      ).to.equal(0n);
    });
  });

  describe('withdrawals', () => {
    it('blocks withdrawals while the sale is running', async () => {
      const { ico, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);
      await ico.write.buyWithETH({
        value: parseEther('1'),
        account: buyer1.account,
      });

      await expect(ico.write.withdrawFunds()).to.be.rejectedWith(
        'SaleNotEnded',
      );
      await expect(
        ico.write.withdrawUnsoldTokens(),
      ).to.be.rejectedWith('SaleNotEnded');
    });

    it('sends raised ETH to the owner after the sale ends', async () => {
      const { ico, buyer1, publicClient, startTime, endTime } =
        await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);
      await ico.write.buyWithETH({
        value: parseEther('1'),
        account: buyer1.account,
      });
      await ico.write.endSale();

      expect(
        await publicClient.getBalance({ address: ico.address }),
      ).to.equal(parseEther('1'));

      await ico.write.withdrawFunds();

      expect(
        await publicClient.getBalance({ address: ico.address }),
      ).to.equal(0n);
    });

    it('sends raised ERC-20 payments to the owner after the sale ends', async () => {
      const { ico, paymentToken, buyer1, startTime, endTime } =
        await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      const paymentAmount = parseUnits('2000', PAYMENT_TOKEN_DECIMALS);
      await paymentToken.write.approve([ico.address, paymentAmount], {
        account: buyer1.account,
      });
      await ico.write.buyWithERC20([paymentToken.address, paymentAmount], {
        account: buyer1.account,
      });
      await ico.write.endSale();

      const [owner] = await hre.viem.getWalletClients();
      const before = await paymentToken.read.balanceOf([owner.account.address]);

      await ico.write.withdrawERC20([paymentToken.address]);

      const after = await paymentToken.read.balanceOf([owner.account.address]);
      expect(after - before).to.equal(paymentAmount);
    });

    it('refuses to withdraw the sale token through withdrawERC20', async () => {
      const { ico, saleToken, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);
      await ico.write.endSale();

      await expect(
        ico.write.withdrawERC20([saleToken.address]),
      ).to.be.rejectedWith('UseWithdrawUnsoldTokens');
    });

    it('withdraws only tokens not reserved for buyers', async () => {
      const { ico, saleToken, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);
      await ico.write.buyWithETH({
        value: parseEther('1'),
        account: buyer1.account,
      });
      await ico.write.endSale();

      const sold = await ico.read.tokensSold(); // 1000 tokens
      const extra = parseEther('4000');
      await saleToken.write.transfer([ico.address, sold + extra]);

      const [owner] = await hre.viem.getWalletClients();
      const before = await saleToken.read.balanceOf([owner.account.address]);

      await ico.write.withdrawUnsoldTokens();

      const after = await saleToken.read.balanceOf([owner.account.address]);
      expect(after - before).to.equal(extra);
      expect(await saleToken.read.balanceOf([ico.address])).to.equal(sold);
    });

    it('is owner-only', async () => {
      const { ico, buyer1, startTime, endTime } = await loadFixture(
        deployICOFixture,
      );
      await openSale(ico, startTime, endTime);
      await ico.write.endSale();

      await expect(
        ico.write.withdrawFunds({ account: buyer1.account }),
      ).to.be.rejectedWith('OwnableUnauthorizedAccount');
      await expect(
        ico.write.withdrawUnsoldTokens({ account: buyer1.account }),
      ).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });
  });

  describe('status keeper', () => {
    it('finalizes the state after the time window elapses', async () => {
      const { ico, startTime, endTime } = await loadFixture(deployICOFixture);
      await openSale(ico, startTime, endTime);

      await time.increaseTo(endTime + 1n);

      // Purchases and withdrawals already respect the real-time condition
      expect(await ico.read.isSaleOpen()).to.equal(false);
      expect(await ico.read.state()).to.equal(SaleState.Active);

      await ico.write.updateSaleStatus();
      expect(await ico.read.state()).to.equal(SaleState.Ended);
    });

    it('allows early withdrawal once the sale sells out, without endSale()', async () => {
      const { ico, buyer1, startTime, endTime, tgeDate } = await loadFixture(
        deployICOFixture,
      );
      const smallCap = parseEther('1000');
      await ico.write.setRules([
        TOKEN_PRICE,
        MIN_PURCHASE,
        MAX_PURCHASE,
        smallCap,
        tgeDate,
        CLIFF_DURATION,
        VESTING_DURATION,
        INITIAL_UNLOCK_BPS,
      ]);
      await openSale(ico, startTime, endTime);

      await ico.write.buyWithETH({
        value: parseEther('1'),
        account: buyer1.account,
      });

      await ico.write.withdrawFunds();
    });
  });

  describe('whitelist', () => {
    it('is owner-managed and supports batches', async () => {
      const { whitelist, outsider } = await loadFixture(deployICOFixture);

      expect(
        await whitelist.read.isVerified([outsider.account.address]),
      ).to.equal(false);

      await whitelist.write.addToWhitelist([outsider.account.address]);
      expect(
        await whitelist.read.isVerified([outsider.account.address]),
      ).to.equal(true);

      await whitelist.write.removeFromWhitelist([outsider.account.address]);
      expect(
        await whitelist.read.isVerified([outsider.account.address]),
      ).to.equal(false);

      const [, , , other] = await hre.viem.getWalletClients();
      await whitelist.write.addBatchToWhitelist([
        [outsider.account.address, other.account.address],
      ]);
      expect(
        await whitelist.read.isVerified([outsider.account.address]),
      ).to.equal(true);
      expect(
        await whitelist.read.isVerified([other.account.address]),
      ).to.equal(true);

      await expect(
        whitelist.write.addToWhitelist([outsider.account.address], {
          account: outsider.account,
        }),
      ).to.be.rejectedWith('OwnableUnauthorizedAccount');
    });
  });
});
