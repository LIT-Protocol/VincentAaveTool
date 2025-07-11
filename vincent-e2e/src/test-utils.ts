import { ethers } from "ethers";
import {
  getAaveAddresses,
  getTestTokens,
} from "../../vincent-packages/tools/aave/dist/lib/helpers/index.js";

const AAVE_BASE_DEBT_ASSET_DECIMALS = 8;

// Enhanced AAVE State interface for tracking changes
export interface AaveAccountData {
  totalCollateralBase: ethers.BigNumber;
  totalDebtBase: ethers.BigNumber;
  availableBorrowsBase: ethers.BigNumber;
  currentLiquidationThreshold: ethers.BigNumber;
  ltv: ethers.BigNumber;
  healthFactor: ethers.BigNumber;
}

// Global state tracking for AAVE operations
let previousAaveState: AaveAccountData | null = null;

export async function getAaveUserAccountData(
  provider: ethers.providers.Provider,
  userAddress: string,
  chain: string = "sepolia"
) {
  const aaveAddresses = getAaveAddresses(chain);
  const aavePoolContract = new ethers.Contract(
    aaveAddresses.POOL,
    [
      {
        inputs: [{ internalType: "address", name: "user", type: "address" }],
        name: "getUserAccountData",
        outputs: [
          {
            internalType: "uint256",
            name: "totalCollateralBase",
            type: "uint256",
          },
          { internalType: "uint256", name: "totalDebtBase", type: "uint256" },
          {
            internalType: "uint256",
            name: "availableBorrowsBase",
            type: "uint256",
          },
          {
            internalType: "uint256",
            name: "currentLiquidationThreshold",
            type: "uint256",
          },
          { internalType: "uint256", name: "ltv", type: "uint256" },
          { internalType: "uint256", name: "healthFactor", type: "uint256" },
        ],
        stateMutability: "view",
        type: "function",
      },
    ],
    provider
  );

  const accountData = await aavePoolContract.getUserAccountData(userAddress);
  return {
    totalCollateralBase: accountData.totalCollateralBase,
    totalDebtBase: accountData.totalDebtBase,
    availableBorrowsBase: accountData.availableBorrowsBase,
    currentLiquidationThreshold: accountData.currentLiquidationThreshold,
    ltv: accountData.ltv,
    healthFactor: accountData.healthFactor,
  };
}

