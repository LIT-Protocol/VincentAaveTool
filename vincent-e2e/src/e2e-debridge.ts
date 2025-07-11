import {
  createAppConfig,
  init,
  suppressLitLogs,
} from "@lit-protocol/vincent-scaffold-sdk/e2e";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Apply log suppression FIRST, before any imports that might trigger logs
suppressLitLogs(false);

import { getVincentToolClient } from "@lit-protocol/vincent-app-sdk";
// Tools and Policies that we will be testing
import { vincentPolicyMetadata as sendLimitPolicyMetadata } from "../../vincent-packages/policies/send-counter-limit/dist/index.js";
import { bundledVincentTool as deBridgeTool } from "../../vincent-packages/tools/debridge/dist/index.js";
import { bundledVincentTool as erc20ApproveTool } from "@lit-protocol/vincent-tool-erc20-approval";
import { bundledVincentTool as uniswapTool } from "@lit-protocol/vincent-tool-uniswap-swap";
import { ethers } from "ethers";
import {
  setupEthFunding,
  addTestResult,
  printTestSummary,
} from "./test-utils.js";

// ========================================
// NETWORK CONFIGURATION - Base to Arbitrum Bridge Test
// ========================================
const SOURCE_NETWORK_NAME = "base";
const DESTINATION_NETWORK_NAME = "arbitrum";

const NETWORK_CONFIG = {
  source: {
    network: SOURCE_NETWORK_NAME,
    chainId: "8453", // Base
    rpcUrlEnv: "BASE_RPC_URL",
    nativeToken: "0x0000000000000000000000000000000000000000", // ETH
    // Common ERC20 tokens on Base for testing
    usdcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", // USDC on Base
    wethToken: "0x4200000000000000000000000000000000000006", // WETH on Base
    usdtToken: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", // USDT on Base
  },
  destination: {
    network: DESTINATION_NETWORK_NAME,
    chainId: "42161", // Arbitrum
    rpcUrlEnv: "ARBITRUM_RPC_URL",
    nativeToken: "0x0000000000000000000000000000000000000000", // ETH on Arbitrum
    // Corresponding tokens on Arbitrum
    usdcToken: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // USDC on Arbitrum
    wethToken: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1", // WETH on Arbitrum
    usdtToken: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", // USDT on Arbitrum
  },
} as const;

const CONFIRMATIONS_TO_WAIT = 2;
const BRIDGE_AMOUNT = "0.00001"; // 0.00001 ETH to bridge from Base to Arbitrum
// Note: deBridge takes a small fee (~0.8%) so bridging 0.00001 ETH results in ~0.0000099 ETH received

