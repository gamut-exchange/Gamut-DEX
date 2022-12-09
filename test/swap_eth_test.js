const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("ETH Single Swap", () => {
  let GamutFactory;
  let Router;
  let BTC;
  let USD;
  let ZYG;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  let tokens;
  let ETH_ADDRESS = "0x0000000000000000000000000000000000000000";
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
  let Pool;

  before(async () => {
    const btcContract = await ethers.getContractFactory("TestToken");
    BTC = await btcContract.deploy("Bitcoin", "BTC", 18);

    const usdContract = await ethers.getContractFactory("TestToken");
    USD = await usdContract.deploy("USD Token", "USD", 18);

    const wethContract = await ethers.getContractFactory("WETH9");
    WETH = await wethContract.deploy();

    WETH.deposit({ value: toWei(5000) });
  });
  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await provider.getWallets();

    // DEPLOYING CONTRACTS

    const routerContract = await ethers.getContractFactory("Router");

    // Passing in dead address instead of WETH
    Router = await routerContract.deploy(WETH.address);

    const factoryContract = await ethers.getContractFactory("GamutFactory");
    GamutFactory = await factoryContract.deploy(Router.address);

    await Router.setGamutFactory(GamutFactory.address);

    // APPROVING TOKENS TO ROUTER CONTRACT

    let tokensToApprove = [BTC.address, USD.address];

    tokens = [ETH_ADDRESS, USD.address];

    // Need to approve the Router to transfer the tokens!
    for (var i in tokensToApprove) {
      const tokenContract = await ethers.getContractAt(
        "ERC20",
        tokensToApprove[i]
      );
      await tokenContract.approve(
        Router.address,
        web3.utils.toWei("10000000000000000000000000000")
      );
    }

    // CREATING POOL AND INITIALIZING IT

    await GamutFactory.create(
      WETH.address,
      USD.address,
      web3.utils.toWei("0.75"),
      web3.utils.toWei("0.25"),
      web3.utils.toWei("0.001"),
      false
    );

    let poolAddress = await GamutFactory.getPool(WETH.address, USD.address);
    Pool = await ethers.getContractAt("Pool", poolAddress);

    const initialBalances = [toWei("1000"), toWei("2000")];

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

    await expect(
      Router.joinPool(owner.address, joinPoolRequest, {
        value: toWei(1000),
      })
    ).to.emit(Router, "PoolBalanceChanged");
  });

  describe("Eth Swap w/ 18 decimal token", () => {
    it("Swap normal USD for ETH with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = ETH_ADDRESS;
      let amountIn = web3.utils.toWei("10");
      let expectedOutputAmount = web3.utils.toWei("1.653973840518552");
      let weightInAfterSwap = web3.utils.toWei("0.24968936612459888");
      let weightOutAfterSwap = web3.utils.toWei("0.75031063387540112");

      const singleSwap = {
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amount: amountIn,
      };

      const funds = {
        sender: owner.address,
        recipient: addr1.address,
      };

      const limit = web3.utils.toWei("0");
      const deadline = 1673602957;

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.swap(singleSwap, funds, limit, deadline))
        .to.emit(Router, "Swap")
        .withArgs(tokenIn, WETH.address, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
      expect(Number(ethers.utils.formatEther(balance0BeforeSwap))).to.be.equal(
        Number(ethers.utils.formatEther(balance0AfterSwap)) +
          Number(ethers.utils.formatEther(expectedOutputAmount))
      );

      expect(Number(ethers.utils.formatEther(balance1BeforeSwap))).to.be.equal(
        Number(ethers.utils.formatEther(balance1AfterSwap)) -
          Number(ethers.utils.formatEther(amountIn))
      );

      const weightsAfterSwap = await Pool.getWeights();

      expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
    });

    it("Swap normal ETH for USD with zero limit", async () => {
      let tokenIn = ETH_ADDRESS;
      let tokenOut = USD.address;
      let amountIn = web3.utils.toWei("80");
      let expectedOutputAmount = web3.utils.toWei("360.692080568605142");
      let weightInAfterSwap = web3.utils.toWei("0.736248309565077254");
      let weightOutAfterSwap = web3.utils.toWei("0.263751690434922746");

      const singleSwap = {
        tokenIn: tokenIn,
        tokenOut: tokenOut,
        amount: amountIn,
      };

      const funds = {
        sender: owner.address,
        recipient: addr1.address,
      };

      const limit = web3.utils.toWei("0");
      const deadline = 1673602957;

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(
        Router.swap(singleSwap, funds, limit, deadline, { value: toWei(80) })
      )
        .to.emit(Router, "Swap")
        .withArgs(WETH.address, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
      expect(Number(ethers.utils.formatEther(balance0BeforeSwap))).to.be.equal(
        Number(ethers.utils.formatEther(balance0AfterSwap)) -
          Number(ethers.utils.formatEther(amountIn))
      );

      expect(Number(ethers.utils.formatEther(balance1BeforeSwap))).to.be.equal(
        Number(ethers.utils.formatEther(balance1AfterSwap)) +
          Number(ethers.utils.formatEther(expectedOutputAmount))
      );

      const weightsAfterSwap = await Pool.getWeights();

      expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
      expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
    });
  });
});
