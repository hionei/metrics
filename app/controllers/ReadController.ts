import { GraphQLClient } from "graphql-request";
import { Request, Response, query } from "express";
import { getContract, getProvider, getWeb3, getWeb3Contract, bigNumberToMillis } from "../services/web3";
import { writeFileSync } from "fs";
import dotenv from "dotenv";
import { currentUnixTime, weiToEther } from "../utils/helpers";
import axios from "axios";
import { FLR_SYMBOLS, RPC_URLS, SGB_SYMBOLS } from "../config";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { BigNumber } from "bignumber.js";
dotenv.config();

const Schema = mongoose.Schema;

const addrSchema = new Schema({
  epochID: String,
  data: Object,
});

// Compile model from schema

const GET_DELEGATORS = `
query {
    delegates(
      first: 10
      orderBy: AMOUNT_DESC
      filter: {
        network: { equalTo: "songbird" }
        delegatee: { equalTo: "${process.env.PROVIDER_ADDRESS}" }
      }
    ) {
      nodes {
        id
        network
        owner
        delegatee
        amount
      }
      totalCount
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
    }
  }
`;

type Top10Info = {
  id: string;
  owner: string;
  delegatee: string;
  network: string;
  amount: string;
  lockedVP: string;
  usualReward: string;
};

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

class ReadController {
  web3: any[] = [];
  priceSubmitterWeb3Contract: any[] = [];
  ftsoManagerWeb3Contract: any[] = [];
  ftsoRewardManagerContract: any[] = [];
  wNatContract: any[] = [];
  voterWhitelisterContract: any[] = [];
  top10Delegators: Top10Info[] = [];
  sgbAddr2Sym = {};
  flrAddr2Sym = {};
  flareProvidersInfo: ProviderInfo[] = [];
  songbirdProvidersInfo: ProviderInfo[] = [];

  currentRewardEpochID: number[] = [0, 0];
  endsIn: number[] = [0, 0];
  duration: number[] = [0, 0];
  totalVotePower: number[] = [0, 0];
  prevTotalVotePower: number[] = [0, 0];
  top10LockedVP: any = 0;
  providerReward: any = 0;
  top10Reward: any = 0;

  constructor() {
    const init = async () => {
      RPC_URLS.forEach((rpc_url) => {
        this.web3.push(getWeb3(rpc_url));
      });

      for (let web3 of this.web3) {
        const priceSubmitterContract = await getWeb3Contract(web3, process.env.SUBMITTER_CONTRACT_ADDRESS, "PriceSubmitter");
        this.priceSubmitterWeb3Contract.push(priceSubmitterContract);

        let ftsoManagerAddress = await priceSubmitterContract.methods.getFtsoManager().call();

        let ftsoManagerContract = await getWeb3Contract(web3, ftsoManagerAddress, "FtsoManager");

        this.ftsoManagerWeb3Contract.push(ftsoManagerContract);

        const ftsoRewardManagerAddress = await ftsoManagerContract.methods.rewardManager().call();

        let ftsoRewardManagerContract = await getWeb3Contract(web3, ftsoRewardManagerAddress, "FtsoRewardManager");

        this.ftsoRewardManagerContract.push(ftsoRewardManagerContract);

        const wnatContractAddress = await ftsoRewardManagerContract.methods.wNat().call();
        let wnatContract = await getWeb3Contract(web3, wnatContractAddress, "WNat");

        this.wNatContract.push(wnatContract);

        const voterWhitelisterAddress = await priceSubmitterContract.methods.getVoterWhitelister().call();
        let voterWhitelisterContract = await getWeb3Contract(web3, voterWhitelisterAddress, "VoterWhitelister");

        this.voterWhitelisterContract.push(voterWhitelisterContract);
      }
    };

    init();

    setTimeout(() => {
      // this.getSTSOProvidersInfo();
      // this.getFTSOProvidersInfo();
      console.log("==Started getting initial info==");
      this.getEpochID();
      this.setupEndsIn();
      this.setupDuration();
      this.getFlareSuccessRate();
    }, 8000);
  }

  top_10_locked_vp = async (req: Request, res: Response) => {
    return res.json({ top10LockedVP: this.top10LockedVP });
  };

  getSongbirdSuccessRate = async () => {};