export async function verifyAaveState(
  provider: ethers.providers.Provider,
  userAddress: string,
  operation: string,
  expectedChanges: {
    collateralIncrease?: boolean;
    collateralDecrease?: boolean;
    debtIncrease?: boolean;
    debtDecrease?: boolean;
    minCollateral?: string;
    maxCollateral?: string;
    minDebt?: string;
    maxDebt?: string;
    minCollateralChange?: string;
    maxCollateralChange?: string;
    minDebtChange?: string;
    maxDebtChange?: string;
  },
  chain: string = "sepolia"
) {
  const currentAccountData = await getAaveUserAccountData(
    provider,
    userAddress,
    chain
  );

  console.log(`🔍 AAVE State Verification (${operation.toUpperCase()})`);
  console.log(
    `   Total Collateral: ${ethers.utils.formatUnits(
      currentAccountData.totalCollateralBase,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    )} USD`
  );
  console.log(
    `   Total Debt: ${ethers.utils.formatUnits(
      currentAccountData.totalDebtBase,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    )} USD`
  );
  console.log(
    `   Available Borrow: ${ethers.utils.formatUnits(
      currentAccountData.availableBorrowsBase,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    )} USD`
  );
  console.log(
    `   Health Factor: ${ethers.utils.formatEther(
      currentAccountData.healthFactor
    )}`
  );

  // If we have previous state, show the changes
  if (previousAaveState && operation !== "initial") {
    const collateralChange = currentAccountData.totalCollateralBase.sub(
      previousAaveState.totalCollateralBase
    );
    const debtChange = currentAccountData.totalDebtBase.sub(
      previousAaveState.totalDebtBase
    );

    console.log(`   📊 Changes from previous state:`);
    console.log(
      `      Collateral Change: ${
        collateralChange.gte(0) ? "+" : ""
      }${ethers.utils.formatUnits(
        collateralChange,
        AAVE_BASE_DEBT_ASSET_DECIMALS
      )} USD`
    );
    console.log(
      `      Debt Change: ${
        debtChange.gte(0) ? "+" : ""
      }${ethers.utils.formatUnits(
        debtChange,
        AAVE_BASE_DEBT_ASSET_DECIMALS
      )} USD`
    );

    // Verify collateral changes with previous state comparison
    if (expectedChanges.collateralIncrease) {
      if (collateralChange.lte(0)) {
        throw new Error(
          `Expected collateral increase but got change of ${ethers.utils.formatUnits(
            collateralChange,
            AAVE_BASE_DEBT_ASSET_DECIMALS
          )} USD`
        );
      }
      console.log(
        `   ✅ Collateral increased by ${ethers.utils.formatUnits(
          collateralChange,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD`
      );

      // Check minimum collateral change if specified
      if (expectedChanges.minCollateralChange) {
        const minChange = ethers.utils.parseUnits(
          expectedChanges.minCollateralChange,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        );
        if (collateralChange.lt(minChange)) {
          throw new Error(
            `Collateral increase ${ethers.utils.formatUnits(
              collateralChange,
              AAVE_BASE_DEBT_ASSET_DECIMALS
            )} USD is less than expected minimum ${
              expectedChanges.minCollateralChange
            } USD`
          );
        }
      }
    }

    if (expectedChanges.collateralDecrease) {
      if (collateralChange.gte(0)) {
        throw new Error(
          `Expected collateral decrease but got change of ${ethers.utils.formatUnits(
            collateralChange,
            AAVE_BASE_DEBT_ASSET_DECIMALS
          )} USD`
        );
      }
      console.log(
        `   ✅ Collateral decreased by ${ethers.utils.formatUnits(
          collateralChange.abs(),
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD`
      );

      // Check minimum collateral change if specified
      if (expectedChanges.minCollateralChange) {
        const minChange = ethers.utils.parseUnits(
          expectedChanges.minCollateralChange,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        );
        if (collateralChange.abs().lt(minChange)) {
          throw new Error(
            `Collateral decrease ${ethers.utils.formatUnits(
              collateralChange.abs(),
              AAVE_BASE_DEBT_ASSET_DECIMALS
            )} USD is less than expected minimum ${
              expectedChanges.minCollateralChange
            } USD`
          );
        }
      }
    }

    // Verify debt changes with previous state comparison
    if (expectedChanges.debtIncrease) {
      if (debtChange.lte(0)) {
        throw new Error(
          `Expected debt increase but got change of ${ethers.utils.formatUnits(
            debtChange,
            AAVE_BASE_DEBT_ASSET_DECIMALS
          )} USD`
        );
      }
      console.log(
        `   ✅ Debt increased by ${ethers.utils.formatUnits(
          debtChange,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD`
      );

      // Check minimum debt change if specified
      if (expectedChanges.minDebtChange) {
        const minChange = ethers.utils.parseUnits(
          expectedChanges.minDebtChange,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        );
        if (debtChange.lt(minChange)) {
          throw new Error(
            `Debt increase ${ethers.utils.formatUnits(
              debtChange,
              AAVE_BASE_DEBT_ASSET_DECIMALS
            )} USD is less than expected minimum ${
              expectedChanges.minDebtChange
            } USD`
          );
        }
      }
    }

    if (expectedChanges.debtDecrease) {
      if (debtChange.gte(0)) {
        throw new Error(
          `Expected debt decrease but got change of ${ethers.utils.formatUnits(
            debtChange,
            AAVE_BASE_DEBT_ASSET_DECIMALS
          )} USD`
        );
      }
      console.log(
        `   ✅ Debt decreased by ${ethers.utils.formatUnits(
          debtChange.abs(),
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD`
      );

      // Check minimum debt change if specified
      if (expectedChanges.minDebtChange) {
        const minChange = ethers.utils.parseUnits(
          expectedChanges.minDebtChange,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        );
        if (debtChange.abs().lt(minChange)) {
          throw new Error(
            `Debt decrease ${ethers.utils.formatUnits(
              debtChange.abs(),
              AAVE_BASE_DEBT_ASSET_DECIMALS
            )} USD is less than expected minimum ${
              expectedChanges.minDebtChange
            } USD`
          );
        }
      }
    }
  } else {
    // For initial state or when no previous state, do basic validation
    if (expectedChanges.collateralIncrease) {
      if (currentAccountData.totalCollateralBase.eq(0)) {
        throw new Error("Expected collateral increase but collateral is zero");
      }
    }

    if (expectedChanges.debtIncrease) {
      if (currentAccountData.totalDebtBase.eq(0)) {
        throw new Error("Expected debt increase but debt is zero");
      }
    }
  }

  // Verify absolute minimum/maximum values if provided
  if (expectedChanges.minCollateral) {
    const minCollateral = ethers.utils.parseUnits(
      expectedChanges.minCollateral,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    );
    if (currentAccountData.totalCollateralBase.lt(minCollateral)) {
      throw new Error(
        `Collateral ${ethers.utils.formatUnits(
          currentAccountData.totalCollateralBase,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD is less than expected minimum ${
          expectedChanges.minCollateral
        } USD`
      );
    }
  }

  if (expectedChanges.maxCollateral) {
    const maxCollateral = ethers.utils.parseUnits(
      expectedChanges.maxCollateral,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    );
    if (currentAccountData.totalCollateralBase.gt(maxCollateral)) {
      throw new Error(
        `Collateral ${ethers.utils.formatUnits(
          currentAccountData.totalCollateralBase,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD exceeds expected maximum ${expectedChanges.maxCollateral} USD`
      );
    }
  }

  if (expectedChanges.minDebt) {
    const minDebt = ethers.utils.parseUnits(
      expectedChanges.minDebt,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    );
    if (currentAccountData.totalDebtBase.lt(minDebt)) {
      throw new Error(
        `Debt ${ethers.utils.formatUnits(
          currentAccountData.totalDebtBase,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD is less than expected minimum ${expectedChanges.minDebt} USD`
      );
    }
  }

  if (expectedChanges.maxDebt) {
    const maxDebt = ethers.utils.parseUnits(
      expectedChanges.maxDebt,
      AAVE_BASE_DEBT_ASSET_DECIMALS
    );
    if (currentAccountData.totalDebtBase.gt(maxDebt)) {
      throw new Error(
        `Debt ${ethers.utils.formatUnits(
          currentAccountData.totalDebtBase,
          AAVE_BASE_DEBT_ASSET_DECIMALS
        )} USD exceeds expected maximum ${expectedChanges.maxDebt} USD`
      );
    }
  }

  // Health factor should be > 1 for healthy positions
  if (currentAccountData.totalDebtBase.gt(0)) {
    const healthFactorNumber = parseFloat(
      ethers.utils.formatEther(currentAccountData.healthFactor)
    );
    if (healthFactorNumber <= 1.0) {
      console.warn(
        `⚠️  Warning: Health factor is ${healthFactorNumber.toFixed(
          4
        )}, position may be at risk`
      );
    }
  }

  // Store current state as previous state for next comparison
  previousAaveState = { ...currentAccountData };

  return currentAccountData;
}

