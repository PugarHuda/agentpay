// LitVM LiteForge testnet configuration
export const CHAIN = {
  id: 4441,
  idHex: "0x1159",
  name: "LitVM LiteForge",
  symbol: "zkLTC",
  rpc: "https://liteforge.rpc.caldera.xyz/http",
  explorer: "https://liteforge.explorer.caldera.xyz",
  faucet: "https://liteforge.hub.caldera.xyz",
};

// Set after deployment: VITE_ESCROW_ADDRESS in frontend/.env
export const ESCROW_ADDRESS = import.meta.env.VITE_ESCROW_ADDRESS || "";

// Scanning logs from genesis times out on the public RPC (16.7M+ blocks),
// so event queries start at the contract's deployment block.
export const DEPLOY_BLOCK = Number(import.meta.env.VITE_DEPLOY_BLOCK || 16703976);
