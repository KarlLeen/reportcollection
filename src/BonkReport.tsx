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

type BonkSnapshot = {
  meta: {
    dao: string;
    twitter: string;
    generatedAt: string;
    slot: number;
    sources: string[];
    notes: string[];
  };
  summary: {
    symbol: string;
    priceUsd: number;
    totalSupply: number;
    depositedVotingPower: number;
    recordCount: number;
    gini: number;
    top10Share: number;
    top20Share: number;
    nakamotoCoefficient: number;
    quorumVotes: number;
    quorumPercent: number;
    proposalThreshold: number;
    baseVotingTimeSec: number;
  };
  attack: {
    proposalId: string;
    title: string;
    recipient: string;
    drainedBonk: number;
    drainedUsdAtReport: number;
    yesVotes: number;
    noVotes: number;
    quorumRequired: number;
    votersReported: number;
    turnoutReportedPct: number;
    realmsUrl: string;
  };
  leaderboard: {
    rank: number;
    address: string;
    votingPower: number;
    share: number;
    totalVotesCount?: number;
  }[];
  lorenz: { x: number; y: number }[];
  vpHistogram: { label: string; count: number }[];
  onchainGovernance: {
    realm: string;
    realmName: string;
    proposalCount: number;
    governances: {
      address: string;
      minCommunityTokensToCreateProposal: number;
      baseVotingTime: number;
      votingCoolOffTime: number;
      communityVoteThresholdPercent: number;
    }[];
    proposals: {
      id: string;
      title: string;
      state: string;
      yesVotes: number;
      noVotes: number;
      totalVotes: number;
      isAttackProposal?: boolean;
    }[];
  };
  holders: {
    tokenAccount: string;
    amount: number;
    shareOfSupply: number;
    note?: string;
  }[];
  liquidSurface?: {
    note: string;
    topAccountsSupplyShare: number;
    giniAmongTopAccounts: number;
    top10ShareAmongTopAccounts: number;
    nakamotoAmongTopAccounts: number;
  };
  treasury: {
    note: string;
    drainedBonk: number;
    drainedUsdEstimate: number;
  };
  influenceCalculator: {
    priceUsd: number;
    totalSupply: number;
    quorumVotes: number;
    scenarios: { name: string; bonk: number; usd: number; shareOfSupply: number }[];
  };
  contracts: { category: string; name: string; address: string; description: string }[];
};

