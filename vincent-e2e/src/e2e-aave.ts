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
// Tools and Policies that we wil be testing
import { vincentPolicyMetadata as sendLimitPolicyMetadata } from "../../vincent-packages/policies/send-counter-limit/dist/index.js";
import { bundledVincentTool as aaveTool } from "../../vincent-packages/tools/aave/dist/index.js";
import { bundledVincentTool as erc20ApproveTool } from "@lit-protocol/vincent-tool-erc20-approval";
import { ethers } from "ethers";
import {
  getAaveAddresses,
  getTestTokens,
  CHAIN_IDS,
} from "../../vincent-packages/tools/aave/dist/lib/helpers/index.js";
import {
  verifyAaveState,
  resetAaveStateTracking,
  AaveAccountData,
  setupWethFunding,
  setupEthFunding,
  setupUsdcContract,
  TestResult,
  TEST_WETH_ADDRESS,
  TEST_USDC_ADDRESS,
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
  chainId: CHAIN_IDS[NETWORK_NAME],

  // RPC URL environment variable
  rpcUrlEnv: `${NETWORK_NAME.toUpperCase()}_RPC_URL`,

  // Get addresses dynamically based on chain
  get aaveAddresses() {
    return getAaveAddresses(NETWORK_NAME);
  },
  get testTokens() {
    return getTestTokens(NETWORK_NAME);
  },

  // Convenience getters for commonly used addresses
  get aavePoolAddress() {
    return this.aaveAddresses.POOL;
  },
  get wethAddress() {
    return this.testTokens.WETH;
  },
  get usdcAddress() {
    return this.testTokens.USDC;
  },
} as const;

// ========================================
// BASE NETWORK EXAMPLE CONFIGURATION
// ========================================
// To test on Base, simply change NETWORK_NAME above to "base":
// const NETWORK_NAME = "base";
//
// The configuration will automatically use the correct addresses and settings.
// Just ensure you have BASE_RPC_URL set in your .env file.
//
// Supported networks: "sepolia", "base"