// Helper function to reset state tracking (useful for test isolation)
export function resetAaveStateTracking() {
  previousAaveState = null;
}

// Test result tracking types
export interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

// Test tracking system
const testResults: TestResult[] = [];

export function addTestResult(name: string, passed: boolean, error?: string) {
  testResults.push({ name, passed, error });
  const status = passed ? "✅" : "❌";
  console.log(`${status} TEST: ${name}${error ? ` - ${error}` : ""}`);

  // Stop execution immediately if a test fails
  if (!passed) {
    console.log("\n🛑 Test failed - stopping execution");
    printTestSummary();
    process.exit(1);
  }
}

export function printTestSummary() {
  const passed = testResults.filter((t) => t.passed).length;
  const failed = testResults.filter((t) => !t.passed).length;
  const total = testResults.length;

  console.log("\n" + "=".repeat(60));
  console.log("🧪 TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total Tests: ${total}`);
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log("=".repeat(60));

  if (failed > 0) {
    console.log("\n❌ FAILED TESTS:");
    testResults
      .filter((t) => !t.passed)
      .forEach((test) => {
        console.log(`  - ${test.name}: ${test.error || "Unknown error"}`);
      });
  }

  return failed === 0;
}

// Token addresses - these are now available via getTestTokens(chain)
// Keeping these for backward compatibility with existing imports
export const TEST_WETH_ADDRESS = getTestTokens("sepolia").WETH; // WETH on Sepolia
export const TEST_USDC_ADDRESS = getTestTokens("sepolia").USDC; // USDC on Sepolia

// Contract ABIs
const wethAbi = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

const usdcAbi = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
];

