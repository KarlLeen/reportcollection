/**
 * Fetch a reproducible Gitcoin DAO governance snapshot.
 * Sources: Alchemy (RPC), Tally (delegates), Snapshot (off-chain), CoinGecko (price).
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  http,
  formatUnits,
  parseAbi,
  type Address,
} from "viem";
import { mainnet } from "viem/chains";

const GTC = "0xDe30da39c46104798bB5aA3fe8B9e0e1F348163F" as Address;
const GOVERNOR = "0x9D4C63565D5618310271bF3F3c01b2954C1D1639" as Address;
const TIMELOCK = "0x57a8865cfB1eCEf7253c27da6B4BC3dAEE5Be518" as Address;
const TREASURY_VESTER = "0x44Aa9c5a034C1499Ec27906E2D427b704b567ffe" as Address;
const GOVERNOR_ID = `eip155:1:${GOVERNOR}`;
const SNAPSHOT_SPACE = "gitcoindao.eth";

const rpcUrl =
  process.env.ALCHEMY_RPC_URL ??
  `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
const tallyKey = process.env.TALLY_API_KEY;
if (!process.env.ALCHEMY_API_KEY && !process.env.ALCHEMY_RPC_URL) {
  throw new Error("Missing ALCHEMY_API_KEY / ALCHEMY_RPC_URL");
}

const client = createPublicClient({
  chain: mainnet,
  transport: http(rpcUrl),
});

const gtcAbi = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function getVotes(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
]);

const governorAbi = parseAbi([
  "function quorum(uint256 blockNumber) view returns (uint256)",
  "function proposalThreshold() view returns (uint256)",
  "function votingPeriod() view returns (uint256)",
  "function votingDelay() view returns (uint256)",
  "function state(uint256 proposalId) view returns (uint8)",
  "function proposalVotes(uint256 proposalId) view returns (uint256 againstVotes, uint256 forVotes, uint256 abstainVotes)",
  "function proposalSnapshot(uint256 proposalId) view returns (uint256)",
  "function proposalDeadline(uint256 proposalId) view returns (uint256)",
  "function name() view returns (string)",
  "event ProposalCreated(uint256 proposalId, address proposer, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint256 startBlock, uint256 endBlock, string description)",
  "event VoteCast(address indexed voter, uint256 proposalId, uint8 support, uint256 weight, string reason)",
]);

const STATE_NAMES = [
  "Pending",
  "Active",
  "Canceled",
  "Defeated",
  "Succeeded",
  "Queued",
  "Expired",
  "Executed",
] as const;

type TallyDelegate = {
  address: string;
  ens: string;
  name: string;
  votes: number;
  votesRaw: string;
  delegatorsCount: number;
};

async function tallyGraphQL<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch("https://api.tally.xyz/query", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Api-Key": tallyKey!,
        Accept: "application/json",
      },
      body: JSON.stringify({ query, variables }),
    });
    const text = await res.text();
    if (res.status === 429) {
      const wait = 5_000 * (attempt + 1);
      console.warn(`  Tally 429 — retry in ${wait / 1000}s`);
      await new Promise((r) => setTimeout(r, wait));
      lastErr = new Error(`Tally HTTP 429`);
      continue;
    }
    if (!res.ok || text.trimStart().startsWith("<")) {
      throw new Error(`Tally HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = JSON.parse(text) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) {
      throw new Error(`Tally: ${json.errors.map((e) => e.message).join("; ")}`);
    }
    return json.data as T;
  }
  throw lastErr ?? new Error("Tally failed");
}

/** Seed addresses when Tally is rate-limited */
const SEED_DELEGATES: Address[] = [
  "0x5743E35477363241300FcEdc2F5eB0195F300817",
  "0x00De4B13153673BCAE2616b67bf822500d325Fc3",
  "0x93F80a67FdFDF9DaF1aee5276Db95c8761cc8561",
  "0xc2E2B715d9e302947Ec7e312fd2384b5a1296099",
  "0xb35659cbac913D5E4119F2Af47fD490A45e2c826",
  "0x2B888954421b424C5D3D9Ce9bB67c9bD47537d12",
  "0x5a5D9aB7b1bD978F80909503EBb828879daCa9C3",
  "0x31cd90C2788f3e390d2Bb72871f5aD3F1a4B22a1",
  "0x5e349eca2dc61aBCd9dD99Ce94d04136151a09Ee",
  "0x4Be88f63f919324210ea3A2cCAD4ff0734425F91",
  "0x2df9a188fBE231B0DC36D14AcEb65dEFbB049479",
  "0x839395e20bbB182fa440d08F850E6c7A8f6F0780",
  "0xdd00Cc906B93419814443Bb913949d503B3DF3c4",
  "0x7E052Ef7B4bB7E5A45F331128AFadB1E589deaF1",
  "0x66b1De0f14a0ce971F7f248415063D44CAF19398",
  "0x8B405dBf2F30844B608b08DaD20447A6955A6C6E",
];

