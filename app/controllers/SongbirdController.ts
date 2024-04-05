import { Request, Response } from "express";
import {
  getContract,
  getProvider,
  getWeb3,
  getWeb3Contract,
} from "../services/web3";
import dotenv from "dotenv";
import axios from "axios";
import { RPC_URL, SGB_SYMBOLS, EXECUTOR_ADDRESS } from "../config";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { PRIVATE_KEY } from "../config/secret";
dotenv.config();

const networkName = "Songbird";
const Schema = mongoose.Schema;
const mongoDB = "mongodb://localhost:27017/songbirdData";

const addrSchema = new Schema({
  epochID: String,
  data: Object,
});

const autoClaimSchema = new Schema({
  address: String,
});

const usersSchema = new Schema(
  {
    address: String,
  },
  { timestamps: true }
);

const prevSchema = new Schema({
  epochID: String,
  prevEpochReward: Object,
  prevTotalReward: Object,
  votePower: Object,
});

// Compile model from schema

type ProviderInfo = {
  chain_id: number;
  name: string;
  desc: string;
  site_url: string;
  address: string;
  listed: boolean;
  logo_uri: string;
  success_rate: number;
  cur_vp: string;
  locked_vp: string;
  availability: number;
  balance: string;
  cur_epoch_reward: string;
  total_epoch_reward: string;
  whitelist: {};
  cur_epoch_info: {
    epoch_id: number;
    vp_block: number;
    start_block: number;
    start_timestamp: number;
    vp: string;
    reward: string;
    fee: string;
  };
  prev_epoch_info: {
    epoch_id: number;
    vp_block: number;
    start_block: number;
    start_timestamp: number;
    vp: string;
    reward: string;
    fee: string;
  };
  fee: { fee: string; scheduled_fee: { value: string; from: string } | null };
};

class SongbirdController {
  web3!: any;
  priceSubmitterWeb3Contract!: any;
  ftsoManagerWeb3Contract!: any;
  ftsoRewardManagerContract!: any;
  wNatContract!: any;
  voterWhitelisterContract!: any;
  CSMContract!: any;
  addrWhitelistInfo = {};
  flareProvidersInfo: ProviderInfo[] = [];
  songbirdProvidersInfo: ProviderInfo[] = [];

  currentRewardEpochID: number = 0;
  tempRewardEpochId: number = 0;
  successRate: Object = {};
  availabilityRate: Object = {};
  votePowerList: Object = {};
  lockedVotePowerList: Object = {};
  currentEpochRewardList: Object = {};
  totalEpochRewardList: Object = {};
  delegatorsInfoList: Object = {};

  ftsoRewardManagerAddress: String = "";

  currentRewardRateList: Object = {};
  prevRewardRateList: Object = {};

  balances: Object = {};
  endsIn: number = 0;
  duration: number = 0;
  lockedBlock: number = 0;

  totalVotePower: number = 0;
  prevTotalVotePower: number = 0;

  prevLockedBlock: number = 0;
  prevEpochRewardList: Object = {};
  prevTotalRewardList: Object = {};

  feeList: Object = {};

  allProvidersInfo!: any;

  top10LockedVP: any = 0;
  providerReward: any = 0;
  top10Reward: any = 0;

  constructor() {
    this.init();
  }

  init = async () => {
    try {
      this.web3 = getWeb3(RPC_URL);

      if (this.web3) {
        console.log(networkName, "Web3 instance is created properly");
      }

      const result = await this.web3.eth.net.isListening();

      console.log(networkName, "🎵 Web3 status", result);

      await this.initContracts();

      this.initVariables();

      await this.setupListener();

      console.log(
        networkName,
        "🍁 Got all contract instances and setup listener 🍁"
      );

      await this.setupEndsIn();
      console.log(networkName, "setupEndsIn");

      await this.roundExecution();
    } catch (err) {
      console.log(err.message);
      console.log(networkName, "🏹 restarting again 🏹");
    }
  };