export async function setupWethFunding(
  networkProvider: ethers.providers.Provider,
  pkpEthAddress: string,
  funderPrivateKey: string,
  addTestResult: (name: string, passed: boolean, error?: string) => void,
  confirmationsToWait: number = 1,
  chain: string = "sepolia",
  fundAmount: string
) {
  console.log(`💰 Setting up WETH funding for AAVE tests on ${chain}`);

  const WETH_FUND_AMOUNT = fundAmount;
  const REQUIRED_WETH_BALANCE = ethers.utils.parseEther(WETH_FUND_AMOUNT);

  const testTokens = getTestTokens(chain);

  // WETH contract for balance checking
  const wethContract = new ethers.Contract(
    testTokens.WETH,
    wethAbi,
    networkProvider
  );

  try {
    console.log("🔍 Checking PKP WETH balance");
    console.log(`   PKP Address: ${pkpEthAddress}`);
    console.log(`   WETH Contract: ${testTokens.WETH}`);

    // Create funder wallet using private key
    const funderWallet = new ethers.Wallet(funderPrivateKey, networkProvider);

    // Check current PKP WETH balance
    const currentBalance = await wethContract.balanceOf(pkpEthAddress);
    const currentBalanceFormatted = ethers.utils.formatEther(currentBalance);
    console.log(`   Current PKP WETH balance: ${currentBalanceFormatted} WETH`);
    console.log(`   Required WETH balance: ${WETH_FUND_AMOUNT} WETH`);

    if (currentBalance.gte(REQUIRED_WETH_BALANCE)) {
      console.log(
        "✅ PKP already has sufficient WETH balance, skipping funding"
      );
      addTestResult("WETH Balance Check", true);
    } else {
      console.log("🏦 PKP needs WETH funding, proceeding with transfer");
      console.log(`   Funder Address: ${funderWallet.address}`);
      console.log(
        `   Transferring ${WETH_FUND_AMOUNT} WETH (${REQUIRED_WETH_BALANCE.toString()} wei)`
      );

      // Execute WETH transfer
      const transferTx = await wethContract
        .connect(funderWallet)
        .transfer(pkpEthAddress, REQUIRED_WETH_BALANCE);
      console.log(`   Transfer transaction hash: ${transferTx.hash}`);

      // Wait for transaction confirmation
      const receipt = await transferTx.wait(confirmationsToWait);
      if (receipt.status === 0) {
        throw new Error(
          `WETH transfer transaction reverted: ${transferTx.hash}`
        );
      }
      console.log(
        `   ✅ WETH transfer confirmed in block ${receipt.blockNumber}`
      );

      // Verify new balance
      const newBalance = await wethContract.balanceOf(pkpEthAddress);
      console.log(
        `   New PKP WETH balance: ${ethers.utils.formatEther(newBalance)} WETH`
      );

      addTestResult("WETH Funding Setup", true);
    }

    return { wethContract, wethDecimals: await wethContract.decimals() };
  } catch (error) {
    console.error("❌ WETH funding setup failed:", error?.message || error);
    addTestResult(
      "WETH Funding Setup",
      false,
      error?.message || error.toString()
    );
    throw error;
  }
}

