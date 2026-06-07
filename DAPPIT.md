# Deploying the AgentPay Reward Token with Dappit

AgentPay supports two tooling paths from the LiteForge Hackathon brief:
**"Build with Dappit, or bring your own EVM tooling."** We do **both** — the core
escrow + agent are built with Foundry/Hardhat-style tooling (ethers v6), and the
**APAY reward token is deployed no-code via [Dappit](https://dappit.io)**, then
wired into the same dapp. This proves the full hackathon toolchain end-to-end.

## Step 1 — deploy APAY via Dappit (no code)

1. Open https://dappit.io and connect your wallet.
2. Make sure the wallet is on **LitVM LiteForge** (Chain ID `4441`,
   RPC `https://liteforge.rpc.caldera.xyz/http`).
3. Paste this prompt to Dappit:

> Deploy an ERC-20 token on the LitVM LiteForge testnet (chain id 4441).
> Name: "AgentPay Reward". Symbol: "APAY". Decimals: 18. Initial supply:
> 1,000,000 tokens, all minted to my connected wallet. Make it a standard,
> ownable, mintable ERC-20 so I can mint more rewards later. Verify the
> contract source on the LiteForge Blockscout explorer after deploying.

4. When Dappit finishes, copy the **deployed APAY token address** and the
   **deployment tx hash**.

## Step 2 — hand the address back

Paste the APAY address here / into chat. We then:
- deploy `AgentEscrowERC20` (already built + tested) pointing at APAY,
- approve + create a token-funded job,
- run the agent so it earns **APAY** per task (on top of the native zkLTC flow),
- show both wage types in the dashboard.

## Result

- **Native zkLTC wages** → escrow built with our own EVM tooling (`AgentEscrow`).
- **APAY token wages** → token deployed by Dappit, escrowed by `AgentEscrowERC20`.

One dapp, both hackathon tooling tracks, all on LiteForge.

---

APAY address: `<PASTE_FROM_DAPPIT>`
APAY deploy tx: `<PASTE_FROM_DAPPIT>`
