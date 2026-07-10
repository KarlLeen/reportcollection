import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import "./App.css";

type Snapshot = {
  meta: {
    dao: string;
    generatedAt: string;
    blockNumber: number;
    blockTimestamp: number;
    sources: string[];
    notes: string[];
  };
  summary: {
    symbol: string;
    gtcPriceUsd: number;
    totalSupply: number;
    totalVotingPower: number;
    delegateCount: number;
    gini: number;
    top10Share: number;
    top20Share: number;
    nakamotoCoefficient: number;
    quorumVotes: number;
    proposalThreshold: number;
  };
  leaderboard: {
    rank: number;
    address: string;
    ens: string;
    name: string;
    votingPower: number;
    share: number;
    delegatorsCount: number;
  }[];
  lorenz: { x: number; y: number }[];
  vpHistogram: { bin: number; label: string; count: number }[];
  onchainGovernance: {
    name?: string;
    proposalCount: number;
    quorumVotes: number;
    proposalThreshold: number;
    votingPeriodBlocks: number;
    votingDelayBlocks: number;
    proposals: {
      id: string;
      title: string;
      state: string;
      proposer?: string;
      proposerEns?: string;
      forVotes: number;
      againstVotes: number;
      abstainVotes: number;
      totalVotes: number;
      createdAt?: string;
    }[];
  };
  snapshot: {
    space: {
      id: string;
      name: string;
      followersCount: number;
      proposalsCount: number;
    };
    proposals: {
      id: string;
      title: string;
      state: string;
      scores_total: number;
      scores: number[];
      votes: number;
      start: number;
      end: number;
      author: string;
      choices: string[];
    }[];
  };
  treasury: {
    name: string;
    address: string;
    eth: number;
    gtc: number;
    gtcUsd: number;
  }[];
  influenceCalculator: {
    token: string;
    priceUsd: number;
    totalSupply: number;
    totalVotingPower: number;
    quorumVotes: number;
    proposalThreshold: number;
    scenarios: { name: string; gtc: number; usd: number; shareOfVp: number }[];
  };
  contracts: { category: string; name: string; address: string; description: string }[];
};

function fmt(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
}

function fmtCompact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return fmt(n, 0);
}

