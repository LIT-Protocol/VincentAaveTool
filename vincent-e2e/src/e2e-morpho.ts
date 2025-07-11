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
import { bundledVincentTool as morphoTool } from "../../vincent-packages/tools/morpho/dist/index.js";
import { bundledVincentTool as erc20ApproveTool } from "@lit-protocol/vincent-tool-erc20-approval";
import { ethers } from "ethers";
import {
  CHAIN_IDS,
  getBestVaultsForAsset,
  getTokenAddress,
  getSupportedChainsWithVaults,
  getVaultDiscoverySummary,
  getVaults,
} from "../../vincent-packages/tools/morpho/dist/lib/helpers/index.js";
import {
  setupWethFunding,
  setupEthFunding,
  addTestResult,
  printTestSummary,
} from "./test-utils.js";
import { testMorphoVaultFiltering } from "./morpho-vaults.js";

// ========================================
// NETWORK CONFIGURATION - CHANGE THIS TO TEST ON OTHER NETWORKS
// ========================================
const NETWORK_NAME = "base"; // Options: "sepolia", "base"

const NETWORK_CONFIG = {
  // Network to test on
  network: NETWORK_NAME,

  // Chain ID for the network
  chainId: CHAIN_IDS[NETWORK_NAME],

  // RPC URL environment variable
  rpcUrlEnv: `${NETWORK_NAME.toUpperCase()}_RPC_URL`,

  // Get token addresses dynamically based on chain
  get testTokens() {
    return {
      WETH: getTokenAddress("WETH", this.chainId),
      USDC: getTokenAddress("USDC", this.chainId),
      USDT: getTokenAddress("USDT", this.chainId),
    };
  },

  // Convenience getters for commonly used addresses
  get wethAddress() {
    return getTokenAddress("WETH", this.chainId);
  },
  get usdcAddress() {
    return getTokenAddress("USDC", this.chainId);
  },

  // Dynamic vault discovery methods
  async getTopVaultAddresses(limit: number = 5) {
    const vaults = await getVaults({
      chainId: this.chainId,
      sortBy: "totalAssetsUsd",
      sortOrder: "desc",
      limit,
      excludeIdle: true,
    });
    return vaults.map((vault) => vault.address);
  },
  async getBestWethVaults(limit: number = 5) {
    return getBestVaultsForAsset("WETH", limit);
  },
  async getChainSummary() {
    return getVaultDiscoverySummary(this.chainId);
  },
} as const;

const CONFIRMATIONS_TO_WAIT = 2;

