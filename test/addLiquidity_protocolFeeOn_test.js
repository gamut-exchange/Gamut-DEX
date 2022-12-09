const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");

const { toWei, tokenSorted } = require("./helper");
const { join } = require("path");

describe("Add Liquidity w/ Protocol Fee On", () => {
  let GamutFactory;
  let Router;
  let BTC;
  let USD;
  let ZYG;
  let owner;
  let addr1;
  let addr2;
  let addrs;

  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
  const POOL_SWAP_FEE_PERCENTAGE = toWei("0.001");

  before(async () => {
    const btcContract = await ethers.getContractFactory("TestToken");
    BTC = await btcContract.deploy("Bitcoin", "BTC", 18);

    const usdContract = await ethers.getContractFactory("TestToken");
    USD = await usdContract.deploy("USD Token", "USD", 18);
  });

  describe("Add Liquidity w/ Protocol Fee on Single Join 18 decimal", () => {
    beforeEach(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("GamutFactory");
      GamutFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      const protocolFeesCollectorContract = await ethers.getContractFactory(
        "ProtocolFeesCollector"
      );
      ProtocolFeesCollector = await protocolFeesCollectorContract.deploy();

      await ProtocolFeesCollector.setSwapFeePercentage(
        web3.utils.toWei("0.01")
      ); // 1%
      await GamutFactory.setProtocolFeeCollector(ProtocolFeesCollector.address);
      await Router.setGamutFactory(GamutFactory.address);

      // APPROVING TOKENS TO ROUTER CONTRACT

      let tokensToApprove = [BTC.address, USD.address, ZYG.address];

      tokens = tokenSorted(BTC.address, USD.address)
        ? [BTC.address, USD.address]
        : [USD.address, BTC.address];

      // Need to approve the Router to transfer the tokens!
      for (var i in tokensToApprove) {
        const tokenContract = await ethers.getContractAt(
          "ERC20",
          tokensToApprove[i]
        );
        await tokenContract.approve(
          Router.address,
          toWei("10000000000000000000000000000")
        );
      }

      // CREATING POOL AND INITIALIZING IT

      const receipt = await (
        await GamutFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await GamutFactory.getPool(BTC.address, USD.address);
      Pool = await ethers.getContractAt("Pool", poolAddress);

      // Values must be decimal-normalized! (USDT has 6 decimals)
      const initialBalances = tokenSorted(BTC.address, USD.address)
        ? [toWei("1000"), toWei("2000")]
        : [toWei("2000"), toWei("1000")];

      // Construct userData
      const JOIN_KIND_INIT = 0;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]"],
        [JOIN_KIND_INIT, initialBalances]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: initialBalances,
        userData: initUserData,
      };

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      // LP tokens for Initiaizing: 2378.41423000539456302
    });

    it("Add Liquidity w/ Fee high BTC only", async () => {
      // actual BTC join = 592.774384680155651788;
      // actual USD join = 658.264242739432308;
      // let expectedWeightBTC = toWei(0.719337095662402656);
      // let expectedWeightUSD = toWei(0.280662904337597344);
      // LP Tokens = 1222.153942384396670279;

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;

      let joinAmount = toWei("800");
      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;

      let expectedAmountIn = tokenSorted(BTC.address, USD.address)
        ? [toWei(800), 0]
        : [0, toWei(800)];
      let expectedProtocolFee = tokenSorted(BTC.address, USD.address)
        ? [toWei(0.002072256153198444), 0]
        : [0, toWei(0.002072256153198444)];

      let maxAmountsIn = tokenSorted(BTC.address, USD.address)
        ? [toWei(850), 0]
        : [0, toWei(850)];

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("50"),
        ]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: maxAmountsIn,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      // const receipt = await (
      //   await Router.joinPool(owner.address, joinPoolRequest)
      // ).wait();

      // console.log(
      //   "Add Liquidity high BTC  --> ",
      //   ethers.utils.formatEther(receipt.events[3].args[2][0])
      // );
      // console.log(
      //   "Add Liquidity high BTC (USD) --> ",
      //   ethers.utils.formatEther(receipt.events[3].args[2][1])
      // );

      await expect(Router.joinPool(owner.address, joinPoolRequest))
        .to.emit(Router, "PoolBalanceChanged")
        .withArgs(owner.address, tokens, expectedAmountIn, expectedProtocolFee);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out

      if (tokenSorted(BTC.address, USD.address)) {
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap)) +
        //     Number(ethers.utils.formatEther(joinAmount))
        // ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightUSD);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightBTC);
      }
    });

    it("Add Liquidity w/ Fee normal BTC only", async () => {
      // actual BTC join = 373.048330761394228859;
      // actual USD join = 497.076015328899546;
      // let expectedWeightBTC = toWei(0.729328794220517433);
      // let expectedWeightUSD = toWei(0.270671205779482567);
      // LP Tokens = 804.252315434022777757;

      let joinAmount = toWei("500");
      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;
      let maxAmountsIn = tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];
      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("50"),
        ]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: maxAmountsIn,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      let expectedProtocolFee = tokenSorted(BTC.address, USD.address)
        ? [toWei(0.001269516692386058), 0]
        : [0, toWei(0.001269516692386058)];

      await expect(Router.joinPool(owner.address, joinPoolRequest))
        .to.emit(Router, "PoolBalanceChanged")
        .withArgs(owner.address, tokens, maxAmountsIn, expectedProtocolFee);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
      if (tokenSorted(BTC.address, USD.address)) {
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap)) +
        //     Number(ethers.utils.formatEther(joinAmount))
        // ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity w/ Fee low BTC only", async () => {
      // actual BTC join = 0.000749999997499794;
      // actual USD join = 0.001498498497986;
      // let expectedWeightBTC = toWei(0.749999953171886853);
      // let expectedWeightUSD = toWei(0.250000046828113147);
      // LP Tokens = 0.001783363886356329;

      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;
      let joinAmount = toWei("0.001");
      let maxAmountsIn = tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("0"),
        ]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: maxAmountsIn,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      let expectedProtocolFee = tokenSorted(BTC.address, USD.address)
        ? [web3.utils.toWei("0.000000002500000026"), 0]
        : [0, web3.utils.toWei("0.000000002500000026")];

      await expect(Router.joinPool(owner.address, joinPoolRequest))
        .to.emit(Router, "PoolBalanceChanged")
        .withArgs(owner.address, tokens, maxAmountsIn, expectedProtocolFee);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap)) +
        //     Number(ethers.utils.formatEther(joinAmount))
        // ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity w/ Fee high USD only", async () => {
      // actual BTC join = 106.513151901785099;
      // actual USD join = 383.6396623885146327;
      // let expectedWeightBTC = toWei(0.772351997708856489);
      // let expectedWeightUSD = toWei(0.227648002291143511);
      // LP Tokens = 298.171597242507017475;

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;

      let joinTokenIndex = !tokenSorted(BTC.address, USD.address) ? 0 : 1;
      let joinAmount = toWei("1600");
      let maxAmountsIn = !tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("50"),
        ]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: maxAmountsIn,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      let expectedProtocolFee = tokenSorted(BTC.address, USD.address)
        ? [0, web3.utils.toWei("0.012163603376114854")]
        : [web3.utils.toWei("0.012163603376114854"), 0];

      await expect(Router.joinPool(owner.address, joinPoolRequest))
        .to.emit(Router, "PoolBalanceChanged")
        .withArgs(owner.address, tokens, maxAmountsIn, expectedProtocolFee);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (!tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap)) +
        //     Number(ethers.utils.formatEther(joinAmount))
        // ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity w/ Fee normal USD only", async () => {
      // actual BTC join = 81.689228046110761;
      // actual USD join = 245.22197217032325469;
      // let expectedWeightBTC = toWei(0.766679244898822618);
      // let expectedWeightUSD = toWei(0.233320755101177382);
      // LP Tokens = 216.660571828540639075;

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;

      let joinTokenIndex = !tokenSorted(BTC.address, USD.address) ? 0 : 1;
      let joinAmount = toWei("1000");
      let maxAmountsIn = !tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("50"),
        ]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: maxAmountsIn,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      let expectedProtocolFee = tokenSorted(BTC.address, USD.address)
        ? [0, web3.utils.toWei("0.007547780278296768")]
        : [web3.utils.toWei("0.007547780278296768"), 0];

      await expect(Router.joinPool(owner.address, joinPoolRequest))
        .to.emit(Router, "PoolBalanceChanged")
        .withArgs(owner.address, tokens, maxAmountsIn, expectedProtocolFee);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (!tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap)) +
        //     Number(ethers.utils.formatEther(joinAmount))
        // ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity w/ Fee low USD only", async () => {
      // actual BTC join = 0.000124874930121;
      // actual USD join = 0.000249999984998059;
      // let expectedWeightBTC = toWei(0.750000023414052321);
      // let expectedWeightUSD = toWei(0.249999976585947679);
      // LP Tokens = 0.00029707856994089;

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;

      let joinTokenIndex = !tokenSorted(BTC.address, USD.address) ? 0 : 1;
      let joinAmount = toWei("0.001");
      let maxAmountsIn = !tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("0.0001"),
        ]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: maxAmountsIn,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      let expectedProtocolFee = tokenSorted(BTC.address, USD.address)
        ? [0, web3.utils.toWei("0.000000007500000151")]
        : [web3.utils.toWei("0.000000007500000151"), 0];

      await expect(Router.joinPool(owner.address, joinPoolRequest))
        .to.emit(Router, "PoolBalanceChanged")
        .withArgs(owner.address, tokens, maxAmountsIn, expectedProtocolFee);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (!tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap)) +
        //     Number(ethers.utils.formatEther(joinAmount))
        // ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });
  });
});
