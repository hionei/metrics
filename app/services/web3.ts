import Web3 from "web3";
import glob from "glob";
import fs from "fs";
import dotenv from "dotenv";
import { ethers, BigNumber } from "ethers";

dotenv.config();
const RPC_URL = process.env.RPC_URL;

export const keepFiles = (limit: number, symbol: string) => {
  const path = "learn/" + symbol;
  if (fs.existsSync(path)) {
    const files = fs.readdirSync(path);
    const existingCount = files.length;
    if (existingCount > limit) {
      for (let i = 0; i < existingCount - limit; i++) {
        const filename = files[i];
        if (!fs.statSync(path + "/" + filename).isDirectory()) {
          fs.unlinkSync(path + "/" + filename);
        }
      }
    } else {
      console.log("No files found in the directory.");
    }
  } else {
    console.log("Directory path not found.");
  }
};

export const getWeb3 = (rpc_url: string) => {
  const web3 = new Web3(rpc_url);
  return web3;
};

export async function relativeContractABIPathForContractName(
  name: string,
  artifactsRoot = "artifacts"
): Promise<string> {
  return new Promise((resolve, reject) => {
    glob(
      `contracts/**/${name}.sol/${name}.json`,
      { cwd: artifactsRoot },
      (er: any, files: string[] | null) => {
        if (er) {
          reject(er);
        } else {
          if (files && files.length === 1) {
            resolve(files[0]);
          } else {
            reject(files);
          }
        }
      }
    );
  });
}

export function getAbi(abiPath: string) {
  let abi = JSON.parse(fs.readFileSync(abiPath).toString());
  if (abi.abi) {
    abi = abi.abi;
  }
  return abi;
}

export const getProvider = (RPC_URL) => {
  const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
  return provider;
};

export async function getWeb3Contract(
  web3: any,
  address: string,
  name: string
) {
  let abiPath = await relativeContractABIPathForContractName(name);
  return new web3.eth.Contract(getAbi(`artifacts/${abiPath}`), address);
}

export async function getContract(
  provider: any,
  address: string,
  name: string
) {
  let abiPath = await relativeContractABIPathForContractName(name);
  return new ethers.Contract(address, getAbi(`artifacts/${abiPath}`), provider);
}

export function getWeb3Wallet(web3: any, privateKey: string) {
  if (privateKey.indexOf("0x") != 0) {
    privateKey = "0x" + privateKey;
  }
  return web3.eth.accounts.privateKeyToAccount(privateKey);
}

export function bigNumberToMillis(num: number) {
  return BigNumber.from(num * 1000);
}