  roundExecution = async () => {
    while (true) {
      try {
        console.log(networkName, "🌼 Songbird Started getting initial info 🌼");

        await this.getWhitelistedAddresses();

        await this.getEpochID();

        await this.getPrevEpochRewardRate();

        await this.setupDuration();

        await this.getTotalVotePower();

        await this.getSuccessRate();

        await this.getCurrentVotePowerList();

        await this.getLockedVotePowerList();

        await this.getBalances();

        await this.getCurrentEpochReward();

        await this.getTotalEpochReward();

        this.currentRewardRateList = await this.getRewardRate();

        await this.savePrevData();

        await this.getFee();

        await this.getFTSOProvidersInfo();

        console.log("Completed the calcuation");
      } catch (err) {
        console.log(err.message);
        console.log(networkName, "🏹 👇restarting again 👇🏹");
      }
    }
  };

  initContracts = async () => {
    try {
      this.priceSubmitterWeb3Contract = await getWeb3Contract(
        this.web3,
        process.env.SUBMITTER_CONTRACT_ADDRESS,
        "PriceSubmitter"
      );

      let ftsoManagerAddress = await this.priceSubmitterWeb3Contract.methods
        .getFtsoManager()
        .call();
      this.ftsoManagerWeb3Contract = await getWeb3Contract(
        this.web3,
        ftsoManagerAddress,
        "FtsoManager"
      );

      const ftsoRewardManagerAddress =
        await this.ftsoManagerWeb3Contract.methods.rewardManager().call();
      this.ftsoRewardManagerAddress = ftsoRewardManagerAddress;
      this.ftsoRewardManagerContract = await getWeb3Contract(
        this.web3,
        ftsoRewardManagerAddress,
        "FtsoRewardManager"
      );

      const csmAddress = await this.ftsoRewardManagerContract.methods
        .claimSetupManager()
        .call();
      this.CSMContract = await getWeb3Contract(
        this.web3,
        csmAddress,
        "ClaimSetupManager"
      );

      const wnatContractAddress = await this.ftsoRewardManagerContract.methods
        .wNat()
        .call();
      this.wNatContract = await getWeb3Contract(
        this.web3,
        wnatContractAddress,
        "WNat"
      );

      const voterWhitelisterAddress =
        await this.priceSubmitterWeb3Contract.methods
          .getVoterWhitelister()
          .call();
      this.voterWhitelisterContract = await getWeb3Contract(
        this.web3,
        voterWhitelisterAddress,
        "VoterWhitelister"
      );
    } catch (err) {
      console.log(err.message);
    }
  };

  initVariables = () => {
    for (let addr in this.addrWhitelistInfo) {
      this.prevRewardRateList[addr] = 0;
      this.currentRewardRateList[addr] = 0;
    }
  };

  enableAutoClaim = async (req: Request, res: Response) => {
    const { address } = req.body;

    try {
      const conn = mongoose.createConnection(mongoDB);
      const songbirdAutoClaimModel = conn.model(
        "songbirdAutoclaimUsers",
        autoClaimSchema
      );

      await songbirdAutoClaimModel.findOneAndUpdate(
        { address: address },
        {},
        { new: true, upsert: true }
      );
    } catch (err) {
      console.log(err.message);
    }
  };

  autoClaim = async () => {
    try {
      const conn = mongoose.createConnection(mongoDB);
      const songbirdAutoClaimModel = conn.model(
        "songbirdAutoclaimUsers",
        autoClaimSchema
      );

      const users = await songbirdAutoClaimModel.find({});

      let rightUsers = [];

      for (let user of users) {
        const isRight = await this.CSMContract.methods
          .isClaimExecutor(user.address, EXECUTOR_ADDRESS)
          .call();
        if (isRight) {
          rightUsers.push(user.address);
        } else {
          await songbirdAutoClaimModel.deleteOne({ address: user.address });
        }
      }

      let estimatedGas = await this.ftsoRewardManagerContract.methods
        .autoClaim(rightUsers, Number(this.currentRewardEpochID) - 1)
        .estimateGas({
          from: EXECUTOR_ADDRESS,
          to: this.ftsoRewardManagerAddress,
        });

      const gasPrice = await this.web3.eth.getGasPrice();

      const transaction = {
        from: EXECUTOR_ADDRESS,
        to: this.ftsoRewardManagerAddress,
        gas: estimatedGas,
        gasPrice: gasPrice,
        data: await this.ftsoRewardManagerContract.methods
          .autoClaim(rightUsers, Number(this.currentRewardEpochID) - 1)
          .encodeABI(),
      };

      const signedTx = await this.web3.eth.accounts.signTransaction(
        transaction,
        PRIVATE_KEY
      );

      let result = await this.web3.eth.sendSignedTransaction(
        signedTx.rawTransaction
      );
    } catch (err) {
      console.log(err);
    }
  };

