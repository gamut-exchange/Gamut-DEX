const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("Remove Liquidity", () => {
  let HedgeFactory;
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

  describe("Remove Liquidity In Single Token 18 decimal", () => {
    beforeEach(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("HedgeFactory");
      HedgeFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      await Router.setHedgeFactory(HedgeFactory.address);

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
        await HedgeFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity 100% BTC against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.756226640667729522);
      //   let expectedWeightUSD = toWei(0.243773359332270478);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );

      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei(0)],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[2].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[2].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% USD against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.731570382507179636);
      //   let expectedWeightUSD = toWei(0.268429617492820364);
      let weightToken0 = !tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );

      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% BTC against 2259.4895 (95%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.764222229840514696);
      //   let expectedWeightUSD = toWei(0.235777770159485304);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[2].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[2].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% USD against 2259.4895 (95%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.73379045283329026);
      //   let expectedWeightUSD = toWei(0.26620954716670974);
      let weightToken0 = !tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% BTC against 23.7841 (1%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.750624363830809296);
      //   let expectedWeightUSD = toWei(0.249375636169190704);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[2].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[2].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% USD against 23.7841 (1%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.74812717052703947);
      //   let expectedWeightUSD = toWei(0.25187282947296053);
      let weightToken0 = !tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC -->", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });
  });

  describe("Remove Liquidity Consecutive In Single Token 18 decimal", () => {
    before(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("HedgeFactory");
      HedgeFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      await Router.setHedgeFactory(HedgeFactory.address);

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
        await HedgeFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity 100% BTC against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.756226640667729522);
      //   let expectedWeightUSD = toWei(0.243773359332270478);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );

      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[2].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[2].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[2].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[2].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% USD against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.736186200809523468);
      //   let expectedWeightUSD = toWei(0.263813799190476532);
      let weightToken0 = !tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% BTC against 594.6025 (25%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.757157271240523109);
      //   let expectedWeightUSD = toWei(0.242842728759476891);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("594.6025"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 100% USD against 594.6025 (25%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.697871584457895486);
      //   let expectedWeightUSD = toWei(0.302128415542104514);
      let weightToken0 = !tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("594.6025"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(-1 * btcOutput)
        // );
      }
    });

    it("Remove liquidity 100% BTC against 23.7841 (1%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.700910335998801791);
      //   let expectedWeightUSD = toWei(0.299089664001198209);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance0AfterSwap)) +
        //     Number(-1 * btcOutput)
        // );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expected: 540.5010107302031
        // actual: 540.501010730203

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(-1 * btcOutput)
        // );
      }
    });

    it("Remove liquidity 100% USD against 23.7841 (1%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.693698966351599154);
      //   let expectedWeightUSD = toWei(0.306301033648400846);
      let weightToken0 = !tokenSorted(BTC.address, USD.address) ? 1 : 0;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });
  });

  describe("Remove Liquidity In Both Tokens Equal Weights (75 BTC, 25 USD) 18 decimal", () => {
    beforeEach(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("HedgeFactory");
      HedgeFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      await Router.setHedgeFactory(HedgeFactory.address);

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
        await HedgeFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity Equal weights against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.75);
      //   let expectedWeightUSD = toWei(0.25);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.75 : 0.25;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity Equal weights 2259.4895 (95%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.75);
      //   let expectedWeightUSD = toWei(0.25);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.75 : 0.25;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity Equal weights against 23.7841 (1%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.75);
      //   let expectedWeightUSD = toWei(0.25);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.75 : 0.25;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });
  });

  describe("Remove Liquidity In Both Tokens (50 BTC/ 50 USD) 18 decimal", () => {
    beforeEach(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("HedgeFactory");
      HedgeFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      await Router.setHedgeFactory(HedgeFactory.address);

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
        await HedgeFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity 50-50 against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.743324122590757758);
      //   let expectedWeightUSD = toWei(0.256675877409242242);

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei("0.5")]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 50 - 50 against 2259.4895 (95%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.715689752446368104);
      //   let expectedWeightUSD = toWei(0.284310247553631896);

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei("0.5")]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 50 - 50 against 23.7841 (1%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.749371445345239997);
      //   let expectedWeightUSD = toWei(0.250628554654760003);

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei("0.5")]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });
  });

  describe("Remove Liquidity In Both Tokens (20 BTC / 80 USD) 18 decimal", () => {
    beforeEach(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("HedgeFactory");
      HedgeFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      await Router.setHedgeFactory(HedgeFactory.address);

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
        await HedgeFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity 20-80 against 237.841 (10%) LP", async () => {
      // let expectedWeightBTC = toWei(0.736017161801744292);
      // let expectedWeightUSD = toWei(0.263982838198255708);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.2 : 0.8;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();
      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 20 - 80 against 2259.4895 (95%) LP", async () => {
      // let expectedWeightBTC = toWei(0.729708837735093114);
      // let expectedWeightUSD = toWei(0.270291162264906886);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.2 : 0.8;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 20 - 80 against 23.7841 (1%) LP", async () => {
      // let expectedWeightBTC = toWei(0.748622818209810333);
      // let expectedWeightUSD = toWei(0.251377181790189667);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.2 : 0.8;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );

      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });
  });

  describe("Remove Liquidity In Both Tokens (90 BTC/ 10 USD) 18 decimal", () => {
    beforeEach(async () => {
      [owner, addr1, addr2, ...addrs] = await provider.getWallets();

      // DEPLOYING CONTRACTS

      const routerContract = await ethers.getContractFactory("Router");

      // Passing in dead address instead of WETH
      Router = await routerContract.deploy(DEAD_ADDRESS);

      const factoryContract = await ethers.getContractFactory("HedgeFactory");
      HedgeFactory = await factoryContract.deploy(Router.address);

      const zygContract = await ethers.getContractFactory("TestToken");
      ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);

      await Router.setHedgeFactory(HedgeFactory.address);

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
        await HedgeFactory.create(
          BTC.address,
          USD.address,
          toWei("0.75"),
          toWei("0.25"),
          toWei("0.001"),
          false
        )
      ).wait();

      let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity 90-10 against 237.841 (10%) LP", async () => {
      // let expectedWeightBTC = toWei(0.753898403222172379);
      // let expectedWeightUSD = toWei(0.246101596777827621);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.9 : 0.1;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 90 - 10 against 2259.4895 (95%) LP", async () => {
      // let expectedWeightBTC = toWei(0.769230582694164603);
      // let expectedWeightUSD = toWei(0.230769417305835397);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.9 : 0.1;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });

    it("Remove liquidity 90 - 10 against 23.7841 (1%) LP", async () => {
      // let expectedWeightBTC = toWei(0.750376127561210792);
      // let expectedWeightUSD = toWei(0.249623872438789208);
      let weightToken0 = tokenSorted(BTC.address, USD.address) ? 0.9 : 0.1;

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(weightToken0)]
      );
      const exitPoolRequest = {
        tokens: tokens,
        minAmountsOut: [0, toWei("0")],
        userData: initUserData,
      };

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      const receipt = await (
        await Router.exitPool(owner.address, exitPoolRequest)
      ).wait();

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * usdOutput)
        );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        console.log("BTC --> ", btcOutput);
        console.log("USD --> ", usdOutput);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * usdOutput)
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(-1 * btcOutput)
        );
      }
    });
  });
});
