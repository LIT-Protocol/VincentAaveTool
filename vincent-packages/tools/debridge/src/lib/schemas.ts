import { z } from "zod";

export const Operations = {
  BRIDGE: "BRIDGE",
  BRIDGE_AND_SWAP: "BRIDGE_AND_SWAP",
} as const;

export type Operation = (typeof Operations)[keyof typeof Operations];

export const toolParamsSchema = z.object({
  rpcUrl: z.string().url().describe("RPC URL for the source chain"),
  sourceChain: z
    .string()
    .describe("Source chain ID (e.g., '1' for Ethereum, '8453' for Base)"),
  destinationChain: z.string().describe("Destination chain ID"),
  sourceToken: z
    .string()
    .describe(
      "Source token address (use 0x0000000000000000000000000000000000000000 for native token)"
    ),
  destinationToken: z
    .string()
    .describe(
      "Destination token address (use 0x0000000000000000000000000000000000000000 for native token)"
    ),
  amount: z
    .string()
    .describe(
      "Amount to bridge in token units (e.g., '1000000000000000000' for 1 ETH)"
    ),
  recipientAddress: z
    .string()
    .describe("Recipient address on destination chain"),
  operation: z
    .enum([Operations.BRIDGE, Operations.BRIDGE_AND_SWAP])
    .describe("Operation type"),
  slippageBps: z
    .number()
    .optional()
    .default(100)
    .describe("Slippage tolerance in basis points (100 = 1%)"),
});

export type ToolParams = z.infer<typeof toolParamsSchema>;

export const precheckSuccessSchema = z.object({
  data: z.object({
    sourceChain: z.string(),
    destinationChain: z.string(),
    sourceToken: z.string(),
    destinationToken: z.string(),
    sourceAmount: z.string(),
    estimatedDestinationAmount: z.string(),
    estimatedFees: z.object({
      protocolFee: z.string(),
    }),
    estimatedExecutionTime: z.string().describe("Estimated time in seconds"),
    orderData: z
      .object({
        orderId: z.string().optional(),
        txData: z.string().optional(),
        contractAddress: z.string(),
      })
      .optional(),
  }),
});

export type PrecheckSuccess = z.infer<typeof precheckSuccessSchema>;

export const precheckFailSchema = z.object({
  error: z.string(),
});

export type PrecheckFail = z.infer<typeof precheckFailSchema>;

export const executeSuccessSchema = z.object({
  data: z.object({
    txHash: z.string(),
    sourceChain: z.string(),
    destinationChain: z.string(),
    sourceToken: z.string(),
    destinationToken: z.string(),
    sourceAmount: z.string(),
    orderId: z.string().optional(),
  }),
});

export type ExecuteSuccess = z.infer<typeof executeSuccessSchema>;

export const executeFailSchema = z.object({
  error: z.string(),
});

export type ExecuteFail = z.infer<typeof executeFailSchema>;
