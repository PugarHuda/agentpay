// LitVM LiteForge testnet configuration
export const CHAIN = {
  id: 4441,
  idHex: "0x1159",
  name: "LitVM LiteForge",
  symbol: "zkLTC",
  rpc: "https://liteforge.rpc.caldera.xyz/http",
  wss: "wss://liteforge.rpc.caldera.xyz/ws",
  explorer: "https://liteforge.explorer.caldera.xyz",
  faucet: "https://liteforge.hub.caldera.xyz",
};

// Set after deployment: VITE_ESCROW_ADDRESS in frontend/.env.
// Strip BOM / whitespace and validate — a stray ﻿ (e.g. injected by a
// shell pipe when setting the env var) makes ethers treat the address as an
// ENS name and throw "network does not support ENS", silently blanking all
// on-chain reads. Treat anything that isn't a clean 0x-address as unset.
function cleanAddress(raw) {
  // keep only visible ASCII — drops BOM (U+FEFF), zero-width chars, whitespace
  const a = (raw || "").replace(/[^\x21-\x7e]/g, "");
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? a : "";
}
export const ESCROW_ADDRESS = cleanAddress(import.meta.env.VITE_ESCROW_ADDRESS);

// Agent marketplace registry (optional; the Agents page degrades gracefully if unset)
export const REGISTRY_ADDRESS = cleanAddress(import.meta.env.VITE_REGISTRY_ADDRESS) ||
  "0x2aE3A667Aa70D23a365eB8310656d06B7c30183E";

// Scanning logs from genesis times out on the public RPC (16.9M+ blocks),
// so event queries start at the V3 contract's deployment block.
export const DEPLOY_BLOCK = Number(import.meta.env.VITE_DEPLOY_BLOCK || 16941954);

// Optimistic-escrow dispute window (seconds) — must match the deployed contract.
export const DISPUTE_WINDOW = Number(import.meta.env.VITE_DISPUTE_WINDOW || 90);
