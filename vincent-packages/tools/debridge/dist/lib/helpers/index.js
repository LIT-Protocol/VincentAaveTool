import { ethers } from "ethers";
import { LIT_EVM_CHAINS } from "@lit-protocol/constants";
export const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";
export const CHAIN_IDS = {
    ETHEREUM: "1",
    BASE: "8453",
    ARBITRUM: "42161",
    OPTIMISM: "10",
    POLYGON: "137",
    BSC: "56",
    AVALANCHE: "43114",
};
export const CHAIN_NAMES = {
    "1": "Ethereum",
    "8453": "Base",
    "42161": "Arbitrum",
    "10": "Optimism",
    "137": "Polygon",
    "56": "BSC",
    "43114": "Avalanche",
};
export const DEBRIDGE_API_URL = "https://dln.debridge.finance/v1.0";
export const DEBRIDGE_CONTRACTS = {
    "1": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Ethereum
    "8453": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Base
    "42161": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Arbitrum
    "10": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Optimism
    "137": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Polygon
    "56": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // BSC
    "43114": "0xeF4fB24aD0916217251F553c0596F8Edc630EB66", // Avalanche
};
export const DEBRIDGE_ABI = [
    {
        inputs: [
            {
                components: [
                    {
                        internalType: "address",
                        name: "giveTokenAddress",
                        type: "address",
                    },
                    { internalType: "uint256", name: "giveAmount", type: "uint256" },
                    { internalType: "uint256", name: "takeAmount", type: "uint256" },
                    { internalType: "uint256", name: "takeChainId", type: "uint256" },
                    { internalType: "address", name: "receiverDst", type: "address" },
                    {
                        internalType: "address",
                        name: "givePatchAuthoritySrc",
                        type: "address",
                    },
                    {
                        internalType: "address",
                        name: "orderAuthorityAddressDst",
                        type: "address",
                    },
                    { internalType: "bytes", name: "allowedTakerDst", type: "bytes" },
                    { internalType: "bytes", name: "externalCall", type: "bytes" },
                    {
                        internalType: "bytes",
                        name: "allowedCancelBeneficiarySrc",
                        type: "bytes",
                    },
                ],
                internalType: "struct DLNOrder",
                name: "_order",
                type: "tuple",
            },
            { internalType: "bytes", name: "_affiliateFee", type: "bytes" },
            { internalType: "uint32", name: "_referralCode", type: "uint32" },
            { internalType: "bytes", name: "_permit", type: "bytes" },
        ],
        name: "createOrder",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "payable",
        type: "function",
    },
];
export const ERC20_ABI = [
    {
        constant: true,
        inputs: [{ name: "_owner", type: "address" }],
        name: "balanceOf",
        outputs: [{ name: "balance", type: "uint256" }],
        type: "function",
    },
    {
        constant: true,
        inputs: [
            { name: "_owner", type: "address" },
            { name: "_spender", type: "address" },
        ],
        name: "allowance",
        outputs: [{ name: "", type: "uint256" }],
        type: "function",
    },
    {
        constant: false,
        inputs: [
            { name: "_spender", type: "address" },
            { name: "_value", type: "uint256" },
        ],
        name: "approve",
        outputs: [{ name: "", type: "bool" }],
        type: "function",
    },
    {
        constant: true,
        inputs: [],
        name: "decimals",
        outputs: [{ name: "", type: "uint8" }],
        type: "function",
    },
];
export function isNativeToken(tokenAddress) {
    return tokenAddress.toLowerCase() === NATIVE_TOKEN_ADDRESS.toLowerCase();
}
export function getChainName(chainId) {
    return CHAIN_NAMES[chainId] || `Chain ${chainId}`;
}
export async function getTokenBalance(provider, tokenAddress, userAddress) {
    if (isNativeToken(tokenAddress)) {
        return await provider.getBalance(userAddress);
    }
    else {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await tokenContract.balanceOf(userAddress);
    }
}
export async function getTokenDecimals(provider, tokenAddress) {
    if (isNativeToken(tokenAddress)) {
        return 18;
    }
    else {
        const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
        return await tokenContract.decimals();
    }
}
export async function checkAndApproveToken(provider, tokenAddress, ownerAddress, spenderAddress, amount) {
    if (isNativeToken(tokenAddress)) {
        return {
            needsApproval: false,
            currentAllowance: ethers.constants.MaxUint256,
        };
    }
    const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
    const currentAllowance = await tokenContract.allowance(ownerAddress, spenderAddress);
    return {
        needsApproval: currentAllowance.lt(amount),
        currentAllowance,
    };
}
export function validateChainId(chainId) {
    return Object.values(CHAIN_IDS).includes(chainId);
}
export function validateAddress(address) {
    try {
        ethers.utils.getAddress(address);
        return true;
    }
    catch {
        return false;
    }
}
export async function callDeBridgeAPI(endpoint, method = "GET", data) {
    let url = `${DEBRIDGE_API_URL}${endpoint}`;
    const options = {
        method,
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
        },
    };
    if (method === "GET" && data && typeof data === "object") {
        const params = new URLSearchParams();
        for (const key in data) {
            if (data[key] !== undefined && data[key] !== null) {
                params.append(key, String(data[key]));
            }
        }
        const paramString = params.toString();
        if (paramString) {
            url += (url.includes("?") ? "&" : "?") + paramString;
        }
    }
    else if (data && method !== "GET") {
        options.body = JSON.stringify(data);
    }
    console.log(`Fetching debridge API URL:`, url);
    const response = await fetch(url, options);
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`DeBridge API error: ${response.status} - ${errorText}`);
    }
    return await response.json();
}
export function formatAmount(amount, decimals) {
    try {
        const formatted = ethers.utils.formatUnits(amount, decimals);
        return formatted;
    }
    catch {
        return amount;
    }
}
export function parseAmount(amount, decimals) {
    try {
        const parsed = ethers.utils.parseUnits(amount, decimals);
        return parsed.toString();
    }
    catch {
        throw new Error(`Invalid amount format: ${amount}`);
    }
}
export async function getRpcUrl(chainId) {
    // Try to find the chain entry in LIT_EVM_CHAINS with matching chainId
    for (const [chainKey, chainData] of Object.entries(LIT_EVM_CHAINS)) {
        // LIT_EVM_CHAINS chainId is a number, input is string
        if (String(chainData.chainId) === String(chainId)) {
            // Return the first rpcUrl if available
            if (Array.isArray(chainData.rpcUrls) && chainData.rpcUrls.length > 0) {
                return await Lit.Actions.getRpcUrl({ chain: chainKey });
            }
        }
    }
    throw new Error(`ChainId ${chainId} not found in LIT_EVM_CHAINS`);
}
