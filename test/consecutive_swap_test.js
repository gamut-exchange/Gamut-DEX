const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("Consecutive Single Swap (18 decimal)", () => {
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
        web3.utils.toWei("10000000000000000000000000000")
      );
    }

    // CREATING POOL AND INITIALIZING IT

    const receipt = await (
      await GamutFactory.create(
        BTC.address,
        USD.address,
        web3.utils.toWei("0.7"),
        web3.utils.toWei("0.3"),
        web3.utils.toWei("0.001"),
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

  describe("Consecutive Swap in 18 decimal pool with zero limit", () => {
    it("Swap 5 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = web3.utils.toWei("5");
      let expectedOutputAmount = web3.utils.toWei("1.066549922318995");
      let weightInAfterSwap = web3.utils.toWei("0.299775785380227711");
      let weightOutAfterSwap = web3.utils.toWei("0.700523168386953940");

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
      const deadline = 1773602957;

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

    it("Swap 250 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = web3.utils.toWei("250");
      let expectedOutputAmount = web3.utils.toWei("45.056355997922421677");
      let weightInAfterSwap = web3.utils.toWei("0.289860680346581116");
      let weightOutAfterSwap = web3.utils.toWei("0.710139319653418884");

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
      const deadline = 1773602957;

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

    it("Swap 100 BTC for USD", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = web3.utils.toWei("100");
      let expectedOutputAmount = web3.utils.toWei("421.0518348692287577");
      let weightInAfterSwap = web3.utils.toWei("0.690849546421975233");
      let weightOutAfterSwap = web3.utils.toWei("0.309150453578024767");

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
      const deadline = 1773602957;

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

    it("Swap 300 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = web3.utils.toWei("300");
      let expectedOutputAmount = web3.utils.toWei("61.938347562966719703");
      let weightInAfterSwap = web3.utils.toWei("0.295814375642899562");
      let weightOutAfterSwap = web3.utils.toWei("0.704185624357100438");

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
      const deadline = 1773602957;

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
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance0AfterSwap)) +
        //     Number(ethers.utils.formatEther(expectedOutputAmount))
        // );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) -
        //     Number(ethers.utils.formatEther(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance0AfterSwap)) -
        //     Number(ethers.utils.formatEther(amountIn))
        // );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(ethers.utils.formatEther(expectedOutputAmount))
        // );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap 500 BTC for USD", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = web3.utils.toWei("500");
      let expectedOutputAmount = web3.utils.toWei("870.91898376094484022");
      let weightInAfterSwap = web3.utils.toWei("0.643845955362578948");
      let weightOutAfterSwap = web3.utils.toWei("0.356154044637421052");

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
      const deadline = 1773602957;

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

      // console.log(ethers.utils.formatEther(balance0BeforeSwap));
      // console.log(ethers.utils.formatEther(balance0AfterSwap));
      // console.log(ethers.utils.formatEther(amountIn));
      // let a =
      //   Number(ethers.utils.formatEther(balance0AfterSwap)) -
      //   Number(ethers.utils.formatEther(amountIn));
      // console.log(balance0BeforeSwap - a);

      // // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
      // expect(Number(ethers.utils.formatEther(balance0BeforeSwap))).to.be.equal(
      //   Number(ethers.utils.formatEther(balance0AfterSwap)) -
      //     Number(ethers.utils.formatEther(amountIn))
      // );

      if (tokenSorted(BTC.address, USD.address)) {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance0AfterSwap)) -
        //     Number(ethers.utils.formatEther(amountIn))
        // );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(ethers.utils.formatEther(expectedOutputAmount))
        // );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(
        //   Number(ethers.utils.formatEther(balance0BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance0AfterSwap)) +
        //     Number(ethers.utils.formatEther(expectedOutputAmount))
        // );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) -
        //     Number(ethers.utils.formatEther(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();

        expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap 800 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = web3.utils.toWei("800");
      let expectedOutputAmount = web3.utils.toWei("248.064570041099864067");
      let weightInAfterSwap = web3.utils.toWei("0.310423313889890544");
      let weightOutAfterSwap = web3.utils.toWei("0.689576686110109456");

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
      const deadline = 1773602957;

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

    it("Swap 1 BTC for USD", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = web3.utils.toWei("1");
      let expectedOutputAmount = web3.utils.toWei("3.671133370329434655");
      let weightInAfterSwap = web3.utils.toWei("0.689404904383778238");
      let weightOutAfterSwap = web3.utils.toWei("0.310595095616221762");

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
      const deadline = 1773602957;

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
  });
});

describe("Consecutive Single Swap (6-9 decimal)", () => {
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
        web3.utils.toWei("10000000000000000000000000000")
      );
    }

    // CREATING POOL AND INITIALIZING IT

    const receipt = await (
      await GamutFactory.create(
        BTC.address,
        USD.address,
        web3.utils.toWei("0.7"),
        web3.utils.toWei("0.3"),
        web3.utils.toWei("0.001"),
        false
      )
    ).wait();

    let poolAddress = await GamutFactory.getPool(BTC.address, USD.address);
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

  describe("Consecutive Swap in (6 - 9) decimal pool with zero limit", () => {
    it("Swap 5 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei(5);
      let expectedOutputAmount = toGwei(1.066549922);

      let weightInAfterSwap = web3.utils.toWei("0.299775785380227711");
      let weightOutAfterSwap = web3.utils.toWei("0.700224214619772289");

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
      const deadline = 1773602957;

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.swap(singleSwap, funds, limit, deadline))
        .to.emit(Router, "Swap")
        .withArgs(tokenIn, tokenOut, amountIn, expectedOutputAmount, 0);

      // const receipt = await (
      //   await Router.swap(singleSwap, funds, limit, deadline)
      // ).wait();
      // // console.log(receipt.events[0].args[2] * 1000000000000);
      // // console.log(receipt.events[0].args[3] * 1000000000);
      // //console.log(web3.utils.fromWei(receipt.events[0].args[2], "mwei"));
      // console.log(fromGwei(receipt.events[0].args[3]));

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

    it("Swap 250 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei(250);
      let expectedOutputAmount = toGwei(45.056355997);
      let weightInAfterSwap = web3.utils.toWei("0.289860680346581116");
      let weightOutAfterSwap = web3.utils.toWei("0.710139319653418884");

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
      const deadline = 1773602957;

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

    it("Swap 100 BTC for USD", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = toGwei(100);
      let expectedOutputAmount = toMwei(421.051834);
      let weightInAfterSwap = web3.utils.toWei("0.690849546421975233");
      let weightOutAfterSwap = web3.utils.toWei("0.309150453578024767");

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
      const deadline = 1773602957;

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
        // expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
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
        // expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      }
    });

    it("Swap 300 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei(300);
      let expectedOutputAmount = toGwei(61.938347562);
      let weightInAfterSwap = web3.utils.toWei("0.295814375642899562");
      let weightOutAfterSwap = web3.utils.toWei("0.704185624357100438");

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
      const deadline = 1773602957;

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.swap(singleSwap, funds, limit, deadline)).to.emit(
        Router,
        "Swap"
      );

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
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) +
        //     Number(fromGwei(expectedOutputAmount))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        // expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
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
        // expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap 500 BTC for USD", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = toGwei(500);
      let expectedOutputAmount = toMwei(870.918983);
      let weightInAfterSwap = web3.utils.toWei("0.643845955362578948");
      let weightOutAfterSwap = web3.utils.toWei("0.356154044637421052");

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
      const deadline = 1773602957;

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.swap(singleSwap, funds, limit, deadline)).to.emit(
        Router,
        "Swap"
      );

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
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) - Number(fromGwei(amountIn))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) +
        //     Number(fromMwei(expectedOutputAmount))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        // expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      } else {
        // Checking whether pool balances before swap are equal to pool balances after the swap +/- amountIn/Out
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) +
        //     Number(fromGwei(expectedOutputAmount))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        // expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      }
    });

    it("Swap 800 USD for BTC", async () => {
      let tokenIn = USD.address;
      let tokenOut = BTC.address;
      let amountIn = toMwei("800");
      let expectedOutputAmount = toGwei("248.064570041");
      let weightInAfterSwap = web3.utils.toWei("0.310423313889890544");
      let weightOutAfterSwap = web3.utils.toWei("0.689576686110109456");

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
      const deadline = 1773602957;

      const result = await Pool.getPoolBalancesAndChangeBlock();
      const balance0BeforeSwap = result[0];
      const balance1BeforeSwap = result[1];

      await expect(Router.swap(singleSwap, funds, limit, deadline)).to.emit(
        Router,
        "Swap"
      );

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
        // expect(Number(fromGwei(balance0BeforeSwap))).to.be.equal(
        //   Number(fromGwei(balance0AfterSwap)) +
        //     Number(fromGwei(expectedOutputAmount))
        // );

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) - Number(fromMwei(amountIn))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        // expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
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
        // expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
      }
    });

    it("Swap 1 BTC for USD", async () => {
      let tokenIn = BTC.address;
      let tokenOut = USD.address;
      let amountIn = toGwei("1");
      let expectedOutputAmount = toMwei("3.671133");
      let weightInAfterSwap = web3.utils.toWei("0.689404904383778238");
      let weightOutAfterSwap = web3.utils.toWei("0.310595095616221762");

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
      const deadline = 1773602957;

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

        // expect(Number(fromMwei(balance1BeforeSwap))).to.be.equal(
        //   Number(fromMwei(balance1AfterSwap)) +
        //     Number(fromMwei(expectedOutputAmount))
        // );

        const weightsAfterSwap = await Pool.getWeights();
        // expect(weightsAfterSwap[0]).to.be.equal(weightInAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightOutAfterSwap);
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
        // expect(weightsAfterSwap[0]).to.be.equal(weightOutAfterSwap);
        // expect(weightsAfterSwap[1]).to.be.equal(weightInAfterSwap);
      }
    });
  });
});
