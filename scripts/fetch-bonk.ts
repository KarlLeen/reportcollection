/**
 * Fetch BonkDAO (Solana Realms / SPL Governance) snapshot.
 * Template parity with RPL pDAO report: VP distribution, proposals, treasury, capital→influence, contracts.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import {
  getRealm,
  getAllProposals,
  getAllTokenOwnerRecords,
  getGovernanceAccounts,
  Governance,
  pubkeyFilter,
} from "@solana/spl-governance";

const REALM = new PublicKey("84pGFuy1Y27ApK67ApethaPvexeDWA66zNV8gm38TVeQ");
const BONK_MINT = new PublicKey("DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263");
const PROGRAM = new PublicKey("GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw");
const ATTACK_PROPOSAL = "6wR1jdhhJ31bbdRNXva8MxqsgsNLKTxargcdAyZ7FcRj";
const ATTACK_RECIPIENT = "9bxWkNf3BtJ6iehq9KbX9uCWMjem4TFiPZ19T2sYJHvQ";

const rpc =
  process.env.SOLANA_RPC_URL ??
  (process.env.ALCHEMY_API_KEY
    ? `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    : clusterApiUrl("mainnet-beta"));

// Heavy getProgramAccounts calls prefer public RPC; Alchemy free tier CU is tight.
const heavyRpc = process.env.SOLANA_HEAVY_RPC_URL ?? clusterApiUrl("mainnet-beta");
const connection = new Connection(rpc, { commitment: "confirmed", disableRetryOnRateLimit: false });
const heavyConnection = new Connection(heavyRpc, {
  commitment: "confirmed",
  disableRetryOnRateLimit: false,
});

const PROPOSAL_STATE: Record<number, string> = {
  0: "Draft",
  1: "SigningOff",
  2: "Voting",
  3: "Succeeded",
  4: "Executing",
  5: "Completed",
  6: "Cancelled",
  7: "Defeated",
  8: "ExecutingWithErrors",
  9: "Vetoed",
};

function gini(values: number[]): number {
  const xs = values.filter((v) => v > 0).sort((a, b) => a - b);
  const n = xs.length;
  if (!n) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (!mean) return 0;
  let sumDiff = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) sumDiff += Math.abs(xs[i] - xs[j]);
  return sumDiff / (2 * n * n * mean);
}

function topShare(values: number[], n: number): number {
  const sorted = [...values].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  return sorted.slice(0, n).reduce((a, b) => a + b, 0) / total;
}

function nakamoto(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!total) return 0;
  let cum = 0;
  for (let i = 0; i < sorted.length; i++) {
    cum += sorted[i];
    if (cum > total / 2) return i + 1;
  }
  return sorted.length;
}

function lorenz(values: number[]): { x: number; y: number }[] {
  const sorted = [...values].filter((v) => v > 0).sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  if (!sorted.length || !total) return [{ x: 0, y: 0 }, { x: 1, y: 1 }];
  const points = [{ x: 0, y: 0 }];
  let cum = 0;
  sorted.forEach((v, i) => {
    cum += v;
    points.push({ x: (i + 1) / sorted.length, y: cum / total });
  });
  return points;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPrice(): Promise<number> {
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bonk&vs_currencies=usd",
    );
    const json = (await res.json()) as { bonk?: { usd?: number } };
    return json.bonk?.usd ?? 0;
  } catch {
    return 0;
  }
}

async function main() {
  console.log("Fetching BonkDAO snapshot via", rpc.includes("alchemy") ? "Alchemy Solana" : "RPC");
  const slot = await connection.getSlot("confirmed");
  const priceUsd = await fetchPrice();
  console.log(`slot ${slot} · BONK $${priceUsd}`);

  const supply = await connection.getTokenSupply(BONK_MINT);
  const totalSupply = supply.value.uiAmount ?? Number(supply.value.amount) / 10 ** supply.value.decimals;
  const decimals = supply.value.decimals;

  const realm = await getRealm(heavyConnection, REALM);
  const communityMint = realm.account.communityMint.toBase58();
  console.log("realm", realm.account.name, "communityMint", communityMint);

  // Governances under realm
  const governances = await getGovernanceAccounts(heavyConnection, PROGRAM, Governance, [
    pubkeyFilter(1, REALM)!,
  ]);
  console.log(`governances ${governances.length}`);
  await sleep(800);

  // Token owner records = voting power registry
  console.log("token owner records…");
  let records = await getAllTokenOwnerRecords(heavyConnection, PROGRAM, REALM);
  console.log(`  ${records.length} records`);
  await sleep(800);

  const delegates = records
    .map((r) => {
      const deposited = Number(r.account.governingTokenDepositAmount.toString()) / 10 ** decimals;
      return {
        address: r.account.governingTokenOwner.toBase58(),
        votingPower: deposited,
        councilVotes: 0,
        totalVotesCount: r.account.totalVotesCount ?? 0,
        outstandingProposalCount: r.account.outstandingProposalCount ?? 0,
      };
    })
    .filter((d) => d.votingPower > 0)
    .sort((a, b) => b.votingPower - a.votingPower);

  // Also fetch largest token accounts for circulating concentration context
  console.log("largest token accounts…");
  await sleep(1500);
  let holderRows: {
    tokenAccount: string;
    owner: string;
    amount: number;
    shareOfSupply: number;
  }[] = [];
  try {
    const light = new Connection(
      process.env.ALCHEMY_API_KEY
        ? `https://solana-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
        : rpc,
      "confirmed",
    );
    const largest = await light.getTokenLargestAccounts(BONK_MINT);
    holderRows = largest.value.map((acc) => {
      const amount = acc.uiAmount ?? 0;
      return {
        tokenAccount: acc.address.toBase58(),
        owner: "",
        amount,
        shareOfSupply: totalSupply > 0 ? amount / totalSupply : 0,
      };
    });
  } catch (e) {
    console.warn("  largest accounts failed, continuing without:", e);
  }
  await sleep(1000);

  // Proposals
  console.log("proposals…");
  const proposalGroups = await getAllProposals(heavyConnection, PROGRAM, REALM);
  const proposalsFlat = proposalGroups.flat();
  console.log(`  ${proposalsFlat.length} proposals`);
  await sleep(500);

  const proposals = proposalsFlat
    .map((p) => {
      const a = p.account as any;
      const yesRaw = a.getYesVoteCount
        ? Number(a.getYesVoteCount().toString())
        : Number((a.yesVotesCount ?? 0).toString?.() ?? a.yesVotesCount ?? 0);
      const noRaw = a.getNoVoteCount
        ? Number(a.getNoVoteCount().toString())
        : Number((a.noVotesCount ?? 0).toString?.() ?? a.noVotesCount ?? 0);
      const yesVotes = yesRaw / 10 ** decimals;
      const noVotes = noRaw / 10 ** decimals;
      const state = PROPOSAL_STATE[a.state] ?? `State(${a.state})`;
      const name = a.name || p.pubkey.toBase58();
      return {
        id: p.pubkey.toBase58(),
        title: name,
        descriptionPreview: (a.descriptionLink || "").slice(0, 280),
        state,
        stateCode: a.state,
        yesVotes,
        noVotes,
        totalVotes: yesVotes + noVotes,
        draftAt: a.draftAt ? Number(a.draftAt) * 1000 : null,
        votingAt: a.votingAt ? Number(a.votingAt) * 1000 : null,
        votingCompletedAt: a.votingCompletedAt ? Number(a.votingCompletedAt) * 1000 : null,
        isAttackProposal:
          p.pubkey.toBase58() === ATTACK_PROPOSAL || /BIP\s*#?\s*76|Sowellian/i.test(name),
      };
    })
    .sort((a, b) => (b.votingAt ?? b.draftAt ?? 0) - (a.votingAt ?? a.draftAt ?? 0));

  // Governance config from first community governance
  let proposalThreshold = 0;
  let baseVotingTime = 0;
  const govConfigs = governances.map((g) => {
    const cfg = g.account.config as any;
    const voteThreshold =
      cfg.communityVoteThreshold?.value ?? cfg.voteThresholdPercentage?.value ?? 60;
    return {
      address: g.pubkey.toBase58(),
      communityVoteThresholdPercent: voteThreshold,
      minCommunityTokensToCreateProposal:
        Number(cfg.minCommunityTokensToCreateProposal.toString()) / 10 ** decimals,
      baseVotingTime: cfg.baseVotingTime,
      votingCoolOffTime: cfg.votingCoolOffTime ?? 0,
    };
  });
  if (govConfigs[0]) {
    proposalThreshold = govConfigs[0].minCommunityTokensToCreateProposal;
    baseVotingTime = govConfigs[0].baseVotingTime;
  }

  // Quorum for Bonk is absolute 1% of supply (from BIP76 reporting)
  const quorumVotes = totalSupply * 0.01;

  const vpValues = delegates.map((d) => d.votingPower);
  const totalVp = vpValues.reduce((a, b) => a + b, 0) || topShare(
    holderRows.map((h) => h.amount),
    holderRows.length,
  ) * totalSupply;

  // If deposited VP is sparse, use holder distribution as proxy for liquid voting power surface
  const useHolders = delegates.length < 20;
  const distValues = useHolders ? holderRows.map((h) => h.amount) : vpValues;
  const distTotal = distValues.reduce((a, b) => a + b, 0);
  const giniCoeff = gini(distValues);
  const top10 = topShare(distValues, 10);
  const top20 = topShare(distValues, 20);
  const naka = nakamoto(distValues);

  const leaderboard = (useHolders ? holderRows : delegates.slice(0, 100)).map((d: any, i) => {
    if (useHolders) {
      return {
        rank: i + 1,
        address: d.owner || d.tokenAccount,
        tokenAccount: d.tokenAccount,
        votingPower: d.amount,
        share: distTotal > 0 ? d.amount / distTotal : 0,
        note: d.owner === ATTACK_RECIPIENT || Math.abs(d.amount - 4_426_104_450_305) < 1e6
          ? "matches BIP#76 drain size / recipient cluster"
          : "",
      };
    }
    return {
      rank: i + 1,
      address: d.address,
      votingPower: d.votingPower,
      share: totalVp > 0 ? d.votingPower / totalVp : 0,
      totalVotesCount: d.totalVotesCount,
      outstandingProposalCount: d.outstandingProposalCount,
    };
  });

  // Treasury: sum BONK in known governance/treasury accounts is hard without PDA walk;
  // use post-attack context + largest accounts labeled.
  const drainedAmount = 4_426_104_450_305;
  const attackYes = 882_380_000_000;
  const attackQuorum = 879_950_000_000;

  const influenceCalculator = {
    token: "BONK",
    priceUsd,
    totalSupply,
    quorumVotes,
    quorumPercent: 1,
    proposalThreshold,
    scenarios: [
      {
        name: "Meet 1% quorum (BIP#76 style)",
        bonk: quorumVotes,
        usd: quorumVotes * priceUsd,
        shareOfSupply: 0.01,
      },
      {
        name: "Actual attack stake (reported)",
        bonk: attackYes,
        usd: attackYes * priceUsd,
        shareOfSupply: attackYes / totalSupply,
      },
      {
        name: "15% of supply",
        bonk: totalSupply * 0.15,
        usd: totalSupply * 0.15 * priceUsd,
        shareOfSupply: 0.15,
      },
      {
        name: "50% of supply",
        bonk: totalSupply * 0.5,
        usd: totalSupply * 0.5 * priceUsd,
        shareOfSupply: 0.5,
      },
    ],
  };

  const snapshot = {
    meta: {
      dao: "Bonk DAO",
      twitter: "https://x.com/bonk_inu",
      generatedAt: new Date().toISOString(),
      slot,
      sources: ["Alchemy Solana RPC", "SPL Governance (@solana/spl-governance)", "CoinGecko", "Realms"],
      notes: [
        "BonkDAO uses Solana Realms / SPL Governance (not Ethereum Governor).",
        "Community quorum reported at ~1% of BONK supply; BIP #76 (Jul 2026) drained ~4.426T BONK (~$20M) after attacker bought ~quorum.",
        useHolders
          ? "Deposited governance TOR sample was sparse; leaderboard uses getTokenLargestAccounts as liquid-power proxy."
          : "Leaderboard from TokenOwnerRecords (deposited governance power).",
        "No timelock / multisig gate on treasury execution at time of BIP#76 — proposal execution was automatic.",
      ],
    },
    summary: {
      symbol: "BONK",
      priceUsd,
      totalSupply,
      decimals,
      depositedVotingPower: totalVp,
      recordCount: delegates.length,
      distributionMode: useHolders ? "token-largest-accounts" : "token-owner-records",
      gini: giniCoeff,
      top10Share: top10,
      top20Share: top20,
      nakamotoCoefficient: naka,
      quorumVotes,
      quorumPercent: 1,
      proposalThreshold,
      baseVotingTimeSec: baseVotingTime,
    },
    attack: {
      proposalId: ATTACK_PROPOSAL,
      title: "BIP #76 - Sowellian BonkDAO",
      recipient: ATTACK_RECIPIENT,
      drainedBonk: drainedAmount,
      drainedUsdAtReport: 20_000_000,
      yesVotes: attackYes,
      noVotes: 710_850_000,
      quorumRequired: attackQuorum,
      votersReported: 7,
      turnoutReportedPct: 2.9,
      realmsUrl: `https://v2.realms.today/dao/${REALM.toBase58()}/proposal/${ATTACK_PROPOSAL}`,
    },
    leaderboard,
    lorenz: lorenz(distValues),
    vpHistogram: (() => {
      const bins = Array.from({ length: 20 }, (_, i) => ({
        bin: i,
        label: `${(i / 2).toFixed(1)}–${((i + 1) / 2).toFixed(1)}`,
        count: 0,
      }));
      for (const v of distValues) {
        if (v <= 0) continue;
        const idx = Math.min(19, Math.max(0, Math.floor(Math.log10(v) * 2)));
        bins[idx].count += 1;
      }
      return bins.filter((b) => b.count > 0);
    })(),
    onchainGovernance: {
      programId: PROGRAM.toBase58(),
      realm: REALM.toBase58(),
      realmName: realm.account.name,
      communityMint,
      proposalCount: proposals.length,
      governances: govConfigs,
      proposals: proposals.slice(0, 40),
    },
    holders: holderRows,
    treasury: {
      note: "Post BIP#76, ~4.426T BONK left the DAO treasury via automatic proposal execution.",
      drainedBonk: drainedAmount,
      drainedUsdEstimate: drainedAmount * priceUsd,
      remainingVisibleLargestAccountsUsd: holderRows
        .slice(0, 5)
        .reduce((a, h) => a + h.amount * priceUsd, 0),
    },
    influenceCalculator,
    contracts: [
      {
        category: "Token",
        name: "BONK mint",
        address: BONK_MINT.toBase58(),
        description: "SPL token mint (5 decimals)",
      },
      {
        category: "Governance",
        name: "Bonk DAO Realm",
        address: REALM.toBase58(),
        description: "SPL Governance realm account",
      },
      {
        category: "Governance",
        name: "SPL Governance program",
        address: PROGRAM.toBase58(),
        description: "Solana on-chain governance program used by Realms",
      },
      {
        category: "UI",
        name: "Realms v2",
        address: `https://v2.realms.today/dao/${REALM.toBase58()}`,
        description: "Governance frontend",
      },
      {
        category: "Incident",
        name: "BIP#76 recipient",
        address: ATTACK_RECIPIENT,
        description: "Wallet that received ~4.426T BONK from malicious proposal",
      },
    ],
  };

  const outDir = join(process.cwd(), "public", "data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "bonk-snapshot.json");
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(
    `supply ${totalSupply.toExponential(2)} · gini ${giniCoeff.toFixed(3)} · top10 ${(top10 * 100).toFixed(1)}% · proposals ${proposals.length}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
