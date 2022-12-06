const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("Batch Swap 18 decimal pools", () => {
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
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
  let Pool;

  before(async () => {
    const btcContract = await ethers.getContractFactory("TestToken");
    BTC = await btcContract.deploy("Bitcoin", "BTC", 18);

    const usdContract = await ethers.getContractFactory("TestToken");
    USD = await usdContract.deploy("USD Token", "USD", 18);

    const zygContract = await ethers.getContractFactory("TestToken");
    ZYG = await zygContract.deploy("Zygnus", "ZYG", 18);

    const gamutContract = await ethers.getContractFactory("TestToken");
    GAMUT = await gamutContract.deploy("GAMUT", "GMT", 18);
  });

  beforeEach(async () => {
    [owner, addr1, addr2, ...addrs] = await provider.getWallets();

    // DEPLOYING CONTRACTS

    const routerContract = await ethers.getContractFactory("Router");

    // Passing in dead address instead of WETH
    Router = await routerContract.deploy(DEAD_ADDRESS);

    const factoryContract = await ethers.getContractFactory("GamutFactory");
    GamutFactory = await factoryContract.deploy(Router.address);

    await Router.setGamutFactory(GamutFactory.address);

    // APPROVING TOKENS TO ROUTER CONTRACT

    let tokensToApprove = [
      BTC.address,
      USD.address,
      ZYG.address,
      GAMUT.address,
    ];

    tokensPoolOne = tokenSorted(BTC.address, USD.address)
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
        web3.utils.toWei("10000000000000000000000000000")
      );
    }

    // CREATING POOL AND INITIALIZING IT

    const receipt = await (
      await GamutFactory.create(
        BTC.address,
        USD.address,
        web3.utils.toWei("0.75"),
        web3.utils.toWei("0.25"),
        web3.utils.toWei("0.001"),
        false
      )
    ).wait();

    let poolOneAddress = await GamutFactory.getPool(BTC.address, USD.address);
    PoolOne = await ethers.getContractAt("Pool", poolOneAddress);

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
      tokens: tokensPoolOne,
      maxAmountsIn: initialBalances,
      userData: initUserData,
    };

    await expect(Router.joinPool(owner.address, joinPoolRequest)).to.emit(
      Router,
      "PoolBalanceChanged"
    );

    // SETTING UP ANOTHER POOL AND INITIALIZING IT

    tokensPoolTwo = tokenSorted(ZYG.address, USD.address)
      ? [ZYG.address, USD.address]
      : [USD.address, ZYG.address];

    await GamutFactory.create(
      ZYG.address,
      USD.address,
      web3.utils.toWei("0.75"),
      web3.utils.toWei("0.25"),
      web3.utils.toWei("0.001"),
      false
    );

    let poolTwoAddress = await GamutFactory.getPool(ZYG.address, USD.address);
    PoolTwo = await ethers.getContractAt("Pool", poolTwoAddress);

    // Values must be decimal-normalized! (USDT has 6 decimals)
    const initialBalancesPoolTwo = tokenSorted(ZYG.address, USD.address)
      ? [toWei("1000"), toWei("2000")]
      : [toWei("2000"), toWei("1000")];

    // Construct userData
    const JOIN_KIND_INIT_POOL_TWO = 0;
    const initUserDataPoolTwo = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256[]"],
      [JOIN_KIND_INIT_POOL_TWO, initialBalancesPoolTwo]
    );

    const joinPoolRequestPoolTwo = {
      tokens: tokensPoolTwo,
      maxAmountsIn: initialBalancesPoolTwo,
      userData: initUserDataPoolTwo,
    };

    await expect(
      Router.joinPool(owner.address, joinPoolRequestPoolTwo)
    ).to.emit(Router, "PoolBalanceChanged");

    // SETTING UP ANOTHER POOL AND INITIALIZING IT

    tokensPoolThree = tokenSorted(ZYG.address, GAMUT.address)
      ? [ZYG.address, GAMUT.address]
      : [GAMUT.address, ZYG.address];

    await GamutFactory.create(
      ZYG.address,
      GAMUT.address,
      web3.utils.toWei("0.75"),
      web3.utils.toWei("0.25"),
      web3.utils.toWei("0.001"),
      false
    );

    let poolThreeAddress = await GamutFactory.getPool(
      ZYG.address,
      GAMUT.address
    );
    PoolThree = await ethers.getContractAt("Pool", poolThreeAddress);

    // Values must be decimal-normalized! (USDT has 6 decimals)
    const initialBalancesPoolThree = tokenSorted(ZYG.address, USD.address)
      ? [toWei("1000"), toWei("2000")]
      : [toWei("2000"), toWei("1000")];

    // Construct userData
    const JOIN_KIND_INIT_POOL_THREE = 0;
    const initUserDataPoolThree = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256[]"],
      [JOIN_KIND_INIT_POOL_THREE, initialBalancesPoolThree]
    );

    const joinPoolRequestPoolThree = {
      tokens: tokensPoolThree,
      maxAmountsIn: initialBalancesPoolThree,
      userData: initUserDataPoolThree,
    };

    await expect(
      Router.joinPool(owner.address, joinPoolRequestPoolThree)
    ).to.emit(Router, "PoolBalanceChanged");
  });

  describe("Batch Swap in 18 decimal pool", () => {
    it("Batch Swap BTC > USD > ZYG", async () => {
      let amountIn = web3.utils.toWei("10");

      const batchSwap = [
        {
          assetInIndex: 0,
          assetOutIndex: 1,
          amount: amountIn,
        },
        {
          assetInIndex: 1,
          assetOutIndex: 2,
          amount: 0, // use amount from the previous swap
        },
      ];

      const assets = [BTC.address, USD.address, ZYG.address];

      const funds = {
        sender: owner.address,
        recipient: addr1.address,
      };

      const limits = [amountIn, 0, 0];
      const deadline = 1673602957;

      await expect(
        Router.batchSwap(batchSwap, assets, funds, limits, deadline)
      ).to.emit(Router, "Swap");
    });

    it("Batch Swap BTC > USD > ZYG > Gamut", async () => {
      let amountIn = web3.utils.toWei("10");

      const batchSwap = [
        {
          assetInIndex: 0,
          assetOutIndex: 1,
          amount: amountIn,
        },
        {
          assetInIndex: 1,
          assetOutIndex: 2,
          amount: 0, // use amount from the previous swap
        },
        {
          assetInIndex: 2,
          assetOutIndex: 3,
          amount: 0, // use amount from the previous swap
        },
      ];

      const assets = [BTC.address, USD.address, ZYG.address, GAMUT.address];

      const funds = {
        sender: owner.address,
        recipient: addr1.address,
      };

      const limits = [amountIn, 0, 0, 0];
      const deadline = 1673602957;

      await expect(
        Router.batchSwap(batchSwap, assets, funds, limits, deadline)
      ).to.emit(Router, "Swap");
    });
  });
});
