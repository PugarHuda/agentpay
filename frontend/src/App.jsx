import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { CHAIN, ESCROW_ADDRESS, DEPLOY_BLOCK, REGISTRY_ADDRESS } from "./config.js";
import { ESCROW_ABI } from "./abi.js";
import { REGISTRY_ABI } from "./registryAbi.js";
import Agents from "./components/Agents.jsx";
import { errMsg, fmt, short } from "./lib.js";
import Nav from "./components/Nav.jsx";
import Stats from "./components/Stats.jsx";
import HireForm from "./components/HireForm.jsx";
import JobsList from "./components/JobsList.jsx";
import WorkFeed from "./components/WorkFeed.jsx";
import Footer from "./components/Footer.jsx";
import JobDetail from "./components/JobDetail.jsx";
import Landing from "./components/Landing.jsx";

// tiny hash router
function parseRoute() {
  const h = window.location.hash || "";
  const job = h.match(/^#\/job\/(\d+)/);
  if (job) return { name: "job", id: Number(job[1]) };
  const hireWith = h.match(/^#\/hire\/(0x[0-9a-fA-F]{40})/);
  if (hireWith) return { name: "hire", prefillAgent: hireWith[1] };
  if (h.startsWith("#/dashboard")) return { name: "dashboard" };
  if (h.startsWith("#/hire")) return { name: "hire" };
  if (h.startsWith("#/jobs")) return { name: "jobs" };
  if (h.startsWith("#/agents")) return { name: "agents" };
  if (h.startsWith("#/activity")) return { name: "activity" };
  return { name: "landing" };
}

export default function App() {
  // ---- read-only provider: dashboard works without a wallet ----
  const readProvider = useMemo(
    () =>
      new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id, {
        staticNetwork: true,
        polling: true,
        pollingInterval: 2000, // snappier pickup of new on-chain tasks
      }),
    []
  );
  const contract = useMemo(
    () =>
      ESCROW_ADDRESS
        ? new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, readProvider)
        : null,
    [readProvider]
  );

  // ---- WebSocket provider: real-time on-chain events via eth_subscribe ----
  // (HTTP polling above still backstops reads if the socket drops)
  const wsContract = useMemo(() => {
    if (!ESCROW_ADDRESS || !CHAIN.wss) return null;
    try {
      const wsp = new ethers.WebSocketProvider(CHAIN.wss, CHAIN.id);
      return new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, wsp);
    } catch {
      return null; // fall back to the HTTP polling listener
    }
  }, []);

  const registry = useMemo(
    () =>
      REGISTRY_ADDRESS
        ? new ethers.Contract(REGISTRY_ADDRESS, REGISTRY_ABI, readProvider)
        : null,
    [readProvider]
  );

  // ---- state ----
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [feed, setFeed] = useState([]);
  const [registryAgents, setRegistryAgents] = useState([]);
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(Boolean(contract));
  const [toast, setToast] = useState(null); // { kind: "err" | "ok", text }
  const [route, setRoute] = useState(parseRoute());
  const [, setTick] = useState(0); // 1s heartbeat → live status recompute
  const blockTimeCache = useRef(new Map());

  // re-render every second so "Working/Idle" + relative times stay live
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // hash routing
  useEffect(() => {
    const onHash = () => {
      setRoute(parseRoute());
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const notify = useCallback((kind, text) => {
    setToast({ kind, text });
    window.clearTimeout(notify._t);
    notify._t = window.setTimeout(() => setToast(null), 6000);
  }, []);

  // ---- chain reads ----
  const refreshJobs = useCallback(async () => {
    if (!contract) return;
    try {
      const n = Number(await contract.nextJobId());
      const list = await Promise.all(
        Array.from({ length: n }, async (_, i) => {
          const [j, remaining, rawTasks] = await Promise.all([
            contract.jobs(i),
            contract.tasksRemaining(i),
            contract.getTasks(i, 0, 500),
          ]);
          const tasks = rawTasks.map((t, idx) => ({
            id: idx,
            agent: t.agent,
            payout: t.payout,
            submittedAt: Number(t.submittedAt),
            claimableAt: Number(t.claimableAt),
            rejectedAt: Number(t.rejectedAt),
            disputedAt: Number(t.disputedAt),
            status: Number(t.status), // 0 Pending·1 Paid·2 Proposed·3 Disputed·4 RejectedFinal
            workHash: t.workHash,
            summary: t.summary,
          }));
          return {
            id: i,
            client: j.client,
            agent: j.agent,
            arbiter: j.arbiter,
            ratePerTask: j.ratePerTask,
            balance: j.balance,
            reserved: j.reserved,
            tasksPaid: Number(j.tasksPaid),
            stake: j.stake,
            slashPerReject: j.slashPerReject,
            minStake: j.minStake,
            accepted: j.accepted,
            active: j.active,
            spec: j.spec,
            remaining: Number(remaining),
            tasks,
            pending: tasks.filter((t) => t.status === 0).length,
          };
        })
      );
      setJobs(list.reverse()); // newest first
    } catch (e) {
      console.error("refreshJobs failed", e);
    }
  }, [contract]);

  const blockTimestamp = useCallback(
    async (blockNumber) => {
      const cache = blockTimeCache.current;
      if (!cache.has(blockNumber)) {
        cache.set(
          blockNumber,
          readProvider
            .getBlock(blockNumber)
            .then((b) => (b ? Number(b.timestamp) : null))
            .catch(() => {
              cache.delete(blockNumber);
              return null;
            })
        );
      }
      return cache.get(blockNumber);
    },
    [readProvider]
  );

  const logToEntry = useCallback(
    async (log, isNew) => {
      // TaskPaid(jobId, taskId, agent, payout, workHash, summary)
      const [jobId, taskId, agent, payout, workHash, summary] = log.args;
      return {
        key: `${log.transactionHash}:${log.index}`,
        jobId: Number(jobId),
        taskId: Number(taskId),
        taskIndex: Number(taskId) + 1,
        agent,
        payout,
        workHash,
        summary,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: await blockTimestamp(log.blockNumber),
        isNew,
      };
    },
    [blockTimestamp]
  );

  const loadFeed = useCallback(async () => {
    if (!contract) return;
    try {
      const logs = await contract.queryFilter(
        contract.filters.TaskPaid(),
        DEPLOY_BLOCK,
        "latest"
      );
      const entries = await Promise.all(logs.map((l) => logToEntry(l, false)));
      entries.sort(
        (a, b) => b.blockNumber - a.blockNumber || b.taskId - a.taskId
      );
      setFeed(entries);
    } catch (e) {
      console.error("loadFeed failed", e);
    }
  }, [contract, logToEntry]);

  // marketplace registry profiles + dispute outcomes (for the Agents page)
  const loadAgents = useCallback(async () => {
    try {
      if (registry) {
        const [addrs, profs] = await registry.getAgents(0, 200);
        setRegistryAgents(
          addrs.map((a, i) => ({
            addr: a,
            name: profs[i].name,
            bio: profs[i].bio,
            capabilities: profs[i].capabilities,
            suggestedRate: profs[i].suggestedRate,
            active: profs[i].active,
            since: Number(profs[i].since),
          }))
        );
      }
      if (contract) {
        const ev = await contract.queryFilter(contract.filters.DisputeResolved(), DEPLOY_BLOCK, "latest");
        setDisputes(ev.map((e) => ({ jobId: Number(e.args.jobId), agentWon: e.args.agentWon })));
      }
    } catch (e) {
      console.error("loadAgents failed", e);
    }
  }, [registry, contract]);

  // initial load + periodic refresh
  useEffect(() => {
    if (!contract) return;
    let alive = true;
    (async () => {
      await Promise.all([refreshJobs(), loadFeed(), loadAgents()]);
      if (alive) setLoading(false);
    })();
    const t = setInterval(() => {
      refreshJobs();
      loadFeed();
      loadAgents();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [contract, refreshJobs, loadFeed, loadAgents]);

  // ---- LIVE listener: TaskPaid via WebSocket eth_subscribe (instant),
  //      falling back to the HTTP polling contract if the socket is unavailable ----
  useEffect(() => {
    const live = wsContract || contract;
    if (!live) return;
    const handler = async (...args) => {
      const event = args[args.length - 1];
      try {
        const entry = await logToEntry(event.log, true);
        if (!entry.timestamp) entry.timestamp = Math.floor(Date.now() / 1000);
        let isNew = false;
        setFeed((prev) => {
          if (prev.some((e) => e.key === entry.key)) return prev;
          isNew = true;
          return [entry, ...prev];
        });
        if (isNew) {
          notify("ok", `⚡ Agent delivered — +${fmt(entry.payout)} ${CHAIN.symbol} · ${entry.summary}`);
        }
        refreshJobs();
        if (account) refreshBalance(account);
      } catch (e) {
        console.error("live event failed", e);
      }
    };
    live.on("TaskPaid", handler);
    return () => {
      live.off("TaskPaid", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsContract, contract, logToEntry, refreshJobs, account]);

  // ---- wallet ----
  const refreshBalance = useCallback(
    async (addr) => {
      try {
        setBalance(await readProvider.getBalance(addr));
      } catch {
        /* RPC hiccup — keep last value */
      }
    },
    [readProvider]
  );

  useEffect(() => {
    if (!account) return;
    refreshBalance(account);
    const t = setInterval(() => refreshBalance(account), 15000);
    return () => clearInterval(t);
  }, [account, refreshBalance]);

  const ensureChain = useCallback(async () => {
    const eth = window.ethereum;
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: CHAIN.idHex }],
      });
    } catch (switchErr) {
      const code = switchErr?.code ?? switchErr?.error?.code;
      if (code !== 4902) throw switchErr;
      await eth.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: CHAIN.idHex,
            chainName: CHAIN.name,
            nativeCurrency: { name: "zkLTC", symbol: CHAIN.symbol, decimals: 18 },
            rpcUrls: [CHAIN.rpc],
            blockExplorerUrls: [CHAIN.explorer],
          },
        ],
      });
    }
  }, []);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      notify("err", "MetaMask not detected — install it to hire agents.");
      return;
    }
    try {
      const accounts = await window.ethereum.request({
        method: "eth_requestAccounts",
      });
      await ensureChain();
      const addr = ethers.getAddress(accounts[0]);
      setAccount(addr);
      refreshBalance(addr);
    } catch (e) {
      notify("err", errMsg(e));
    }
  }, [ensureChain, notify, refreshBalance]);

  useEffect(() => {
    const eth = window.ethereum;
    if (!eth || !eth.on) return;
    const onAccounts = (accs) =>
      setAccount(accs && accs.length ? ethers.getAddress(accs[0]) : null);
    eth.on("accountsChanged", onAccounts);
    return () => {
      if (eth.removeListener) eth.removeListener("accountsChanged", onAccounts);
    };
  }, []);

  // ---- writes ----
  const getWriteContract = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    await ensureChain();
    const browserProvider = new ethers.BrowserProvider(window.ethereum);
    const signer = await browserProvider.getSigner();
    return new ethers.Contract(ESCROW_ADDRESS, ESCROW_ABI, signer);
  }, [ensureChain]);

  const createJob = useCallback(
    async ({ agent, arbiter, rate, deposit, slash, minStake, spec }) => {
      const c = await getWriteContract();
      const tx = await c.createJob(
        agent,
        arbiter,
        ethers.parseEther(rate),
        ethers.parseEther(slash || "0"),
        ethers.parseEther(minStake || slash || "0"),
        spec,
        { value: ethers.parseEther(deposit) }
      );
      const receipt = await tx.wait();
      await refreshJobs();
      if (account) refreshBalance(account);
      return receipt;
    },
    [getWriteContract, refreshJobs, refreshBalance, account]
  );

  // agent stakes to accept a job (V3)
  const acceptJob = useCallback(
    async (jobId, stake) => {
      const c = await getWriteContract();
      const tx = await c.acceptJob(jobId, { value: ethers.parseEther(stake) });
      await tx.wait();
      await refreshJobs();
      if (account) refreshBalance(account);
      notify("ok", `Staked ${stake} ${CHAIN.symbol} — job #${jobId} accepted`);
    },
    [getWriteContract, refreshJobs, refreshBalance, account, notify]
  );

  const fundJob = useCallback(
    async (jobId, amount) => {
      const c = await getWriteContract();
      const tx = await c.fund(jobId, { value: ethers.parseEther(amount) });
      await tx.wait();
      await refreshJobs();
      if (account) refreshBalance(account);
      notify("ok", `Job #${jobId} funded with ${amount} ${CHAIN.symbol}`);
    },
    [getWriteContract, refreshJobs, refreshBalance, account, notify]
  );

  const closeJob = useCallback(
    async (jobId) => {
      const c = await getWriteContract();
      const tx = await c.closeJob(jobId);
      await tx.wait();
      await refreshJobs();
      if (account) refreshBalance(account);
      notify("ok", `Job #${jobId} closed — unspent (free) escrow refunded`);
    },
    [getWriteContract, refreshJobs, refreshBalance, account, notify]
  );

  // ---- V2 optimistic task actions ----
  const approveTask = useCallback(
    async (jobId, taskId) => {
      const c = await getWriteContract();
      const tx = await c.approveTask(jobId, taskId);
      await tx.wait();
      await Promise.all([refreshJobs(), loadFeed()]);
      if (account) refreshBalance(account);
      notify("ok", `Approved task #${taskId} of job #${jobId} — agent paid`);
    },
    [getWriteContract, refreshJobs, loadFeed, refreshBalance, account, notify]
  );

  const rejectTask = useCallback(
    async (jobId, taskId, reason) => {
      const c = await getWriteContract();
      const tx = await c.rejectTask(jobId, taskId, reason || "rejected by client");
      await tx.wait();
      await refreshJobs();
      if (account) refreshBalance(account);
      notify("ok", `Rejected task #${taskId} — escrow returned, agent unpaid`);
    },
    [getWriteContract, refreshJobs, refreshBalance, account, notify]
  );

  const claimTask = useCallback(
    async (jobId, taskId) => {
      const c = await getWriteContract();
      const tx = await c.claimTask(jobId, taskId);
      await tx.wait();
      await Promise.all([refreshJobs(), loadFeed()]);
      if (account) refreshBalance(account);
      notify("ok", `Claimed task #${taskId} — optimistic payout released`);
    },
    [getWriteContract, refreshJobs, loadFeed, refreshBalance, account, notify]
  );

  // ---- V4 arbitration ----
  const disputeRejection = useCallback(
    async (jobId, taskId) => {
      const c = await getWriteContract();
      await (await c.disputeRejection(jobId, taskId)).wait();
      await refreshJobs();
      notify("ok", `Disputed rejection of task #${taskId} — escalated to the arbiter`);
    },
    [getWriteContract, refreshJobs, notify]
  );

  const resolveDispute = useCallback(
    async (jobId, taskId, agentWon) => {
      const c = await getWriteContract();
      await (await c.resolveDispute(jobId, taskId, agentWon)).wait();
      await Promise.all([refreshJobs(), loadFeed()]);
      notify("ok", `Dispute resolved ${agentWon ? "for the agent (paid)" : "for the client (slashed)"}`);
    },
    [getWriteContract, refreshJobs, loadFeed, notify]
  );

  const finalizeRejection = useCallback(
    async (jobId, taskId) => {
      const c = await getWriteContract();
      await (await c.finalizeRejection(jobId, taskId)).wait();
      await refreshJobs();
      notify("ok", `Rejection of task #${taskId} finalized — slash applied`);
    },
    [getWriteContract, refreshJobs, notify]
  );

  // liveness backstop: anyone unsticks a dispute an absent arbiter ignored
  const forceResolve = useCallback(
    async (jobId, taskId) => {
      const c = await getWriteContract();
      await (await c.forceResolveStuck(jobId, taskId)).wait();
      await Promise.all([refreshJobs(), loadFeed()]);
      notify("ok", `Stuck dispute force-resolved for the agent (arbiter timed out)`);
    },
    [getWriteContract, refreshJobs, loadFeed, notify]
  );

  // ---- derived stats ----
  const totalJobs = jobs.length;
  const totalTasks = feed.length;
  const totalPaid = useMemo(
    () => feed.reduce((acc, e) => acc + e.payout, 0n),
    [feed]
  );
  // most recent SUBMIT timestamp per job — powers the live "Working / Idle"
  // status (an agent submitting work right now is the strongest "working" signal)
  const lastTaskByJob = useMemo(() => {
    const m = {};
    for (const j of jobs) {
      for (const t of j.tasks || []) {
        if (t.submittedAt && (!m[j.id] || t.submittedAt > m[j.id])) {
          m[j.id] = t.submittedAt;
        }
      }
    }
    return m;
  }, [jobs]);
  const pendingCount = useMemo(
    () => jobs.reduce((a, j) => a + (j.pending || 0), 0),
    [jobs]
  );
  // recomputed every render (1s tick) so the dashboard "working now" count is live
  const nowSec = Math.floor(Date.now() / 1000);
  const workingNow = jobs.filter(
    (j) => j.active && lastTaskByJob[j.id] && nowSec - Number(lastTaskByJob[j.id]) < 120
  ).length;

  return (
    <div className="app">
      <div className="bg-fx" />
      <Nav account={account} balance={balance} onConnect={connect} route={route.name} />

      {!ESCROW_ADDRESS && (
        <div className="banner">
          <span className="dot" style={{ background: "var(--amber)" }} />
          Contract not deployed yet — set <code>VITE_ESCROW_ADDRESS</code> in{" "}
          <code>frontend/.env</code>. The dashboard lights up automatically.
        </div>
      )}

      {toast && <div className={`toast ${toast.kind}`}>{toast.text}</div>}

      {route.name === "job" && (
        <JobDetail
          job={jobs.find((j) => j.id === route.id) || null}
          entries={feed.filter((e) => e.jobId === route.id)}
          account={account}
          lastTask={lastTaskByJob[route.id]}
          onFund={fundJob}
          onClose={closeJob}
          onApprove={approveTask}
          onReject={rejectTask}
          onClaim={claimTask}
          onAccept={acceptJob}
          onDispute={disputeRejection}
          onResolve={resolveDispute}
          onFinalize={finalizeRejection}
          onForceResolve={forceResolve}
          notify={notify}
        />
      )}

      {route.name === "landing" && (
        <Landing
          account={account}
          totalPaid={fmt(totalPaid)}
          totalTasks={totalTasks}
          totalJobs={totalJobs}
          onConnect={connect}
        />
      )}

      {route.name === "dashboard" && (
        <main className="container page">
          <h1 className="page-title">⚡ Dashboard</h1>
          <div className={`livebar${workingNow > 0 ? " on" : ""}`}>
            <span className="dot" />
            <strong>
              {workingNow > 0
                ? `${workingNow} agent${workingNow > 1 ? "s" : ""} working right now`
                : "No agents working right now"}
            </strong>
            <span className="livebar-sub">live · updates every second</span>
          </div>
          <Stats
            totalPaid={fmt(totalPaid)}
            totalTasks={totalTasks}
            totalJobs={totalJobs}
            pendingCount={pendingCount}
            loading={loading}
          />
          <div className="grid">
            <div className="col">
              <section className="card panel">
                <div className="phead">
                  <h2 className="ptitle">⚡ Quick actions</h2>
                </div>
                <p className="psub">Jump straight to what you want to do.</p>
                <div className="quick-actions">
                  <a className="btn btn-primary" href="#/hire">Hire an Agent →</a>
                  <a className="btn btn-ghost" href="#/jobs">Browse Jobs →</a>
                  <a className="btn btn-ghost" href="#/activity">Live Activity →</a>
                </div>
              </section>
            </div>
            <div className="col">
              <WorkFeed
                feed={feed}
                loading={loading}
                limit={3}
                moreHref="#/activity"
              />
            </div>
          </div>
        </main>
      )}

      {route.name === "hire" && (
        <main className="container page">
          <h1 className="page-title">🪄 Hire an Agent</h1>
          <div className="page-narrow">
            <HireForm
              disabled={!ESCROW_ADDRESS}
              account={account}
              prefillAgent={route.prefillAgent}
              onConnect={connect}
              onCreate={createJob}
            />
          </div>
        </main>
      )}

      {route.name === "agents" && (
        <main className="container page">
          <h1 className="page-title">🧑‍💻 Agents Marketplace</h1>
          <Agents
            agents={registryAgents}
            feed={feed}
            jobs={jobs}
            disputes={disputes}
            loading={loading}
          />
        </main>
      )}

      {route.name === "jobs" && (
        <main className="container page">
          <h1 className="page-title">💼 Jobs</h1>
          <JobsList
            jobs={jobs}
            account={account}
            loading={loading}
            grid
            lastTaskByJob={lastTaskByJob}
            onFund={fundJob}
            onClose={closeJob}
            notify={notify}
          />
        </main>
      )}

      {route.name === "activity" && (
        <main className="container page">
          <h1 className="page-title">📡 Live Activity</h1>
          <WorkFeed feed={feed} loading={loading} />
        </main>
      )}

      <Footer />
    </div>
  );
}