  AddNewUser = async (req: Request, res: Response) => {
    const { address } = req.body;

    try {
      const conn = mongoose.createConnection(mongoDB);
      const usersModel = conn.model("users", usersSchema);

      await usersModel.findOneAndUpdate(
        { address: address },
        {},
        { new: true, upsert: true }
      );

      return res.json("New User Added");
    } catch (err) {
      console.log(err.message);
      return res.json("Adding new user failed");
    }
  };

  removeAutoClaim = async (req: Request, res: Response) => {
    const { address } = req.body;

    try {
      const conn = mongoose.createConnection(mongoDB);
      const songbirdAutoClaimModel = conn.model(
        "songbirdAutoclaimUsers",
        autoClaimSchema
      );

      await songbirdAutoClaimModel.deleteOne({ address: address });
    } catch (err) {
      console.log(err.message);
    }
  };

  getBalances = async () => {
    for (let addr in this.addrWhitelistInfo) {
      try {
        let balance = await this.web3.eth.getBalance(addr);
        const ethBalance = this.web3.utils.fromWei(balance, "ether");
        this.balances[addr] = ethBalance;
      } catch (err) {
        console.log(addr, "getBalances", err.message);
      }
    }
  };

  getFee = async () => {
    for (let addr in this.addrWhitelistInfo) {
      try {
        const fee = await this.ftsoRewardManagerContract.methods
          .getDataProviderCurrentFeePercentage(addr)
          .call();
        const scheduledFee = await this.ftsoRewardManagerContract.methods
          .getDataProviderScheduledFeePercentageChanges(addr)
          .call();
        this.feeList[addr] = {
          fee: fee.toString(),
          scheduledFee: {
            fee: scheduledFee[0].toString(),
            from: scheduledFee[1].toString(),
          },
        };
      } catch (err) {
        console.log(addr, "getFee", err);
      }
    }
  };

  // =================current epoch reward and total reward ======================

  getCurrentEpochReward = async () => {
    for (let addr in this.addrWhitelistInfo) {
      try {
        const curEpochReward = await this.ftsoRewardManagerContract.methods
          .getStateOfRewards(addr, this.currentRewardEpochID)
          .call();
        this.currentEpochRewardList[addr] = curEpochReward[1][0]
          ? curEpochReward[1][0].toString()
          : "0";
      } catch (err) {
        this.currentEpochRewardList[addr] = "0";
        console.log(addr, err.message);
      }
    }
  };

  getTotalEpochReward = async () => {
    for (let addr in this.addrWhitelistInfo) {
      try {
        const totalEpochReward = await this.ftsoRewardManagerContract.methods
          .getDataProviderPerformanceInfo(this.currentRewardEpochID, addr)
          .call();
        this.totalEpochRewardList[addr] = totalEpochReward[0]
          ? totalEpochReward[0].toString()
          : "0";
      } catch (err) {
        this.totalEpochRewardList[addr] = "0";
        console.log(addr, "getTotalEpochReward", err);
      }
    }
  };

  getPrevEpochRewardRate = async () => {
    try {
      const conn = mongoose.createConnection(mongoDB);
      const prevModel = conn.model("prevData", prevSchema);

      const prevData = await prevModel.find({
        epochID: String(Number(this.currentRewardEpochID) - 1),
      });
      for (let addr in this.addrWhitelistInfo) {
        const prevTotalReward = Number(
          this.web3.utils.fromWei(prevData[0].prevTotalReward[addr], "ether")
        ).toFixed();
        const prevEpochReward = Number(
          this.web3.utils.fromWei(prevData[0].prevEpochReward[addr], "ether")
        ).toFixed();
        const votePower = Number(
          this.web3.utils.fromWei(prevData[0].votePower[addr], "ether")
        ).toFixed();

        this.prevRewardRateList[addr] = Number(
          ((Number(prevTotalReward) - Number(prevEpochReward)) /
            Number(votePower)) *
            100
        ).toFixed(4);
      }
    } catch (err) {
      console.log(err.message);
    }
  };