  getFlareSuccessRate = async () => {
    const mongoDB = "mongodb://localhost:27017/flareData";
    const conn = mongoose.createConnection(mongoDB);

    for (let symbol of FLR_SYMBOLS) {
      const dynamicAddrModel = conn.model(symbol, addrSchema);
      const dbRows = await dynamicAddrModel.find();
      console.log(dbRows);
      // for (let addr in dbRows.data) {}
    }
  };

  setupDuration = async () => {
    try {
      this.duration[0] = await this.ftsoManagerWeb3Contract[0].methods.rewardEpochDurationSeconds().call();
      this.duration[1] = await this.ftsoManagerWeb3Contract[1].methods.rewardEpochDurationSeconds().call();
    } catch (err) {
      console.log(err);
    }
  };

  setupEndsIn = async () => {
    try {
      const ends1 = await this.ftsoManagerWeb3Contract[0].methods.currentRewardEpochEnds().call();
      const ends2 = await this.ftsoManagerWeb3Contract[1].methods.currentRewardEpochEnds().call();
      const currentUnixTime = Math.floor(Date.now() / 1000);
      this.endsIn[0] = Number(ends1) - currentUnixTime;
      this.endsIn[1] = Number(ends2) - currentUnixTime;
      const interval = setInterval(() => {
        if (this.endsIn[0] < 0 && this.endsIn[1] < 0) {
          clearInterval(interval);
          this.setupEndsIn();
        }
        this.endsIn[0]--;
        this.endsIn[1]--;
      }, 1000);
    } catch (err) {
      console.log(err);
    }
  };

  getEpochID = async () => {
    try {
      this.currentRewardEpochID[0] = await this.ftsoManagerWeb3Contract[0].methods.getCurrentRewardEpoch().call();
      this.currentRewardEpochID[1] = await this.ftsoManagerWeb3Contract[1].methods.getCurrentRewardEpoch().call();
    } catch (err) {}

    setTimeout(async () => {
      this.getEpochID();
    }, 5000);
  };

  getTotalVotePower = async () => {
    try {
      this.totalVotePower[0] = await this.wNatContract[0].methods.totalVotePower().call();
      this.totalVotePower[1] = await this.wNatContract[0].methods.totalVotePower().call();
    } catch (err) {
      console.log(err);
    }
  };

  getFTSOProvidersInfo = async () => {
    for (let symbol of FLR_SYMBOLS) {
      const result = await this.voterWhitelisterContract[1].methods.getFtsoWhitelistedPriceProvidersBySymbol(symbol).call();
      result.forEach((addr) => {
        addr = String(addr).toLowerCase();
        if (!this.flrAddr2Sym[addr]) {
          this.flrAddr2Sym[addr] = {};
        }
        this.flrAddr2Sym[addr][symbol] = true;
      });
    }

    const providersRawData = await axios.get("https://raw.githubusercontent.com/TowoLabs/ftso-signal-providers/master/bifrost-wallet.providerlist.json");

    let providersInfo = [];
    for (let addr in this.flrAddr2Sym) {
      providersRawData.data.providers.forEach((provider) => {
        if (provider.address == addr && provider.chainId == 14) {
          providersInfo.push({
            name: provider.name,
            desc: provider.description,
            url: provider.url,
            logoURI: provider.logoURI,
            listed: provider.listed,
            address: addr,
            whitelist: this.flrAddr2Sym[addr],
          });
        }
      });
      providersInfo.push({
        name: "",
        desc: "",
        url: "",
        logoURI: "",
        listed: false,
        address: addr,
        whitelist: this.flrAddr2Sym[addr],
      });
    }

    this.flareProvidersInfo = providersRawData.data.data.map((data) => {
      const addr = String(data.address).toLowerCase();
      if (Object.keys(this.flrAddr2Sym).includes(addr)) {
        return {
          chain_id: data.chainID,
          name: data.name,
          desc: data.description,
          site_url: data.url,
          address: data.address,
          logo_uri: data.logoURI,
          listed: data.listed,
          success_rate: data.successRate,
          cur_vp: data.currentVotePower,
          locked_vp: data.currentRewardEpochVotePower,
          availability: data.availability,
          balance: data.balance,
          cur_epoch_reward: data.currentEpochReward,
          total_epoch_reward: data.totalEpochReward,
          whitelist: this.flrAddr2Sym[addr],
          cur_epoch_info: {
            epoch_id: data.currentRewardEpoch.rewardEpochId,
            vp_block: data.currentRewardEpoch.votePowerBlock,
            start_block: data.currentRewardEpoch.startBlock,
            start_timestamp: data.currentRewardEpoch.startTimestamp,
            vp: data.currentRewardEpoch.votePower,
            reward: data.currentRewardEpoch.reward,
            fee: data.currentRewardEpoch.fee,
          },
          prev_epoch_info: {
            epoch_id: data.previousRewardEpoch.rewardEpochId,
            vp_block: data.previousRewardEpoch.votePowerBlock,
            start_block: data.previousRewardEpoch.startBlock,
            start_timestamp: data.previousRewardEpoch.startTimestamp,
            vp: data.previousRewardEpoch.votePower,
            reward: data.previousRewardEpoch.reward,
            fee: data.previousRewardEpoch.fee,
          },
          fee: {
            fee: data.fee.fee,
            scheduled_fee: {
              value: data.fee.scheduledFee?.bips,
              from: data.fee.scheduledFee?.fromEpoch,
            },
          },
        };
      }
    });

    console.log(this.flareProvidersInfo.length);
  };