async function fetchDelegatesFromAlchemy(blockNumber: bigint): Promise<TallyDelegate[]> {
  console.log("  Alchemy fallback: seed delegates via getVotes…");
  const list = [...SEED_DELEGATES];
  const out: TallyDelegate[] = [];
  const results = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: list.map((address) => ({
      address: GTC,
      abi: gtcAbi,
      functionName: "getVotes" as const,
      args: [address],
    })),
  });
  for (let j = 0; j < list.length; j++) {
    const r = results[j];
    if (r.status !== "success") continue;
    const raw = r.result as bigint;
    const votes = Number(formatUnits(raw, 18));
    if (votes <= 0) continue;
    out.push({
      address: list[j],
      ens: "",
      name: "",
      votes,
      votesRaw: String(raw),
      delegatorsCount: 0,
    });
  }
  return out.sort((a, b) => b.votes - a.votes);
}

async function fetchAllDelegates(): Promise<TallyDelegate[]> {
  if (!tallyKey) {
    console.warn("  No TALLY_API_KEY — skipping Tally");
    return [];
  }
  try {
    const out: TallyDelegate[] = [];
    let afterCursor: string | null = null;
    for (let page = 0; page < 8; page++) {
      const pageClause = afterCursor
        ? `page: { limit: 50, afterCursor: ${JSON.stringify(afterCursor)} }`
        : `page: { limit: 50 }`;
      const data = await tallyGraphQL<{
        delegates: {
          nodes: {
            account: { address: string; ens: string; name: string };
            votesCount: string;
            delegatorsCount: number;
          }[];
          pageInfo: { lastCursor?: string; count: number };
        };
      }>(
        `query {
          delegates(input: {
            filters: { governorId: "${GOVERNOR_ID}", hasVotes: true }
            ${pageClause}
            sort: { isDescending: true, sortBy: votes }
          }) {
            nodes {
              ... on Delegate {
                account { address ens name }
                votesCount
                delegatorsCount
              }
            }
            pageInfo { lastCursor count }
          }
        }`,
      );

      const nodes = data.delegates.nodes ?? [];
      if (!nodes.length) break;
      for (const n of nodes) {
        const raw = n.votesCount ?? "0";
        out.push({
          address: n.account.address,
          ens: n.account.ens || "",
          name: n.account.name || n.account.ens || "",
          votes: Number(formatUnits(BigInt(raw), 18)),
          votesRaw: raw,
          delegatorsCount: n.delegatorsCount ?? 0,
        });
      }
      const next = data.delegates.pageInfo.lastCursor ?? null;
      if (!next || next === afterCursor) break;
      afterCursor = next;
      if (out.length >= 200) break;
      await new Promise((r) => setTimeout(r, 800));
    }
    const map = new Map<string, TallyDelegate>();
    for (const d of out) {
      const key = d.address.toLowerCase();
      const prev = map.get(key);
      if (!prev || d.votes > prev.votes) map.set(key, d);
    }
    const list = [...map.values()].sort((a, b) => b.votes - a.votes);
    if (list.length > 0) return list;
  } catch (e) {
    console.warn("  Tally delegates failed:", e);
  }
  return [];
}

async function crossCheckVotes(
  delegates: TallyDelegate[],
  blockNumber: bigint,
): Promise<TallyDelegate[]> {
  const sample = delegates.slice(0, 100);
  const results = await client.multicall({
    allowFailure: true,
    blockNumber,
    contracts: sample.map((d) => ({
      address: GTC,
      abi: gtcAbi,
      functionName: "getVotes" as const,
      args: [d.address as Address],
    })),
  });

  return sample.map((d, i) => {
    const r = results[i];
    if (r.status === "success") {
      const votes = Number(formatUnits(r.result as bigint, 18));
      return { ...d, votes, votesRaw: String(r.result) };
    }
    return d;
  });
}

