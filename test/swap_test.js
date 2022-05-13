const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("Single Swap 18 decimals", () => {
  let HedgeFactory;
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
  });
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
        web3.utils.toWei("10000000000000000000000000000")
      );
    }

    // CREATING POOL AND INITIALIZING IT

    const receipt = await (
      await HedgeFactory.create(
        BTC.address,
        USD.address,
        web3.utils.toWei("0.75"),
        web3.utils.toWei("0.25"),
        web3.utils.toWei("0.001"),
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
  });

  describe("Swap in 18 decimal pool", () => {
    it("Swap normal USD for BTC with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap high USD for BTC with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = web3.utils.toWei("1900");
      let expectedOutputAmount = web3.utils.toWei("127.371266129342723");
      let weightInAfterSwap = web3.utils.toWei("0.222631989444904512");
      let weightOutAfterSwap = web3.utils.toWei("0.777368010555095488");

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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap low USD for BTC with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = web3.utils.toWei("0.0001");
      let expectedOutputAmount = web3.utils.toWei("0.000016649988889");
      let weightInAfterSwap = web3.utils.toWei("0.249999996878127032");
      let weightOutAfterSwap = web3.utils.toWei("0.750000003121872968");

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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      //   const receipt = await (
      //     await Router.swap(singleSwap, funds, limit, deadline)
      //   ).wait();
      //   console.log(ethers.utils.formatEther(receipt.events[0].args[2]));
      //   console.log(ethers.utils.formatEther(receipt.events[0].args[3]));

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap normal BTC for USD with zero limit", async () => {
      let tokenIn = BTC.address;
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

      await expect(Router.swap(singleSwap, funds, limit, deadline))
        .to.emit(Router, "Swap")
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap high BTC for USD with zero limit", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = web3.utils.toWei("950");
      let expectedOutputAmount = web3.utils.toWei("997.656545219177818");
      let weightInAfterSwap = web3.utils.toWei("0.687792246980020264");
      let weightOutAfterSwap = web3.utils.toWei("0.312207753019979736");

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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      // const receipt = await (
      //   await Router.swap(singleSwap, funds, limit, deadline)
      // ).wait();
      // console.log(ethers.utils.formatEther(receipt.events[0].args[2]));
      // console.log(ethers.utils.formatEther(receipt.events[0].args[3]));

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap low BTC for USD with zero limit", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = web3.utils.toWei("0.0001");
      let expectedOutputAmount = web3.utils.toWei("0.000599399740476");
      let weightInAfterSwap = web3.utils.toWei("0.749999981268752497");
      let weightOutAfterSwap = web3.utils.toWei("0.250000018731247503");

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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      // const receipt = await (
      //   await Router.swap(singleSwap, funds, limit, deadline)
      // ).wait();
      // console.log(ethers.utils.formatEther(receipt.events[0].args[2]));
      // console.log(ethers.utils.formatEther(receipt.events[0].args[3]));

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(ethers.utils.formatEther(expectedOutputAmount))
        );

        expect(
          Number(ethers.utils.formatEther(balance1BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance1AfterSwap)) -
            Number(ethers.utils.formatEther(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      }
    });
  });
});