  getSTSOProvidersInfo = async () => {
    for (let symbol of SGB_SYMBOLS) {
      const result = await this.voterWhitelisterContract[0].methods.getFtsoWhitelistedPriceProvidersBySymbol(symbol).call();

      result.forEach((addr) => {
        addr = String(addr).toLowerCase();
        if (!this.sgbAddr2Sym[addr]) {
          this.sgbAddr2Sym[addr] = {};
        }
        this.sgbAddr2Sym[addr][symbol] = true;
      });
    }

    console.log(Object.keys(this.sgbAddr2Sym).length);

    const providersRawData = await axios.get("https://songbird-ftso-monitor.flare.network/api/ftso/dataProvidersInfo");

    console.log(providersRawData.data.data.length, "rawData");

    const filteredArray = providersRawData.data.data.filter((data) => {
      const addr = String(data.address).toLowerCase();
      return Object.keys(this.sgbAddr2Sym).includes(addr);
    });

    console.log(filteredArray.length, "here");

    this.songbirdProvidersInfo = filteredArray.map((data) => {
      const addr = String(data.address).toLowerCase();
      return {
        chain_id: data.chainId,
        name: data.name,
        desc: data.description,
        site_url: data.url,
        address: data.address,
        listed: data.listed,
        success_rate: data.successRate,
        cur_vp: data.currentVotePower,
        logo_uri: data.logoURI,
        locked_vp: data.currentRewardEpochVotePower,
        availability: data.availability,
        balance: data.balance,
        cur_epoch_reward: data.currentEpochReward,
        total_epoch_reward: data.totalEpochReward,
        whitelist: this.sgbAddr2Sym[addr],
        cur_epoch_info: {
          epoch_id: data.currentRewardEpoch.rewardEpochId,
          vp_block: data.currentRewardEpoch.votePowerBlock,
          start_block: data.currentRewardEpoch.startBlock,
          start_timestamp: data.currentRewardEpoch.startTimestamp,
          vp: data.currentRewardEpoch.votePower,
          reward: data.currentRewardEpoch.reward,
          fee: data.currentRewardEpoch.fee,
        },
        prev_epoch_info: {
          epoch_id: data.previousRewardEpoch.rewardEpochId,
          vp_block: data.previousRewardEpoch.votePowerBlock,
          start_block: data.previousRewardEpoch.startBlock,
          start_timestamp: data.previousRewardEpoch.startTimestamp,
          vp: data.previousRewardEpoch.votePower,
          reward: data.previousRewardEpoch.reward,
          fee: data.previousRewardEpoch.fee,
        },
        fee: {
          fee: data.fee.fee,
          scheduled_fee: {
            value: data.fee.scheduledFee?.bips,
            from: data.fee.scheduledFee?.fromEpoch,
          },
        },
      };
    });
    console.log(this.songbirdProvidersInfo.length);
  };

  getFlareProvidersInfo = async (req: Request, res: Response) => {
    return res.json(this.flareProvidersInfo);
  };

  getSongbirdProvidersInfo = async (req: Request, res: Response) => {
    return res.json(this.songbirdProvidersInfo);
  };

