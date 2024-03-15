import { GraphQLClient } from "graphql-request";
import { Request, Response, query } from "express";
import { getWeb3, getWeb3Contract } from "../services/web3";
import { writeFileSync } from "fs";
import dotenv from "dotenv";
import { currentUnixTime } from "../utils/helpers";
dotenv.config();

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
  owner: string;
  delegatee: string;
};

class ReadController {
  web3!: any;
  priceSubmitterWeb3Contract!: any;
  ftsoManagerWeb3Contract!: any;
  ftsoRewardManagerContract!: any;
  wNatContract!: any;
  top10Delegators: Top10Info[] = [];

  constructor() {}

  runGettingDelegatorsInfo = async () => {
    this.web3 = getWeb3();

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

    const ftsoRewardManagerAddress = await this.ftsoManagerWeb3Contract.methods
      .rewardManager()
      .call();

    this.ftsoRewardManagerContract = await getWeb3Contract(
      this.web3,
      ftsoRewardManagerAddress,
      "FtsoRewardManager"
    );

    const wnatContractAddress = await this.ftsoRewardManagerContract.methods
      .wNat()
      .call();

    this.wNatContract = await getWeb3Contract(
      this.web3,
      wnatContractAddress,
      "WNat"
    );

    const client = new GraphQLClient(process.env.GRAPHQL_URL);
    const rewardEpochID = await this.ftsoManagerWeb3Contract.methods
      .getCurrentRewardEpoch()
      .call();

    const lockedBlock = await this.ftsoManagerWeb3Contract.methods
      .getRewardEpochVotePowerBlock(rewardEpochID)
      .call();
    console.log(rewardEpochID, lockedBlock);

    let intervalOfGQL = setInterval(async () => {
      try {
        const result = await client.request(GET_DELEGATORS);

        const top10VPInfo = [];

        // console.log(result["delegates"]["nodes"]);
        for (let node of result["delegates"]["nodes"]) {
          this.top10Delegators.push({
            owner: node.owner,
            delegatee: node.delegatee,
          });

          top10VPInfo.push({
            id: node.id,
            network: node.network,
            owner: node.owner,
            delegatee: node.delegatee,
            amount: node.amount,
          });
        }
        const nowTime = new Date();

        writeFileSync(
          `top10VP.json`,
          JSON.stringify({
            time:
              nowTime.getFullYear() +
              "." +
              String(Number(nowTime.getMonth()) + 1) +
              "." +
              nowTime.getDate() +
              "." +
              nowTime.getHours() +
              "." +
              nowTime.getMinutes(),
            data: top10VPInfo,
          })
        );
      } catch (err) {
        console.log(err);
        clearInterval(intervalOfGQL);
        setTimeout(() => {
          this.runGettingDelegatorsInfo();
        }, 1000);
      }
    }, 5000);

    const recursiveTimeout = async () => {
      const currentRewardEpochEnds = await this.ftsoManagerWeb3Contract.methods
        .currentRewardEpochEnds()
        .call();

      const endsin = Number(currentRewardEpochEnds) - currentUnixTime();

      setTimeout(async () => {
        let top10LockVPInfo = [];

        for (let node of this.top10Delegators) {
          const lockedVP = await this.wNatContract.methods
            .votePowerFromToAt(node.owner, node.delegatee, lockedBlock)
            .call();
          top10LockVPInfo.push({
            owner: node.owner,
            lockVP: String(lockedVP),
          });
        }
        const nowTime = new Date();

        writeFileSync(
          `top10lockedVP.json`,
          JSON.stringify({
            time:
              nowTime.getFullYear() +
              "." +
              nowTime.getMonth() +
              "." +
              nowTime.getDay() +
              "." +
              nowTime.getHours() +
              "." +
              nowTime.getMinutes(),
            data: top10LockVPInfo,
          })
        );
      }, 10000);

      setTimeout(() => {
        recursiveTimeout();
      }, endsin);
    };

    recursiveTimeout();
  };

  top_10_vp = async (req: Request, res: Response) => {
    return res.json({ text: "text" });
  };
}

type Node = {
  id: string;
  network: "songbird" | "flare";
  owner: string;
  delegatee: string;
  amount: string;
};

export default ReadController;