function fmt(n: number, digits = 0) {
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

function fmtCompact(n: number) {
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return fmt(n, 0);
}

function shortAddr(a?: string) {
  if (!a) return "—";
  if (a.startsWith("http")) return a;
  return `${a.slice(0, 4)}…${a.slice(-4)}`;
}

export default function BonkReport() {
  const [data, setData] = useState<BonkSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [capitalUsd, setCapitalUsd] = useState(4_400_000);

  useEffect(() => {
    fetch("/data/bonk-snapshot.json")
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load Bonk snapshot (${r.status})`);
        return r.json();
      })
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    if (!q) return data.leaderboard;
    return data.leaderboard.filter((d) => d.address.toLowerCase().includes(q));
  }, [data, query]);

  const plan = useMemo(() => {
    if (!data) return null;
    const bonk = data.summary.priceUsd > 0 ? capitalUsd / data.summary.priceUsd : 0;
    const share = data.summary.totalSupply > 0 ? bonk / data.summary.totalSupply : 0;
    let label = "BELOW QUORUM";
    if (share >= 0.15) label = "SIGNIFICANT INFLUENCE (>15% supply)";
    else if (bonk >= data.summary.quorumVotes) label = "QUORUM-CAPABLE (≥1%)";
    else if (share >= 0.005) label = "MATERIAL (>0.5%)";
    return { bonk, share, label };
  }, [data, capitalUsd]);

  if (error) return <div className="page"><p className="error">{error}</p></div>;
  if (!data) return <div className="page"><p className="muted">Loading BonkDAO snapshot…</p></div>;

  const { summary, meta, attack } = data;
  const top20 = data.leaderboard.slice(0, 20).map((d) => ({
    label: shortAddr(d.address),
    vp: d.votingPower,
  }));
  const holderBars = data.holders.slice(0, 15).map((h, i) => ({
    label: `#${i + 1}`,
    amount: h.amount,
  }));
  const proposalBars = data.onchainGovernance.proposals.slice(0, 12).map((p, i) => ({
    idx: `#${i + 1}`,
    Yes: Math.round(p.yesVotes),
    No: Math.round(p.noVotes),
  }));

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">DAO governance report · Solana Realms</p>
          <h1>Bonk DAO — voting power distribution</h1>
          <p className="subhead">
            Snapshot @ slot {fmt(meta.slot)} · {fmt(summary.recordCount)} deposited voters · Gini{" "}
            {summary.gini.toFixed(3)} · top 10 control {(summary.top10Share * 100).toFixed(1)}% ·
            Nakamoto {summary.nakamotoCoefficient} · quorum {summary.quorumPercent}% of supply
          </p>
          <p className="subhead">
            <a href={meta.twitter} target="_blank" rel="noreferrer">@bonk_inu</a>
            {" · "}
            <a href={`https://v2.realms.today/dao/${data.onchainGovernance.realm}`} target="_blank" rel="noreferrer">
              Realms
            </a>
          </p>
        </div>
        <div className="hero-stats">
          <Stat label="BONK price" value={`$${summary.priceUsd.toExponential(2)}`} />
          <Stat label="Quorum (1%)" value={fmtCompact(summary.quorumVotes)} />
          <Stat label="Deposited VP" value={fmtCompact(summary.depositedVotingPower)} />
          <Stat label="Propose min" value={fmtCompact(summary.proposalThreshold)} />
        </div>
      </header>

      <section className="card attack-card">
        <div className="card-head">
          <h2>Incident — {attack.title}</h2>
          <a href={attack.realmsUrl} target="_blank" rel="noreferrer">Open on Realms</a>
        </div>
        <div className="metric-grid">
          <Metric label="Drained" value={`${fmtCompact(attack.drainedBonk)} BONK`} />
          <Metric label="USD (report)" value={`~$${fmtCompact(attack.drainedUsdAtReport)}`} />
          <Metric label="Yes / Quorum" value={`${fmtCompact(attack.yesVotes)} / ${fmtCompact(attack.quorumRequired)}`} />
          <Metric label="Turnout" value={`${attack.turnoutReportedPct}% · ${attack.votersReported} wallets`} />
        </div>
        <p className="caption">
          Attacker bought ~1% supply (~${fmtCompact(attack.yesVotes * summary.priceUsd)} at current price),
          cleared quorum by &lt;0.3%, and auto-executed a treasury transfer to {shortAddr(attack.recipient)}.
          No code exploit — governance parameters enabled a bought-vote drain.
        </p>
      </section>

      <section className="grid-2">
        <Card title="Top 20 deposited voters (TokenOwnerRecords)">
          <div className="chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={top20} margin={{ bottom: 48, left: 8, right: 8, top: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis dataKey="label" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip formatter={(v) => fmt(Number(v), 2)} />
                <Bar dataKey="vp" fill="var(--accent)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="caption">Post-BIP#76 residual deposits — much smaller than liquid quorum surface.</p>
        </Card>

        <Card title="Lorenz curve — deposited VP">
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
        <Card title="Liquid top accounts (attack surface)">
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={holderBars}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "var(--muted)" }} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip formatter={(v) => fmtCompact(Number(v))} />
                <Bar dataKey="amount" fill="var(--accent-2)" name="BONK" />
              </BarChart>
            </ResponsiveContainer>
          </div>
          {data.liquidSurface && (
            <div className="metric-grid">
              <Metric label="Top accts / supply" value={`${(data.liquidSurface.topAccountsSupplyShare * 100).toFixed(1)}%`} />
              <Metric label="Top10 of tops" value={`${(data.liquidSurface.top10ShareAmongTopAccounts * 100).toFixed(1)}%`} />
              <Metric label="Nakamoto (tops)" value={String(data.liquidSurface.nakamotoAmongTopAccounts)} />
            </div>
          )}
        </Card>

        <Card title="Concentration metrics">
          <div className="metric-grid">
            <Metric label="Gini (deposited)" value={summary.gini.toFixed(3)} />
            <Metric label="Top 10 deposited" value={`${(summary.top10Share * 100).toFixed(1)}%`} />
            <Metric label="Top 20 deposited" value={`${(summary.top20Share * 100).toFixed(1)}%`} />
            <Metric label="Nakamoto" value={String(summary.nakamotoCoefficient)} />
            <Metric label="Total supply" value={fmtCompact(summary.totalSupply)} />
            <Metric label="Vote window" value={`${Math.round(summary.baseVotingTimeSec / 86400)}d`} />
          </div>
        </Card>
      </section>

      <Card
        title="Delegate / depositor leaderboard"
        right={
          <input
            className="search"
            placeholder="Search address…"
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
                <th>Address</th>
                <th>Deposited VP</th>
                <th>Share</th>
                <th>Votes cast (lifetime)</th>
              </tr>
            </thead>
            <tbody>
              {filtered.slice(0, 50).map((d) => (
                <tr key={d.address}>
                  <td>{d.rank}</td>
                  <td>
                    <a href={`https://solscan.io/account/${d.address}`} target="_blank" rel="noreferrer">
                      {d.address}
                    </a>
                  </td>
                  <td>{fmt(d.votingPower, 2)}</td>
                  <td>{(d.share * 100).toFixed(2)}%</td>
                  <td>{d.totalVotesCount ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`On-chain proposals (${data.onchainGovernance.proposalCount})`}>
        {proposalBars.length > 0 && (
          <div className="chart">
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={proposalBars}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
                <XAxis dataKey="idx" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <YAxis tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: "var(--muted)" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="Yes" stackId="a" fill="var(--ok)" />
                <Bar dataKey="No" stackId="a" fill="var(--bad)" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Title</th>
                <th>Yes</th>
                <th>No</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {data.onchainGovernance.proposals.map((p) => (
                <tr key={p.id} className={p.isAttackProposal ? "attack-row" : undefined}>
                  <td><span className={`pill ${p.state.toLowerCase()}`}>{p.state}</span></td>
                  <td className="title-cell">
                    <a
                      href={`https://v2.realms.today/dao/${data.onchainGovernance.realm}/proposal/${p.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {p.title}
                    </a>
                  </td>
                  <td>{fmtCompact(p.yesVotes)}</td>
                  <td>{fmtCompact(p.noVotes)}</td>
                  <td>{fmtCompact(p.totalVotes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <section className="grid-2">
        <Card title="Treasury">
          <div className="metric-grid">
            <Metric label="Drained BONK" value={fmtCompact(data.treasury.drainedBonk)} />
            <Metric label="Drained USD (now)" value={`$${fmtCompact(data.treasury.drainedUsdEstimate)}`} />
          </div>
          <p className="caption">{data.treasury.note}</p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Token account</th>
                  <th>BONK</th>
                  <th>% supply</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {data.holders.slice(0, 10).map((h) => (
                  <tr key={h.tokenAccount}>
                    <td>
                      <a href={`https://solscan.io/account/${h.tokenAccount}`} target="_blank" rel="noreferrer">
                        {shortAddr(h.tokenAccount)}
                      </a>
                    </td>
                    <td>{fmtCompact(h.amount)}</td>
                    <td>{(h.shareOfSupply * 100).toFixed(2)}%</td>
                    <td className="muted-cell">{h.note || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="Capital → voting power calculator">
          <p className="caption">
            BONK is 1:1 when deposited into Realms. BIP#76 showed ~1% of supply (~quorum) was enough to
            pass and auto-execute treasury transfers.
          </p>
          <div className="calc-row">
            <label>
              USD capital
              <input
                type="number"
                value={capitalUsd}
                min={0}
                onChange={(e) => setCapitalUsd(Number(e.target.value))}
              />
            </label>
            <label>
              Implied BONK
              <input type="text" readOnly value={plan ? fmt(plan.bonk, 0) : ""} />
            </label>
          </div>
          {plan && (
            <div className="calc-result">
              <div>
                <div className="big">{(plan.share * 100).toFixed(3)}% supply</div>
                <div className="muted">vs quorum {fmtCompact(summary.quorumVotes)} BONK</div>
              </div>
              <div className={`tag ${plan.bonk >= summary.quorumVotes ? "hot" : ""}`}>{plan.label}</div>
            </div>
          )}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th>BONK</th>
                  <th>USD</th>
                  <th>% supply</th>
                </tr>
              </thead>
              <tbody>
                {data.influenceCalculator.scenarios.map((s) => (
                  <tr key={s.name}>
                    <td>{s.name}</td>
                    <td>{fmtCompact(s.bonk)}</td>
                    <td>${fmtCompact(s.usd)}</td>
                    <td>{(s.shareOfSupply * 100).toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <Card title="Program / account directory">
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
                    {c.address.startsWith("http") ? (
                      <a href={c.address} target="_blank" rel="noreferrer">{c.address}</a>
                    ) : (
                      <a href={`https://solscan.io/account/${c.address}`} target="_blank" rel="noreferrer">
                        {c.address}
                      </a>
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
        <p>Sources: {meta.sources.join(" · ")}. Generated {meta.generatedAt}.</p>
        <ul>
          {meta.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </footer>
    </div>
  );
}

function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
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
