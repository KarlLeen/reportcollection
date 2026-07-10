# Gitcoin DAO Governance Report

Interactive webpage report for Gitcoin DAO voting-power distribution, proposals, treasury, and capital→influence scenarios — similar in scope to the RPL pDAO dashboard.

## Quick start

```bash
cp .env.example .env   # fill Alchemy + Tally keys
npm install
npm run fetch          # writes public/data/gitcoin-snapshot.json
npm run dev
```

## Data sources

| Source | Used for |
|--------|----------|
| Alchemy RPC | Block snapshot, `GTC.getVotes`, governor params, treasury balances |
| Tally GraphQL | Delegate leaderboard, on-chain proposal history |
| Snapshot Hub | Off-chain signaling proposals (`gitcoindao.eth`) |
| CoinGecko | GTC USD price |

**Note:** Alchemy Free tier limits `eth_getLogs` to a 10-block range, so proposal/vote event scans use Tally instead of raw logs.

## Report modules

1. Voting power distribution (Gini, top10, Nakamoto, Lorenz)
2. Delegate leaderboard
3. On-chain Governor proposals
4. Snapshot proposals
5. Treasury balances (Timelock / vester)
6. Capital → VP calculator
7. Contract directory