  // ======================Prev epoch Reward and total reward ===========================

  savePrevData = async () => {
    try {
      const conn = mongoose.createConnection(mongoDB);
      const prevModel = conn.model("prevData", prevSchema);

      await prevModel.findOneAndUpdate(
        { epochID: String(this.currentRewardEpochID) },
        {
          prevEpochReward: this.currentEpochRewardList,
          prevTotalReward: this.totalEpochRewardList,
          votePower: this.lockedVotePowerList,
        },
        { new: true, upsert: true }
      );
    } catch (err) {
      console.log(err.message);
    }
  };

  getWhitelistedAddresses = async () => {
    try {
      for (let symbol of SGB_SYMBOLS) {
        const result = await this.voterWhitelisterContract.methods
          .getFtsoWhitelistedPriceProvidersBySymbol(symbol)
          .call();
        result.forEach((addr) => {
          addr = String(addr).toLowerCase();
          if (!this.addrWhitelistInfo[addr]) {
            this.addrWhitelistInfo[addr] = {};
          }
          this.addrWhitelistInfo[addr][symbol] = true;
        });
      }
    } catch (err) {
      console.log("getWhitelistedAddresses", err.message);
    }
  };

  getSuccessRate = async () => {
    let symbolSuccessRate = {};
    let symbolAvailableRate = {};
    for (let addr in this.addrWhitelistInfo) {
      symbolSuccessRate[addr] = {};
      symbolAvailableRate[addr] = {};
      for (let symbol of SGB_SYMBOLS) {
        symbolSuccessRate[addr][symbol] = 0;
        symbolAvailableRate[addr][symbol] = 0;
      }
    }

    for (let symbol of SGB_SYMBOLS) {
      const conn = mongoose.createConnection(mongoDB);
      const dynamicAddrModel = conn.model(symbol, addrSchema);
      const dbRows = await dynamicAddrModel.find();
      let totalResult = {};
      let totalSumOfAvailable = {};
      dbRows.forEach((row) => {
        for (let addr in row.data) {
          totalResult[addr] = 0;
          totalSumOfAvailable[addr] = 0;
        }
      });

      dbRows.forEach((row) => {
        for (let addr in row.data) {
          totalResult[addr] += Number(row.data[addr].result);
          if (row.data[addr].price) totalSumOfAvailable[addr]++;
        }
      });

      for (let addr in this.addrWhitelistInfo) {
        symbolSuccessRate[addr][symbol] = (totalResult[addr] / 120) * 100;
        symbolAvailableRate[addr][symbol] =
          (totalSumOfAvailable[addr] / 120) * 100;
      }
    }

    for (let addr in this.addrWhitelistInfo) {
      let sum = 0;
      let count = 0;
      let sumavailable = 0;
      for (let symbol of SGB_SYMBOLS) {
        sum += symbolSuccessRate[addr][symbol];
        sumavailable += symbolAvailableRate[addr][symbol];
        count++;
      }

      this.successRate[addr] = Number(sum / count).toFixed(2);
      this.availabilityRate[addr] = Number(sumavailable / count).toFixed(2);
    }
  };

  setupDuration = async () => {
    try {
      this.duration = await this.ftsoManagerWeb3Contract.methods
        .rewardEpochDurationSeconds()
        .call();
    } catch (err) {
      console.log(err.message);
    }
  };

  setupEndsIn = async () => {
    try {
      const ends1 = await this.ftsoManagerWeb3Contract.methods
        .currentRewardEpochEnds()
        .call();

      const currentUnixTime = Math.floor(Date.now() / 1000);
      this.endsIn = Number(ends1) - currentUnixTime;

      const interval = setInterval(async () => {
        if (this.endsIn <= 0) {
          clearInterval(interval);
          this.setupEndsIn();
        }
        this.endsIn--;
      }, 1000);
    } catch (err) {
      console.log(err.message);
    }
  };

