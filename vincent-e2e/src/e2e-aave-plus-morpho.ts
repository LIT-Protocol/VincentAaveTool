import {
  createAppConfig,
  init,
  suppressLitLogs,
} from "@lit-protocol/vincent-scaffold-sdk/e2e";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Apply log suppression FIRST, before any imports that might trigger logs
suppressLitLogs(true);

import { getVincentToolClient } from "@lit-protocol/vincent-app-sdk";
// Tools and Policies that we will be testing
import { vincentPolicyMetadata as sendLimitPolicyMetadata } from "../../vincent-packages/policies/send-counter-limit/dist/index.js";
import { bundledVincentTool as aaveTool } from "../../vincent-packages/tools/aave/dist/index.js";
import { bundledVincentTool as morphoTool } from "../../vincent-packages/tools/morpho/dist/index.js";
import { bundledVincentTool as erc20ApproveTool } from "@lit-protocol/vincent-tool-erc20-approval";
import { ethers } from "ethers";
import {
  getAaveAddresses,
  getTestTokens as getAaveTestTokens,
  CHAIN_IDS as AAVE_CHAIN_IDS,
} from "../../vincent-packages/tools/aave/dist/lib/helpers/index.js";
import {
  getVaults,
  getTokenAddress,
} from "../../vincent-packages/tools/morpho/dist/lib/helpers/index.js";
import {
  setupWethFunding,
  setupEthFunding,
  addTestResult,
  printTestSummary,
} from "./test-utils.js";

// ========================================
// NETWORK CONFIGURATION - CHANGE THIS TO TEST ON OTHER NETWORKS
// ========================================
const NETWORK_NAME = "base"; // Options: "sepolia", "base"

const NETWORK_CONFIG = {
  // Network to test on
  network: NETWORK_NAME,

  // Chain ID for the network
  chainId: AAVE_CHAIN_IDS[NETWORK_NAME],

  // RPC URL environment variable
  rpcUrlEnv: `${NETWORK_NAME.toUpperCase()}_RPC_URL`,

  // Get addresses dynamically based on chain
  get aaveAddresses() {
    return getAaveAddresses(NETWORK_NAME);
  },
  get aaveTestTokens() {
    return getAaveTestTokens(NETWORK_NAME);
  },
  // Dynamic morpho vault discovery - get best USDC vault
  async getBestUsdcVault() {
    const vaults = await getVaults({
      assetSymbol: "USDC",
      chainId: this.chainId,
      sortBy: "netApy",
      sortOrder: "desc",
      limit: 1,
      excludeIdle: true,
      minTvl: 10000, // Minimum $10k TVL for safety
    });

    if (vaults.length === 0) {
      throw new Error(`No suitable USDC vaults found on ${NETWORK_NAME}`);
    }

    return vaults[0];
  },

  get morphoTokenAddresses() {
    return {
      USDC: getTokenAddress("USDC", this.chainId),
      WETH: getTokenAddress("WETH", this.chainId),
      USDT: getTokenAddress("USDT", this.chainId),
    };
  },

  // Convenience getters for commonly used addresses
  get aavePoolAddress() {
    return this.aaveAddresses.POOL;
  },
  get wethAddress() {
    return this.aaveTestTokens.WETH;
  },
  get usdcAddress() {
    return this.aaveTestTokens.USDC;
  },
  // Note: usdcVaultAddress will be dynamically discovered in the test flow
} as const;

const CONFIRMATIONS_TO_WAIT = 2;

// Test amounts
const WETH_DEPOSIT_AMOUNT = "0.001"; // 0.01 WETH to deposit on AAVE
const USDC_BORROW_AMOUNT = "0.1"; // 0.1 USDC to borrow from AAVE and deposit to Morpho

// Global variable to store the dynamically discovered vault
let selectedUsdcVault: any;