(async () => {
  console.log("🌉 Starting deBridge Tool E2E Test - Base to Arbitrum Bridge");
  console.log(
    `   Bridging ${BRIDGE_AMOUNT} ETH from ${SOURCE_NETWORK_NAME} to ${DESTINATION_NETWORK_NAME}`
  );

  /**
   * ====================================
   * Initialise the environment
   * ====================================
   */
  const { accounts, chainClient } = await init({
    network: "datil",
    deploymentStatus: "dev",
  });

  const sourceRpcUrl = process.env[NETWORK_CONFIG.source.rpcUrlEnv];
  if (!sourceRpcUrl) {
    throw new Error(
      `${NETWORK_CONFIG.source.rpcUrlEnv} is not set - can't test on ${NETWORK_CONFIG.source.network} without an RPC URL`
    );
  }

  const destinationRpcUrl = process.env[NETWORK_CONFIG.destination.rpcUrlEnv];
  if (!destinationRpcUrl) {
    throw new Error(
      `${NETWORK_CONFIG.destination.rpcUrlEnv} is not set - can't test on ${NETWORK_CONFIG.destination.network} without an RPC URL`
    );
  }

  if (!process.env.TEST_FUNDER_PRIVATE_KEY) {
    throw new Error(
      `TEST_FUNDER_PRIVATE_KEY is not set - can't test without a funder private key`
    );
  }

  const sourceProvider = new ethers.providers.JsonRpcProvider(sourceRpcUrl);
  const destinationProvider = new ethers.providers.JsonRpcProvider(
    destinationRpcUrl
  );

  /**
   * ====================================
   * (🫵 You) Prepare the tools and policies
   * ====================================
   */

  const deBridgeToolClient = getVincentToolClient({
    bundledVincentTool: deBridgeTool,
    ethersSigner: accounts.delegatee.ethersWallet,
  });

  const approveToolClient = getVincentToolClient({
    bundledVincentTool: erc20ApproveTool,
    ethersSigner: accounts.delegatee.ethersWallet,
  });

  const uniswapToolClient = getVincentToolClient({
    bundledVincentTool: uniswapTool,
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
        deBridgeTool.ipfsCid,
        erc20ApproveTool.ipfsCid,
        uniswapTool.ipfsCid,
      ],
      toolPolicies: [
        [
          // No policies for deBridge tool for now
        ],
        [
          // No policies for ERC20 Approval tool
        ],
        [
          // No policies for Uniswap tool
        ],
      ],
      toolPolicyParameterNames: [
        [], // No policy parameter names for deBridgeTool
        [], // No policy parameter names for approveTool
        [], // No policy parameter names for uniswapTool
      ],
      toolPolicyParameterTypes: [
        [], // No policy parameter types for deBridgeTool
        [], // No policy parameter types for approveTool
        [], // No policy parameter types for uniswapTool
      ],
      toolPolicyParameterValues: [
        [], // No policy parameter values for deBridgeTool
        [], // No policy parameter values for approveTool
        [], // No policy parameter values for uniswapTool
      ],
    },

    // Debugging options
    {
      cidToNameMap: {
        [deBridgeTool.ipfsCid]: "deBridge Tool",
        [erc20ApproveTool.ipfsCid]: "ERC20 Approval Tool",
        [uniswapTool.ipfsCid]: "Uniswap Swap Tool",
        [sendLimitPolicyMetadata.ipfsCid]: "Send Limit Policy",
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
    deBridgeTool.ipfsCid,
    erc20ApproveTool.ipfsCid,
    uniswapTool.ipfsCid,
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
  try {
    let validation = await chainClient.validateToolExecution({
      delegateeAddress: accounts.delegatee.ethersWallet.address,
      pkpTokenId: agentWalletPkp.tokenId,
      toolIpfsCid: deBridgeTool.ipfsCid,
    });

    console.log("✅ deBridge Tool execution validation:", validation);

    if (!validation.isPermitted) {
      throw new Error(
        `Delegatee is not permitted to execute deBridge tool for PKP for IPFS CID: ${
          deBridgeTool.ipfsCid
        }. Validation: ${JSON.stringify(validation, (_, value) =>
          typeof value === "bigint" ? value.toString() : value
        )}`
      );
    }
    addTestResult("deBridge Tool Validation", true);
  } catch (error) {
    addTestResult("deBridge Tool Validation", false, error.message);
  }

  // ========================================
  // ETH Funding Setup for Source Chain (Base)
  // ========================================
  const fundAmount = (parseFloat(BRIDGE_AMOUNT) + 0.002).toString(); // Bridge amount + extra for gas and fees
  await setupEthFunding(
    sourceProvider,
    agentWalletPkp.ethAddress,
    process.env.TEST_FUNDER_PRIVATE_KEY,
    addTestResult,
    CONFIRMATIONS_TO_WAIT,
    SOURCE_NETWORK_NAME,
    fundAmount
  );

  // ========================================
  // deBridge Tool Testing - Cross-Chain Bridge
  // ========================================
  console.log("🌉 Testing deBridge Tool - Base to Arbitrum Bridge");
  console.log(
    `📋 Workflow: Bridge ${BRIDGE_AMOUNT} ETH from ${SOURCE_NETWORK_NAME} to ${DESTINATION_NETWORK_NAME}`
  );

  // Store initial balances for comparison
  let initialSourceBalance: ethers.BigNumber = ethers.BigNumber.from(0);
  let initialDestinationBalance: ethers.BigNumber = ethers.BigNumber.from(0);

  // Test: Initial Balance Check
  try {
    console.log("🔍 Recording initial balances on both chains...");

    // Get initial balances
    initialSourceBalance = await sourceProvider.getBalance(
      agentWalletPkp.ethAddress
    );
    initialDestinationBalance = await destinationProvider.getBalance(
      agentWalletPkp.ethAddress
    );

    const initialSourceFormatted =
      ethers.utils.formatEther(initialSourceBalance);
    const initialDestinationFormatted = ethers.utils.formatEther(
      initialDestinationBalance
    );

    console.log(
      `   Initial ${SOURCE_NETWORK_NAME} ETH balance: ${initialSourceFormatted} ETH`
    );
    console.log(
      `   Initial ${DESTINATION_NETWORK_NAME} ETH balance: ${initialDestinationFormatted} ETH`
    );

    // Verify PKP has sufficient ETH for the bridge + gas
    const requiredBalance = ethers.utils.parseEther(BRIDGE_AMOUNT);
    const gasBuffer = ethers.utils.parseEther("0.002"); // Extra for gas + debridge fee of 0.001
    const totalRequired = requiredBalance.add(gasBuffer);

    if (initialSourceBalance.lt(totalRequired)) {
      throw new Error(
        `Insufficient ETH balance on ${SOURCE_NETWORK_NAME}. Required: ${ethers.utils.formatEther(
          totalRequired
        )} ETH (including gas), Available: ${initialSourceFormatted} ETH`
      );
    }

    addTestResult("Initial Balance Check", true);
  } catch (error) {
    console.error("❌ Initial balance check failed:", error.message);
    addTestResult("Initial Balance Check", false, error.message);
    throw error; // Exit early if funding is insufficient
  }

  // ========================================
  // deBridge Cross-Chain Bridge Operation
  // ========================================
  console.log("🌉 Executing ETH to Base bridge via deBridge");

  try {
    const bridgeParams = {
      rpcUrl: sourceRpcUrl,
      sourceChain: NETWORK_CONFIG.source.chainId,
      destinationChain: NETWORK_CONFIG.destination.chainId,
      sourceToken: NETWORK_CONFIG.source.nativeToken,
      destinationToken: NETWORK_CONFIG.destination.nativeToken,
      amount: ethers.utils.parseEther(BRIDGE_AMOUNT).toString(),
      recipientAddress: agentWalletPkp.ethAddress, // Bridge to same address on destination
      operation: "BRIDGE" as const,
      slippageBps: 100, // 1% slippage tolerance
    };

    console.log("📋 Bridge Parameters:", {
      ...bridgeParams,
      amount: `${BRIDGE_AMOUNT} ETH (${bridgeParams.amount} wei)`,
    });

    // Step 1: Precheck
    console.log("🔍 Running deBridge precheck...");
    const bridgePrecheckRes = await deBridgeToolClient.precheck(bridgeParams, {
      delegatorPkpEthAddress: agentWalletPkp.ethAddress,
    });

    console.log(
      "(DEBRIDGE-PRECHECK): ",
      JSON.stringify(bridgePrecheckRes, null, 2)
    );

    if (bridgePrecheckRes.success && !("error" in bridgePrecheckRes.result)) {
      console.log("✅ deBridge precheck passed");

      // Log expected costs and destination amount
      const precheckData = bridgePrecheckRes.result.data;
      console.log(
        `   Estimated destination amount: ${ethers.utils.formatEther(
          precheckData.estimatedDestinationAmount
        )} ETH`
      );
      console.log(
        `   Protocol fee: ${ethers.utils.formatEther(
          precheckData.estimatedFees.protocolFee
        )} ETH`
      );
      console.log(
        `   Estimated execution time: ${precheckData.estimatedExecutionTime} seconds`
      );

      // Step 2: Execute the bridge operation
      console.log("🚀 Executing bridge operation...");

      const bridgeExecuteRes = await deBridgeToolClient.execute(bridgeParams, {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      });

      console.log(
        "(DEBRIDGE-EXECUTE): ",
        JSON.stringify(bridgeExecuteRes, null, 2)
      );

      if (bridgeExecuteRes.success) {
        console.log("✅ Bridge transaction submitted successfully!");
        console.log(`   Tx hash: ${bridgeExecuteRes.result.data.txHash}`);

        if (bridgeExecuteRes.result.data.orderId) {
          console.log(`   Order ID: ${bridgeExecuteRes.result.data.orderId}`);
        }

        // Wait for source transaction confirmation
        try {
          console.log("⏳ Waiting for source transaction confirmation...");
          const receipt = await sourceProvider.waitForTransaction(
            bridgeExecuteRes.result.data.txHash,
            CONFIRMATIONS_TO_WAIT,
            300000 // 5 minute timeout
          );
          if (receipt.status === 0) {
            throw new Error(
              `Bridge transaction reverted: ${bridgeExecuteRes.result.data.txHash}`
            );
          }
          console.log(
            `   ✅ Source transaction confirmed in block ${receipt.blockNumber}`
          );
        } catch (confirmError) {
          console.log(
            "⚠️  Source transaction confirmation failed",
            confirmError.message
          );
          throw confirmError;
        }

        // Verify source balance decreased
        try {
          console.log("🔍 Verifying source chain balance change...");

          const postBridgeSourceBalance = await sourceProvider.getBalance(
            agentWalletPkp.ethAddress
          );
          const postBridgeSourceFormatted = ethers.utils.formatEther(
            postBridgeSourceBalance
          );

          console.log(
            `   Post-bridge ${SOURCE_NETWORK_NAME} ETH balance: ${postBridgeSourceFormatted} ETH`
          );

          // Source balance should be reduced by at least the bridge amount
          const bridgeAmountBN = ethers.utils.parseEther(BRIDGE_AMOUNT);
          const expectedMaxSourceBalance =
            initialSourceBalance.sub(bridgeAmountBN);

          if (postBridgeSourceBalance.lte(expectedMaxSourceBalance)) {
            console.log("✅ Source balance correctly reduced");
            addTestResult("deBridge Source Transaction", true);
          } else {
            const errorMsg = `Source balance not reduced correctly. Expected <= ${ethers.utils.formatEther(
              expectedMaxSourceBalance
            )} ETH, Got: ${postBridgeSourceFormatted} ETH`;
            console.log(`❌ ${errorMsg}`);
            addTestResult("deBridge Source Transaction", false, errorMsg);
          }
        } catch (balanceError) {
          console.log(
            "❌ Could not verify source balance:",
            balanceError.message
          );
          addTestResult(
            "deBridge Source Transaction",
            false,
            `Source balance verification failed: ${balanceError.message}`
          );
        }

        // Poll destination chain for balance arrival
        console.log("⏳ Polling destination chain for balance arrival...");
        console.log(
          "   This typically takes 1-5 minutes depending on network conditions."
        );

        const MAX_POLL_TIME = 10 * 60 * 1000; // 10 minutes
        const POLL_INTERVAL = 10 * 1000; // 10 seconds
        const startTime = Date.now();
        let destinationBalanceArrived = false;
        let finalDestinationBalance: ethers.BigNumber =
          ethers.BigNumber.from(0);

        // Expected amount accounting for fees (approximately 0.8% based on your observation)
        const bridgeAmountBN = ethers.utils.parseEther(BRIDGE_AMOUNT);
        const minExpectedAmount = bridgeAmountBN.mul(99).div(100); // Allow up to 1% in fees

        while (
          Date.now() - startTime < MAX_POLL_TIME &&
          !destinationBalanceArrived
        ) {
          try {
            const currentDestBalance = await destinationProvider.getBalance(
              agentWalletPkp.ethAddress
            );

            const balanceIncrease = currentDestBalance.sub(
              initialDestinationBalance
            );

            if (balanceIncrease.gt(0)) {
              finalDestinationBalance = currentDestBalance;
              const increaseFormatted =
                ethers.utils.formatEther(balanceIncrease);
              const finalFormatted = ethers.utils.formatEther(
                finalDestinationBalance
              );

              console.log(`✅ Balance arrived on ${DESTINATION_NETWORK_NAME}!`);
              console.log(`   Balance increase: ${increaseFormatted} ETH`);
              console.log(`   Final balance: ${finalFormatted} ETH`);

              // Verify amount is within expected range
              if (balanceIncrease.gte(minExpectedAmount)) {
                console.log(
                  `   ✅ Received amount is within expected range (>= ${ethers.utils.formatEther(
                    minExpectedAmount
                  )} ETH)`
                );
                const feePercentage =
                  bridgeAmountBN
                    .sub(balanceIncrease)
                    .mul(10000)
                    .div(bridgeAmountBN)
                    .toNumber() / 100;
                console.log(`   Bridge fee: ~${feePercentage.toFixed(2)}%`);
                destinationBalanceArrived = true;
                addTestResult("deBridge Destination Balance", true);
              } else {
                const errorMsg = `Received amount ${increaseFormatted} ETH is less than minimum expected ${ethers.utils.formatEther(
                  minExpectedAmount
                )} ETH`;
                console.log(`   ❌ ${errorMsg}`);
                addTestResult("deBridge Destination Balance", false, errorMsg);
                destinationBalanceArrived = true; // Stop polling but mark as failed
              }
            } else {
              const elapsed = Math.floor((Date.now() - startTime) / 1000);
              console.log(`   Still waiting... (${elapsed}s elapsed)`);
            }
          } catch (pollError) {
            console.log(
              "   Error polling destination balance:",
              pollError.message
            );
          }

          if (!destinationBalanceArrived) {
            await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
          }
        }

        if (!destinationBalanceArrived) {
          const errorMsg = `Bridge funds did not arrive on destination chain within ${
            MAX_POLL_TIME / 1000
          } seconds`;
          console.log(`❌ ${errorMsg}`);
          addTestResult("deBridge Destination Balance", false, errorMsg);
        }

        addTestResult("deBridge Bridge Execution", true);
      } else {
        const errorMsg = `Bridge execution failed: ${
          bridgeExecuteRes.error || "Unknown execution error"
        }`;
        console.log("❌ Bridge execution failed:", errorMsg);
        console.log(
          "   Full execution response:",
          JSON.stringify(bridgeExecuteRes, null, 2)
        );
        addTestResult("deBridge Bridge Execution", false, errorMsg);
      }
    } else {
      const errorMsg = `Bridge precheck failed: ${
        "error" in bridgePrecheckRes
          ? bridgePrecheckRes.error
          : "Unknown precheck error"
      }`;
      console.log("❌ deBridge precheck failed:", errorMsg);
      console.log(
        "   Full precheck response:",
        JSON.stringify(bridgePrecheckRes, null, 2)
      );
      addTestResult("deBridge Bridge Execution", false, errorMsg);
    }
  } catch (error) {
    const errorMsg = `deBridge operation threw exception: ${
      error.message || error
    }`;
    console.log("❌ deBridge bridge unexpected error:", errorMsg);
    console.log("   Error stack:", error.stack);
    addTestResult("deBridge Bridge Execution", false, errorMsg);
  }

  // ========================================
  // Test 2: ETH -> USDT Swap, then Bridge USDT to Arbitrum as USDC
  // ========================================
  console.log("\n" + "=".repeat(70));
  console.log("🔄 Starting Test 2: ETH → USDT → Bridge to Arbitrum as USDC");
  console.log("=".repeat(70));

  const SWAP_AMOUNT = "0.0001"; // Amount of ETH to swap to USDT
  const BRIDGE_SWAP_AMOUNT = "0.1"; // Amount of USDT to bridge (0.1 USDT)

  // get usdt token decimals
  const ERC20_ABI = [
    "function balanceOf(address account) view returns (uint256)",
    "function decimals() view returns (uint8)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ];
  const usdtContract = new ethers.Contract(
    NETWORK_CONFIG.source.usdtToken,
    ERC20_ABI,
    sourceProvider
  );
  const usdtTokenDecimals = await usdtContract.decimals();

  // First, swap ETH to USDT on Base using Uniswap
  console.log(`\n💱 Step 1: Swapping ${SWAP_AMOUNT} ETH to USDT on Base`);

  try {
    const swapParams = {
      chainIdForUniswap: Number(NETWORK_CONFIG.source.chainId),
      tokenInAddress: NETWORK_CONFIG.source.nativeToken,
      tokenInAmount: Number(SWAP_AMOUNT),
      tokenOutAddress: NETWORK_CONFIG.source.usdtToken,
      rpcUrlForUniswap: sourceRpcUrl,
      ethRpcUrl: process.env.ETHEREUM_RPC_URL!,
      tokenInDecimals: 18,
      tokenOutDecimals: usdtTokenDecimals,
    };

    console.log("📋 Swap Parameters:", {
      ...swapParams,
      amountIn: `${SWAP_AMOUNT} ETH`,
      tokenOut: "USDT",
    });

    // Precheck swap
    console.log("🔍 Running Uniswap precheck...");
    const swapPrecheckRes = await uniswapToolClient.precheck(swapParams, {
      delegatorPkpEthAddress: agentWalletPkp.ethAddress,
    });

    if (swapPrecheckRes.success && !("error" in swapPrecheckRes.result)) {
      console.log("✅ Uniswap precheck passed");

      // Execute swap
      console.log("🚀 Executing swap...");
      const swapExecuteRes = await uniswapToolClient.execute(swapParams, {
        delegatorPkpEthAddress: agentWalletPkp.ethAddress,
      });

      if (swapExecuteRes.success) {
        console.log("✅ Swap executed successfully!");
        console.log(`   Tx hash: ${swapExecuteRes.result.data.txHash}`);

        // Wait for confirmation
        await sourceProvider.waitForTransaction(
          swapExecuteRes.result.data.txHash,
          CONFIRMATIONS_TO_WAIT
        );

        // Check USDT balance

        const usdtBalance = await usdtContract.balanceOf(
          agentWalletPkp.ethAddress
        );
        const usdtFormatted = ethers.utils.formatUnits(usdtBalance, 6); // USDT has 6 decimals
        console.log(`   USDT balance after swap: ${usdtFormatted} USDT`);

        addTestResult("Uniswap ETH to USDT Swap", true);

        // Now approve USDT for deBridge
        console.log("\n🔓 Step 2: Approving USDT for deBridge");

        // Get deBridge contract address for approval
        const DEBRIDGE_CONTRACTS: Record<string, string> = {
          "8453": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Base
        };

        const approveParams = {
          rpcUrl: sourceRpcUrl,
          chainId: parseInt(NETWORK_CONFIG.source.chainId),
          spenderAddress: DEBRIDGE_CONTRACTS[NETWORK_CONFIG.source.chainId],
          tokenAddress: NETWORK_CONFIG.source.usdtToken,
          tokenDecimals: 6,
          tokenAmount: parseFloat(BRIDGE_SWAP_AMOUNT),
        };

        const approvePrecheckRes = await approveToolClient.precheck(
          approveParams,
          {
            delegatorPkpEthAddress: agentWalletPkp.ethAddress,
          }
        );

        if (
          approvePrecheckRes.success &&
          !("error" in approvePrecheckRes.result)
        ) {
          console.log("✅ Approval precheck passed");

          const approveExecuteRes = await approveToolClient.execute(
            approveParams,
            {
              delegatorPkpEthAddress: agentWalletPkp.ethAddress,
            }
          );

          if (approveExecuteRes.success) {
            console.log("✅ USDT approved for deBridge");
            console.log(`   Tx hash: ${approveExecuteRes.result.data.txHash}`);

            await sourceProvider.waitForTransaction(
              approveExecuteRes.result.data.txHash,
              CONFIRMATIONS_TO_WAIT
            );

            addTestResult("USDT Approval for deBridge", true);

            // Bridge USDT from Base to Arbitrum as USDC
            console.log(
              "\n🌉 Step 3: Bridging USDT from Base to USDC on Arbitrum"
            );

            const bridgeSwapParams = {
              rpcUrl: sourceRpcUrl,
              sourceChain: NETWORK_CONFIG.source.chainId,
              destinationChain: NETWORK_CONFIG.destination.chainId,
              sourceToken: NETWORK_CONFIG.source.usdtToken,
              destinationToken: NETWORK_CONFIG.destination.usdcToken,
              amount: ethers.utils.parseUnits(BRIDGE_SWAP_AMOUNT, 6).toString(), // USDT has 6 decimals
              recipientAddress: agentWalletPkp.ethAddress,
              operation: "BRIDGE_AND_SWAP" as const,
              slippageBps: 300, // 3% slippage tolerance
            };

            console.log("📋 Bridge Parameters:", {
              ...bridgeSwapParams,
              amount: `${BRIDGE_SWAP_AMOUNT} USDT`,
              destinationToken: "USDC on Arbitrum",
            });

            // Get initial USDC balance on destination
            const destinationUsdcContract = new ethers.Contract(
              NETWORK_CONFIG.destination.usdcToken,
              ERC20_ABI,
              destinationProvider
            );
            const initialDestUsdcBalance =
              await destinationUsdcContract.balanceOf(
                agentWalletPkp.ethAddress
              );

            // Precheck bridge
            const bridgeSwapPrecheckRes = await deBridgeToolClient.precheck(
              bridgeSwapParams,
              {
                delegatorPkpEthAddress: agentWalletPkp.ethAddress,
              }
            );

            if (
              bridgeSwapPrecheckRes.success &&
              !("error" in bridgeSwapPrecheckRes.result)
            ) {
              console.log("✅ Bridge and swap precheck passed");

              const precheckData = bridgeSwapPrecheckRes.result.data;
              console.log(
                `   Estimated USDC to receive: ${ethers.utils.formatUnits(
                  precheckData.estimatedDestinationAmount,
                  6
                )} USDC`
              );

              // Execute bridge
              const bridgeSwapExecuteRes = await deBridgeToolClient.execute(
                bridgeSwapParams,
                {
                  delegatorPkpEthAddress: agentWalletPkp.ethAddress,
                }
              );

              if (bridgeSwapExecuteRes.success) {
                console.log("✅ Bridge and swap transaction submitted!");
                console.log(
                  `   Tx hash: ${bridgeSwapExecuteRes.result.data.txHash}`
                );

                // Wait for source transaction
                await sourceProvider.waitForTransaction(
                  bridgeSwapExecuteRes.result.data.txHash,
                  CONFIRMATIONS_TO_WAIT
                );

                // Poll for USDC arrival on destination
                console.log("\n⏳ Polling for USDC arrival on Arbitrum...");

                const MAX_POLL_TIME = 10 * 60 * 1000; // 10 minutes
                const POLL_INTERVAL = 10 * 1000; // 10 seconds
                const startTime = Date.now();
                let usdcArrived = false;

                while (Date.now() - startTime < MAX_POLL_TIME && !usdcArrived) {
                  const currentUsdcBalance =
                    await destinationUsdcContract.balanceOf(
                      agentWalletPkp.ethAddress
                    );
                  const balanceIncrease = currentUsdcBalance.sub(
                    initialDestUsdcBalance
                  );

                  if (balanceIncrease.gt(0)) {
                    const increaseFormatted = ethers.utils.formatUnits(
                      balanceIncrease,
                      6
                    );
                    console.log(
                      `✅ USDC arrived on Arbitrum: ${increaseFormatted} USDC`
                    );
                    usdcArrived = true;
                    addTestResult("USDT to USDC Bridge", true);
                  } else {
                    const elapsed = Math.floor((Date.now() - startTime) / 1000);
                    console.log(`   Still waiting... (${elapsed}s elapsed)`);
                    await new Promise((resolve) =>
                      setTimeout(resolve, POLL_INTERVAL)
                    );
                  }
                }

                if (!usdcArrived) {
                  addTestResult(
                    "USDT to USDC Bridge",
                    false,
                    "USDC did not arrive within timeout"
                  );
                }
              } else {
                addTestResult(
                  "USDT to USDC Bridge",
                  false,
                  bridgeSwapExecuteRes.error || "Bridge execution failed"
                );
              }
            } else {
              addTestResult(
                "USDT to USDC Bridge",
                false,
                "Bridge precheck failed"
              );
            }
          } else {
            addTestResult(
              "USDT Approval for deBridge",
              false,
              approveExecuteRes.error || "Approval failed"
            );
          }
        } else {
          addTestResult(
            "USDT Approval for deBridge",
            false,
            "Approval precheck failed"
          );
        }
      } else {
        addTestResult(
          "Uniswap ETH to USDT Swap",
          false,
          swapExecuteRes.error || "Swap execution failed"
        );
      }
    } else {
      addTestResult("Uniswap ETH to USDT Swap", false, "Swap precheck failed");
    }
  } catch (error) {
    console.error("❌ Test 2 failed:", error.message);
    addTestResult("Test 2: Bridge and Swap", false, error.message);
  }

  // ========================================
  // Print Test Summary and Exit
  // ========================================
  const allTestsPassed = printTestSummary();
  process.exit(allTestsPassed ? 0 : 1);
})();