async function fetchOnchainParams(blockNumber: bigint) {
  const [quorum, threshold, votingPeriod, votingDelay, govName] = await Promise.all([
    client.readContract({
      address: GOVERNOR,
      abi: governorAbi,
      functionName: "quorum",
      args: [0n],
      blockNumber,
    }),
    client.readContract({
      address: GOVERNOR,
      abi: governorAbi,
      functionName: "proposalThreshold",
      blockNumber,
    }),
    client.readContract({
      address: GOVERNOR,
      abi: governorAbi,
      functionName: "votingPeriod",
      blockNumber,
    }),
    client.readContract({
      address: GOVERNOR,
      abi: governorAbi,
      functionName: "votingDelay",
      blockNumber,
    }),
    client.readContract({
      address: GOVERNOR,
      abi: governorAbi,
      functionName: "name",
      blockNumber,
    }),
  ]);

  return {
    name: govName,
    proposalCount: 0,
    quorumVotes: Number(formatUnits(quorum, 18)),
    proposalThreshold: Number(formatUnits(threshold, 18)),
    votingPeriodBlocks: Number(votingPeriod),
    votingDelayBlocks: Number(votingDelay),
    proposals: [] as {
      id: string;
      tallyId?: string;
      title: string;
      descriptionPreview: string;
      proposer?: string;
      proposerEns?: string;
      state: string;
      createdAt?: string;
      quorum?: number | null;
      forVotes: number;
      againstVotes: number;
      abstainVotes: number;
      totalVotes: number;
      votersFor?: number;
      votersAgainst?: number;
      votersAbstain?: number;
    }[],
  };
}

async function fetchTallyProposals() {
  if (!tallyKey) return [];
  const data = await tallyGraphQL<{
    proposals: {
      nodes: {
        id: string;
        onchainId: string;
        status: string;
        createdAt: string;
        quorum: string;
        proposer: { address: string; ens: string };
        metadata: { title: string; description: string };
        voteStats: { type: string; votesCount: string; votersCount: number; percent: number }[];
      }[];
    };
  }>(`query {
    proposals(input: {
      filters: { governorId: "${GOVERNOR_ID}" }
      page: { limit: 40 }
      sort: { isDescending: true, sortBy: id }
    }) {
      nodes {
        ... on Proposal {
          id onchainId status createdAt quorum
          proposer { address ens }
          metadata { title description }
          voteStats { type votesCount votersCount percent }
        }
      }
    }
  }`);

  return (data.proposals.nodes ?? []).map((p) => {
    const stats = Object.fromEntries((p.voteStats ?? []).map((s) => [s.type, s]));
    const votes = (t: string) => Number(formatUnits(BigInt(stats[t]?.votesCount ?? "0"), 18));
    const voters = (t: string) => stats[t]?.votersCount ?? 0;
    const forV = votes("for");
    const againstV = votes("against");
    const abstainV = votes("abstain");
    return {
      id: p.onchainId || p.id,
      tallyId: p.id,
      title: (p.metadata?.title || "").slice(0, 160),
      descriptionPreview: (p.metadata?.description || "").slice(0, 280),
      proposer: p.proposer?.address,
      proposerEns: p.proposer?.ens || "",
      state: (p.status || "").replace(/^\w/, (c) => c.toUpperCase()),
      createdAt: p.createdAt,
      quorum: p.quorum ? Number(formatUnits(BigInt(p.quorum), 18)) : null,
      forVotes: forV,
      againstVotes: againstV,
      abstainVotes: abstainV,
      totalVotes: forV + againstV + abstainV,
      votersFor: voters("for"),
      votersAgainst: voters("against"),
      votersAbstain: voters("abstain"),
    };
  });
}