export async function setupEthFunding(
  networkProvider: ethers.providers.Provider,
  pkpEthAddress: string,
  funderPrivateKey: string,
  addTestResult: (name: string, passed: boolean, error?: string) => void,
  confirmationsToWait: number = 1,
  chain: string = "sepolia",
  fundAmount: string = "0.001"
) {
  console.log(`⛽ Setting up ETH gas funding for ${chain} operations`);

  const ETH_FUND_AMOUNT = fundAmount; // Use provided amount or default to 0.001 ETH
  const REQUIRED_ETH_BALANCE = ethers.utils.parseEther(fundAmount).mul(80).div(100); // 80% of fund amount as threshold

  try {
    console.log("🔍 Checking PKP ETH balance for gas fees");
    console.log(`   PKP Address: ${pkpEthAddress}`);

    // Create funder wallet using private key
    const funderWallet = new ethers.Wallet(funderPrivateKey, networkProvider);

    // Check current PKP ETH balance
    const currentEthBalance = await networkProvider.getBalance(pkpEthAddress);
    const currentEthBalanceFormatted =
      ethers.utils.formatEther(currentEthBalance);
    console.log(
      `   Current PKP ETH balance: ${currentEthBalanceFormatted} ETH`
    );
    console.log(
      `   Required ETH balance threshold: ${ethers.utils.formatEther(
        REQUIRED_ETH_BALANCE
      )} ETH`
    );

    if (currentEthBalance.gte(REQUIRED_ETH_BALANCE)) {
      console.log(
        "✅ PKP already has sufficient ETH balance for gas, skipping funding"
      );
      addTestResult("ETH Balance Check", true);
    } else {
      console.log("⛽ PKP needs ETH funding for gas, proceeding with transfer");
      console.log(`   Funder Address: ${funderWallet.address}`);
      console.log(`   Transferring ${ETH_FUND_AMOUNT} ETH`);

      // Execute ETH transfer
      const transferTx = await funderWallet.sendTransaction({
        to: pkpEthAddress,
        value: ethers.utils.parseEther(ETH_FUND_AMOUNT),
        gasLimit: 21000,
      });
      console.log(`   Transfer transaction hash: ${transferTx.hash}`);

      // Wait for transaction confirmation
      const receipt = await transferTx.wait(confirmationsToWait);
      if (receipt.status === 0) {
        throw new Error(
          `ETH transfer transaction reverted: ${transferTx.hash}`
        );
      }
      console.log(
        `   ✅ ETH transfer confirmed in block ${receipt.blockNumber}`
      );

      // Verify new balance
      const newEthBalance = await networkProvider.getBalance(pkpEthAddress);
      console.log(
        `   New PKP ETH balance: ${ethers.utils.formatEther(newEthBalance)} ETH`
      );

      addTestResult("ETH Funding Setup", true);
    }
  } catch (error) {
    console.error("❌ ETH funding setup failed:", error?.message || error);
    addTestResult(
      "ETH Funding Setup",
      false,
      error?.message || error.toString()
    );
    throw error;
  }
}

export async function setupUsdcContract(
  networkProvider: ethers.providers.Provider,
  chain: string = "sepolia"
) {
  const testTokens = getTestTokens(chain);
  const usdcContract = new ethers.Contract(
    testTokens.USDC,
    usdcAbi,
    networkProvider
  );
  const usdcDecimals = await usdcContract.decimals();
  return { usdcContract, usdcDecimals };
}
