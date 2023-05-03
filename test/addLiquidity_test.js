const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");

const { toWei, tokenSorted } = require("./helper");

describe("Add Liquidity", () => {
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

  describe("Add Liquidity Single Token 18 decimal", () => {
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

    it("Add Liquidity high BTC only", async () => {
      // actual BTC join = 592.774384680155651788;
      // actual USD join = 658.264242739432308;
      // let expectedWeightBTC = toWei(0.719337095662402656);
      // let expectedWeightUSD = toWei(0.280662904337597344);
      // LP Tokens = 1222.153942384396670279;

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;

      let joinAmount = toWei("800");
      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

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

    it("Add Liquidity normal BTC only", async () => {
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
      if (tokenSorted(BTC.address, USD.address)) {
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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity low BTC only", async () => {
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity high USD only", async () => {
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity normal USD only", async () => {
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity low USD only", async () => {
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });
  });

  describe("Add Liquidity Consecutive Single Token 18 decimal", () => {
    before(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("GamutFactory");
      GamutFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

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
    });

    it("Add Liquidity high BTC only", async () => {
      // actual BTC join = 592.774384680155651788;
      // actual USD join = 658.264242739432308;
      // let expectedWeightBTC = toWei(0.719337095662402656);
      // let expectedWeightUSD = toWei(0.280662904337597344);
      // LP Tokens = 1222.153942384396670279;

      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;
      let joinAmount = toWei("800");
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity normal BTC only", async () => {
      // actual BTC join = 358.944836491620292433;
      // actual USD join = 311.885009085696266;
      // let expectedWeightBTC = toWei(0.704783761406047731);
      // let expectedWeightUSD = toWei(0.295216238593952269);
      // LP Tokens = 671.160489155530295637;

      let joinAmount = toWei("500");
      let maxAmountsIn = tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];
      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;

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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity low BTC only", async () => {
      // actual BTC join = 0.0007047837546161;
      // actual USD join = 0.000612242317414;
      // let expectedWeightBTC = toWei(0.704783734726776241);
      // let expectedWeightUSD = toWei(0.295216265273223759);
      // LP Tokens = 0.001308589114997635;

      let joinAmount = toWei(0.001);
      let maxAmountsIn = tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];
      let joinTokenIndex = tokenSorted(BTC.address, USD.address) ? 0 : 1;

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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity high USD only", async () => {
      // actual BTC join = 290.088057041507642121;
      // actual USD join = 454.273786594701721216;
      // let expectedWeightBTC = toWei(0.734813280064022644);
      // let expectedWeightUSD = toWei(0.265186719935977356);
      // LP Tokens = 649.533808728504954623;

      let joinAmount = toWei(1600);
      let maxAmountsIn = !tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];
      let joinTokenIndex = !tokenSorted(BTC.address, USD.address) ? 0 : 1;

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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity normal USD only", async () => {
      // actual BTC join = 131.609216532429892502;
      // actual USD join = 263.420466058546171852;
      // let expectedWeightBTC = toWei(0.746640354196785225);
      // let expectedWeightUSD = toWei(0.253359645803214775);
      // LP Tokens = 301.364211949477048289;

      let joinAmount = toWei(1000);
      let maxAmountsIn = !tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];
      let joinTokenIndex = !tokenSorted(BTC.address, USD.address) ? 0 : 1;

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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity low USD only", async () => {
      // actual BTC join = 0.000126553153437186;
      // actual USD join = 0.000253359611451608;
      // let expectedWeightBTC = toWei(0.746640364605422455);
      // let expectedWeightUSD = toWei(0.253359635394577545);
      // LP Tokens = 0.000287437847000802;

      let joinAmount = toWei(0.001);
      let maxAmountsIn = !tokenSorted(BTC.address, USD.address)
        ? [joinAmount, 0]
        : [0, joinAmount];
      let joinTokenIndex = !tokenSorted(BTC.address, USD.address) ? 0 : 1;

      const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256", "uint256", "uint256"],
        [
          JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
          joinAmount,
          joinTokenIndex,
          toWei("0.000001"),
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

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

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

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmount))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });
  });

  describe("Add Liquidity Two Token 18 decimal", () => {
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
    });

    it("Add Liquidity in (75% BTC amount and 25% USD amount)", async () => {
      // actual BTC join = 179.71922823444930921;
      // actual USD join = 304.198583795773466;
      // let expectedWeightBTC = toWei(0.741910492415382308);
      // let expectedWeightUSD = toWei(0.258089507584617692);
      // LP Tokens = 410.330661170072737899;

      let joinAmounts = tokenSorted(BTC.address, USD.address)
        ? [toWei("225"), toWei("75")]
        : [toWei("75"), toWei("225")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity extreme BTC low USD", async () => {
      // actual BTC join = 373.439651062575305881;
      // actual USD join = 498.094953715690654;
      // let expectedWeightBTC = toWei(0.729383050356911248);
      // let expectedWeightUSD = toWei(0.270616949643088752);
      // LP Tokens = 805.28185405327309263

      let joinAmounts = tokenSorted(BTC.address, USD.address)
        ? [toWei("500"), toWei("2")]
        : [toWei("2"), toWei("500")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity equal amount", async () => {
      // actual BTC join = 177.263404928510694584;
      // actual USD join = 324.836531107968392;
      // let expectedWeightBTC = toWei(0.745839145053919955);
      // let expectedWeightUSD = toWei(0.254160854946080045);
      // LP Tokens = 412.582737747589807636

      let joinAmounts = [toWei("200"), toWei("200")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity extreme USD low BTC", async () => {
      // actual BTC join = 114.355534942229228;
      // actual USD join = 433.87348443688579687;
      // let expectedWeightBTC = toWei(0.773733221611759719);
      // let expectedWeightUSD = toWei(0.226266778388240281);
      // LP Tokens = 325.284259050440435053

      let joinAmounts = tokenSorted(BTC.address, USD.address)
        ? [toWei("2"), toWei("1800")]
        : [toWei("1800"), toWei("2")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity Two Token equal extreme amount", async () => {
      // actual BTC join = 1680.527219337365595661;
      // actual USD join = 2277.92064105553439;
      // let expectedWeightBTC = toWei(0.730375504148032578);
      // let expectedWeightUSD = toWei(0.269624495851967422);
      // LP Tokens = 3620.360030441938294606

      let joinAmounts = [toWei("1800"), toWei("1800")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity Two Token equal low amount", async () => {
      // actual BTC join = 0.000875000060816487;
      // actual USD join = 0.001749249241216;
      // let expectedWeightBTC = toWei(0.749999976585952441);
      // let expectedWeightUSD = toWei(0.250000023414047559);
      // LP Tokens = 0.002080889142784623

      let joinAmounts = [toWei("0.001"), toWei("0.001")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("0.0001")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });
  });

  describe("Add Liquidity Consecutive Two Token 18 decimal", () => {
    before(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("GamutFactory");
      GamutFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

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
    });

    it("Add Liquidity in (75% BTC amount and 25% USD amount)", async () => {
      // actual BTC join = 179.71922823444930921;
      // actual USD join = 304.198583795773466;
      // let expectedWeightBTC = toWei(0.741910492415382308);
      // let expectedWeightUSD = toWei(0.258089507584617692);
      // LP Tokens = 410.330661170072737899

      let joinAmounts = tokenSorted(BTC.address, USD.address)
        ? [toWei("225"), toWei("75")]
        : [toWei("75"), toWei("225")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity extreme BTC low USD", async () => {
      // actual BTC join = 370.014557540990237061;
      // actual USD join = 445.210850204530172575;
      // let expectedWeightBTC = toWei(0.723818473182622915);
      // let expectedWeightUSD = toWei(0.276181526817377085);
      // LP Tokens = 773.207671291853645524

      let joinAmounts = tokenSorted(BTC.address, USD.address)
        ? [toWei("500"), toWei("2")]
        : [toWei("2"), toWei("500")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity equal amount", async () => {
      // actual BTC join = 191.46100409959797227;
      // actual USD join = 226.444341380624278832;
      // let expectedWeightBTC = toWei(0.722834800874553513);
      // let expectedWeightUSD = toWei(0.277165199125446487);
      // LP Tokens = 393.403102450696856844

      let joinAmounts = [toWei("200"), toWei("200")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity extreme USD low BTC", async () => {
      // actual BTC join = 228.092692955255647675;
      // actual USD join = 482.815271760604522869;
      // let expectedWeightBTC = toWei(0.749496915748820026);
      // let expectedWeightUSD = toWei(0.250503084251179974);
      // LP Tokens = 558.524636090249489759

      let joinAmounts = tokenSorted(BTC.address, USD.address)
        ? [toWei("2"), toWei("1800")]
        : [toWei("1800"), toWei("2")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity Two Token equal extreme amount", async () => {
      // actual BTC join = 1634.183198802444043835;
      // actual USD join = 2574.242753037872605686;
      // let expectedWeightBTC = toWei(0.734786442330469398);
      // let expectedWeightUSD = toWei(0.265213557669530602);
      // LP Tokens = 3556.449215371150600261

      let joinAmounts = [toWei("1800"), toWei("1800")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("50")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });

    it("Add Liquidity Two Token equal low amount", async () => {
      // actual BTC join = 0.000902976164470764;
      // actual USD join = 0.001423453313468368;
      // let expectedWeightBTC = toWei(0.734786437262414405);
      // let expectedWeightUSD = toWei(0.265213562737585595);
      // LP Tokens = 0.001955121703995264

      let joinAmounts = [toWei("0.001"), toWei("0.001")];

      const EXACT_TOKENS_IN_FOR_BPT_OUT = 1;
      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256[]", "uint256"],
        [EXACT_TOKENS_IN_FOR_BPT_OUT, joinAmounts, toWei("0.0001")]
      );

      const joinPoolRequest = {
        tokens: tokens,
        maxAmountsIn: joinAmounts,
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
        Router,
        "PoolBalanceChanged"
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      } else {
        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[1]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance0AfterSwap)));

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap)) +
            Number(ethers.utils.formatEther(joinAmounts[0]))
        ).to.be.equal(Number(ethers.utils.formatEther(balance1AfterSwap)));
      }
    });
  });
});