  setupSongbirdListener = async () => {
    let lst = await this.ftsoManagerWeb3Contract[0].methods.getFtsos().call();
    const ftsoContracts = [];
    const provider = getProvider(RPC_URLS[0]);
    await provider.getNetwork();

    for (let ftso of lst) {
      let contract = await getWeb3Contract(this.web3[0], ftso, "Ftso");
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
        async (epochId: any, price: any, rewardedFtso: boolean, lowRewardPrice: any, highRewardPrice: any, finalizationType: any, timestamp: any) => {
          try {
            if (contractWithSymbol.symbol == "SGB") {
              console.log(`=====Songbird Price finalized for ${contractWithSymbol.symbol} in epochId ${epochId}=====`);
            }

            const mongoDB = "mongodb://localhost:27017/songbirdData";
            const conn = mongoose.createConnection(mongoDB);

            const dynamicAddrModel = conn.model(contractWithSymbol.symbol, addrSchema);

            let addrData = {};

            for (let addr of Object.keys(this.sgbAddr2Sym)) {
              const epochPriceOfAddr = await contractWithSymbol.web3Contract.methods.getEpochPriceForVoter(Number(epochId), addr).call();

              let result = 0;
              let medianPrice = this.web3[0].utils.toWei(ethers.utils.formatEther(price), "ether");
              let lowPrice = this.web3[0].utils.toWei(ethers.utils.formatEther(lowRewardPrice), "ether");

              let highPrice = this.web3[0].utils.toWei(ethers.utils.formatEther(highRewardPrice), "ether");

              if (Number(lowPrice) < epochPriceOfAddr && epochPriceOfAddr < Number(highPrice)) {
                result = 1;
              }

              if (Number(lowPrice) == epochPriceOfAddr || Number(highPrice) == epochPriceOfAddr) {
                result = 0.5;
              }

              addrData[addr] = {
                price: epochPriceOfAddr,
                medianPrice,
                lowPrice,
                highPrice,
                result,
              };
            }

            const currentLength = await dynamicAddrModel.countDocuments();

            if (currentLength > 119) {
              await dynamicAddrModel.deleteMany({}, { sort: { _id: 1 }, limit: 1 });
            }

            const newEpochData = new dynamicAddrModel({
              epochID: epochId,
              data: addrData,
            });

            newEpochData.save();
          } catch (err) {}
        }
      );
    }
  };

  setupFlareListener = async () => {
    let lst = await this.ftsoManagerWeb3Contract[1].methods.getFtsos().call();
    const ftsoContracts = [];
    const provider = getProvider(RPC_URLS[1]);
    await provider.getNetwork();

    for (let ftso of lst) {
      let contract = await getWeb3Contract(this.web3[1], ftso, "Ftso");
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
        async (epochId: any, price: any, rewardedFtso: boolean, lowRewardPrice: any, highRewardPrice: any, finalizationType: any, timestamp: any) => {
          try {
            if (contractWithSymbol.symbol == "FLR") {
              console.log(`=====FLare Price finalized for ${contractWithSymbol.symbol} in epochId ${epochId}=====`);
            }
            const mongoDB = "mongodb://localhost:27017/flareData";
            const conn = mongoose.createConnection(mongoDB);

            const dynamicAddrModel = conn.model(contractWithSymbol.symbol, addrSchema);

            let addrData = {};

            for (let addr of Object.keys(this.flrAddr2Sym)) {
              const epochPriceOfAddr = await contractWithSymbol.web3Contract.methods.getEpochPriceForVoter(Number(epochId), addr).call();

              let result = 0;
              let medianPrice = this.web3[0].utils.toWei(ethers.utils.formatEther(price), "ether");
              let lowPrice = this.web3[0].utils.toWei(ethers.utils.formatEther(lowRewardPrice), "ether");

              let highPrice = this.web3[0].utils.toWei(ethers.utils.formatEther(highRewardPrice), "ether");

              if (Number(lowPrice) < epochPriceOfAddr && epochPriceOfAddr < Number(highPrice)) {
                result = 1;
              }

              if (Number(lowPrice) == epochPriceOfAddr || Number(highPrice) == epochPriceOfAddr) {
                result = 0.5;
              }

              addrData[addr] = {
                price: epochPriceOfAddr,
                medianPrice,
                lowPrice,
                highPrice,
                result,
              };
            }

            const currentLength = await dynamicAddrModel.countDocuments();

            if (currentLength > 119) {
              await dynamicAddrModel.deleteMany({}, { sort: { _id: 1 }, limit: 1 });
            }

            const newEpochData = new dynamicAddrModel({
              epochID: epochId,
              data: addrData,
            });

            newEpochData.save();
          } catch (err) {}
        }
      );
    }
  };

  isInTop10 = async (req: Request, res: Response) => {
    const { address } = req.params;
    this.top10Delegators.forEach((delegatorInfo) => {
      if (delegatorInfo.owner == address) return res.json({ result: true });
    });
    return res.json({ result: false });
  };

  // runGettingDelegatorsInfo = async () => {
  //   try {
  //     const rewardEpochID = await this.ftsoManagerWeb3Contract.methods
  //       .getCurrentRewardEpoch()
  //       .call();

  //     const lockedBlock = await this.ftsoManagerWeb3Contract.methods
  //       .getRewardEpochVotePowerBlock(rewardEpochID)
  //       .call();
  //     console.log(rewardEpochID, lockedBlock);

  //     const client = new GraphQLClient(process.env.GRAPHQL_URL);

  //     let intervalOfGQL = setInterval(async () => {
  //       try {
  //         let temptop10Delegators = [];
  //         const result = await client.request(GET_DELEGATORS);

  //         const providerRewardInfo =
  //           await this.ftsoRewardManagerContract.methods
  //             .getStateOfRewards(process.env.PROVIDER_ADDRESS, rewardEpochID)
  //             .call();

  //         let sumLockedVP = 0;

  //         for (let node of result["delegates"]["nodes"]) {
  //           const lockedVP = await this.wNatContract.methods
  //             .votePowerFromToAt(node.owner, node.delegatee, lockedBlock)
  //             .call();
  //           const lockedVPEther = Math.floor(
  //             this.web3.utils.fromWei(lockedVP, "ether")
  //           );
  //           sumLockedVP += Number(lockedVPEther);
  //         }

  //         const providerReward = Math.floor(
  //           this.web3.utils.fromWei(providerRewardInfo[1], "ether")
  //         );
  //         const top10Reward = Math.floor((providerReward * 40) / 100);

  //         this.providerReward = providerReward;
  //         this.top10LockedVP = sumLockedVP;
  //         this.top10Reward = top10Reward;

  //         for (let node of result["delegates"]["nodes"]) {
  //           const lockedVP = await this.wNatContract.methods
  //             .votePowerFromToAt(node.owner, node.delegatee, lockedBlock)
  //             .call();
  //           const lockedVPEther = Math.floor(
  //             this.web3.utils.fromWei(lockedVP, "ether")
  //           );
  //           const delegatorRewardInfo =
  //             await this.ftsoRewardManagerContract.methods
  //               .getStateOfRewards(node.owner, rewardEpochID)
  //               .call();
  //           let totalDelegatorReward = 0;
  //           delegatorRewardInfo[1].forEach((value) => {
  //             totalDelegatorReward += Math.floor(
  //               this.web3.utils.fromWei(value, "ether")
  //             );
  //           });
  //           const apy = Math.floor((lockedVPEther / sumLockedVP) * 100);
  //           temptop10Delegators.push({
  //             id: node.id,
  //             network: node.network,
  //             owner: node.owner,
  //             delegatee: node.delegatee,
  //             amount: Math.floor(this.web3.utils.fromWei(node.amount, "ether")),
  //             lockedVP: String(lockedVPEther),
  //             usualReward: String(totalDelegatorReward),
  //             apy,
  //             godReward: Math.floor((top10Reward * apy) / 100),
  //           });
  //         }
  //         this.top10Delegators = [...temptop10Delegators];

  //         const nowTime = new Date();

  //         writeFileSync(
  //           `top10VP.json`,
  //           JSON.stringify({
  //             time:
  //               nowTime.getFullYear() +
  //               "." +
  //               nowTime.getMonth() +
  //               "." +
  //               nowTime.getDay() +
  //               "." +
  //               nowTime.getHours() +
  //               "." +
  //               nowTime.getMinutes(),
  //             data: this.top10Delegators,
  //           })
  //         );
  //       } catch (err) {
  //         console.log(err);
  //         clearInterval(intervalOfGQL);
  //         setTimeout(() => {
  //           this.runGettingDelegatorsInfo();
  //         }, 1000);
  //       }
  //     }, 5000);
  //   } catch (err) {}
  // };

  top_10_vp = async (req: Request, res: Response) => {
    return res.json({
      top10LockedVP: this.top10LockedVP,
      providerReward: this.providerReward,
      top10Reward: this.top10Reward,
      top10Info: this.top10Delegators,
    });
  };
}

export default ReadController;