async function fetchSnapshotProposals() {
  const res = await fetch("https://hub.snapshot.org/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: `{
        space(id: "${SNAPSHOT_SPACE}") {
          id name about network symbol followersCount proposalsCount
        }
        proposals(first: 30, where: { space_in: ["${SNAPSHOT_SPACE}"] }, orderBy: "created", orderDirection: desc) {
          id title state scores_total scores votes start end author choices
        }
      }`,
    }),
  });
  const json = (await res.json()) as {
    data: {
      space: Record<string, unknown>;
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
  };
  return json.data;
}

async function fetchTreasury(blockNumber: bigint, gtcPriceUsd: number) {
  const wallets = [
    { name: "Governor Timelock", address: TIMELOCK },
    { name: "Treasury Vester (historical)", address: TREASURY_VESTER },
  ];

  const rows = [];
  for (const w of wallets) {
    const [eth, gtc] = await Promise.all([
      client.getBalance({ address: w.address, blockNumber }),
      client.readContract({
        address: GTC,
        abi: gtcAbi,
        functionName: "balanceOf",
        args: [w.address],
        blockNumber,
      }),
    ]);
    const ethBal = Number(formatUnits(eth, 18));
    const gtcBal = Number(formatUnits(gtc, 18));
    rows.push({
      ...w,
      eth: ethBal,
      gtc: gtcBal,
      gtcUsd: gtcBal * gtcPriceUsd,
    });
  }
  return rows;
}

async function fetchGtcPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=gitcoin&vs_currencies=usd",
    );
    const json = (await res.json()) as { gitcoin?: { usd?: number } };
    return json.gitcoin?.usd ?? 0;
  } catch {
    return 0;
  }
}

function gini(values: number[]): number {
  const xs = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (mean === 0) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) sumDiff += Math.abs(xs[i] - xs[j]);
  }
  return sumDiff / (2 * n * n * mean);
}

function topShare(values: number[], n: number): number {
  const sorted = [...values].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  return sorted.slice(0, n).reduce((a, b) => a + b, 0) / total;
}

function lorenz(values: number[]): { x: number; y: number }[] {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!sorted.length || total === 0) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const points = [{ x: 0, y: 0 }];
  let cum = 0;
  sorted.forEach((v, i) => {
    cum += v;
    points.push({ x: (i + 1) / sorted.length, y: cum / total });
  });
  return points;
}

function nakamoto(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i];
    if (cum > total / 2) return i + 1;
  }
  return sorted.length;
}

async function main() {
  console.log("Fetching Gitcoin governance snapshot…");
  const blockNumber = await client.getBlockNumber();
  const block = await client.getBlock({ blockNumber });
  const gtcPriceUsd = await fetchGtcPrice();

  const [totalSupply, symbol] = await Promise.all([
    client.readContract({ address: GTC, abi: gtcAbi, functionName: "totalSupply", blockNumber }),
    client.readContract({ address: GTC, abi: gtcAbi, functionName: "symbol", blockNumber }),
  ]);

  console.log(`Block ${blockNumber} · GTC $${gtcPriceUsd}`);

  console.log("Tally delegates…");
  let delegates = await fetchAllDelegates();
  if (delegates.length < 10) {
    delegates = await fetchDelegatesFromAlchemy(blockNumber);
  }
  console.log(`  ${delegates.length} delegates with votes`);

  console.log("Alchemy getVotes cross-check (top 100)…");
  const checked = await crossCheckVotes(delegates, blockNumber);
  // merge checked votes into full list
  const checkedMap = new Map(checked.map((d) => [d.address.toLowerCase(), d]));
  delegates = delegates.map((d) => checkedMap.get(d.address.toLowerCase()) ?? d);
  delegates = delegates.filter((d) => d.votes > 0).sort((a, b) => b.votes - a.votes);

  const vpValues = delegates.map((d) => d.votes);
  const totalVp = vpValues.reduce((a, b) => a + b, 0);

  console.log("On-chain proposals (Tally)…");
  let onchain = await fetchOnchainParams(blockNumber);
  try {
    const tallyProps = await fetchTallyProposals();
    onchain = { ...onchain, proposalCount: tallyProps.length, proposals: tallyProps };
    console.log(`  ${tallyProps.length} proposals from Tally`);
  } catch (e) {
    console.warn("  Tally proposals failed:", e);
    onchain = { ...onchain, proposalCount: 0, proposals: [] };
  }

  console.log("Skipping VoteCast log scan (Alchemy free tier: 10-block eth_getLogs limit)");
  const participation: {
    address: string;
    proposalsVoted: number;
    totalPowerCast: number;
    for: number;
    against: number;
    abstain: number;
  }[] = [];

  console.log("Snapshot…");
  const snapshot = await fetchSnapshotProposals();

  console.log("Treasury balances…");
  const treasury = await fetchTreasury(blockNumber, gtcPriceUsd);

  const giniCoeff = gini(vpValues);
  const top10 = topShare(vpValues, 10);
  const top20 = topShare(vpValues, 20);
  const naka = nakamoto(vpValues);
  const lorenzCurve = lorenz(vpValues);

  const leaderboard = delegates.slice(0, 100).map((d, i) => ({
    rank: i + 1,
    address: d.address,
    ens: d.ens,
    name: d.name,
    votingPower: d.votes,
    share: totalVp > 0 ? d.votes / totalVp : 0,
    delegatorsCount: d.delegatorsCount,
  }));

  const influenceCalculator = {
    token: symbol,
    priceUsd: gtcPriceUsd,
    totalSupply: Number(formatUnits(totalSupply, 18)),
    totalVotingPower: totalVp,
    quorumVotes: onchain.quorumVotes,
    proposalThreshold: onchain.proposalThreshold,
    scenarios: [
      {
        name: "Submit proposal",
        gtc: onchain.proposalThreshold,
        usd: onchain.proposalThreshold * gtcPriceUsd,
        shareOfVp: totalVp > 0 ? onchain.proposalThreshold / totalVp : 0,
      },
      {
        name: "Meet quorum (self-vote)",
        gtc: onchain.quorumVotes,
        usd: onchain.quorumVotes * gtcPriceUsd,
        shareOfVp: totalVp > 0 ? onchain.quorumVotes / totalVp : 0,
      },
      {
        name: "15% of current VP",
        gtc: totalVp * 0.15,
        usd: totalVp * 0.15 * gtcPriceUsd,
        shareOfVp: 0.15,
      },
      {
        name: "50% of current VP (Nakamoto-style)",
        gtc: totalVp * 0.5,
        usd: totalVp * 0.5 * gtcPriceUsd,
        shareOfVp: 0.5,
      },
    ],
  };

  const contracts = [
    { category: "Token", name: "GTC", address: GTC, description: "ERC20Votes governance token" },
    { category: "Governance", name: "Governor Bravo", address: GOVERNOR, description: "On-chain Compound-style governor" },
    { category: "Governance", name: "Timelock", address: TIMELOCK, description: "2-day minimum execution delay" },
    { category: "Treasury", name: "Treasury Vester", address: TREASURY_VESTER, description: "Historical vesting / treasury-related contract" },
    { category: "Off-chain", name: "Snapshot space", address: SNAPSHOT_SPACE, description: "gitcoindao.eth signaling votes" },
  ];

  const snapshotPayload = {
    meta: {
      dao: "Gitcoin",
      generatedAt: new Date().toISOString(),
      blockNumber: Number(blockNumber),
      blockTimestamp: Number(block.timestamp),
      sources: ["Alchemy RPC", "Tally GraphQL", "Snapshot Hub", "CoinGecko"],
      notes: [
        "On-chain votes are signaling-heavy post April 2026 treasury custody move to multisig.",
        "Delegate VP cross-checked via GTC.getVotes for top 100 at snapshot block.",
        "Liquid treasury may sit in a 4-of-5 Safe not fully enumerated here.",
      ],
    },
    summary: {
      symbol,
      gtcPriceUsd,
      totalSupply: Number(formatUnits(totalSupply, 18)),
      totalVotingPower: totalVp,
      delegateCount: delegates.length,
      gini: giniCoeff,
      top10Share: top10,
      top20Share: top20,
      nakamotoCoefficient: naka,
      quorumVotes: onchain.quorumVotes,
      proposalThreshold: onchain.proposalThreshold,
    },
    leaderboard,
    lorenz: lorenzCurve,
    vpHistogram: (() => {
      const bins = Array.from({ length: 20 }, (_, i) => ({
        bin: i,
        label: `${(i / 2).toFixed(1)}–${((i + 1) / 2).toFixed(1)}`,
        count: 0,
      }));
      for (const v of vpValues) {
        if (v <= 0) continue;
        const idx = Math.min(19, Math.floor(Math.log10(v) * 2));
        const safe = Math.max(0, idx);
        bins[safe].count += 1;
      }
      return bins.filter((b) => b.count > 0);
    })(),
    onchainGovernance: onchain,
    voterParticipation: participation.slice(0, 50),
    snapshot,
    treasury,
    influenceCalculator,
    contracts,
  };

  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "gitcoin-snapshot.json");
  writeFileSync(outPath, JSON.stringify(snapshotPayload, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(
    `VP ${totalVp.toLocaleString()} · Gini ${giniCoeff.toFixed(3)} · top10 ${(top10 * 100).toFixed(1)}% · Nakamoto ${naka}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