  getEpochID = async () => {
    try {
      this.currentRewardEpochID = await this.ftsoManagerWeb3Contract.methods
        .getCurrentRewardEpoch()
        .call();
      if (
        Number(this.currentRewardEpochID) ==
        Number(this.tempRewardEpochId) + 1
      ) {
        await this.autoClaim();
      } else {
        this.tempRewardEpochId = this.currentRewardEpochID;
      }
    } catch (err) {}
  };

  getTotalVotePower = async () => {
    try {
      const totalvp = await this.wNatContract.methods.totalVotePower().call();
      this.totalVotePower = totalvp.toString();
    } catch (err) {
      console.log(err.message);
    }
  };

  getCurrentVotePowerList = async () => {
    for (let addr in this.addrWhitelistInfo) {
      try {
        const vp = await this.wNatContract.methods.votePowerOf(addr).call();
        this.votePowerList[addr] = vp.toString();
      } catch (err) {
        console.log(addr, err.message, "getCurrentVotePowerList");
      }
    }
  };

  getLockedVotePowerList = async () => {
    try {
      this.lockedBlock = await this.ftsoRewardManagerContract.methods
        .getRewardEpochVotePowerBlock(this.currentRewardEpochID)
        .call();
      for (let addr in this.addrWhitelistInfo) {
        const locked_vp = await this.wNatContract.methods
          .votePowerOfAt(addr, Number(this.lockedBlock))
          .call();
        this.lockedVotePowerList[addr] = locked_vp.toString();
      }
    } catch (err) {
      console.log(err.message, "getLockedVotePowerList");
    }
  };

  getRewardRate = async () => {
    try {
      const promises = Object.keys(this.addrWhitelistInfo).map(async (addr) => {
        try {
          const totalReward = Number(
            this.web3.utils.fromWei(this.totalEpochRewardList[addr], "ether")
          );
          const currentReward = Number(
            this.web3.utils.fromWei(this.currentEpochRewardList[addr], "ether")
          );
          const votePower = Number(
            this.web3.utils.fromWei(this.votePowerList[addr], "ether")
          );

          if (isNaN(totalReward) || isNaN(currentReward) || isNaN(votePower)) {
            throw new Error("Invalid values for reward calculation");
          }

          const rewardRate = ((totalReward - currentReward) / votePower) * 100;
          return { addr, rewardRate: rewardRate.toFixed(4) };
        } catch (err) {
          console.log(err.message, addr);
          return { addr, rewardRate: "N/A" }; // or handle error accordingly
        }
      });

      const results = await Promise.all(promises);
      const rewardRates = {};
      results.forEach(({ addr, rewardRate }) => {
        rewardRates[addr] = rewardRate;
      });

      return rewardRates;
    } catch (err) {
      console.log(err.message);
      return {}; // or handle error accordingly
    }
  };

  getFTSOProvidersInfo = async () => {
    const providersRawData = await axios.get(
      "https://raw.githubusercontent.com/TowoLabs/ftso-signal-providers/master/bifrost-wallet.providerlist.json"
    );

    let providersInfo = [];
    let id = 0;
    for (let addr in this.addrWhitelistInfo) {
      id++;
      let found = false;
      providersRawData.data.providers.forEach((provider, index) => {
        if (
          String(provider.address).toLowerCase() == addr.toLowerCase() &&
          provider.chainId == 19
        ) {
          providersInfo.push({
            id: id,
            name: provider.name,
            desc: provider.description,
            url: provider.url,
            logoURI: provider.logoURI,
            listed: provider.listed,
            address: addr,
            whitelist: this.addrWhitelistInfo[addr],
            successRate: this.successRate[addr]?.toString(),
            currentVotePower: this.votePowerList[addr]?.toString(),
            lockedVotePower: this.lockedVotePowerList[addr]?.toString(),
            availability: this.availabilityRate[addr]?.toString(),
            balance: this.balances[addr]?.toString(),
            currentEpochReward: this.currentEpochRewardList[addr]?.toString(),
            curRewardRate: this.currentRewardRateList[addr]?.toString(),
            totalEpochReward: this.totalEpochRewardList[addr]?.toString(),
            prevRewardRate: this.prevRewardRateList[addr]?.toString(),
            fee: this.feeList[addr],
          });
          found = true;
        }
      });

      if (!found) {
        providersInfo.push({
          id: id,
          name: "",
          desc: "",
          url: "",
          logoURI: "",
          listed: false,
          address: addr,
          whitelist: this.addrWhitelistInfo[addr],
          successRate: this.successRate[addr]?.toString(),
          currentVotePower: this.votePowerList[addr]?.toString(),
          lockedVotePower: this.lockedVotePowerList[addr]?.toString(),
          availability: this.availabilityRate[addr]?.toString(),
          balance: this.balances[addr]?.toString(),
          currentEpochReward: this.currentEpochRewardList[addr]?.toString(),
          curRewardRate: this.currentRewardRateList[addr]?.toString(),
          totalEpochReward: this.totalEpochRewardList[addr]?.toString(),
          prevRewardRate: this.prevRewardRateList[addr]?.toString(),
          fee: this.feeList[addr],
        });
      }
    }

    this.allProvidersInfo = providersInfo;
  };