(async () => {
  /**
   * ====================================
   * Initialise the environment
   * ====================================
   */
  const { accounts, chainClient } = await init({
    network: "datil",
    deploymentStatus: "dev",
  });

  const rpcUrl = process.env[NETWORK_CONFIG.rpcUrlEnv];
  if (!rpcUrl) {
    throw new Error(
      `${NETWORK_CONFIG.rpcUrlEnv} is not set - can't test on ${NETWORK_CONFIG.network} without an RPC URL`
    );
  }

  if (!process.env.TEST_FUNDER_PRIVATE_KEY) {
    throw new Error(
      `TEST_FUNDER_PRIVATE_KEY is not set - can't test on ${NETWORK_CONFIG.network} without a funder private key`
    );
  }

  const networkProvider = new ethers.providers.JsonRpcProvider(rpcUrl);

  /**
   * ====================================
   * (🫵 You) Prepare the tools and policies
   * ====================================
   */

  const aaveToolClient = getVincentToolClient({
    bundledVincentTool: aaveTool,
    ethersSigner: accounts.delegatee.ethersWallet,
  });

  const morphoToolClient = getVincentToolClient({
    bundledVincentTool: morphoTool,
    ethersSigner: accounts.delegatee.ethersWallet,
  });

  const approveToolClient = getVincentToolClient({
    bundledVincentTool: erc20ApproveTool,
    ethersSigner: accounts.delegatee.ethersWallet,
  });

  /**
   * ====================================
   * Prepare the IPFS CIDs for the tools and policies
   * NOTE: All arrays below are parallel - each index corresponds to the same tool.
   * ❗️If you change the policy parameter values, you will need to reset the state file.
   * You can do this by running: npm run vincent:reset
   * ====================================
   */
  const appConfig = createAppConfig(
    {
      toolIpfsCids: [
        aaveTool.ipfsCid,
        morphoTool.ipfsCid,
        erc20ApproveTool.ipfsCid,
      ],
      toolPolicies: [
        [
          // No policies for AAVE tool for now
        ],
        [
          // No policies for Morpho tool for now
        ],
        [
          // No policies for ERC20 Approval tool
        ],
      ],
      toolPolicyParameterNames: [
        [], // No policy parameter names for aaveTool
        [], // No policy parameter names for morphoTool
        [], // No policy parameter names for approveTool
      ],
      toolPolicyParameterTypes: [
        [], // No policy parameter types for aaveTool
        [], // No policy parameter types for morphoTool
        [], // No policy parameter types for approveTool
      ],
      toolPolicyParameterValues: [
        [], // No policy parameter values for aaveTool
        [], // No policy parameter values for morphoTool
        [], // No policy parameter values for approveTool
      ],
    },

    // Debugging options
    {
      cidToNameMap: {
        [aaveTool.ipfsCid]: "AAVE Tool",
        [morphoTool.ipfsCid]: "Morpho Tool",
        [sendLimitPolicyMetadata.ipfsCid]: "Send Limit Policy",
        [erc20ApproveTool.ipfsCid]: "ERC20 Approval Tool",
      },
      debug: true,
    }
  );

  /**
   * Collect all IPFS CIDs for tools and policies that need to be:
   * 1. Authorised during agent wallet PKP minting
   * 2. Permitted as authentication methods for the PKP
   */
  const toolAndPolicyIpfsCids = [
    aaveTool.ipfsCid,
    morphoTool.ipfsCid,
    erc20ApproveTool.ipfsCid,
    sendLimitPolicyMetadata.ipfsCid,
  ];

  /**
   * ====================================
   * 👦🏻 (Agent Wallet PKP Owner) mint an Agent Wallet PKP
   * ====================================
   */
  const agentWalletPkp = await accounts.agentWalletPkpOwner.mintAgentWalletPkp({
    toolAndPolicyIpfsCids: toolAndPolicyIpfsCids,
  });
  console.log("toolAndPolicyIpfsCids", toolAndPolicyIpfsCids);
  console.log("appConfig.TOOL_IPFS_CIDS", appConfig.TOOL_IPFS_CIDS);

  console.log("🤖 Agent Wallet PKP:", agentWalletPkp);

  /**
   * ====================================
   * 🦹‍♀️ (App Manager Account) Register Vincent app with delegatee
   * ====================================
   */
  const { appId, appVersion } = await chainClient.registerApp({
    toolIpfsCids: appConfig.TOOL_IPFS_CIDS,
    toolPolicies: appConfig.TOOL_POLICIES,
    toolPolicyParameterNames: appConfig.TOOL_POLICY_PARAMETER_NAMES,
    toolPolicyParameterTypes: appConfig.TOOL_POLICY_PARAMETER_TYPES,
  });

  console.log("✅ Vincent app registered:", { appId, appVersion });

  /**
   * ====================================
   * 👦🏻 (Agent Wallet PKP Owner) Permit PKP to use the app version
   * ====================================
   */
  await chainClient.permitAppVersion({
    pkpTokenId: agentWalletPkp.tokenId,
    appId,
    appVersion,
    toolIpfsCids: appConfig.TOOL_IPFS_CIDS,
    policyIpfsCids: appConfig.TOOL_POLICIES,
    policyParameterNames: appConfig.TOOL_POLICY_PARAMETER_NAMES,
    policyParameterValues: appConfig.TOOL_POLICY_PARAMETER_VALUES,
    policyParameterTypes: appConfig.TOOL_POLICY_PARAMETER_TYPES,
  });

  console.log("✅ PKP permitted to use app version");

  /**
   * ====================================
   * 👦🏻 (Agent Wallet PKP Owner) Permit auth methods for the agent wallet PKP
   * ====================================
   */
  const permittedAuthMethodsTxHashes =
    await accounts.agentWalletPkpOwner.permittedAuthMethods({
      agentWalletPkp: agentWalletPkp,
      toolAndPolicyIpfsCids: toolAndPolicyIpfsCids,
    });

  console.log(
    "✅ Permitted Auth Methods Tx hashes:",
    permittedAuthMethodsTxHashes
  );

  /**
   * ====================================
   * Validate tool permissions (debugging)
   * ====================================
   */
  // Test 1: AAVE Tool Validation
  try {
    let validation = await chainClient.validateToolExecution({
      delegateeAddress: accounts.delegatee.ethersWallet.address,
      pkpTokenId: agentWalletPkp.tokenId,
      toolIpfsCid: aaveTool.ipfsCid,
    });

    console.log("✅ AAVE Tool execution validation:", validation);

    if (!validation.isPermitted) {
      throw new Error(
        `Delegatee is not permitted to execute AAVE tool for PKP for IPFS CID: ${
          aaveTool.ipfsCid
        }. Validation: ${JSON.stringify(validation, (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        )}`
      );
    }
    addTestResult("AAVE Tool Validation", true);
  } catch (error) {
    addTestResult("AAVE Tool Validation", false, error.message);
  }

  // Test 2: Morpho Tool Validation
  try {
    let validation = await chainClient.validateToolExecution({
      delegateeAddress: accounts.delegatee.ethersWallet.address,
      pkpTokenId: agentWalletPkp.tokenId,
      toolIpfsCid: morphoTool.ipfsCid,
    });

    console.log("✅ Morpho Tool execution validation:", validation);

    if (!validation.isPermitted) {
      throw new Error(
        `Delegatee is not permitted to execute Morpho tool for PKP for IPFS CID: ${
          morphoTool.ipfsCid
        }. Validation: ${JSON.stringify(validation, (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        )}`
      );
    }
    addTestResult("Morpho Tool Validation", true);
  } catch (error) {
    addTestResult("Morpho Tool Validation", false, error.message);
  }

  // ========================================
  // WETH and ETH Funding Setup
  // ========================================
  const wethContract = new ethers.Contract(
    NETWORK_CONFIG.wethAddress,
    [
      {
        inputs: [{ internalType: "address", name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ],
    networkProvider
  );

  const usdcContract = new ethers.Contract(
    NETWORK_CONFIG.usdcAddress,
    [
      {
        inputs: [{ internalType: "address", name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        inputs: [],
        name: "decimals",
        outputs: [{ internalType: "uint8", name: "", type: "uint8" }],
        stateMutability: "view",
        type: "function",
      },
    ],
    networkProvider
  );

  const usdcDecimals = await usdcContract.decimals();

  const { wethDecimals } = await setupWethFunding(
    networkProvider,
    agentWalletPkp.ethAddress,
    process.env.TEST_FUNDER_PRIVATE_KEY,
    addTestResult,
    CONFIRMATIONS_TO_WAIT,
    NETWORK_CONFIG.network,
    WETH_DEPOSIT_AMOUNT
  );

  await setupEthFunding(
    networkProvider,
    agentWalletPkp.ethAddress,
    process.env.TEST_FUNDER_PRIVATE_KEY,
    addTestResult,
    CONFIRMATIONS_TO_WAIT,
    NETWORK_CONFIG.network,
    "0.002" // 0.002 ETH for gas fees
  );

  // ========================================
  // Dynamic Vault Discovery
  // ========================================
  console.log("🔍 Discovering best USDC vault on Morpho...");

  try {
    selectedUsdcVault = await NETWORK_CONFIG.getBestUsdcVault();
    console.log(
      `✅ Selected vault: ${selectedUsdcVault.name} (${selectedUsdcVault.address})`
    );
    console.log(`   Net APY: ${selectedUsdcVault.metrics.netApy}%`);
    console.log(
      `   TVL: $${selectedUsdcVault.metrics.totalAssetsUsd.toLocaleString()}`
    );
    addTestResult("Morpho Vault Discovery", true);
  } catch (error) {
    console.error("❌ Failed to discover USDC vault:", error.message);
    addTestResult("Morpho Vault Discovery", false, error.message);
    process.exit(1);
  }

  // Setup vault contract for Morpho operations using discovered vault
  const usdcVaultContract = new ethers.Contract(
    selectedUsdcVault.address,
    [
      {
        inputs: [{ internalType: "address", name: "account", type: "address" }],
        name: "balanceOf",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
      {
        inputs: [{ internalType: "uint256", name: "shares", type: "uint256" }],
        name: "convertToAssets",
        outputs: [{ internalType: "uint256", name: "assets", type: "uint256" }],
        stateMutability: "view",
        type: "function",
      },
    ],
    networkProvider
  );

  // ========================================
  // Combined AAVE + Morpho Workflow Testing
  // ========================================
  console.log(
    "🧪 Testing Combined AAVE + Morpho Workflow with Dynamic Vault Discovery"
  );
  console.log(
    `📋 Workflow: AAVE Deposit WETH → Borrow USDC → Morpho Deposit USDC (to ${selectedUsdcVault.name}) → Morpho Redeem USDC → AAVE Repay → AAVE Withdraw WETH`
  );
  console.log(
    `🏛️ Using dynamically discovered vault: ${selectedUsdcVault.address}`
  );
  console.log(
    `📊 Vault metrics: ${
      selectedUsdcVault.metrics.netApy
    }% Net APY, $${selectedUsdcVault.metrics.totalAssetsUsd.toLocaleString()} TVL`
  );

  // Store initial balances for comparison throughout the workflow
  let initialWethBalance: ethers.BigNumber = ethers.BigNumber.from(0);
  let initialUsdcBalance: ethers.BigNumber = ethers.BigNumber.from(0);

  // Test: Initial Balance Check
  try {
    console.log("🔍 Recording initial token balances...");

    // Get initial balances
    initialWethBalance = await wethContract.balanceOf(
      agentWalletPkp.ethAddress
    );
    initialUsdcBalance = await usdcContract.balanceOf(
      agentWalletPkp.ethAddress
    );

    const initialWethFormatted = ethers.utils.formatEther(initialWethBalance);
    const initialUsdcFormatted = ethers.utils.formatUnits(
      initialUsdcBalance,
      usdcDecimals
    );

    console.log(`   Initial WETH balance: ${initialWethFormatted} WETH`);
    console.log(`   Initial USDC balance: ${initialUsdcFormatted} USDC`);

    // Verify PKP has sufficient WETH for the test
    const requiredWethBalance = ethers.utils.parseEther(WETH_DEPOSIT_AMOUNT);
    if (initialWethBalance.lt(requiredWethBalance)) {
      throw new Error(
        `Insufficient WETH balance. Required: ${WETH_DEPOSIT_AMOUNT} WETH, Available: ${initialWethFormatted} WETH`
      );
    }

    addTestResult("Initial Balance Check", true);
  } catch (error) {
    console.error("❌ Initial balance check failed:", error.message);
    addTestResult("Initial Balance Check", false, error.message);
  }

  // ========================================
  // STEP 1: Approve WETH for AAVE Pool
  // ========================================
  console.log(
    "🛂 (STEP 1) Approving WETH for AAVE Pool via ERC20 Approval Tool"
  );

  try {
    const approveWethParams = {
      chainId: NETWORK_CONFIG.chainId,
      tokenAddress: NETWORK_CONFIG.wethAddress,
      spenderAddress: NETWORK_CONFIG.aavePoolAddress,
      tokenAmount: parseFloat(WETH_DEPOSIT_AMOUNT),
      tokenDecimals: wethDecimals,
      rpcUrl: rpcUrl,
    };

    const approveWethPrecheck = await approveToolClient.precheck(
      approveWethParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(APPROVE-PRECHECK-WETH): ",
      JSON.stringify(approveWethPrecheck, null, 2)
    );

    if (approveWethPrecheck.success) {
      const approveWethExecute = await approveToolClient.execute(
        approveWethParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(APPROVE-EXECUTE-WETH): ",
        JSON.stringify(approveWethExecute, null, 2)
      );

      if (approveWethExecute.success) {
        console.log("✅ WETH approval executed successfully");
        if (approveWethExecute.result.approvalTxHash) {
          console.log(
            "🔍 Waiting for WETH approval transaction confirmation..."
          );
          const receipt = await networkProvider.waitForTransaction(
            approveWethExecute.result.approvalTxHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          );
          if (receipt.status === 0) {
            throw new Error(
              `WETH approval transaction reverted: ${approveWethExecute.result.approvalTxHash}`
            );
          }
          console.log(
            `   WETH approval confirmed in block ${receipt.blockNumber}`
          );
        }
        addTestResult("ERC20 Approve WETH for AAVE", true);
      } else {
        console.log("❌ WETH approval execution failed:", approveWethExecute);
        addTestResult(
          "ERC20 Approve WETH for AAVE",
          false,
          JSON.stringify(approveWethExecute, null, 2)
        );
      }
    } else {
      const errMsg = approveWethPrecheck.error || "Unknown precheck error";
      console.log("❌ WETH approval precheck failed:", errMsg);
      addTestResult("ERC20 Approve WETH for AAVE", false, errMsg);
    }
  } catch (error) {
    console.log("❌ WETH approval unexpected error:", error.message || error);
    addTestResult(
      "ERC20 Approve WETH for AAVE",
      false,
      error.message || error.toString()
    );
  }

  // ========================================
  // STEP 2: Deposit WETH to AAVE
  // ========================================
  console.log("🏦 (STEP 2) Deposit WETH to AAVE Pool");

  try {
    const aaveDepositPrecheckParams = {
      operation: "supply",
      asset: NETWORK_CONFIG.wethAddress,
      amount: WETH_DEPOSIT_AMOUNT,
      rpcUrl: rpcUrl,
      chain: NETWORK_CONFIG.network,
    };

    const aaveDepositExecuteParams = {
      operation: "supply",
      asset: NETWORK_CONFIG.wethAddress,
      amount: WETH_DEPOSIT_AMOUNT,
      chain: NETWORK_CONFIG.network,
    };

    const aaveDepositPrecheck = await aaveToolClient.precheck(
      aaveDepositPrecheckParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-DEPOSIT): ",
      JSON.stringify(aaveDepositPrecheck, null, 2)
    );

    if (
      aaveDepositPrecheck.success &&
      !("error" in aaveDepositPrecheck.result)
    ) {
      console.log("✅ (AAVE-PRECHECK-DEPOSIT) WETH deposit precheck passed");

      const aaveDepositExecute = await aaveToolClient.execute(
        aaveDepositExecuteParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-DEPOSIT): ",
        JSON.stringify(aaveDepositExecute, null, 2)
      );

      if (aaveDepositExecute.success) {
        console.log("✅ (STEP 2) AAVE WETH deposit completed successfully!");
        console.log(`   Tx hash: ${aaveDepositExecute.result.txHash}`);

        // Wait for transaction confirmation
        const receipt = await networkProvider.waitForTransaction(
          aaveDepositExecute.result.txHash,
          CONFIRMATIONS_TO_WAIT,
          180000
        );
        if (receipt.status === 0) {
          throw new Error(
            `AAVE deposit transaction reverted: ${aaveDepositExecute.result.txHash}`
          );
        }
        console.log(
          `   ✅ Deposit transaction confirmed in block ${receipt.blockNumber}`
        );

        addTestResult("AAVE Deposit WETH", true);
      } else {
        const errorMsg = `AAVE Deposit execution failed: ${
          aaveDepositExecute.error || "Unknown execution error"
        }`;
        console.log("❌ (STEP 2) AAVE WETH deposit failed:", errorMsg);
        addTestResult("AAVE Deposit WETH", false, errorMsg);
      }
    } else {
      const errorMsg = `AAVE Deposit precheck failed: ${
        aaveDepositPrecheck.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-DEPOSIT)", errorMsg);
      addTestResult("AAVE Deposit WETH", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Deposit operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-DEPOSIT) Unexpected error:", errorMsg);
    addTestResult("AAVE Deposit WETH", false, errorMsg);
  }

  // ========================================
  // STEP 3: Borrow USDC from AAVE
  // ========================================
  console.log("💰 (STEP 3) Borrow USDC from AAVE Pool");

  try {
    const aaveBorrowPrecheckParams = {
      operation: "borrow",
      asset: NETWORK_CONFIG.usdcAddress,
      amount: USDC_BORROW_AMOUNT,
      interestRateMode: 2, // Variable rate
      rpcUrl: rpcUrl,
      chain: NETWORK_CONFIG.network,
    };

    const aaveBorrowExecuteParams = {
      operation: "borrow",
      asset: NETWORK_CONFIG.usdcAddress,
      amount: USDC_BORROW_AMOUNT,
      interestRateMode: 2, // Variable rate
      chain: NETWORK_CONFIG.network,
    };

    const aaveBorrowPrecheck = await aaveToolClient.precheck(
      aaveBorrowPrecheckParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-BORROW): ",
      JSON.stringify(aaveBorrowPrecheck, null, 2)
    );

    if (aaveBorrowPrecheck.success && !("error" in aaveBorrowPrecheck.result)) {
      console.log("✅ (AAVE-PRECHECK-BORROW) USDC borrow precheck passed");

      const aaveBorrowExecute = await aaveToolClient.execute(
        aaveBorrowExecuteParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-BORROW): ",
        JSON.stringify(aaveBorrowExecute, null, 2)
      );

      if (aaveBorrowExecute.success) {
        console.log("✅ (STEP 3) AAVE USDC borrow completed successfully!");
        console.log(`   Tx hash: ${aaveBorrowExecute.result.txHash}`);

        // Wait for transaction confirmation
        const receipt = await networkProvider.waitForTransaction(
          aaveBorrowExecute.result.txHash,
          CONFIRMATIONS_TO_WAIT,
          180000
        );
        if (receipt.status === 0) {
          throw new Error(
            `AAVE borrow transaction reverted: ${aaveBorrowExecute.result.txHash}`
          );
        }
        console.log(
          `   ✅ Borrow transaction confirmed in block ${receipt.blockNumber}`
        );

        // Verify USDC balance increased
        const postBorrowUsdcBalance = await usdcContract.balanceOf(
          agentWalletPkp.ethAddress
        );
        const postBorrowUsdcFormatted = ethers.utils.formatUnits(
          postBorrowUsdcBalance,
          usdcDecimals
        );
        console.log(
          `   Post-borrow USDC balance: ${postBorrowUsdcFormatted} USDC`
        );

        addTestResult("AAVE Borrow USDC", true);
      } else {
        const errorMsg = `AAVE Borrow execution failed: ${
          aaveBorrowExecute.error || "Unknown execution error"
        }`;
        console.log("❌ (STEP 3) AAVE USDC borrow failed:", errorMsg);
        addTestResult("AAVE Borrow USDC", false, errorMsg);
      }
    } else {
      const errorMsg = `AAVE Borrow precheck failed: ${
        aaveBorrowPrecheck.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-BORROW)", errorMsg);
      addTestResult("AAVE Borrow USDC", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Borrow operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-BORROW) Unexpected error:", errorMsg);
    addTestResult("AAVE Borrow USDC", false, errorMsg);
  }

  // ========================================
  // STEP 4: Approve USDC for Morpho Vault
  // ========================================
  console.log(
    "🛂 (STEP 4) Approving USDC for Morpho Vault via ERC20 Approval Tool"
  );

  try {
    const approveUsdcParams = {
      chainId: NETWORK_CONFIG.chainId,
      tokenAddress: NETWORK_CONFIG.usdcAddress,
      spenderAddress: selectedUsdcVault.address,
      tokenAmount: parseFloat(USDC_BORROW_AMOUNT),
      tokenDecimals: usdcDecimals,
      rpcUrl: rpcUrl,
    };

    const approveUsdcPrecheck = await approveToolClient.precheck(
      approveUsdcParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(APPROVE-PRECHECK-USDC): ",
      JSON.stringify(approveUsdcPrecheck, null, 2)
    );

    if (approveUsdcPrecheck.success) {
      const approveUsdcExecute = await approveToolClient.execute(
        approveUsdcParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(APPROVE-EXECUTE-USDC): ",
        JSON.stringify(approveUsdcExecute, null, 2)
      );

      if (approveUsdcExecute.success) {
        console.log("✅ USDC approval executed successfully");
        if (approveUsdcExecute.result.approvalTxHash) {
          console.log(
            "🔍 Waiting for USDC approval transaction confirmation..."
          );
          const receipt = await networkProvider.waitForTransaction(
            approveUsdcExecute.result.approvalTxHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          );
          if (receipt.status === 0) {
            throw new Error(
              `USDC approval transaction reverted: ${approveUsdcExecute.result.approvalTxHash}`
            );
          }
          console.log(
            `   USDC approval confirmed in block ${receipt.blockNumber}`
          );
        }
        addTestResult("ERC20 Approve USDC for Morpho", true);
      } else {
        console.log("❌ USDC approval execution failed:", approveUsdcExecute);
        addTestResult(
          "ERC20 Approve USDC for Morpho",
          false,
          JSON.stringify(approveUsdcExecute, null, 2)
        );
      }
    } else {
      const errMsg = approveUsdcPrecheck.error || "Unknown precheck error";
      console.log("❌ USDC approval precheck failed:", errMsg);
      addTestResult("ERC20 Approve USDC for Morpho", false, errMsg);
    }
  } catch (error) {
    console.log("❌ USDC approval unexpected error:", error.message || error);
    addTestResult(
      "ERC20 Approve USDC for Morpho",
      false,
      error.message || error.toString()
    );
  }

  // ========================================
  // STEP 5: Deposit USDC to Morpho Vault
  // ========================================
  console.log("🏛️ (STEP 5) Deposit USDC to Morpho Vault");

  try {
    const morphoDepositPrecheckParams = {
      operation: "deposit",
      vaultAddress: selectedUsdcVault.address,
      amount: USDC_BORROW_AMOUNT,
      rpcUrl: rpcUrl,
      chain: NETWORK_CONFIG.network,
    };

    const morphoDepositExecuteParams = {
      operation: "deposit",
      vaultAddress: selectedUsdcVault.address,
      amount: USDC_BORROW_AMOUNT,
      chain: NETWORK_CONFIG.network,
    };

    const morphoDepositPrecheck = await morphoToolClient.precheck(
      morphoDepositPrecheckParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(MORPHO-PRECHECK-DEPOSIT): ",
      JSON.stringify(morphoDepositPrecheck, null, 2)
    );

    if (
      morphoDepositPrecheck.success &&
      !("error" in morphoDepositPrecheck.result)
    ) {
      console.log("✅ (MORPHO-PRECHECK-DEPOSIT) USDC deposit precheck passed");

      const morphoDepositExecute = await morphoToolClient.execute(
        morphoDepositExecuteParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(MORPHO-EXECUTE-DEPOSIT): ",
        JSON.stringify(morphoDepositExecute, null, 2)
      );

      if (morphoDepositExecute.success) {
        console.log("✅ (STEP 5) Morpho USDC deposit completed successfully!");
        console.log(`   Tx hash: ${morphoDepositExecute.result.txHash}`);

        // Wait for transaction confirmation
        const receipt = await networkProvider.waitForTransaction(
          morphoDepositExecute.result.txHash,
          CONFIRMATIONS_TO_WAIT,
          180000
        );
        if (receipt.status === 0) {
          throw new Error(
            `Morpho deposit transaction reverted: ${morphoDepositExecute.result.txHash}`
          );
        }
        console.log(
          `   ✅ Deposit transaction confirmed in block ${receipt.blockNumber}`
        );

        // Verify vault shares received
        const postDepositShares = await usdcVaultContract.balanceOf(
          agentWalletPkp.ethAddress
        );
        const postDepositSharesFormatted =
          ethers.utils.formatEther(postDepositShares);
        console.log(
          `   Vault shares received: ${postDepositSharesFormatted} shares`
        );

        addTestResult("Morpho Deposit USDC", true);
      } else {
        const errorMsg = `Morpho Deposit execution failed: ${
          morphoDepositExecute.error || "Unknown execution error"
        }`;
        console.log("❌ (STEP 5) Morpho USDC deposit failed:", errorMsg);
        addTestResult("Morpho Deposit USDC", false, errorMsg);
      }
    } else {
      const errorMsg = `Morpho Deposit precheck failed: ${
        "error" in morphoDepositPrecheck
          ? morphoDepositPrecheck.error
          : "Unknown precheck error"
      }`;
      console.log("❌ (MORPHO-PRECHECK-DEPOSIT)", errorMsg);
      addTestResult("Morpho Deposit USDC", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `Morpho Deposit operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (MORPHO-DEPOSIT) Unexpected error:", errorMsg);
    addTestResult("Morpho Deposit USDC", false, errorMsg);
  }

  // ========================================
  // STEP 6: Redeem USDC from Morpho Vault
  // ========================================
  console.log("💎 (STEP 6) Redeem USDC from Morpho Vault");

  // Get vault position for redeem operation
  let userVaultShares: ethers.BigNumber;
  let userVaultSharesFormatted: string;

  try {
    console.log("🔍 Checking vault position before redeem...");

    userVaultShares = await usdcVaultContract.balanceOf(
      agentWalletPkp.ethAddress
    );
    userVaultSharesFormatted = ethers.utils.formatEther(userVaultShares); // Vault shares have 18 decimals like ETH

    // Estimate assets that will be received for shares
    const estimatedAssets = await usdcVaultContract.convertToAssets(
      userVaultShares
    );
    const estimatedAssetsFormatted = ethers.utils.formatUnits(
      estimatedAssets,
      usdcDecimals
    );

    console.log(`   User vault shares: ${userVaultSharesFormatted} shares`);
    console.log(
      `   Estimated USDC to receive: ${estimatedAssetsFormatted} USDC`
    );

    // Verify user has shares to redeem
    if (userVaultShares.eq(0)) {
      throw new Error("No vault shares found to redeem");
    }

    addTestResult("Morpho Pre-Redeem Check", true);
  } catch (error) {
    console.log("❌ Could not check vault position:", error.message);
    addTestResult("Morpho Pre-Redeem Check", false, error.message);
    return; // Exit if we can't get shares info
  }

  try {
    const morphoRedeemPrecheckParams = {
      operation: "redeem",
      vaultAddress: selectedUsdcVault.address,
      amount: userVaultSharesFormatted,
      rpcUrl: rpcUrl,
      chain: NETWORK_CONFIG.network,
    };

    const morphoRedeemExecuteParams = {
      operation: "redeem",
      vaultAddress: selectedUsdcVault.address,
      amount: userVaultSharesFormatted,
      chain: NETWORK_CONFIG.network,
    };

    const morphoRedeemPrecheck = await morphoToolClient.precheck(
      morphoRedeemPrecheckParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(MORPHO-PRECHECK-REDEEM): ",
      JSON.stringify(morphoRedeemPrecheck, null, 2)
    );

    if (
      morphoRedeemPrecheck.success &&
      !("error" in morphoRedeemPrecheck.result)
    ) {
      console.log("✅ (MORPHO-PRECHECK-REDEEM) USDC redeem precheck passed");

      const morphoRedeemExecute = await morphoToolClient.execute(
        morphoRedeemExecuteParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(MORPHO-EXECUTE-REDEEM): ",
        JSON.stringify(morphoRedeemExecute, null, 2)
      );

      if (morphoRedeemExecute.success) {
        console.log("✅ (STEP 6) Morpho USDC redeem completed successfully!");
        console.log(`   Tx hash: ${morphoRedeemExecute.result.txHash}`);

        // Wait for transaction confirmation
        const receipt = await networkProvider.waitForTransaction(
          morphoRedeemExecute.result.txHash,
          CONFIRMATIONS_TO_WAIT,
          180000
        );
        if (receipt.status === 0) {
          throw new Error(
            `Morpho redeem transaction reverted: ${morphoRedeemExecute.result.txHash}`
          );
        }
        console.log(
          `   ✅ Redeem transaction confirmed in block ${receipt.blockNumber}`
        );

        // Verify USDC balance and vault shares
        const postRedeemUsdcBalance = await usdcContract.balanceOf(
          agentWalletPkp.ethAddress
        );
        const postRedeemShares = await usdcVaultContract.balanceOf(
          agentWalletPkp.ethAddress
        );
        const postRedeemUsdcFormatted = ethers.utils.formatUnits(
          postRedeemUsdcBalance,
          usdcDecimals
        );
        const postRedeemSharesFormatted =
          ethers.utils.formatEther(postRedeemShares);

        console.log(
          `   Post-redeem USDC balance: ${postRedeemUsdcFormatted} USDC`
        );
        console.log(
          `   Post-redeem vault shares: ${postRedeemSharesFormatted} shares`
        );

        addTestResult("Morpho Redeem USDC", true);
      } else {
        const errorMsg = `Morpho Redeem execution failed: ${
          morphoRedeemExecute.error || "Unknown execution error"
        }`;
        console.log("❌ (STEP 6) Morpho USDC redeem failed:", errorMsg);
        addTestResult("Morpho Redeem USDC", false, errorMsg);
      }
    } else {
      const errorMsg = `Morpho Redeem precheck failed: ${
        "error" in morphoRedeemPrecheck
          ? morphoRedeemPrecheck.error
          : "Unknown precheck error"
      }`;
      console.log("❌ (MORPHO-PRECHECK-REDEEM)", errorMsg);
      addTestResult("Morpho Redeem USDC", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `Morpho Redeem operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (MORPHO-REDEEM) Unexpected error:", errorMsg);
    addTestResult("Morpho Redeem USDC", false, errorMsg);
  }

  // ========================================
  // ERC20 Approval for USDC (required for AAVE Repay)
  // ========================================
  console.log("🛂 Approving USDC for AAVE repay via ERC20 Approval Tool");

  try {
    const approveUsdcParams = {
      chainId: NETWORK_CONFIG.chainId,
      tokenAddress: NETWORK_CONFIG.usdcAddress,
      spenderAddress: NETWORK_CONFIG.aavePoolAddress,
      tokenAmount: parseFloat(USDC_BORROW_AMOUNT),
      tokenDecimals: usdcDecimals,
      rpcUrl: rpcUrl,
    };

    const approveUsdcPrecheck = await approveToolClient.precheck(
      approveUsdcParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(APPROVE-PRECHECK-USDC): ",
      JSON.stringify(approveUsdcPrecheck, null, 2)
    );

    if (approveUsdcPrecheck.success) {
      const approveUsdcExecute = await approveToolClient.execute(
        approveUsdcParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(APPROVE-EXECUTE-USDC): ",
        JSON.stringify(approveUsdcExecute, null, 2)
      );

      if (approveUsdcExecute.success) {
        console.log("✅ USDC approval executed successfully");
        if (approveUsdcExecute.result.approvalTxHash) {
          console.log(
            "🔍 Waiting for USDC approval transaction confirmation..."
          );
          // wait for transaction confirmation
          const receipt = await networkProvider.waitForTransaction(
            approveUsdcExecute.result.approvalTxHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          );
          if (receipt.status === 0) {
            throw new Error(
              `USDC approval transaction reverted: ${approveUsdcExecute.result.approvalTxHash}`
            );
          }
          console.log(
            `   USDC approval confirmed in block ${receipt.blockNumber}`
          );
        }
        addTestResult("ERC20 Approve USDC", true);
      } else {
        const errMsg = approveUsdcExecute.error || "Unknown execution error";
        console.log("❌ USDC approval execution failed:", errMsg);
        addTestResult("ERC20 Approve USDC", false, errMsg);
      }
    } else {
      const errMsg = approveUsdcPrecheck.error || "Unknown precheck error";
      console.log("❌ USDC approval precheck failed:", errMsg);
      addTestResult("ERC20 Approve USDC", false, errMsg);
    }
  } catch (error) {
    console.log("❌ USDC approval unexpected error:", error.message || error);
    addTestResult(
      "ERC20 Approve USDC",
      false,
      error.message || error.toString()
    );
  }

  // ========================================
  // STEP 7: Repay USDC to AAVE
  // ========================================
  console.log("💳 (STEP 7) Repay USDC to AAVE Pool");

  try {
    const aaveRepayPrecheckParams = {
      operation: "repay",
      asset: NETWORK_CONFIG.usdcAddress,
      amount: USDC_BORROW_AMOUNT,
      rpcUrl: rpcUrl,
      chain: NETWORK_CONFIG.network,
    };

    const aaveRepayExecuteParams = {
      operation: "repay",
      asset: NETWORK_CONFIG.usdcAddress,
      amount: USDC_BORROW_AMOUNT,
      chain: NETWORK_CONFIG.network,
    };

    const aaveRepayPrecheck = await aaveToolClient.precheck(
      aaveRepayPrecheckParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-REPAY): ",
      JSON.stringify(aaveRepayPrecheck, null, 2)
    );

    if (aaveRepayPrecheck.success && !("error" in aaveRepayPrecheck.result)) {
      console.log("✅ (AAVE-PRECHECK-REPAY) USDC repay precheck passed");

      const aaveRepayExecute = await aaveToolClient.execute(
        aaveRepayExecuteParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-REPAY): ",
        JSON.stringify(aaveRepayExecute, null, 2)
      );

      if (aaveRepayExecute.success) {
        console.log("✅ (STEP 7) AAVE USDC repay completed successfully!");
        console.log(`   Tx hash: ${aaveRepayExecute.result.txHash}`);

        // Wait for transaction confirmation
        const receipt = await networkProvider.waitForTransaction(
          aaveRepayExecute.result.txHash,
          CONFIRMATIONS_TO_WAIT,
          180000
        );
        if (receipt.status === 0) {
          throw new Error(
            `AAVE repay transaction reverted: ${aaveRepayExecute.result.txHash}`
          );
        }
        console.log(
          `   ✅ Repay transaction confirmed in block ${receipt.blockNumber}`
        );

        addTestResult("AAVE Repay USDC", true);
      } else {
        const errorMsg = `AAVE Repay execution failed: ${
          aaveRepayExecute.error || "Unknown execution error"
        }`;
        console.log("❌ (STEP 7) AAVE USDC repay failed:", errorMsg);
        addTestResult("AAVE Repay USDC", false, errorMsg);
      }
    } else {
      const errorMsg = `AAVE Repay precheck failed: ${
        aaveRepayPrecheck.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-REPAY)", errorMsg);
      addTestResult("AAVE Repay USDC", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Repay operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-REPAY) Unexpected error:", errorMsg);
    addTestResult("AAVE Repay USDC", false, errorMsg);
  }

  // ========================================
  // STEP 8: Withdraw WETH from AAVE
  // ========================================
  console.log("🏦 (STEP 8) Withdraw WETH from AAVE Pool");

  try {
    const aaveWithdrawPrecheckParams = {
      operation: "withdraw",
      asset: NETWORK_CONFIG.wethAddress,
      amount: WETH_DEPOSIT_AMOUNT,
      rpcUrl: rpcUrl,
      chain: NETWORK_CONFIG.network,
    };

    const aaveWithdrawExecuteParams = {
      operation: "withdraw",
      asset: NETWORK_CONFIG.wethAddress,
      amount: WETH_DEPOSIT_AMOUNT,
      chain: NETWORK_CONFIG.network,
    };

    const aaveWithdrawPrecheck = await aaveToolClient.precheck(
      aaveWithdrawPrecheckParams,
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-WITHDRAW): ",
      JSON.stringify(aaveWithdrawPrecheck, null, 2)
    );

    if (
      aaveWithdrawPrecheck.success &&
      !("error" in aaveWithdrawPrecheck.result)
    ) {
      console.log("✅ (AAVE-PRECHECK-WITHDRAW) WETH withdraw precheck passed");

      const aaveWithdrawExecute = await aaveToolClient.execute(
        aaveWithdrawExecuteParams,
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-WITHDRAW): ",
        JSON.stringify(aaveWithdrawExecute, null, 2)
      );

      if (aaveWithdrawExecute.success) {
        console.log("✅ (STEP 8) AAVE WETH withdraw completed successfully!");
        console.log(`   Tx hash: ${aaveWithdrawExecute.result.txHash}`);

        // Wait for transaction confirmation
        const receipt = await networkProvider.waitForTransaction(
          aaveWithdrawExecute.result.txHash,
          CONFIRMATIONS_TO_WAIT,
          180000
        );
        if (receipt.status === 0) {
          throw new Error(
            `AAVE withdraw transaction reverted: ${aaveWithdrawExecute.result.txHash}`
          );
        }
        console.log(
          `   ✅ Withdraw transaction confirmed in block ${receipt.blockNumber}`
        );

        // Final balance verification
        const finalWethBalance = await wethContract.balanceOf(
          agentWalletPkp.ethAddress
        );
        const finalUsdcBalance = await usdcContract.balanceOf(
          agentWalletPkp.ethAddress
        );

        const finalWethFormatted = ethers.utils.formatEther(finalWethBalance);
        const usdcDecimals = await usdcContract.decimals();
        const finalUsdcFormatted = ethers.utils.formatUnits(
          finalUsdcBalance,
          usdcDecimals
        );

        console.log(`   Final WETH balance: ${finalWethFormatted} WETH`);
        console.log(`   Final USDC balance: ${finalUsdcFormatted} USDC`);

        // Check if we ended up with more USDC (rewards from Morpho)
        const usdcGained = finalUsdcBalance.sub(initialUsdcBalance);
        if (usdcGained.gt(0)) {
          const usdcGainedFormatted = ethers.utils.formatUnits(
            usdcGained,
            usdcDecimals
          );
          console.log(
            `   🎉 USDC rewards earned from Morpho: ${usdcGainedFormatted} USDC`
          );
        }

        addTestResult("AAVE Withdraw WETH", true);
      } else {
        const errorMsg = `AAVE Withdraw execution failed: ${
          aaveWithdrawExecute.error || "Unknown execution error"
        }`;
        console.log("❌ (STEP 8) AAVE WETH withdraw failed:", errorMsg);
        addTestResult("AAVE Withdraw WETH", false, errorMsg);
      }
    } else {
      const errorMsg = `AAVE Withdraw precheck failed: ${
        aaveWithdrawPrecheck.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-WITHDRAW)", errorMsg);
      addTestResult("AAVE Withdraw WETH", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Withdraw operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-WITHDRAW) Unexpected error:", errorMsg);
    addTestResult("AAVE Withdraw WETH", false, errorMsg);
  }

  // ========================================
  // Print Test Summary and Exit
  // ========================================
  const allTestsPassed = printTestSummary();
  process.exit(allTestsPassed ? 0 : 1);
})();
