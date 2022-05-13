const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");

describe("Hedge Factory", () => {
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
  const POOL_SWAP_FEE_PERCENTAGE = web3.utils.toWei("0.001");

  before(async () => {
    [owner, addr1, addr2, ...addrs] = await provider.getWallets();
    console.log("Owner Address --> ", owner.address);

    const routerContract = await ethers.getContractFactory("Router");

    // Passing in dead address instead of WETH
    Router = await routerContract.deploy(DEAD_ADDRESS);

    const factoryContract = await ethers.getContractFactory("HedgeFactory");
    HedgeFactory = await factoryContract.deploy(Router.address);

    const btcContract = await ethers.getContractFactory("TestToken");
    BTC = await btcContract.deploy("Bitcoin", "BTC", 18);

    const usdContract = await ethers.getContractFactory("TestToken");
    USD = await usdContract.deploy("USD Token", "USD", 18);

    const zygContract = await ethers.getContractFactory("TestToken");
    ZYG = await zygContract.deploy("Zygnus", "ZYG", 9);
  });

  describe("Pools Creation", () => {
    it("Create Pool with normal weights", async () => {
      // const receipt = await (
      //   await HedgeFactory.create(
      //     BTC.address,
      //     USD.address,
      //     web3.utils.toWei("0.75"),
      //     web3.utils.toWei("0.25"),
      //     web3.utils.toWei("0.001"),
      //     false
      //   )
      // ).wait();
      // expect(receipt.events[1].event).to.equal("PoolCreated");

      await expect(
        HedgeFactory.create(
          BTC.address,
          USD.address,
          web3.utils.toWei("0.75"),
          web3.utils.toWei("0.25"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.emit(HedgeFactory, "PoolCreated");
    });

    describe("Pool Constructor arguments", () => {
      let Pool;
      before("Load Pool Address", async () => {
        let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
        Pool = await ethers.getContractAt("Pool", poolAddress);
      });

      it("sets the vault", async () => {
        expect(await Pool.getRouter()).to.equal(Router.address);
      });

      it("starts with no LP tokens", async () => {
        expect(await Pool.totalSupply()).to.be.equal(0);
      });

      it("sets swap fee", async () => {
        expect(await Pool.getSwapFeePercentage()).to.equal(
          POOL_SWAP_FEE_PERCENTAGE
        );
      });

      it("sets the owner ", async () => {
        expect(await Pool._owner()).to.equal(owner.address);
      });

      it("sets the name", async () => {
        expect(await Pool.name()).to.equal("Hedge Pool Token");
      });

      it("sets the symbol", async () => {
        expect(await Pool.symbol()).to.equal("HT");
      });

      it("sets the decimals", async () => {
        expect(await Pool.decimals()).to.equal(18);
      });
    });
  });

  describe("Revert Pool Creation", () => {
    it("Reverts: Create pool with existing pair", async () => {
      await expect(
        HedgeFactory.create(
          BTC.address,
          USD.address,
          web3.utils.toWei("0.75"),
          web3.utils.toWei("0.25"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.be.revertedWith("ZYG#701");
    });

    it("Reverts: Create pool with weights sum more than one", async () => {
      await expect(
        HedgeFactory.create(
          ZYG.address,
          BTC.address,
          web3.utils.toWei("0.85"),
          web3.utils.toWei("0.25"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.be.revertedWith("ZYG#303");
    });

    it("Reverts: Create pool with weights sum less than one", async () => {
      await expect(
        HedgeFactory.create(
          ZYG.address,
          BTC.address,
          web3.utils.toWei("0.5"),
          web3.utils.toWei("0.25"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.be.revertedWith("ZYG#303");
    });

    it("Reverts: Create pool with weight of a token less than Minimum weight allowed", async () => {
      await expect(
        HedgeFactory.create(
          ZYG.address,
          BTC.address,
          web3.utils.toWei("0.1"),
          web3.utils.toWei("0.9"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.be.revertedWith("ZYG#300");
    });

    it("Reverts: Create pool with identical address", async () => {
      await expect(
        HedgeFactory.create(
          BTC.address,
          BTC.address,
          web3.utils.toWei("0.3"),
          web3.utils.toWei("0.7"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.be.revertedWith("ZYG#700");
    });

    it("Reverts: Create pool with zero address", async () => {
      await expect(
        HedgeFactory.create(
          ZERO_ADDRESS,
          BTC.address,
          web3.utils.toWei("0.3"),
          web3.utils.toWei("0.7"),
          POOL_SWAP_FEE_PERCENTAGE,
          false
        )
      ).to.be.revertedWith("ZYG#102");
    });

    it("Reverts: Create pool with high swap fee", async () => {
      await expect(
        HedgeFactory.create(
          USD.address,
          ZYG.address,
          web3.utils.toWei("0.3"),
          web3.utils.toWei("0.7"),
          web3.utils.toWei("0.3"),
          false
        )
      ).to.be.revertedWith("ZYG#202");
    });

    it("Reverts: Create pool with low swap fee", async () => {
      await expect(
        HedgeFactory.create(
          USD.address,
          ZYG.address,
          web3.utils.toWei("0.3"),
          web3.utils.toWei("0.7"),
          web3.utils.toWei("0.0000001"),
          false
        )
      ).to.be.revertedWith("ZYG#203");
    });
  });
});
