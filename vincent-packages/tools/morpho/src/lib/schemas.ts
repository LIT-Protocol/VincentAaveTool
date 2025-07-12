import { z } from "zod";

/**
 * Morpho Vault operation types
 */
export enum MorphoOperation {
  DEPOSIT = "deposit",
  WITHDRAW = "withdraw",
  REDEEM = "redeem",
}

/**
 * Tool parameters schema - defines the input parameters for the Morpho tool
 */
export const toolParamsSchema = z.object({
  operation: z.nativeEnum(MorphoOperation),
  vaultAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Invalid vault address"),
  amount: z
    .string()
    .regex(/^\d*\.?\d+$/, "Invalid amount format")
    .refine((val) => parseFloat(val) > 0, "Amount must be greater than 0"),
  onBehalfOf: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid address")
    .optional(),
  chain: z.string(),
  rpcUrl: z.string().optional(),
  // Gas sponsorship parameters for EIP-7702
  alchemyGasSponsor: z.boolean().optional().default(false),
  alchemyGasSponsorApiKey: z.string().optional(),
  alchemyGasSponsorPolicyId: z.string().optional(),
});

/**
 * Precheck success result schema
 */
export const precheckSuccessSchema = z.object({
  operationValid: z.boolean(),
  vaultValid: z.boolean(),
  amountValid: z.boolean(),
  userBalance: z.string().optional(),
  allowance: z.string().optional(),
  vaultShares: z.string().optional(),
  estimatedGas: z.number().optional(),
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
  operation: z.nativeEnum(MorphoOperation),
  vaultAddress: z.string(),
  amount: z.string(),
  timestamp: z.number(),
});

/**
 * Execute failure result schema
 */
export const executeFailSchema = z.object({
  error: z.string(),
});

// Type exports
export type ToolParams = z.infer<typeof toolParamsSchema>;
export type PrecheckSuccess = z.infer<typeof precheckSuccessSchema>;
export type PrecheckFail = z.infer<typeof precheckFailSchema>;
export type ExecuteSuccess = z.infer<typeof executeSuccessSchema>;
export type ExecuteFail = z.infer<typeof executeFailSchema>;