  getProvidersInfo = (req: Request, res: Response) => {
    return res.json({
      epochId: this.currentRewardEpochID.toString(),
      endsIn: this.endsIn.toString(),
      duration: this.duration.toString(),
      totalVotePower: this.totalVotePower.toString(),
      providersInfo: this.allProvidersInfo,
    });
  };

  setupListener = async () => {
    let lst = await this.ftsoManagerWeb3Contract.methods.getFtsos().call();
    const ftsoContracts = [];
    const provider = getProvider(RPC_URL);
    await provider.getNetwork();

    for (let ftso of lst) {
      let contract = await getWeb3Contract(this.web3, ftso, "Ftso");
      let symbol = await contract.methods.symbol().call();
      ftsoContracts.push({
        symbol,
        web3Contract: contract,
        contract: await getContract(provider, ftso, "Ftso"),
      });
    }

    for (let contractWithSymbol of ftsoContracts) {
      contractWithSymbol.contract.on(
        "PriceFinalized",
        async (
          epochId: any,
          price: any,
          rewardedFtso: boolean,
          lowRewardPrice: any,
          highRewardPrice: any,
          finalizationType: any,
          timestamp: any
        ) => {
          try {
            if (contractWithSymbol.symbol == "SGB") {
              console.log(
                `💲Songbird Price finalized for ${contractWithSymbol.symbol} in epochId ${epochId} 💲`
              );
            }
            const conn = mongoose.createConnection(mongoDB);
            const dynamicAddrModel = conn.model(
              contractWithSymbol.symbol,
              addrSchema
            );

            let addrData = {};

            for (let addr of Object.keys(this.addrWhitelistInfo)) {
              try {
                const epochPriceOfAddr =
                  await contractWithSymbol.web3Contract.methods
                    .getEpochPriceForVoter(Number(epochId), addr)
                    .call();
                let result = 0;
                let medianPrice = this.web3.utils.toWei(
                  ethers.utils.formatEther(price),
                  "ether"
                );
                let lowPrice = this.web3.utils.toWei(
                  ethers.utils.formatEther(lowRewardPrice),
                  "ether"
                );

                let highPrice = this.web3.utils.toWei(
                  ethers.utils.formatEther(highRewardPrice),
                  "ether"
                );

                if (
                  Number(lowPrice) < epochPriceOfAddr &&
                  epochPriceOfAddr < Number(highPrice)
                ) {
                  result = 1;
                }

                if (
                  Number(lowPrice) == epochPriceOfAddr ||
                  Number(highPrice) == epochPriceOfAddr
                ) {
                  result = 0.5;
                }

                addrData[addr] = {
                  price: epochPriceOfAddr,
                  medianPrice,
                  lowPrice,
                  highPrice,
                  result,
                };
              } catch (err) {
                console.log(
                  err.message,
                  "**** This provider's epoch data doesn't exist ****"
                );
                continue;
              }
            }
            const currentLength = await dynamicAddrModel.countDocuments();

            if (currentLength > 119) {
              await dynamicAddrModel.deleteMany(
                {},
                { sort: { _id: 1 }, limit: 1 }
              );
            }
            const newEpochData = new dynamicAddrModel({
              epochID: epochId,
              data: addrData,
            });

            newEpochData.save();
          } catch (err) {
            console.log(err);
          }
        }
      );
    }
  };
}

export default SongbirdController;
