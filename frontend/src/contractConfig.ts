// ========================================================================
// On-Chain Tutoring Escrow for ArivuHub - Contract Configuration
// Update CONTRACT_ADDRESS after deploying to Sepolia testnet.
// ========================================================================

export const CONTRACT_ADDRESS = "0x0000000000000000000000000000000000000000";

export const SEPOLIA_CHAIN_ID = 11155111n; // 0xaa36a7

export const EXPLORER_BASE_URL = "https://sepolia.etherscan.io";

export const STATUS_MAP = ["None", "Funded", "Released", "Refunded"] as const;

export type SessionStatus = (typeof STATUS_MAP)[number];

export const CONTRACT_ABI = [
  "function createSession(address payable educator, uint256 sessionTime) external payable returns (uint256 id)",
  "function confirmSession(uint256 id) external",
  "function claimRefund(uint256 id) external",
  "function claimPayment(uint256 id) external",
  "function cancelByEducator(uint256 id) external",
  "function sessions(uint256) view returns (address student, address payable educator, uint256 amount, uint256 sessionTime, bool studentConfirmed, bool educatorConfirmed, uint8 status)",
  "function sessionCount() view returns (uint256)",
  "function timeout() view returns (uint256)",
  "event SessionCreated(uint256 indexed id, address indexed student, address indexed educator, uint256 amount, uint256 sessionTime)",
  "event Confirmed(uint256 indexed id, address indexed by)",
  "event Settled(uint256 indexed id, address indexed to, uint256 amount, uint8 status)"
];

