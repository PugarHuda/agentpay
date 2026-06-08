import { ethers } from "ethers";

/** 0x1234…abcd */
export function short(addr) {
  if (!addr) return "";
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

/** 0x12345678…90ab for hashes */
export function shortHash(hash) {
  if (!hash) return "";
  return hash.slice(0, 10) + "…" + hash.slice(-4);
}

/** Format wei -> zkLTC string with trailing zeros trimmed */
export function fmt(wei) {
  let s = ethers.formatEther(wei ?? 0n);
  if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

/** Relative time from a unix timestamp (seconds) */
export function timeAgo(ts) {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - Number(ts);
  if (diff < 10) return "just now";
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(Number(ts) * 1000).toLocaleString();
}

/**
 * Live agent status derived purely from on-chain task timestamps.
 * The chain can't see if a process is running, but a recent completed task is
 * strong evidence the agent is actively working right now.
 */
export function agentStatus(active, lastTs, windowSec = 120) {
  if (!active) return { key: "closed", label: "Closed", working: false };
  if (!lastTs) return { key: "idle", label: "No deliveries yet", working: false };
  const age = Math.floor(Date.now() / 1000) - Number(lastTs);
  if (age < windowSec) return { key: "working", label: "Working", working: true };
  return { key: "idle", label: `Idle · last ${timeAgo(lastTs)}`, working: false };
}

/** Human-friendly error message from an ethers / wallet error */
export function errMsg(e) {
  if (!e) return "Unknown error";
  if (e.code === "ACTION_REJECTED" || e.code === 4001) return "Transaction rejected in wallet";
  if (e.reason) return e.reason;
  if (e.shortMessage) return e.shortMessage;
  if (e.message) return e.message.length > 140 ? e.message.slice(0, 140) + "…" : e.message;
  return String(e);
}
