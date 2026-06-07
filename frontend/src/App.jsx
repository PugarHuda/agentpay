import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { CHAIN, ESCROW_ADDRESS, DEPLOY_BLOCK } from "./config.js";
import { ESCROW_ABI } from "./abi.js";
import { errMsg, fmt, short } from "./lib.js";
import Nav from "./components/Nav.jsx";
import Hero from "./components/Hero.jsx";
import Stats from "./components/Stats.jsx";
import HireForm from "./components/HireForm.jsx";
import JobsList from "./components/JobsList.jsx";
import WorkFeed from "./components/WorkFeed.jsx";
import Footer from "./components/Footer.jsx";
import JobDetail from "./components/JobDetail.jsx";

// tiny hash router
function parseRoute() {
  const h = window.location.hash || "";
  const job = h.match(/^#\/job\/(\d+)/);
  if (job) return { name: "job", id: Number(job[1]) };
  if (h.startsWith("#/hire")) return { name: "hire" };
  if (h.startsWith("#/jobs")) return { name: "jobs" };
  if (h.startsWith("#/activity")) return { name: "activity" };
  return { name: "dashboard" };
}

export default function App() {
  // ---- read-only provider: dashboard works without a wallet ----
  const readProvider = useMemo(
    () =>
      new ethers.JsonRpcProvider(CHAIN.rpc, CHAIN.id, {
        staticNetwork: true,
        polling: true,
        pollingInterval: 4000,
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

  // ---- state ----
  const [account, setAccount] = useState(null);
  const [balance, setBalance] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(Boolean(contract));
  const [toast, setToast] = useState(null); // { kind: "err" | "ok", text }
  const [route, setRoute] = useState(parseRoute());
  const blockTimeCache = useRef(new Map());

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
          const [j, remaining] = await Promise.all([
            contract.jobs(i),
            contract.tasksRemaining(i),
          ]);
          return {
            id: i,
            client: j.client,
            agent: j.agent,
            ratePerTask: j.ratePerTask,
            balance: j.balance,
            tasksCompleted: Number(j.tasksCompleted),
            active: j.active,
            spec: j.spec,
            remaining: Number(remaining),
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
      const [jobId, agent, taskIndex, payout, workHash, summary] = log.args;
      return {
        key: `${log.transactionHash}:${log.index}`,
        jobId: Number(jobId),
        agent,
        taskIndex: Number(taskIndex),
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
        contract.filters.TaskCompleted(),
        DEPLOY_BLOCK,
        "latest"
      );
      const entries = await Promise.all(logs.map((l) => logToEntry(l, false)));
      entries.sort(
        (a, b) => b.blockNumber - a.blockNumber || b.taskIndex - a.taskIndex
      );
      setFeed(entries);
    } catch (e) {
      console.error("loadFeed failed", e);
    }
  }, [contract, logToEntry]);

  // initial load + periodic refresh
  useEffect(() => {
    if (!contract) return;
    let alive = true;
    (async () => {
      await Promise.all([refreshJobs(), loadFeed()]);
      if (alive) setLoading(false);
    })();
    const t = setInterval(() => {
      refreshJobs();
      loadFeed();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [contract, refreshJobs, loadFeed]);

  // ---- LIVE listener: TaskCompleted over polling JSON-RPC ----
  useEffect(() => {
    if (!contract) return;
    const handler = async (...args) => {
      const event = args[args.length - 1];
      try {
        const entry = await logToEntry(event.log, true);
        if (!entry.timestamp) entry.timestamp = Math.floor(Date.now() / 1000);
        setFeed((prev) =>
          prev.some((e) => e.key === entry.key) ? prev : [entry, ...prev]
        );
        refreshJobs();
        if (account) refreshBalance(account);
      } catch (e) {
        console.error("live event failed", e);
      }
    };
    contract.on("TaskCompleted", handler);
    return () => {
      contract.off("TaskCompleted", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contract, logToEntry, refreshJobs, account]);

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
    async ({ agent, rate, deposit, spec }) => {
      const c = await getWriteContract();
      const tx = await c.createJob(agent, ethers.parseEther(rate), spec, {
        value: ethers.parseEther(deposit),
      });
      const receipt = await tx.wait();
      await refreshJobs();
      if (account) refreshBalance(account);
      return receipt;
    },
    [getWriteContract, refreshJobs, refreshBalance, account]
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
      notify("ok", `Job #${jobId} closed — unspent escrow refunded`);
    },
    [getWriteContract, refreshJobs, refreshBalance, account, notify]
  );

  // ---- derived stats ----
  const totalJobs = jobs.length;
  const activeJobs = useMemo(() => jobs.filter((j) => j.active).length, [jobs]);
  const totalTasks = feed.length;
  const totalPaid = useMemo(
    () => feed.reduce((acc, e) => acc + e.payout, 0n),
    [feed]
  );

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
          onFund={fundJob}
          onClose={closeJob}
          notify={notify}
        />
      )}

      {route.name === "dashboard" && (
        <main className="container">
          <Hero
            account={account}
            totalPaid={fmt(totalPaid)}
            totalTasks={totalTasks}
            onConnect={connect}
          />
          <Stats
            totalPaid={fmt(totalPaid)}
            totalTasks={totalTasks}
            totalJobs={totalJobs}
            activeJobs={activeJobs}
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
              onConnect={connect}
              onCreate={createJob}
            />
          </div>
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