function shortAddr(a?: string) {
  if (!a) return "—";
  if (a.endsWith(".eth")) return a;
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

function utcFromUnix(ts: number) {
  return new Date(ts * 1000).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export default function App() {
  const [data, setData] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [capitalEth, setCapitalEth] = useState(100);
  const [ethPrice, setEthPrice] = useState(3000);

  useEffect(() => {
    fetch("/data/gitcoin-snapshot.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load snapshot (${r.status})`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const filteredDelegates = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.leaderboard;
    return data.leaderboard.filter(
      (d) =>
        d.address.toLowerCase().includes(q) ||
        d.ens.toLowerCase().includes(q) ||
        d.name.toLowerCase().includes(q),
    );
  }, [data, query]);

  const capitalPlan = useMemo(() => {
    if (!data) return null;
    const usd = capitalEth * ethPrice;
    const gtc = data.summary.gtcPriceUsd > 0 ? usd / data.summary.gtcPriceUsd : 0;
    const share = data.summary.totalVotingPower > 0 ? gtc / data.summary.totalVotingPower : 0;
    let label = "NEGLIGIBLE";
    if (share >= 0.15) label = "SIGNIFICANT INFLUENCE (>15%)";
    else if (share >= 0.05) label = "MATERIAL (>5%)";
    else if (gtc >= data.summary.quorumVotes) label = "QUORUM-CAPABLE";
    else if (gtc >= data.summary.proposalThreshold) label = "CAN PROPOSE";
    return { usd, gtc, share, label };
  }, [data, capitalEth, ethPrice]);

  if (error) {
    return (
      <div className="page">
        <p className="error">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="page">
        <p className="muted">Loading Gitcoin snapshot…</p>
      </div>
    );
  }

  const { summary, meta } = data;
  const executed = data.onchainGovernance.proposals.filter((p) =>
    p.state.toLowerCase().includes("executed"),
  ).length;
  const defeated = data.onchainGovernance.proposals.filter((p) =>
    p.state.toLowerCase().includes("defeat"),
  ).length;
  const top20Chart = data.leaderboard.slice(0, 20).map((d) => ({
    label: d.ens || d.name || shortAddr(d.address),
    vp: Math.round(d.votingPower),
  }));
  const proposalBars = data.onchainGovernance.proposals.slice(0, 12).map((p, i) => ({
    idx: `#${i + 1}`,
    For: Math.round(p.forVotes),
    Against: Math.round(p.againstVotes),
    Abstain: Math.round(p.abstainVotes),
  }));
  const treasuryGtc = data.treasury.reduce((a, t) => a + t.gtc, 0);
  const treasuryUsd = data.treasury.reduce((a, t) => a + t.gtcUsd, 0);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">DAO governance report</p>
          <h1>Gitcoin DAO — voting power distribution</h1>
          <p className="subhead">
            Snapshot @ block {fmt(meta.blockNumber)} ({utcFromUnix(meta.blockTimestamp)}) ·{" "}
            {fmt(summary.delegateCount)} delegates · Gini {summary.gini.toFixed(3)} · top 10
            control {(summary.top10Share * 100).toFixed(1)}% · Nakamoto{" "}
            {summary.nakamotoCoefficient}
          </p>
        </div>
        <div className="hero-stats">
          <Stat label="Total VP" value={fmtCompact(summary.totalVotingPower)} />
          <Stat label="GTC price" value={`$${summary.gtcPriceUsd.toFixed(4)}`} />
          <Stat label="Quorum" value={fmtCompact(summary.quorumVotes)} />
          <Stat label="Propose" value={fmtCompact(summary.proposalThreshold)} />
        </div>
      </header>

      <section className="grid-2">
        <Card title="Top 20 effective delegates (voting power)">
          <div className="chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={top20Chart} margin={{ left: 8, right: 8, top: 8, bottom: 48 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis
                  dataKey="label"
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                  tick={{ fontSize: 10, fill: "var(--muted)" }}
                />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={fmtCompact} />
                <Tooltip formatter={(v) => fmt(Number(v))} />
                <Bar dataKey="vp" fill="var(--accent)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Lorenz curve — cumulative share">
          <div className="chart">
            <ResponsiveContainer width="100%" height={280}>
              <LineChart
                data={data.lorenz.map((p) => ({
                  x: +(p.x * 100).toFixed(2),
                  y: +(p.y * 100).toFixed(2),
                  equal: +(p.x * 100).toFixed(2),
                }))}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis dataKey="x" unit="%" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis unit="%" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="equal" stroke="var(--muted)" dot={false} name="Equality" />
                <Line type="monotone" dataKey="y" stroke="var(--accent)" dot={false} name="Cumulative VP" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </section>

      <section className="grid-2">
        <Card title="Distribution of voting power (log10 bins)">
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.vpHistogram}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip />
                <Bar dataKey="count" fill="var(--accent-2)" name="Delegates" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Concentration metrics">
          <div className="metric-grid">
            <Metric label="Gini" value={summary.gini.toFixed(3)} />
            <Metric label="Top 10 share" value={`${(summary.top10Share * 100).toFixed(1)}%`} />
            <Metric label="Top 20 share" value={`${(summary.top20Share * 100).toFixed(1)}%`} />
            <Metric label="Nakamoto coeff." value={String(summary.nakamotoCoefficient)} />
            <Metric label="Delegates sampled" value={fmt(summary.delegateCount)} />
            <Metric label="Total supply" value={fmtCompact(summary.totalSupply)} />
          </div>
        </Card>
      </section>

      <Card
        title="Delegate leaderboard"
        right={
          <input
            className="search"
            placeholder="Search address / ENS…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Delegate</th>
                <th>Effective VP</th>
                <th>Share</th>
                <th>Delegators</th>
              </tr>
            </thead>
            <tbody>
              {filteredDelegates.slice(0, 50).map((d) => (
                <tr key={d.address}>
                  <td>{d.rank}</td>
                  <td>
                    <div className="addr">
                      <strong>{d.ens || d.name || shortAddr(d.address)}</strong>
                      <a
                        href={`https://etherscan.io/address/${d.address}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {shortAddr(d.address)}
                      </a>
                    </div>
                  </td>
                  <td>{fmt(d.votingPower, 2)}</td>
                  <td>{(d.share * 100).toFixed(2)}%</td>
                  <td>{d.delegatorsCount || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption">
          Showing {Math.min(50, filteredDelegates.length)} of {filteredDelegates.length} filtered ·{" "}
          {data.leaderboard.length} total in snapshot
        </p>
      </Card>

      <Card
        title={`On-chain proposals (${data.onchainGovernance.proposalCount}) — ${executed} executed · ${defeated} defeated`}
      >
        <div className="chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={proposalBars}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
              <XAxis dataKey="idx" tick={{ fontSize: 11, fill: "var(--muted)" }} />
              <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} tickFormatter={fmtCompact} />
              <Tooltip />
              <Legend />
              <Bar dataKey="For" stackId="a" fill="var(--ok)" />
              <Bar dataKey="Against" stackId="a" fill="var(--bad)" />
              <Bar dataKey="Abstain" stackId="a" fill="var(--muted)" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Title</th>
                <th>For</th>
                <th>Against</th>
                <th>Abstain</th>
                <th>Total</th>
                <th>Proposer</th>
              </tr>
            </thead>
            <tbody>
              {data.onchainGovernance.proposals.map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className={`pill ${p.state.toLowerCase()}`}>{p.state}</span>
                  </td>
                  <td className="title-cell">{p.title}</td>
                  <td>{fmtCompact(p.forVotes)}</td>
                  <td>{fmtCompact(p.againstVotes)}</td>
                  <td>{fmtCompact(p.abstainVotes)}</td>
                  <td>{fmtCompact(p.totalVotes)}</td>
                  <td>{p.proposerEns || shortAddr(p.proposer)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`Snapshot (${data.snapshot.space.id}) — ${data.snapshot.space.proposalsCount} proposals · ${fmt(data.snapshot.space.followersCount)} followers`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>State</th>
                <th>Title</th>
                <th>Votes</th>
                <th>Power</th>
                <th>Tallies</th>
                <th>Window</th>
              </tr>
            </thead>
            <tbody>
              {data.snapshot.proposals.slice(0, 15).map((p) => (
                <tr key={p.id}>
                  <td>
                    <span className={`pill ${p.state}`}>{p.state}</span>
                  </td>
                  <td className="title-cell">
                    <a
                      href={`https://snapshot.org/#/gitcoindao.eth/proposal/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.title}
                    </a>
                  </td>
                  <td>{p.votes}</td>
                  <td>{fmtCompact(p.scores_total)}</td>
                  <td>
                    {p.scores?.map((s, i) => `${p.choices?.[i] ?? i}: ${fmtCompact(s)}`).join(" · ")}
                  </td>
                  <td className="muted-cell">
                    {utcFromUnix(p.start).slice(0, 10)} → {utcFromUnix(p.end).slice(0, 10)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="grid-2">
        <Card title="Treasury (visible on-chain wallets)">
          <div className="metric-grid">
            <Metric label="Σ GTC" value={fmtCompact(treasuryGtc)} />
            <Metric label="Σ GTC USD" value={`$${fmtCompact(treasuryUsd)}`} />
            <Metric label="Timelock ETH" value={fmt(data.treasury[0]?.eth ?? 0, 2)} />
            <Metric label="Custody" value="Multisig-gated" />
          </div>
          <p className="caption">
            Liquid assets moved to a 4-of-5 Safe in Apr 2026; on-chain votes are largely signaling.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Wallet</th>
                  <th>ETH</th>
                  <th>GTC</th>
                  <th>GTC USD</th>
                </tr>
              </thead>
              <tbody>
                {data.treasury.map((t) => (
                  <tr key={t.address}>
                    <td>
                      <div className="addr">
                        <strong>{t.name}</strong>
                        <a href={`https://etherscan.io/address/${t.address}`} target="_blank" rel="noreferrer">
                          {shortAddr(t.address)}
                        </a>
                      </div>
                    </td>
                    <td>{fmt(t.eth, 3)}</td>
                    <td>{fmt(t.gtc, 0)}</td>
                    <td>${fmt(t.gtcUsd, 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Capital → voting power calculator">
          <p className="caption">
            GTC is 1:1 voting power when delegated. Enter ETH-equivalent capital to estimate influence
            vs current delegated VP.
          </p>
          <div className="calc-row">
            <label>
              ETH capital
              <input
                type="number"
                value={capitalEth}
                min={0}
                onChange={(e) => setCapitalEth(Number(e.target.value))}
              />
            </label>
            <label>
              ETH price (USD)
              <input
                type="number"
                value={ethPrice}
                min={0}
                onChange={(e) => setEthPrice(Number(e.target.value))}
              />
            </label>
          </div>
          {capitalPlan && (
            <div className="calc-result">
              <div>
                <div className="big">{fmt(capitalPlan.gtc, 0)} GTC</div>
                <div className="muted">
                  ${fmt(capitalPlan.usd, 0)} at ${summary.gtcPriceUsd.toFixed(4)}/GTC
                </div>
              </div>
              <div>
                <div className="big">{(capitalPlan.share * 100).toFixed(2)}%</div>
                <div className={`tag ${capitalPlan.share >= 0.15 ? "hot" : ""}`}>{capitalPlan.label}</div>
              </div>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>GTC</th>
                  <th>USD</th>
                  <th>Share of VP</th>
                </tr>
              </thead>
              <tbody>
                {data.influenceCalculator.scenarios.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>{fmtCompact(s.gtc)}</td>
                    <td>${fmtCompact(s.usd)}</td>
                    <td>{(s.shareOfVp * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <Card title="Contract directory">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Category</th>
                <th>Name</th>
                <th>Address</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.contracts.map((c) => (
                <tr key={c.address}>
                  <td>{c.category}</td>
                  <td>{c.name}</td>
                  <td>
                    {c.address.startsWith("0x") ? (
                      <a href={`https://etherscan.io/address/${c.address}`} target="_blank" rel="noreferrer">
                        {c.address}
                      </a>
                    ) : (
                      c.address
                    )}
                  </td>
                  <td>{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <footer className="footer">
        <p>
          Sources: {meta.sources.join(" · ")}. Generated {new Date(meta.generatedAt).toISOString()}.
        </p>
        <ul>
          {meta.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

function Card({
  title,
  children,
  right,
}: {
  title: string;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <div className="metric-value">{value}</div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
