const { expect } = require("chai");
const { utils } = require("ethers");
const { cp } = require("fs");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("Hedge Factory + Router + Vault + Tokens", function () {
  let HedgeFactory;
  let Router;
  let BTC;
  let USD;
  let WETH;
  let owner;
  let addr1;
  let addr2;
  let addrs;
  let tokens;
  const DEAD_ADDRESS = "0x000000000000000000000000000000000000dead";
  const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
  let Pool;

  before(async () => {
    const btcContract = await ethers.getContractFactory("TestToken");
    BTC = await btcContract.deploy("Bitcoin", "BTC", 18);

    // const usdContract = await ethers.getContractFactory("TestToken");
    // USD = await usdContract.deploy("USD Token", "USD", 18);

    const wethContract = await ethers.getContractFactory("WETH9");
    WETH = await wethContract.deploy();

    [owner, addr1, addr2, ...addrs] = await provider.getWallets();

    // DEPLOYING CONTRACTS

    const routerContract = await ethers.getContractFactory("Router");

    Router = await routerContract.deploy(WETH.address);

    const factoryContract = await ethers.getContractFactory("HedgeFactory");
    HedgeFactory = await factoryContract.deploy(Router.address);

    await Router.setHedgeFactory(HedgeFactory.address);
  });

  it("Create and Initialize BTC-WETH Pool", async () => {
    // APPROVING TOKENS TO ROUTER CONTRACT

    let tokensToApprove = [BTC.address, WETH.address];
    tokens = tokenSorted(BTC.address, WETH.address)
      ? [BTC.address, WETH.address]
      : [WETH.address, BTC.address];

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
      await HedgeFactory.create(
        BTC.address,
        WETH.address,
        web3.utils.toWei("0.75"),
        web3.utils.toWei("0.25"),
        web3.utils.toWei("0.001"),
        false
      )
    ).wait();

    let poolAddress = await HedgeFactory.getPool(BTC.address, WETH.address);
    Pool = await ethers.getContractAt("Pool", poolAddress);
    const initialBalances = tokenSorted(BTC.address, WETH.address)
      ? [toWei(1000), toWei(2000)]
      : [toWei(2000), toWei(1000)];

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

  it("Add single token liquidity ETH", async () => {
    ////////////
    // actual BTC join = 592.774384680155651788;
    // actual USD join = 658.264242739432308;
    // let expectedWeightBTC = toWei(0.719337095662402656);
    // let expectedWeightUSD = toWei(0.280662904337597344);
    // LP Tokens = 1222.153942384396670279;
    // console.log("a", HedgeFactory.address);
    // console.log(WETH.address);
    // let poolAddress = await HedgeFactory.getPool(BTC.address, WETH.address);
    // console.log(poolAddress);

    let joinAmount = toWei(10);

    let joinTokenIndex = !tokenSorted(BTC.address, WETH.address) ? 0 : 1;

    let maxAmountsIn = tokenSorted(BTC.address, WETH.address)
      ? [0, toWei(10)]
      : [toWei(10), 0];

    let joinToken = tokenSorted(BTC.address, WETH.address)
      ? [BTC.address, ZERO_ADDRESS]
      : [ZERO_ADDRESS, BTC.address];

    const JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT = 2;
    const initUserData = ethers.utils.defaultAbiCoder.encode(
      ["uint256", "uint256", "uint256", "uint256"],
      [
        JOIN_KIND_TOKEN_IN_FOR_EXACT_BPT_OUT,
        joinAmount,
        joinTokenIndex,
        toWei(0),
      ]
    );

    const joinPoolRequest = {
      tokens: joinToken,
      maxAmountsIn: maxAmountsIn,
      userData: initUserData,
    };

    // await expect(
    //   Router.joinPool(owner.address, joinPoolRequest, {
    //     value: joinAmount,
    //   })
    // ).to.emit(Router, "PoolBalanceChanged");

    console.log(
      "ETH Balance before tx -->",
      await ethers.utils.formatEther(await provider.getBalance(owner.address))
    );

    const receipt = await (
      await Router.joinPool(owner.address, joinPoolRequest, {
        value: joinAmount,
      })
    ).wait();

    console.log(
      "Amount In Token 0 --> ",
      ethers.utils.formatEther(receipt.events[2].args[2][0])
    );
    console.log(
      "Amount In Token 1 --> ",
      ethers.utils.formatEther(receipt.events[2].args[2][1])
    );

    console.log(
      "ETH Balance after tx -->",
      await ethers.utils.formatEther(await provider.getBalance(owner.address))
    );
  });
});