const CONFIRMATIONS_TO_WAIT = 2;

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
        // helloWorldTool.ipfsCid,
        aaveTool.ipfsCid,
        erc20ApproveTool.ipfsCid,
        // ...add more tool IPFS CIDs here
      ],
      toolPolicies: [
        // [
        //   // fooLimitPolicyMetadata.ipfsCid
        // ],
        [
          // No policies for AAVE tool for now
        ],
        [
          // No policies for ERC20 Approval tool
        ],
      ],
      toolPolicyParameterNames: [
        // [], // No policy parameter names for helloWorldTool
        [], // No policy parameter names for aaveTool
        [], // No policy parameter names for approveTool
      ],
      toolPolicyParameterTypes: [
        // [], // No policy parameter types for helloWorldTool
        [], // No policy parameter types for aaveTool
        [], // No policy parameter types for approveTool
      ],
      toolPolicyParameterValues: [
        // [], // No policy parameter values for helloWorldTool
        [], // No policy parameter values for aaveTool
        [], // No policy parameter values for approveTool
      ],
    },

    // Debugging options
    {
      cidToNameMap: {
        // [helloWorldTool.ipfsCid]: "Hello World Tool",
        [aaveTool.ipfsCid]: "AAVE Tool",
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
    // helloWorldTool.ipfsCid,
    aaveTool.ipfsCid,
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
   * Validate delegatee permissions (debugging)
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
        `Delegatee is not permitted to execute aave tool for PKP for IPFS CID: ${
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

  // ========================================
  // WETH and ETH Funding Setup
  // ========================================
  const WETH_SUPPLY_AMOUNT = "0.001"; // 0.001 WETH as collateral
  const { wethContract, wethDecimals } = await setupWethFunding(
    networkProvider,
    agentWalletPkp.ethAddress,
    process.env.TEST_FUNDER_PRIVATE_KEY,
    addTestResult,
    CONFIRMATIONS_TO_WAIT,
    NETWORK_CONFIG.network,
    WETH_SUPPLY_AMOUNT
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

  const { usdcContract, usdcDecimals } = await setupUsdcContract(
    networkProvider,
    NETWORK_CONFIG.network
  );

  // ========================================
  // AAVE Tool Testing - Complete Workflow
  // ========================================
  console.log("🧪 Testing AAVE Tool - Complete DeFi Workflow");
  console.log(
    "📋 Workflow: Supply WETH → Borrow USDC → Repay USDC → Withdraw WETH"
  );

  const USDC_BORROW_AMOUNT = "0.1"; // 0.1 USDC

  // Store initial balances for comparison throughout the workflow
  let initialWethBalance: ethers.BigNumber = ethers.BigNumber.from(0);
  let initialUsdcBalance: ethers.BigNumber = ethers.BigNumber.from(0);

  // Store initial AAVE state for end-to-end comparison
  let initialAaveState: AaveAccountData | null = null;

  // Reset state tracking for clean test isolation
  resetAaveStateTracking();

  // Record initial AAVE state before any operations
  console.log("🔍 Recording initial AAVE state...");
  try {
    initialAaveState = await verifyAaveState(
      networkProvider,
      agentWalletPkp.ethAddress,
      "initial",
      {},
      NETWORK_CONFIG.network
    );
    console.log("📊 Initial AAVE State Recorded:");
    console.log(
      `   - Collateral: ${ethers.utils.formatUnits(
        initialAaveState.totalCollateralBase,
        8
      )} USD`
    );
    console.log(
      `   - Debt: ${ethers.utils.formatUnits(
        initialAaveState.totalDebtBase,
        8
      )} USD`
    );
    console.log(
      `   - Available Borrow: ${ethers.utils.formatUnits(
        initialAaveState.availableBorrowsBase,
        8
      )} USD`
    );
    addTestResult("Initial AAVE State Check", true);
  } catch (error) {
    addTestResult("Initial AAVE State Check", false, error.message);
  }

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
    const requiredWethBalance = ethers.utils.parseEther(WETH_SUPPLY_AMOUNT);
    if (initialWethBalance.lt(requiredWethBalance)) {
      throw new Error(
        `Insufficient WETH balance. Required: ${WETH_SUPPLY_AMOUNT} WETH, Available: ${initialWethFormatted} WETH`
      );
    }

    addTestResult("Initial Balance Check", true);
  } catch (error) {
    console.error("❌ Initial balance check failed:", error.message);
    addTestResult("Initial Balance Check", false, error.message);
  }

  // ========================================
  // ERC20 Approval for WETH (required for AAVE Supply)
  // ========================================
  console.log("🛂 Approving WETH for AAVE supply via ERC20 Approval Tool");

  try {
    const approveWethParams = {
      chainId: NETWORK_CONFIG.chainId,
      tokenAddress: NETWORK_CONFIG.wethAddress,
      spenderAddress: NETWORK_CONFIG.aavePoolAddress,
      tokenAmount: parseFloat(WETH_SUPPLY_AMOUNT),
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
  // STEP 1: Supply WETH as Collateral
  // ========================================
  console.log("(AAVE-STEP-1) Supply WETH as collateral");

  console.log(`   Supplying ${WETH_SUPPLY_AMOUNT} WETH as collateral`);
  console.log(`   WETH Address: ${NETWORK_CONFIG.wethAddress}`);

  // AAVE Supply Operation
  try {
    const aaveSupplyPrecheckRes = await aaveToolClient.precheck(
      {
        operation: "supply",
        asset: NETWORK_CONFIG.wethAddress,
        amount: WETH_SUPPLY_AMOUNT,
        rpcUrl: rpcUrl,
        chain: NETWORK_CONFIG.network,
      },
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-SUPPLY): ",
      JSON.stringify(aaveSupplyPrecheckRes, null, 2)
    );

    if (
      aaveSupplyPrecheckRes.success &&
      !("error" in aaveSupplyPrecheckRes.result) // a hack until the zod type inference is fixed
    ) {
      console.log("✅ (AAVE-PRECHECK-SUPPLY) WETH supply precheck passed");

      // Execute the supply operation
      console.log("🚀 (AAVE-SUPPLY) Executing WETH supply operation...");

      const aaveSupplyExecuteRes = await aaveToolClient.execute(
        {
          operation: "supply",
          asset: NETWORK_CONFIG.wethAddress,
          amount: WETH_SUPPLY_AMOUNT,
          chain: NETWORK_CONFIG.network,
        },
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-SUPPLY): ",
        JSON.stringify(aaveSupplyExecuteRes, null, 2)
      );

      if (aaveSupplyExecuteRes.success) {
        console.log("✅ (AAVE-STEP-1) WETH supply completed successfully!");
        console.log(`   Tx hash: ${aaveSupplyExecuteRes.result.txHash}`);

        // Wait for transaction confirmation
        try {
          console.log("⏳ Waiting for supply transaction confirmation...");
          const receipt = await networkProvider.waitForTransaction(
            aaveSupplyExecuteRes.result.txHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          ); // 1 confirmation, 3 minute timeout
          if (receipt.status === 0) {
            throw new Error(
              `AAVE supply transaction reverted: ${aaveSupplyExecuteRes.result.txHash}`
            );
          }
          console.log(
            `   ✅ Supply transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Transaction confirmation failed",
            confirmError.message
          );
          throw confirmError;
        }

        // Verify AAVE state after supply
        try {
          await verifyAaveState(
            networkProvider,
            agentWalletPkp.ethAddress,
            "supply",
            {
              collateralIncrease: true,
              minCollateral: USDC_BORROW_AMOUNT,
              minCollateralChange: USDC_BORROW_AMOUNT,
            },
            NETWORK_CONFIG.network
          );
          addTestResult("AAVE Supply State Verification", true);
        } catch (verifyError) {
          addTestResult(
            "AAVE Supply State Verification",
            false,
            verifyError.message
          );
        }

        // Verify balance after supply
        try {
          console.log("🔍 Verifying WETH balance after supply...");

          const postSupplyBalance = await wethContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postSupplyBalanceFormatted =
            ethers.utils.formatEther(postSupplyBalance);
          console.log(
            `   Post-supply WETH balance: ${postSupplyBalanceFormatted} WETH`
          );

          // Expected: balance should be reduced by the supplied amount
          const suppliedAmount = ethers.utils.parseEther(WETH_SUPPLY_AMOUNT);
          const expectedBalance = initialWethBalance.sub(suppliedAmount);
          const expectedBalanceFormatted =
            ethers.utils.formatEther(expectedBalance);

          console.log(
            `   Expected WETH balance: ${expectedBalanceFormatted} WETH`
          );

          if (postSupplyBalance.eq(expectedBalance)) {
            console.log("✅ WETH balance correctly reduced after supply");
            addTestResult("AAVE Supply WETH", true);
          } else {
            const errorMsg = `Balance mismatch after supply. Expected: ${expectedBalanceFormatted} WETH, Got: ${postSupplyBalanceFormatted} WETH`;
            console.log(`❌ ${errorMsg}`);
            addTestResult("AAVE Supply WETH", false, errorMsg);
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify balance after supply:",
            balanceError.message
          );
          addTestResult(
            "AAVE Supply WETH",
            false,
            `Balance verification failed: ${balanceError.message}`
          );
        }
      } else {
        const errorMsg = `Supply execution failed: ${
          aaveSupplyExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ (AAVE-STEP-1) WETH supply failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(aaveSupplyExecuteRes, null, 2)
        );
        addTestResult("AAVE Supply WETH", false, errorMsg);
      }
    } else {
      const errorMsg = `Supply precheck failed: ${
        aaveSupplyPrecheckRes.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-SUPPLY)", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(aaveSupplyPrecheckRes, null, 2)
      );
      addTestResult("AAVE Supply WETH", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Supply operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-SUPPLY) Unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("AAVE Supply WETH", false, errorMsg);
  }

  // ========================================
  // STEP 2: Borrow USDC against WETH collateral
  // ========================================
  console.log("(AAVE-STEP-2) Borrow USDC against WETH collateral");

  console.log(`   Borrowing ${USDC_BORROW_AMOUNT} USDC`);
  console.log(`   USDC Address: ${NETWORK_CONFIG.usdcAddress}`);

  // AAVE Borrow Operation
  try {
    const aaveBorrowPrecheckRes = await aaveToolClient.precheck(
      {
        operation: "borrow",
        asset: NETWORK_CONFIG.usdcAddress,
        amount: USDC_BORROW_AMOUNT,
        interestRateMode: 2, // Variable rate
        rpcUrl: rpcUrl,
        chain: NETWORK_CONFIG.network,
      },
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-BORROW): ",
      JSON.stringify(aaveBorrowPrecheckRes, null, 2)
    );

    if (
      aaveBorrowPrecheckRes.success &&
      !("error" in aaveBorrowPrecheckRes.result) // a hack until the zod type inference is fixed
    ) {
      console.log("✅ (AAVE-PRECHECK-BORROW) USDC borrow precheck passed");

      // Execute the borrow operation
      console.log("🚀 (AAVE-BORROW) Executing USDC borrow operation...");

      const aaveBorrowExecuteRes = await aaveToolClient.execute(
        {
          operation: "borrow",
          asset: NETWORK_CONFIG.usdcAddress,
          amount: USDC_BORROW_AMOUNT,
          interestRateMode: 2, // Variable rate
          chain: NETWORK_CONFIG.network,
        },
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-BORROW): ",
        JSON.stringify(aaveBorrowExecuteRes, null, 2)
      );

      if (aaveBorrowExecuteRes.success) {
        console.log("✅ (AAVE-STEP-2) USDC borrow completed successfully!");
        console.log(
          `   Transaction Hash: ${aaveBorrowExecuteRes.result.txHash}`
        );

        // Wait for transaction confirmation
        try {
          console.log("⏳ Waiting for borrow transaction confirmation...");

          const receipt = await networkProvider.waitForTransaction(
            aaveBorrowExecuteRes.result.txHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          ); // 1 confirmation, 3 minute timeout
          if (receipt.status === 0) {
            throw new Error(
              `AAVE borrow transaction reverted: ${aaveBorrowExecuteRes.result.txHash}`
            );
          }
          console.log(
            `   ✅ Borrow transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Transaction confirmation failed",
            confirmError.message
          );
          throw confirmError;
        }

        // Verify AAVE state after borrow
        try {
          await verifyAaveState(
            networkProvider,
            agentWalletPkp.ethAddress,
            "borrow",
            {
              debtIncrease: true,
              minDebt: "0.05", // Expect at least $0.05 worth of debt
              minDebtChange: "0.08", // Expect at least $0.08 increase in debt (1 USDC)
            },
            NETWORK_CONFIG.network
          );
          addTestResult("AAVE Borrow State Verification", true);
        } catch (verifyError) {
          addTestResult(
            "AAVE Borrow State Verification",
            false,
            verifyError.message
          );
        }

        // Verify USDC balance after borrow
        try {
          console.log("🔍 Verifying USDC balance after borrow...");

          const postBorrowBalance = await usdcContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const decimals = await usdcContract.decimals();
          const postBorrowBalanceFormatted = ethers.utils.formatUnits(
            postBorrowBalance,
            decimals
          );
          console.log(
            `   Post-borrow USDC balance: ${postBorrowBalanceFormatted} USDC`
          );

          // Expected: balance should be increased by borrowed amount
          const borrowedAmount = ethers.utils.parseUnits(
            USDC_BORROW_AMOUNT,
            decimals
          );
          const expectedBalance = initialUsdcBalance.add(borrowedAmount);
          const expectedBalanceFormatted = ethers.utils.formatUnits(
            expectedBalance,
            decimals
          );

          console.log(
            `   Expected USDC balance: ${expectedBalanceFormatted} USDC`
          );

          if (postBorrowBalance.eq(expectedBalance)) {
            console.log("✅ USDC balance correctly increased after borrow");
            addTestResult("AAVE Borrow USDC", true);
          } else {
            const errorMsg = `Balance mismatch after borrow. Expected: ${expectedBalanceFormatted} USDC, Got: ${postBorrowBalanceFormatted} USDC`;
            console.log(`❌ ${errorMsg}`);
            addTestResult("AAVE Borrow USDC", false, errorMsg);
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify balance after borrow:",
            balanceError.message
          );
          addTestResult(
            "AAVE Borrow USDC",
            false,
            `Balance verification failed: ${balanceError.message}`
          );
        }
      } else {
        const errorMsg = `Borrow execution failed: ${
          aaveBorrowExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ (AAVE-STEP-2) USDC borrow failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(aaveBorrowExecuteRes, null, 2)
        );
        addTestResult("AAVE Borrow USDC", false, errorMsg);
      }
    } else {
      const errorMsg = `Borrow precheck failed: ${
        aaveBorrowPrecheckRes.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-BORROW)", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(aaveBorrowPrecheckRes, null, 2)
      );
      addTestResult("AAVE Borrow USDC", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Borrow operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-BORROW) Unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("AAVE Borrow USDC", false, errorMsg);
  }

  // ========================================
  // ERC20 Approval for USDC (required for AAVE Repay)
  // ========================================
  console.log("🛂 Approving USDC for AAVE repay via ERC20 Approval Tool");

  // only repay the debt amount.  sometimes we try to borrow 1.0 and get 0.99999.
  const currentAaveState = await verifyAaveState(
    networkProvider,
    agentWalletPkp.ethAddress,
    "repay_check",
    {},
    NETWORK_CONFIG.network
  );

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
  // STEP 3: Repay USDC Debt
  // ========================================
  console.log("(AAVE-STEP-3) Repay USDC debt");

  // Test 6: AAVE Repay Operation
  try {
    const preRepayBalance = await usdcContract.balanceOf(
      agentWalletPkp.ethAddress
    );

    const aaveRepayPrecheckRes = await aaveToolClient.precheck(
      {
        operation: "repay",
        asset: NETWORK_CONFIG.usdcAddress,
        amount: USDC_BORROW_AMOUNT,
        interestRateMode: 2, // Variable rate
        chain: NETWORK_CONFIG.network,
        rpcUrl: rpcUrl,
      },
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-REPAY): ",
      JSON.stringify(aaveRepayPrecheckRes, null, 2)
    );

    if (
      aaveRepayPrecheckRes.success &&
      !("error" in aaveRepayPrecheckRes.result) // a hack until the zod type inference is fixed
    ) {
      console.log("✅ (AAVE-PRECHECK-REPAY) USDC repay precheck passed");

      // Execute the repay operation
      console.log("🚀 (AAVE-REPAY) Executing USDC repay operation...");

      const aaveRepayExecuteRes = await aaveToolClient.execute(
        {
          operation: "repay",
          asset: NETWORK_CONFIG.usdcAddress,
          amount: USDC_BORROW_AMOUNT,
          interestRateMode: 2, // Variable rate
          chain: NETWORK_CONFIG.network,
        },
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-REPAY): ",
        JSON.stringify(aaveRepayExecuteRes, null, 2)
      );

      if (aaveRepayExecuteRes.success) {
        console.log("✅ (AAVE-STEP-3) USDC repay completed successfully!");
        console.log(
          `   Transaction Hash: ${aaveRepayExecuteRes.result.txHash}`
        );

        // Wait for transaction confirmation
        try {
          console.log("⏳ Waiting for repay transaction confirmation...");

          const receipt = await networkProvider.waitForTransaction(
            aaveRepayExecuteRes.result.txHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          ); // 3 minute timeout
          if (receipt.status === 0) {
            throw new Error(
              `AAVE repay transaction reverted: ${aaveRepayExecuteRes.result.txHash}`
            );
          }
          console.log(
            `   ✅ Repay transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Transaction confirmation failed:",
            confirmError.message
          );
          throw confirmError;
        }

        // Verify AAVE state after repay
        try {
          await verifyAaveState(
            networkProvider,
            agentWalletPkp.ethAddress,
            "repay",
            {
              debtDecrease: true,
              minDebtChange: "0.08", // Expect at least $0.08 decrease in debt
            },
            NETWORK_CONFIG.network
          );
          addTestResult("AAVE Repay State Verification", true);
        } catch (verifyError) {
          addTestResult(
            "AAVE Repay State Verification",
            false,
            verifyError.message
          );
        }

        // Verify USDC balance after repay
        try {
          console.log("🔍 Verifying USDC balance after repay...");

          const postRepayBalance = await usdcContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postRepayBalanceFormatted = ethers.utils.formatUnits(
            postRepayBalance,
            usdcDecimals
          );
          console.log(
            `   Post-repay USDC balance: ${postRepayBalanceFormatted} USDC`
          );

          // Expected: balance should have the repaid amount subtracted
          const expectedBalance = preRepayBalance.sub(
            ethers.utils.parseUnits(USDC_BORROW_AMOUNT, usdcDecimals)
          );
          const expectedBalanceFormatted = ethers.utils.formatUnits(
            expectedBalance,
            usdcDecimals
          );

          console.log(
            `   Expected USDC balance: ${expectedBalanceFormatted} USDC`
          );

          if (postRepayBalance.eq(expectedBalance)) {
            console.log(
              "✅ USDC balance correctly returned the borrowed amount after repay"
            );
            addTestResult("AAVE Repay USDC", true);
          } else {
            const errorMsg = `Balance mismatch after repay. Expected: ${expectedBalanceFormatted} USDC, Got: ${postRepayBalanceFormatted} USDC`;
            console.log(`❌ ${errorMsg}`);
            addTestResult("AAVE Repay USDC", false, errorMsg);
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify balance after repay:",
            balanceError.message
          );
          addTestResult(
            "AAVE Repay USDC",
            false,
            `Balance verification failed: ${balanceError.message}`
          );
        }
      } else {
        const errorMsg = `Repay execution failed: ${
          aaveRepayExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ (AAVE-STEP-3) USDC repay failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(aaveRepayExecuteRes, null, 2)
        );
        addTestResult("AAVE Repay USDC", false, errorMsg);
      }
    } else {
      const errorMsg = `Repay precheck failed: ${
        aaveRepayPrecheckRes.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-REPAY)", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(aaveRepayPrecheckRes, null, 2)
      );
      addTestResult("AAVE Repay USDC", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Repay operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-REPAY) Unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("AAVE Repay USDC", false, errorMsg);
  }

  // ========================================
  // STEP 4: Withdraw WETH Collateral
  // ========================================
  console.log("(AAVE-STEP-4) Withdraw WETH collateral");

  const WETH_WITHDRAW_AMOUNT = WETH_SUPPLY_AMOUNT; // Withdraw full collateral
  console.log(`   Withdrawing ${WETH_WITHDRAW_AMOUNT} WETH`);

  // Test 7: AAVE Withdraw Operation
  try {
    const aaveWithdrawPrecheckRes = await aaveToolClient.precheck(
      {
        operation: "withdraw",
        asset: NETWORK_CONFIG.wethAddress,
        amount: WETH_WITHDRAW_AMOUNT,
        rpcUrl: rpcUrl,
        chain: NETWORK_CONFIG.network,
      },
      {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      }
    );

    console.log(
      "(AAVE-PRECHECK-WITHDRAW): ",
      JSON.stringify(aaveWithdrawPrecheckRes, null, 2)
    );

    if (
      aaveWithdrawPrecheckRes.success &&
      !("error" in aaveWithdrawPrecheckRes.result) // a hack until the zod type inference is fixed
    ) {
      console.log("✅ (AAVE-PRECHECK-WITHDRAW) WETH withdraw precheck passed");

      // Execute the withdraw operation
      console.log("🚀 (AAVE-WITHDRAW) Executing WETH withdraw operation...");

      const aaveWithdrawExecuteRes = await aaveToolClient.execute(
        {
          operation: "withdraw",
          asset: NETWORK_CONFIG.wethAddress,
          amount: WETH_WITHDRAW_AMOUNT,
          chain: NETWORK_CONFIG.network,
        },
        {
          delegatorPkpEthAddress: agentWalletPkp.ethAddress,
        }
      );

      console.log(
        "(AAVE-EXECUTE-WITHDRAW): ",
        JSON.stringify(aaveWithdrawExecuteRes, null, 2)
      );

      if (aaveWithdrawExecuteRes.success) {
        console.log("✅ (AAVE-STEP-4) WETH withdraw completed successfully!");
        console.log(
          `   Transaction Hash: ${aaveWithdrawExecuteRes.result.txHash}`
        );

        // Wait for transaction confirmation
        try {
          console.log("⏳ Waiting for withdraw transaction confirmation...");

          const receipt = await networkProvider.waitForTransaction(
            aaveWithdrawExecuteRes.result.txHash,
            CONFIRMATIONS_TO_WAIT,
            180000
          ); // 3 minute timeout
          if (receipt.status === 0) {
            throw new Error(
              `AAVE withdraw transaction reverted: ${aaveWithdrawExecuteRes.result.txHash}`
            );
          }
          console.log(
            `   ✅ Withdraw transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Transaction confirmation failed",
            confirmError.message
          );
          throw confirmError;
        }

        // Verify AAVE state after withdraw
        try {
          await verifyAaveState(
            networkProvider,
            agentWalletPkp.ethAddress,
            "withdraw",
            {
              collateralDecrease: true,
              minCollateralChange: USDC_BORROW_AMOUNT,
            },
            NETWORK_CONFIG.network
          );
          addTestResult("AAVE Withdraw State Verification", true);
        } catch (verifyError) {
          addTestResult(
            "AAVE Withdraw State Verification",
            false,
            verifyError.message
          );
        }

        // Verify WETH balance after withdraw
        try {
          console.log("🔍 Verifying WETH balance after withdraw...");

          const postWithdrawBalance = await wethContract.balanceOf(
            agentWalletPkp.ethAddress
          );
          const postWithdrawBalanceFormatted =
            ethers.utils.formatEther(postWithdrawBalance);
          console.log(
            `   Post-withdraw WETH balance: ${postWithdrawBalanceFormatted} WETH`
          );

          // Expected: balance should return to initial amount (collateral withdrawn)
          const expectedBalance = initialWethBalance;
          const expectedBalanceFormatted =
            ethers.utils.formatEther(expectedBalance);

          console.log(
            `   Expected WETH balance: ${expectedBalanceFormatted} WETH`
          );

          if (postWithdrawBalance.eq(expectedBalance)) {
            console.log(
              "✅ WETH balance correctly returned to initial amount after withdraw"
            );
            addTestResult("AAVE Withdraw WETH", true);
          } else {
            const errorMsg = `Balance mismatch after withdraw. Expected: ${expectedBalanceFormatted} WETH, Got: ${postWithdrawBalanceFormatted} WETH`;
            console.log(`❌ ${errorMsg}`);
            addTestResult("AAVE Withdraw WETH", false, errorMsg);
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify balance after withdraw:",
            balanceError.message
          );
          addTestResult(
            "AAVE Withdraw WETH",
            false,
            `Balance verification failed: ${balanceError.message}`
          );
        }
      } else {
        const errorMsg = `Withdraw execution failed: ${
          aaveWithdrawExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ (AAVE-STEP-4) WETH withdraw failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(aaveWithdrawExecuteRes, null, 2)
        );
        addTestResult("AAVE Withdraw WETH", false, errorMsg);
      }
    } else {
      const errorMsg = `Withdraw precheck failed: ${
        aaveWithdrawPrecheckRes.error || "Unknown precheck error"
      }`;
      console.log("❌ (AAVE-PRECHECK-WITHDRAW)", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(aaveWithdrawPrecheckRes, null, 2)
      );
      addTestResult("AAVE Withdraw WETH", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `AAVE Withdraw operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ (AAVE-WITHDRAW) Unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("AAVE Withdraw WETH", false, errorMsg);
  }

  // ========================================
  // Final AAVE State Verification
  // ========================================
  console.log("\n🏁 Final AAVE State Verification - Workflow Complete");
  try {
    const finalAaveState = await verifyAaveState(
      networkProvider,
      agentWalletPkp.ethAddress,
      "final",
      {},
      NETWORK_CONFIG.network
    );

    if (!initialAaveState) {
      addTestResult(
        "Final AAVE State - Clean Workflow",
        false,
        "Initial AAVE state was not captured, cannot compare final state"
      );
      return;
    }

    // Compare final state to initial state
    const initialCollateral = parseFloat(
      ethers.utils.formatUnits(initialAaveState.totalCollateralBase, 8)
    );
    const initialDebt = parseFloat(
      ethers.utils.formatUnits(initialAaveState.totalDebtBase, 8)
    );
    const finalCollateral = parseFloat(
      ethers.utils.formatUnits(finalAaveState.totalCollateralBase, 8)
    );
    const finalDebt = parseFloat(
      ethers.utils.formatUnits(finalAaveState.totalDebtBase, 8)
    );

    const collateralDifference = Math.abs(finalCollateral - initialCollateral);
    const debtDifference = Math.abs(finalDebt - initialDebt);

    console.log("📊 Final vs Initial AAVE State Comparison:");
    console.log(`   - Initial Collateral: ${initialCollateral.toFixed(4)} USD`);
    console.log(`   - Final Collateral: ${finalCollateral.toFixed(4)} USD`);
    console.log(
      `   - Collateral Difference: ${collateralDifference.toFixed(4)} USD`
    );
    console.log(`   - Initial Debt: ${initialDebt.toFixed(4)} USD`);
    console.log(`   - Final Debt: ${finalDebt.toFixed(4)} USD`);
    console.log(`   - Debt Difference: ${debtDifference.toFixed(4)} USD`);

    // Define acceptable tolerance (small differences due to interest accrual, rounding, etc.)
    const TOLERANCE_USD = 0.001; // $0.001 tolerance

    const collateralWithinTolerance = collateralDifference <= TOLERANCE_USD;
    const debtWithinTolerance = debtDifference <= TOLERANCE_USD;

    if (collateralWithinTolerance && debtWithinTolerance) {
      console.log(
        `   ✅ Successfully returned to initial state (within ${TOLERANCE_USD} USD tolerance)`
      );
      console.log(
        `      Collateral returned to within ${collateralDifference.toFixed(
          4
        )} USD of initial value`
      );
      console.log(
        `      Debt returned to within ${debtDifference.toFixed(
          4
        )} USD of initial value`
      );
      addTestResult("Final AAVE State - Clean Workflow", true);
    } else {
      const issues: string[] = [];
      if (!collateralWithinTolerance) {
        issues.push(
          `collateral differs by ${collateralDifference.toFixed(
            4
          )} USD (tolerance: ${TOLERANCE_USD} USD)`
        );
      }
      if (!debtWithinTolerance) {
        issues.push(
          `debt differs by ${debtDifference.toFixed(
            4
          )} USD (tolerance: ${TOLERANCE_USD} USD)`
        );
      }

      addTestResult(
        "Final AAVE State - Clean Workflow",
        false,
        `Position not returned to initial state: ${issues.join(", ")}`
      );
    }
  } catch (error) {
    addTestResult("Final AAVE State - Clean Workflow", false, error.message);
  } finally {
    // ========================================
    // Send WETH and ETH back to funding wallet (not implemented yet)
    // ========================================
    console.log("Send WETH and ETH back to funding wallet");

    // Send WETH back to funding wallet
    // 1. get the eth balance of the PKP
    const wethBalance = await wethContract.balanceOf(agentWalletPkp.ethAddress);
    console.log(`   PKP WETH balance: ${wethBalance} WETH`);

    const fundingWallet = new ethers.Wallet(
      process.env.TEST_FUNDER_PRIVATE_KEY!,
      networkProvider
    );
    // 2. send the eth balance to the funding wallet
    let txData = await wethContract.populateTransaction.transfer(
      await fundingWallet.getAddress(),
      wethBalance
    );
    console.log(
      `   Sending ${wethBalance} WETH to funding wallet with data ${txData}`
    );

    // TODO: sign the txn with the PKP and broadcast it.

    // Send ETH back to funding wallet
    // 1. get the eth balance of the PKP
    const ethBalance = await networkProvider.getBalance(
      agentWalletPkp.ethAddress
    );

    // 2. estimate the gas, to subtract from the eth balance
    const feeData = await networkProvider.getFeeData();
    console.log(`   Fee data: ${feeData}`);

    // 2. send the eth balance to the funding wallet
    // costs 21000 gas to send eth
    const amountToSend = ethBalance.sub(
      ethers.BigNumber.from(21000).mul(feeData.gasPrice!)
    );
    console.log(
      `   Sending ${ethers.utils.formatEther(
        amountToSend
      )} ETH to funding wallet (balance is ${ethBalance})`
    );

    // TODO: sign the txn with the PKP and broadcast it.
  }

  // ========================================
  // Print Test Summary and Exit
  // ========================================
  const allTestsPassed = printTestSummary();
  process.exit(allTestsPassed ? 0 : 1);
})();
