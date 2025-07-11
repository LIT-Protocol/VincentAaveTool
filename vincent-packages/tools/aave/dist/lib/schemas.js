import { z } from "zod";
/**
 * AAVE operation types
 */
export var AaveOperation;
(function (AaveOperation) {
    AaveOperation["SUPPLY"] = "supply";
    AaveOperation["WITHDRAW"] = "withdraw";
    AaveOperation["BORROW"] = "borrow";
    AaveOperation["REPAY"] = "repay";
})(AaveOperation || (AaveOperation = {}));
/**
 * Supported chains for validation
 */
const SUPPORTED_CHAINS = [
    // Mainnets
    "ethereum", "polygon", "avalanche", "arbitrum", "optimism", "base",
    "fantom", "bnb", "gnosis", "scroll", "metis", "linea", "zksync",
    // Testnets
    "sepolia", "basesepolia", "arbitrumsepolia", "optimismsepolia",
    "avalanchefuji", "scrollsepolia"
];
/**
 * Tool parameters schema - defines the input parameters for the AAVE tool
 */
export const toolParamsSchema = z.object({
    operation: z.nativeEnum(AaveOperation),
    asset: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid token address"),
    amount: z
        .string()
        .regex(/^\d*\.?\d+$/, "Invalid amount format")
        .refine((val) => parseFloat(val) > 0, "Amount must be greater than 0"),
    interestRateMode: z.number().int().min(1).max(2).optional(), // 1 = Stable, 2 = Variable (only for borrow)
    onBehalfOf: z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address")
        .optional(),
    chain: z.string().refine((val) => SUPPORTED_CHAINS.includes(val.toLowerCase()), `Chain must be one of: ${SUPPORTED_CHAINS.join(", ")}`),
    rpcUrl: z.string().optional(),
});
/**
 * Precheck success result schema
 */
export const precheckSuccessSchema = z.object({
    operationValid: z.boolean(),
    assetValid: z.boolean(),
    amountValid: z.boolean(),
    userBalance: z.string().optional(),
    allowance: z.string().optional(),
    borrowCapacity: z.string().optional(),
    estimatedGas: z.number().optional(),
    availableMarkets: z.record(z.string()).optional(),
    supportedChains: z.array(z.string()).optional(),
});
/**
 * Precheck failure result schema
 */
export const precheckFailSchema = z.object({
    error: z.string(),
});
/**
 * Execute success result schema
 */
export const executeSuccessSchema = z.object({
    txHash: z.string(),
    operation: z.nativeEnum(AaveOperation),
    asset: z.string(),
    amount: z.string(),
    timestamp: z.number(),
    interestRateMode: z.number().optional(),
});
/**
 * Execute failure result schema
 */
export const executeFailSchema = z.object({
    error: z.string(),
});