(async () => {
  /**
   * ====================================
   * Multi-Chain Vault Discovery & Network Analysis
   * ====================================
   */
  console.log("🌐 Discovering supported chains and vault ecosystem...");

  try {
    // Get all supported chains with active vaults
    const supportedChains = await getSupportedChainsWithVaults();
    console.log("📋 Morpho-supported chains with active vaults:");
    supportedChains.forEach((chain) => {
      console.log(
        `   ${chain.name} (${chain.chainId}): ${chain.vaultCount} vaults`
      );
    });

    // Get detailed summary for current chain
    const chainSummary = await NETWORK_CONFIG.getChainSummary();
    console.log(`\n📊 ${chainSummary.chainName} Chain Summary:`);
    console.log(`   Total Vaults: ${chainSummary.totalVaults}`);
    console.log(`   Total TVL: $${chainSummary.totalTvl.toLocaleString()}`);
    console.log(`   Asset Breakdown:`);
    chainSummary.assetBreakdown.slice(0, 5).forEach((asset) => {
      console.log(
        `     ${asset.symbol}: ${
          asset.count
        } vaults, $${asset.totalTvl.toLocaleString()} TVL, ${
          100 * asset.maxNetApy.toFixed(4)
        }% max APY`
      );
    });

    addTestResult("Multi-Chain Discovery", true);
  } catch (error) {
    console.error(
      "❌ Failed to discover multi-chain ecosystem:",
      error.message
    );
    addTestResult("Multi-Chain Discovery", false, error.message);
  }

  /**
   * ====================================
   * Dynamic WETH Vault Discovery
   * ====================================
   */
  console.log("🔍 Discovering best WETH vault dynamically...");
  let dynamicWethVaultAddress: string;

  try {
    // Get best WETH vault for this chain
    const bestVaults = await getVaults({
      assetSymbol: "WETH",
      chainId: NETWORK_CONFIG.chainId,
      sortBy: "netApy",
      sortOrder: "desc",
      limit: 100,
      excludeIdle: true,
    });

    if (bestVaults.length === 0) {
      throw new Error(`No WETH vaults found on ${NETWORK_NAME}`);
    }

    dynamicWethVaultAddress = bestVaults[0].address;
    console.log(
      `✅ Found best WETH vault: ${dynamicWethVaultAddress} with Net APY: ${
        100 * bestVaults[0].metrics.netApy.toFixed(4)
      }%`
    );

    // Get vault details for logging
    const wethVaults = await getBestVaultsForAsset("WETH", 100);
    const chainVaults = wethVaults.filter(
      (vault: any) => vault.chain.id === NETWORK_CONFIG.chainId
    );

    if (chainVaults.length > 0) {
      console.log("📊 Top WETH vaults on", NETWORK_NAME + ":");
      chainVaults.forEach((vault, index) => {
        console.log(`   ${index + 1}. ${vault.name} (${vault.symbol})`);
        console.log(`      Address: ${vault.address}`);
        console.log(`      APY: ${100 * vault.metrics.netApy.toFixed(4)}%`);
        console.log(
          `      TVL: $${vault.metrics.totalAssetsUsd.toLocaleString()}`
        );
        console.log(
          `      Asset: ${vault.asset.symbol} (${vault.asset.address})`
        );
      });
    }

    addTestResult("Dynamic WETH Vault Discovery", true);
  } catch (error) {
    console.error(
      "❌ Failed to discover WETH vault dynamically:",
      error.message
    );
    throw new Error(
      `Cannot proceed without a valid WETH vault address: ${error.message}`
    );
  }

  /**
   * ====================================
   * Vault Filtering and Sorting Tests
   * ====================================
   */
  await testMorphoVaultFiltering(NETWORK_CONFIG.chainId, NETWORK_NAME);

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
      toolIpfsCids: [morphoTool.ipfsCid, erc20ApproveTool.ipfsCid],
      toolPolicies: [
        [
          // No policies for Morpho tool for now
        ],
        [
          // No policies for ERC20 Approval tool
        ],
      ],
      toolPolicyParameterNames: [
        [], // No policy parameter names for morphoTool
        [], // No policy parameter names for approveTool
      ],
      toolPolicyParameterTypes: [
        [], // No policy parameter types for morphoTool
        [], // No policy parameter types for approveTool
      ],
      toolPolicyParameterValues: [
        [], // No policy parameter values for morphoTool
        [], // No policy parameter values for approveTool
      ],
    },

    // Debugging options
    {
      cidToNameMap: {
        [morphoTool.ipfsCid]: "Morpho Tool",
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
  const toolAndPolicyIpfsCids = [morphoTool.ipfsCid, erc20ApproveTool.ipfsCid];

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
   * Validate delegatee permissions (debugging)
   * ====================================
   */
  // Test 1: Morpho Tool Validation
  try {
    let validation = await chainClient.validateToolExecution({
      delegateeAddress: accounts.delegatee.ethersWallet.address,
      pkpTokenId: agentWalletPkp.tokenId,
      toolIpfsCid: morphoTool.ipfsCid,
    });

    console.log("✅ Morpho Tool execution validation:", validation);

    if (!validation.isPermitted) {
      throw new Error(
        `Delegatee is not permitted to execute morpho tool for PKP for IPFS CID: ${
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
  const WETH_DEPOSIT_AMOUNT = "0.001"; // 0.001 WETH to deposit

  const { wethContract, wethDecimals } = await setupWethFunding(
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
  // Morpho Tool Testing - Complete Workflow
  // ========================================
  console.log("🧪 Testing Morpho Tool - Vault Workflow");
  console.log(
    "📋 Workflow: Deposit WETH → Redeem vault shares for WETH + rewards"
  );

  // Store initial balances for comparison throughout the workflow
  let initialWethBalance: ethers.BigNumber = ethers.BigNumber.from(0);

  // Test: Initial Balance Check
  try {
    console.log("🔍 Recording initial token balances...");

    // Get initial balances
    initialWethBalance = await wethContract.balanceOf(
      agentWalletPkp.ethAddress
    );
    const initialWethFormatted = ethers.utils.formatEther(initialWethBalance);

    console.log(`   Initial WETH balance: ${initialWethFormatted} WETH`);

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

  // Setup vault contract for balance checks
  const vaultContract = new ethers.Contract(
    dynamicWethVaultAddress,
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
  // ERC20 Approval for WETH (required for Morpho Vault Deposit)
  // ========================================
  console.log("🛂 Approving WETH for Morpho vault via ERC20 Approval Tool");

  try {
    const approveWethParams = {
      chainId: NETWORK_CONFIG.chainId,
      tokenAddress: NETWORK_CONFIG.wethAddress,
      spenderAddress: dynamicWethVaultAddress,
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
          // wait for transaction confirmation
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
        addTestResult("ERC20 Approve WETH", true);
      } else {
        console.log("❌ WETH approval execution failed:", approveWethExecute);
        addTestResult(
          "ERC20 Approve WETH",
          false,
          JSON.stringify(approveWethExecute, null, 2)
        );
      }
    } else {
      const errMsg = approveWethPrecheck.error || "Unknown precheck error";
      console.log("❌ WETH approval precheck failed:", errMsg);
      addTestResult("ERC20 Approve WETH", false, errMsg);
    }
  } catch (error) {
    console.log("❌ WETH approval unexpected error:", error.message || error);
    addTestResult(
      "ERC20 Approve WETH",
      false,
      error.message || error.toString()
    );
  }

  // ========================================
  // STEP 1: Deposit WETH to Morpho Vault
  // ========================================
  console.log("(MORPHO-STEP-1) Deposit WETH to vault");

  console.log(`   Depositing ${WETH_DEPOSIT_AMOUNT} WETH to vault`);
  console.log(`   Vault Address: ${dynamicWethVaultAddress}`);

  // Morpho Deposit Operation
  try {
    const morphoDepositPrecheckRes = await morphoToolClient.precheck(
      {
        operation: "deposit",
        vaultAddress: dynamicWethVaultAddress,
        amount: WETH_DEPOSIT_AMOUNT,
        rpcUrl: rpcUrl,
        chain: NETWORK_CONFIG.network,
      },
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(MORPHO-PRECHECK-DEPOSIT): ",
      JSON.stringify(morphoDepositPrecheckRes, null, 2)
    );

    if (
      morphoDepositPrecheckRes.success &&
      !("error" in morphoDepositPrecheckRes.result)
    ) {
      console.log("✅ (MORPHO-PRECHECK-DEPOSIT) WETH deposit precheck passed");

      // Execute the deposit operation
      console.log("🚀 (MORPHO-DEPOSIT) Executing WETH deposit operation...");

      const morphoDepositExecuteRes = await morphoToolClient.execute(
        {
          operation: "deposit",
          vaultAddress: dynamicWethVaultAddress,
          amount: WETH_DEPOSIT_AMOUNT,
          chain: NETWORK_CONFIG.network,
        },
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(MORPHO-EXECUTE-DEPOSIT): ",
        JSON.stringify(morphoDepositExecuteRes, null, 2)
      );

      if (morphoDepositExecuteRes.success) {
        console.log("✅ (MORPHO-STEP-1) WETH deposit completed successfully!");
        console.log(`   Tx hash: ${morphoDepositExecuteRes.result.txHash}`);

        // Wait for transaction confirmation
        try {
          console.log("⏳ Waiting for deposit transaction confirmation...");
          const receipt = await networkProvider.waitForTransaction(
            morphoDepositExecuteRes.result.txHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          );
          if (receipt.status === 0) {
            throw new Error(
              `Morpho deposit transaction reverted: ${morphoDepositExecuteRes.result.txHash}`
            );
          }
          console.log(
            `   ✅ Deposit transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Transaction confirmation failed",
            confirmError.message
          );
          throw confirmError;
        }

        // Comprehensive balance verification after deposit
        try {
          console.log("🔍 Verifying balances after deposit...");

          // Check WETH balance (should be reduced by deposit amount)
          const postDepositWethBalance = await wethContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postDepositWethBalanceFormatted = ethers.utils.formatEther(
            postDepositWethBalance
          );
          console.log(
            `   Post-deposit WETH balance: ${postDepositWethBalanceFormatted} WETH`
          );

          // Check vault shares balance (should now have shares)
          const postDepositShares = await vaultContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postDepositSharesFormatted =
            ethers.utils.formatEther(postDepositShares);
          console.log(
            `   Post-deposit vault shares: ${postDepositSharesFormatted} shares`
          );

          // Expected WETH: balance should be reduced by the deposited amount
          const depositedAmount = ethers.utils.parseEther(WETH_DEPOSIT_AMOUNT);
          const expectedWethBalance = initialWethBalance.sub(depositedAmount);
          const expectedWethBalanceFormatted =
            ethers.utils.formatEther(expectedWethBalance);

          console.log(
            `   Expected WETH balance: ${expectedWethBalanceFormatted} WETH`
          );

          // Validation 1: WETH balance should be reduced
          const wethBalanceCorrect =
            postDepositWethBalance.eq(expectedWethBalance);

          // Validation 2: Should have received vault shares (greater than 0)
          const hasVaultShares = postDepositShares.gt(0);

          if (wethBalanceCorrect && hasVaultShares) {
            console.log("✅ WETH balance correctly reduced after deposit");
            console.log("✅ Vault shares received successfully");
            addTestResult("Morpho Deposit WETH", true);
          } else {
            let errorMsg = "";
            if (!wethBalanceCorrect) {
              errorMsg += `WETH balance mismatch. Expected: ${expectedWethBalanceFormatted} WETH, Got: ${postDepositWethBalanceFormatted} WETH. `;
            }
            if (!hasVaultShares) {
              errorMsg += `No vault shares received. Expected > 0, Got: ${postDepositSharesFormatted} shares.`;
            }
            console.log(`❌ ${errorMsg}`);
            addTestResult("Morpho Deposit WETH", false, errorMsg.trim());
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify balances after deposit:",
            balanceError.message
          );
          addTestResult(
            "Morpho Deposit WETH",
            false,
            `Balance verification failed: ${balanceError.message}`
          );
        }
      } else {
        const errorMsg = `Deposit execution failed: ${
          morphoDepositExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ (MORPHO-STEP-1) WETH deposit failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(morphoDepositExecuteRes, null, 2)
        );
        addTestResult("Morpho Deposit WETH", false, errorMsg);
      }
    } else {
      const errorMsg = `Deposit precheck failed: ${
        "error" in morphoDepositPrecheckRes
          ? morphoDepositPrecheckRes.error
          : "Unknown precheck error"
      }`;
      console.log("❌ (MORPHO-PRECHECK-DEPOSIT)", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(morphoDepositPrecheckRes, null, 2)
      );
      addTestResult("Morpho Deposit WETH", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `Morpho Deposit operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (MORPHO-DEPOSIT) Unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("Morpho Deposit WETH", false, errorMsg);
  }

  // ========================================
  // STEP 2: Redeem vault shares for WETH + rewards
  // ========================================
  console.log("(MORPHO-STEP-2) Redeem vault shares for WETH + rewards");

  // Get vault position for redeem operation
  let userVaultShares: ethers.BigNumber;
  let userVaultSharesFormatted: string;

  try {
    console.log("🔍 Checking vault position before redeem...");

    userVaultShares = await vaultContract.balanceOf(agentWalletPkp.ethAddress);
    userVaultSharesFormatted = ethers.utils.formatEther(userVaultShares);

    // Estimate assets that will be received for shares
    const estimatedAssets = await vaultContract.convertToAssets(
      userVaultShares
    );
    const estimatedAssetsFormatted = ethers.utils.formatEther(estimatedAssets);

    console.log(`   User vault shares: ${userVaultSharesFormatted} shares`);
    console.log(
      `   Estimated WETH to receive: ${estimatedAssetsFormatted} WETH`
    );
    console.log(`   Redeeming all vault shares for WETH + rewards`);

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

  // Morpho Redeem Operation
  try {
    const morphoRedeemPrecheckRes = await morphoToolClient.precheck(
      {
        operation: "redeem",
        vaultAddress: dynamicWethVaultAddress,
        amount: userVaultSharesFormatted, // Pass shares amount for redeem
        rpcUrl: rpcUrl,
        chain: NETWORK_CONFIG.network,
      },
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(MORPHO-PRECHECK-REDEEM): ",
      JSON.stringify(morphoRedeemPrecheckRes, null, 2)
    );

    if (
      morphoRedeemPrecheckRes.success &&
      !("error" in morphoRedeemPrecheckRes.result)
    ) {
      console.log("✅ (MORPHO-PRECHECK-REDEEM) Share redeem precheck passed");

      // Execute the redeem operation
      console.log("🚀 (MORPHO-REDEEM) Executing share redeem operation...");

      const morphoRedeemExecuteRes = await morphoToolClient.execute(
        {
          operation: "redeem",
          vaultAddress: dynamicWethVaultAddress,
          amount: userVaultSharesFormatted,
          chain: NETWORK_CONFIG.network,
        },
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(MORPHO-EXECUTE-REDEEM): ",
        JSON.stringify(morphoRedeemExecuteRes, null, 2)
      );

      if (morphoRedeemExecuteRes.success) {
        console.log("✅ (MORPHO-STEP-2) Share redeem completed successfully!");
        console.log(
          `   Transaction Hash: ${morphoRedeemExecuteRes.result.txHash}`
        );

        // Wait for transaction confirmation
        try {
          console.log("⏳ Waiting for redeem transaction confirmation...");

          const receipt = await networkProvider.waitForTransaction(
            morphoRedeemExecuteRes.result.txHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          );
          if (receipt.status === 0) {
            throw new Error(
              `Morpho redeem transaction reverted: ${morphoRedeemExecuteRes.result.txHash}`
            );
          }
          console.log(
            `   ✅ Redeem transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Transaction confirmation failed",
            confirmError.message
          );
          throw confirmError;
        }

        // Comprehensive balance verification after redeem
        try {
          console.log("🔍 Verifying balances after redeem...");

          // Check WETH balance (should be back to initial + rewards)
          const postRedeemWethBalance = await wethContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postRedeemWethBalanceFormatted = ethers.utils.formatEther(
            postRedeemWethBalance
          );
          console.log(
            `   Post-redeem WETH balance: ${postRedeemWethBalanceFormatted} WETH`
          );

          // Check vault shares balance (should be 0 or very close to 0)
          const postRedeemShares = await vaultContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postRedeemSharesFormatted =
            ethers.utils.formatEther(postRedeemShares);
          console.log(
            `   Post-redeem vault shares: ${postRedeemSharesFormatted} shares`
          );

          // Reference balances for validation
          const initialWethFormatted =
            ethers.utils.formatEther(initialWethBalance);
          console.log(`   Initial WETH balance: ${initialWethFormatted} WETH`);

          // Calculate deposited amount for comparison
          const depositedAmount = ethers.utils.parseEther(WETH_DEPOSIT_AMOUNT);
          const depositedAmountFormatted =
            ethers.utils.formatEther(depositedAmount);
          console.log(`   Amount deposited: ${depositedAmountFormatted} WETH`);

          // Validation 1: WETH balance should be at least initial amount (may be more due to rewards)
          const wethBalanceIncreased =
            postRedeemWethBalance.gte(initialWethBalance);

          // Validation 2: WETH balance should be higher than what we deposited (rewards earned)
          const earnedRewards = postRedeemWethBalance.gt(depositedAmount);

          // Validation 3: Vault shares should be 0 or very close to 0 (allowing for rounding dust)
          const maxDustShares = ethers.utils.parseUnits("0.000001", 18); // 1 microshare tolerance
          const vaultSharesEmpty = postRedeemShares.lte(maxDustShares);

          // Calculate rewards earned
          const rewardsEarned = postRedeemWethBalance.sub(initialWethBalance);
          const rewardsFormatted = ethers.utils.formatEther(rewardsEarned);

          if (wethBalanceIncreased && earnedRewards && vaultSharesEmpty) {
            console.log("✅ WETH balance returned to at least initial amount");
            console.log(`✅ Rewards earned: ${rewardsFormatted} WETH`);
            console.log("✅ Vault shares successfully redeemed (balance ~0)");
            console.log(
              `✅ Total return higher than deposit (${postRedeemWethBalanceFormatted} WETH > ${depositedAmountFormatted} WETH)`
            );
            addTestResult("Morpho Redeem WETH", true);
          } else {
            let errorMsg = "";
            if (!wethBalanceIncreased) {
              errorMsg += `WETH balance not restored. Expected: >= ${initialWethFormatted} WETH, Got: ${postRedeemWethBalanceFormatted} WETH. `;
            }
            if (!earnedRewards) {
              errorMsg += `No rewards earned. Expected: > ${depositedAmountFormatted} WETH, Got: ${postRedeemWethBalanceFormatted} WETH. `;
            }
            if (!vaultSharesEmpty) {
              errorMsg += `Vault shares not fully redeemed. Expected: ~0 shares, Got: ${postRedeemSharesFormatted} shares.`;
            }
            console.log(`❌ ${errorMsg}`);
            addTestResult("Morpho Redeem WETH", false, errorMsg.trim());
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify balances after redeem:",
            balanceError.message
          );
          addTestResult(
            "Morpho Redeem WETH",
            false,
            `Balance verification failed: ${balanceError.message}`
          );
        }
      } else {
        const errorMsg = `Redeem execution failed: ${
          morphoRedeemExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ (MORPHO-STEP-2) Share redeem failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(morphoRedeemExecuteRes, null, 2)
        );
        addTestResult("Morpho Redeem WETH", false, errorMsg);
      }
    } else {
      const errorMsg = `Redeem precheck failed: ${
        "error" in morphoRedeemPrecheckRes
          ? morphoRedeemPrecheckRes.error
          : "Unknown precheck error"
      }`;
      console.log("❌ (MORPHO-PRECHECK-REDEEM)", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(morphoRedeemPrecheckRes, null, 2)
      );
      addTestResult("Morpho Redeem WETH", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `Morpho Redeem operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (MORPHO-REDEEM) Unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("Morpho Redeem WETH", false, errorMsg);
  }

  // ========================================
  // Print Test Summary and Exit
  // ========================================
  const allTestsPassed = printTestSummary();
  process.exit(allTestsPassed ? 0 : 1);
})();
