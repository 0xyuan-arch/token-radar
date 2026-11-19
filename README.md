# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/0xyuan-arch/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/0xyuan-arch/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a frozen DefiLlama snapshot of 758 protocols, finds the ones whose
token does not exist yet (no CoinGecko id, no ticker — 342 of them), and ranks them by **implied
value** — what a token could be worth if it traded like the tokens that already exist.

## How the model works

Nothing is hardcoded and no protocol is named in the code. The multiples are calibrated from the
snapshot itself:

- Inside each category, the tokenized protocols vote with their real market-cap/TVL ratio. A
  category with at least 3 tokenized peers is priced at the **median** of its own ratios; thinner
  categories fall back to the global median across all 128 tokenized protocols. Multiples are
  clamped to [0.05, 12].
- **Implied value = TVL × category multiple × momentum × maturity**, where momentum damps the
  7-day TVL change (90% of it, capped between −30% and +50%) and maturity rewards survival
  (0.80× when new, full weight after 900 days tracked).
- Rows are tiered Prime / Strong / Early from TVL, age and growth, the 40-protocol watchlist is
  covered in full, and every row carries a concrete six-step farm plan for that protocol — wallet
  setup, core usage for its category, a weekly consistency habit, tracking, and a risk step.

The dashboard (`dashboard/`) is a static dark radar board: sortable and filterable by category,
chain, tier and watchlist, with a detail view per protocol that shows the value equation factor by
factor and the full farm plan. An implied value is a calibration, not a prediction that a token
launches — the board says so on its own page.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node 22, standard library only, no build step. The program writes `board.json`, `data.js`, the
dashboard and screenshots, and a `dossier.json` built with the vendored make.fun library — and it
refuses to write anything if its own board check fails.

---

<sub>Entered on [make.fun](https://make.fun/?ref=snj9eaja&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
