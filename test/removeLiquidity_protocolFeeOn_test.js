const { expect } = require("chai");
const { cp } = require("fs");
const { utils } = require("ethers");
const { waffle } = require("hardhat");
const { deployContract } = waffle;
const provider = waffle.provider;
const web3 = require("web3");
const { toWei, tokenSorted } = require("./helper");

describe("Remove Liquidity w/ Protocol Fee On", () => {
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

  describe("Remove Liquidity w/ Protocol Fee On In Single Token 18 decimal", () => {
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

      //   console.log(
      //     ethers.utils.formatEther(await Pool.balanceOf(owner.address))
      //   );
    });

    it("Remove liquidity w/ Fee 100% BTC against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.756226640667729522);
      //   let expectedWeightUSD = toWei(0.243773359332270478);

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(1)]
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

      // Checking whether correct protocol fees were paid
      expect("0").to.be.equal(
        Number(ethers.utils.formatEther(receipt.events[3].args[3][0])).toFixed(
          0
        )
      );

      expect("0.001999996443003628").to.be.equal(
        ethers.utils.formatEther(receipt.events[3].args[3][1])
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(-1 * usdOutput)
        // );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

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

    it("Remove liquidity w/ Fee 100% USD against 237.841 (10%) LP", async () => {
      //   let expectedWeightBTC = toWei(0.731570382507179636);
      //   let expectedWeightUSD = toWei(0.268429617492820364);

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("237.841"), toWei(0)]
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

      // Checking whether correct protocol fees were paid
      expect("0.000999998221501814").to.be.equal(
        ethers.utils.formatEther(receipt.events[4].args[3][0])
      );

      expect("0").to.be.equal(
        Number(ethers.utils.formatEther(receipt.events[4].args[3][1])).toFixed(
          0
        )
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[4].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[4].args[2][1]);

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
        let usdOutput = ethers.utils.formatEther(receipt.events[4].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[4].args[2][1]);

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

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(1)]
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

      // Checking whether correct protocol fees were paid
      expect("0").to.be.equal(
        Number(ethers.utils.formatEther(receipt.events[3].args[3][0])).toFixed(
          0
        )
      );

      expect("0.018999966208534459").to.be.equal(
        ethers.utils.formatEther(receipt.events[3].args[3][1])
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(-1 * usdOutput)
        // );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

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

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("2259.4895"), toWei(0)]
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

      // Checking whether correct protocol fees were paid
      expect("0.00949998310426723").to.be.equal(
        ethers.utils.formatEther(receipt.events[4].args[3][0])
      );

      expect("0").to.be.equal(
        Number(ethers.utils.formatEther(receipt.events[4].args[3][1])).toFixed(
          0
        )
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      //   const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[4].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[4].args[2][1]);

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
        let usdOutput = ethers.utils.formatEther(receipt.events[4].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[4].args[2][1]);

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

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(1)]
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

      // Checking whether correct protocol fees were paid
      expect("0").to.be.equal(
        Number(ethers.utils.formatEther(receipt.events[3].args[3][0])).toFixed(
          0
        )
      );

      expect("0.000199999644300363").to.be.equal(
        ethers.utils.formatEther(receipt.events[3].args[3][1])
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

        expect(
          Number(ethers.utils.formatEther(balance0BeforeSwap))
        ).to.be.equal(
          Number(ethers.utils.formatEther(balance0AfterSwap)) +
            Number(-1 * btcOutput)
        );

        // expect(
        //   Number(ethers.utils.formatEther(balance1BeforeSwap))
        // ).to.be.equal(
        //   Number(ethers.utils.formatEther(balance1AfterSwap)) +
        //     Number(-1 * usdOutput)
        // );

        // expect(weightsAfterSwap[0]).to.be.equal(expectedWeightBTC);
        // expect(weightsAfterSwap[1]).to.be.equal(expectedWeightUSD);
      } else {
        let usdOutput = ethers.utils.formatEther(receipt.events[3].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[3].args[2][1]);

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

      const initUserData = ethers.utils.defaultAbiCoder.encode(
        ["uint256", "uint256"],
        [toWei("23.7841"), toWei(0)]
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

      // Checking whether correct protocol fees were paid
      expect("0.000099999822150182").to.be.equal(
        ethers.utils.formatEther(receipt.events[4].args[3][0])
      );

      expect("0").to.be.equal(
        Number(ethers.utils.formatEther(receipt.events[4].args[3][1])).toFixed(
          0
        )
      );

      const resultAfter = await Pool.getPoolBalancesAndChangeBlock();
      const balance0AfterSwap = resultAfter[0];
      const balance1AfterSwap = resultAfter[1];

      // const weightsAfterSwap = await Pool.getWeights();

      if (tokenSorted(BTC.address, USD.address)) {
        let btcOutput = ethers.utils.formatEther(receipt.events[4].args[2][0]);
        let usdOutput = ethers.utils.formatEther(receipt.events[4].args[2][1]);

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
        let usdOutput = ethers.utils.formatEther(receipt.events[4].args[2][0]);
        let btcOutput = ethers.utils.formatEther(receipt.events[4].args[2][1]);

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