describe("Single Swap (6 - 9) decimals", () => {
  let HedgeFactory;
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

  const toMwei = (amount) => {
    return web3.utils.toWei(amount.toString(), "mwei");
  };

  const toGwei = (amount) => {
    return web3.utils.toWei(amount.toString(), "gwei");
  };

  const fromMwei = (amount) => {
    return web3.utils.fromWei(amount.toString(), "mwei");
  };

  const fromGwei = (amount) => {
    return web3.utils.fromWei(amount.toString(), "gwei");
  };

  before(async () => {
    const btcContract = await ethers.getContractFactory("TestToken");
    BTC = await btcContract.deploy("Bitcoin", "BTC", 9);

    const usdContract = await ethers.getContractFactory("TestToken");
    USD = await usdContract.deploy("USD Token", "USD", 6);
  });
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
        web3.utils.toWei("10000000000000000000000000000")
      );
    }

    // CREATING POOL AND INITIALIZING IT

    const receipt = await (
      await HedgeFactory.create(
        BTC.address,
        USD.address,
        web3.utils.toWei("0.75"),
        web3.utils.toWei("0.25"),
        web3.utils.toWei("0.001"),
        false
      )
    ).wait();

    let poolAddress = await HedgeFactory.getPool(BTC.address, USD.address);
    Pool = await ethers.getContractAt("Pool", poolAddress);

    // Values must be decimal-normalized! (USDT has 6 decimals)
    const initialBalances = tokenSorted(BTC.address, USD.address)
      ? [toGwei(1000), toMwei(2000)]
      : [toMwei(2000), toGwei(1000)];

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

  describe("Swap in (6 - 9) decimal pool", () => {
    it("Swap normal USD for BTC with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei(10);
      let expectedOutputAmount = toGwei(1.65397384);
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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) +
        //     Number(fromGwei(expectedOutputAmount))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) +
        //     Number(fromMwei(expectedOutputAmount))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap high USD for BTC with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei(1900);
      let expectedOutputAmount = toGwei(127.371266129);
      let weightInAfterSwap = web3.utils.toWei("0.222631989444904512");
      let weightOutAfterSwap = web3.utils.toWei("0.777368010555095488");
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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      // const receipt = await (
      //   await Router.swap(singleSwap, funds, limit, deadline)
      // ).wait();
      // console.log(ethers.utils.formatEther(receipt.events[0].args[2]));
      // console.log(ethers.utils.formatEther(receipt.events[0].args[3]));

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) +
            Number(fromGwei(expectedOutputAmount))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) +
            Number(fromMwei(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap low USD for BTC with zero limit", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei(0.0001);
      let expectedOutputAmount = toGwei(0.000016649);
      let weightInAfterSwap = web3.utils.toWei("0.249999996878127032");
      let weightOutAfterSwap = web3.utils.toWei("0.750000003121872968");

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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      //   const receipt = await (
      //     await Router.swap(singleSwap, funds, limit, deadline)
      //   ).wait();
      //   console.log(ethers.utils.formatEther(receipt.events[0].args[2]));
      //   console.log(ethers.utils.formatEther(receipt.events[0].args[3]));

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) +
        //     Number(fromGwei(expectedOutputAmount))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) +
        //     Number(fromMwei(expectedOutputAmount))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap normal BTC for USD with zero limit", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = toGwei(80);
      let expectedOutputAmount = toMwei(360.69208);
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

      await expect(Router.swap(singleSwap, funds, limit, deadline))
        .to.emit(Router, "Swap")
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) +
            Number(fromMwei(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) +
            Number(fromGwei(expectedOutputAmount))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      }
    });

    it("Swap high BTC for USD with zero limit", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = toGwei(950);
      let expectedOutputAmount = toMwei(997.656545);
      let weightInAfterSwap = web3.utils.toWei("0.687792246980020264");
      let weightOutAfterSwap = web3.utils.toWei("0.312207753019979736");
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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) +
            Number(fromMwei(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) +
            Number(fromGwei(expectedOutputAmount))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      }
    });

    it("Swap low BTC for USD with zero limit", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = toGwei(0.0001);
      let expectedOutputAmount = toMwei(0.000599);
      let weightInAfterSwap = web3.utils.toWei("0.749999981268752497");
      let weightOutAfterSwap = web3.utils.toWei("0.250000018731247503");

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
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) +
            Number(fromMwei(expectedOutputAmount))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
          Number(fromGwei(balance0AfterSwap)) +
            Number(fromGwei(expectedOutputAmount))
        );

        expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
          Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        );

        const weightsAfterSwap = await Pool.getWeights();
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      }
    });
  });
});
