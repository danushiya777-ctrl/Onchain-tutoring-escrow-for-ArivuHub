import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  // Read timeout from environment variable (default to 300 seconds / 5 minutes)
  const timeoutEnv = process.env.ESCROW_TIMEOUT;
  const timeoutSeconds = timeoutEnv ? parseInt(timeoutEnv, 10) : 300;

  console.log("==================================================");
  console.log("Deploying TutoringEscrow for ArivuHub");
  console.log("==================================================");
  console.log(`Configured Timeout: ${timeoutSeconds} seconds`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying with account: ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Account balance: ${ethers.formatEther(balance)} ETH`);

  const TutoringEscrowFactory = await ethers.getContractFactory("TutoringEscrow");
  const escrow = await TutoringEscrowFactory.deploy(timeoutSeconds);

  await escrow.waitForDeployment();
  const address = await escrow.getAddress();

  console.log("--------------------------------------------------");
  console.log(`TutoringEscrow successfully deployed to: ${address}`);
  console.log("--------------------------------------------------");
  console.log("Next steps:");
  console.log(`1. Update frontend/src/contractConfig.ts with CONTRACT_ADDRESS = "${address}"`);
  console.log(`2. Update README.md with the deployed address and Sepolia Etherscan URL`);
  console.log("==================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});

