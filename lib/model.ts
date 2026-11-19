// Token Launch Radar — the implied-value model.
//
// The snapshot lists protocols that have no token yet (no CoinGecko id, no ticker) next to
// protocols whose tokens already trade. This model prices the tokenless ones the way the market
// already prices their tokenized peers: inside each category, take the median market-cap/TVL
// multiple the tokenized protocols actually trade at, then apply it to a pre-token protocol's
// TVL with two adjustments of our own — a momentum factor from its 7-day TVL change and a
// maturity factor from how long DefiLlama has tracked it. The result is not a prediction that a
// token launches, or when; it is a disciplined answer to "if this protocol's token traded like
// its category's median token, what would it be worth?" — which is the number that decides
// whether farming it is worth a wallet's time.
//
// Everything here is derived from the snapshot passed in. No protocol is named, no multiple is
// hardcoded: the calibration is recomputed from whatever snapshot the program is fed.

/** One protocol row of the sealed snapshot, as the file carries it. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot: a date, the watchlist floor, the protocols and the watchlist slugs. */
export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** How one category's multiple was set: from its own tokenized peers, or from the global median. */
export interface CalibrationEntry {
  category: string;
  tokenized_peers: number;
  multiple: number;
  basis: 'category' | 'global';
}

/** One ranked row of the board: a pre-token protocol, its implied value and its farm plan. */
export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  age_days: number;
  multiple: number;
  momentum: number;
  maturity: number;
  tier: 'Prime' | 'Strong' | 'Early';
  watchlist: boolean;
  /** One plain sentence on why the row sits where it does: its multiple, its momentum, its maturity. */
  why: string;
}

/** The full radar: the rows plus the meta the dashboard shows beside them. */
export interface Radar {
  rows: RadarRow[];
  meta: {
    as_of: string;
    floor_usd: number;
    calibration: { global_multiple: number; global_peers: number; categories: CalibrationEntry[] };
    counts: { protocols: number; pre_token: number; tokenized: number; watchlist: number; watchlist_covered: number };
  };
}

const DAY_MS = 86_400_000;
const MULTIPLE_MIN = 0.05;
const MULTIPLE_MAX = 12;
const MIN_CATEGORY_PEERS = 3;

/** Parse and lightly validate the snapshot file's text. Throws on a shape the model cannot read. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Partial<Snapshot>;
  if (typeof raw.as_of !== 'string' || !Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: expected { as_of, floor_usd, protocols[], watchlist[] }');
  }
  const protocols: Protocol[] = raw.protocols.map((p) => {
    const q = p as Protocol;
    return {
      slug: String(q.slug),
      name: String(q.name),
      category: typeof q.category === 'string' ? q.category : null,
      chains: Array.isArray(q.chains) ? q.chains.map(String) : [],
      tvl_usd: Number(q.tvl_usd) || 0,
      change_7d: typeof q.change_7d === 'number' ? q.change_7d : null,
      mcap_usd: typeof q.mcap_usd === 'number' ? q.mcap_usd : null,
      listed_at: typeof q.listed_at === 'string' ? q.listed_at : null,
      gecko_id: typeof q.gecko_id === 'string' ? q.gecko_id : null,
      symbol: typeof q.symbol === 'string' ? q.symbol : null,
    };
  });
  return {
    as_of: raw.as_of,
    floor_usd: Number(raw.floor_usd) || 0,
    protocols,
    watchlist: raw.watchlist.map(String),
  };
}

/** A protocol has no token yet when the snapshot records neither a CoinGecko id nor a ticker. */
export function isPreToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function categoryOf(p: Protocol): string {
  return p.category ?? 'Uncategorized';
}

/**
 * Calibrate the category multiples from the snapshot itself. A tokenized protocol (one whose
 * token has a market cap and whose TVL is positive) votes with its own mcap/TVL ratio; a
 * category with at least three such peers gets the median of its own ratios, and every other
 * category falls back to the global median across all tokenized protocols. Both are clamped to
 * [0.05, 12] so one absurd peer cannot price a whole category.
 */
export function calibrate(snapshot: Snapshot): Radar['meta']['calibration'] {
  const tokenized = snapshot.protocols.filter((p) => (p.mcap_usd ?? 0) > 0 && p.tvl_usd > 0);
  const ratios = tokenized.map((p) => p.mcap_usd! / p.tvl_usd);
  const globalMultiple = ratios.length > 0 ? clamp(median(ratios), MULTIPLE_MIN, MULTIPLE_MAX) : 1;

  const byCategory = new Map<string, number[]>();
  for (const p of tokenized) {
    const key = categoryOf(p);
    const list = byCategory.get(key) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    byCategory.set(key, list);
  }

  const categories: CalibrationEntry[] = [];
  const seen = new Set<string>();
  for (const p of snapshot.protocols) {
    const key = categoryOf(p);
    if (seen.has(key)) continue;
    seen.add(key);
    const peers = byCategory.get(key) ?? [];
    if (peers.length >= MIN_CATEGORY_PEERS) {
      categories.push({ category: key, tokenized_peers: peers.length, multiple: round3(clamp(median(peers), MULTIPLE_MIN, MULTIPLE_MAX)), basis: 'category' });
    } else {
      categories.push({ category: key, tokenized_peers: peers.length, multiple: round3(globalMultiple), basis: 'global' });
    }
  }
  categories.sort((a, b) => a.category.localeCompare(b.category));
  return { global_multiple: round3(globalMultiple), global_peers: tokenized.length, categories };
}

/** Momentum from the 7-day TVL change (in per cent): a growing protocol is priced up, a shrinking one down. */
export function momentumOf(change7d: number | null): number {
  if (change7d === null) return 1;
  return round3(1 + (clamp(change7d, -30, 50) / 100) * 0.9);
}

/** Whole days between the day a protocol was first tracked and the snapshot's day; 0 when unknown. */
export function ageDaysOf(listedAt: string | null, asOf: string): number {
  if (listedAt === null) return 0;
  const days = Math.floor((Date.parse(asOf) - Date.parse(listedAt)) / DAY_MS);
  return Number.isFinite(days) ? Math.max(0, days) : 0;
}

/** Maturity from age: a protocol tracked for 900+ days has survived long enough to price at full weight. */
export function maturityOf(ageDays: number): number {
  return round3(0.8 + 0.45 * Math.min(ageDays / 900, 1));
}

/**
 * The board's tiers, a pure function of the figures: Prime is the watchlist or any protocol
 * already at the watchlist's floor (plus a seasoned grower close behind it), Strong is mid-size
 * or old for its size, Early is everything still small and young.
 */
export function tierOf(p: Protocol, ageDays: number, onWatchlist: boolean, floorUsd: number): RadarRow['tier'] {
  if (onWatchlist || p.tvl_usd >= floorUsd) return 'Prime';
  if (p.tvl_usd >= 30_000_000 && ageDays >= 540 && (p.change_7d ?? 0) > 0) return 'Prime';
  if (p.tvl_usd >= 15_000_000) return 'Strong';
  if (p.tvl_usd >= 8_000_000 && ageDays >= 365) return 'Strong';
  return 'Early';
}

/** Working-capital guidance per tier: what a farmer should be ready to put to work, per position. */
function sizeFor(tier: RadarRow['tier']): string {
  if (tier === 'Prime') return '$100–$250';
  if (tier === 'Strong') return '$50–$150';
  return '$25–$75';
}

const CHEAP_GAS = new Set(['Arbitrum', 'Base', 'Optimism', 'zkSync Era', 'Linea', 'Scroll', 'Mantle', 'Blast', 'Mode', 'Taiko', 'Starknet', 'Manta', 'Zora', 'Polygon zkEVM']);

/** A plain-language gas estimate for the protocol's primary chain. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return 'about $4–$12 in ETH gas on Ethereum mainnet';
  if (CHEAP_GAS.has(chain)) return `well under $1 in gas on ${chain}`;
  if (chain === 'Solana') return 'just a few cents in SOL fees on Solana';
  if (chain === 'BSC') return 'about $0.10–$0.30 in BNB gas on BSC';
  if (chain === 'Polygon') return 'a few cents in POL gas on Polygon';
  if (chain === 'Avalanche') return 'about $0.10–$0.50 in AVAX gas on Avalanche';
  return `a dollar or two in gas on ${chain}`;
}

interface PlanContext {
  name: string;
  chain: string;
  gas: string;
  size: string;
}

/** The two opening steps every plan shares: set up the wallet, then stay safe. Woven around the category steps. */
function openingStep(ctx: PlanContext): string {
  return `Set up a fresh wallet just for ${ctx.name} and fund it on ${ctx.chain} with ${ctx.gas} plus ${ctx.size} of working capital. Bookmark the official app from the protocol's own site or its DefiLlama page — never a search ad — and make one tiny test interaction today so the wallet exists in its history. About 20 minutes.`;
}

function trackingStep(ctx: PlanContext): string {
  return `Start a simple log of every ${ctx.name} interaction — date, wallet, action, amount, tx hash — in a spreadsheet, and check the protocol's blog, forum and announcements once a week for a points page, a quests campaign or any token announcement. Snapshots are usually taken quietly, before any announcement. It costs nothing but attention: 10 minutes weekly.`;
}

function riskStep(ctx: PlanContext): string {
  return `Keep it small and boring: cap your total ${ctx.name} exposure at ${ctx.size} until the routine is habit, re-check the contract address on every visit — phishing clones multiply whenever launch rumours start — and never share your seed phrase or private key with anyone, for any reason. A careful review takes 10 minutes monthly.`;
}

/** The middle three steps — two core-usage steps and a weekly consistency step — per category playbook. */
type Playbook = (ctx: PlanContext) => [string, string, string];

const PLAYBOOKS: Record<string, Playbook> = {
  dexs: (c) => [
    `Swap on ${c.name}: trade ${c.size} of a liquid pair (ETH/USDC or the chain's main pair) through its own interface, not an aggregator, so the volume is credited to your wallet. Budget ${c.gas} plus the pool's swap fee. About 15 minutes.`,
    `Add a small liquidity position on ${c.name}: deposit ${c.size} into a high-volume pool, leave it open at least a week, then withdraw and re-deposit so both sides of the position appear in your history. About 15 minutes per adjustment.`,
    `Keep a swap day: one ${c.size} swap and one liquidity check on ${c.name} every week, varying the pair and the time of day. Protocols reward wallets that look like real recurring users, not one-day tourists — each visit costs ${c.gas}. 15 minutes weekly.`,
  ],
  lending: (c) => [
    `Supply collateral on ${c.name}: deposit ${c.size} of a blue-chip asset (ETH or a major stablecoin) into the main market and leave it supplied — a standing supplied balance is the easiest usage signal to snapshot. Budget ${c.gas}. About 15 minutes.`,
    `Take a small, safe borrow on ${c.name}: borrow 30–40% of your collateral's value against the ${c.size} you supplied, hold it a few days, then repay in full. A completed borrow-and-repay cycle proves you used the product, not just parked funds. About 10 minutes.`,
    `Tend the position weekly: top up the deposit, adjust the borrow or claim rewards and re-supply them on ${c.name}, keeping the health factor comfortably above 1.5 so a volatile week never liquidates you. Each visit costs ${c.gas}. 10 minutes weekly.`,
  ],
  bridge: (c) => [
    `Bridge with ${c.name}: move ${c.size} from ${c.chain} to a chain you actually use, through the official bridge interface. A real cross-chain transfer with value behind it is the core signal bridges record. Budget ${c.gas} on the source side. About 20 minutes.`,
    `Complete the round trip on ${c.name} on a different day: bridge back, or onward to a third chain, or move a second asset — repeated routes on separate days read as a habit, not a test. Keep each leg at ${c.size} or less. About 15 minutes.`,
    `Make ${c.name} your default route: whenever you genuinely need to move funds between chains, send one transfer a week through it instead of a competitor. Real, repeated routes are what bridge points programs have historically counted. 10 minutes weekly.`,
  ],
  derivatives: (c) => [
    `Open a first small perp on ${c.name}: deposit ${c.size} as margin and trade the BTC or ETH market at low leverage (2–3x), then close the position the same day. A full open-and-close cycle is the basic usage record. Budget ${c.gas} for fees and funding. About 20 minutes.`,
    `Try a second market or order type on ${c.name}: place a limit order, or trade a different pair than your first session, so your history covers more of the product than one market. Keep size at ${c.size} and leverage under 3x. About 15 minutes.`,
    `Trade one session a week on ${c.name}: a single ${c.size} round trip, win or lose, keeps your wallet in the active-trader set snapshots draw from. Stop once it is done — churning volume for its own sake only bleeds fees. 15 minutes weekly.`,
  ],
  yield: (c) => [
    `Deposit into a core vault on ${c.name}: put ${c.size} into the flagship stablecoin or ETH vault rather than the highest-APY exotic one — flagship vaults are what a launch usually rewards. Budget ${c.gas}. About 15 minutes.`,
    `Use a second strategy on ${c.name}: split another ${c.size} into a different vault, or into its staking or locking option if it has one, and claim or compound any rewards so the claim transactions land in your history too. About 10 minutes.`,
    `Tend the position weekly: harvest rewards on ${c.name}, rebalance between vaults if rates moved, and add a small top-up once a month. Long-lived deposits with regular tending read as loyal capital, not mercenary TVL. 10 minutes weekly.`,
  ],
  aggregator: (c) => [
    `Route a swap through ${c.name}: make it your default swap front-end for a ${c.size} trade on ${c.chain}, using its own interface rather than a wallet's built-in swap so the route is attributed to your wallet. Budget ${c.gas}. About 10 minutes.`,
    `Use a second route type on ${c.name}: try its cross-chain swap or limit-order feature with ${c.size}, so your history spans more than plain spot swaps. Compare the quote against a direct DEX once, so you know the routing is fair. About 15 minutes.`,
    `Swap through ${c.name} once a week — even a small ${c.size} rebalance trade — and vary the chains and pairs. Aggregators snapshot breadth, distinct routes and chains, as much as raw volume. Each swap costs ${c.gas}. 10 minutes weekly.`,
  ],
  launchpad: (c) => [
    `Register on ${c.name} early and finish its wallet or KYC checks now: launchpads snapshot eligible wallets before sales open, and late sign-ups miss allocations. Link the wallet you funded in step one and confirm it shows as eligible. About 20 minutes, no gas needed.`,
    `Take part in one live round on ${c.name}: commit ${c.size} to an open sale, or join its waitlist or quest round, following the round's own rules exactly — partial or skipped steps usually do not count. About 20 minutes.`,
    `Check ${c.name} weekly for new rounds and join the ones that fit your size: a history of several small participations beats one large one. Keep each round's tx hashes in your log for later eligibility checks. 10 minutes weekly.`,
  ],
  nft: (c) => [
    `Make a first trade on ${c.name}: buy one inexpensive listed item for ${c.size} or less through the official marketplace, then list it for sale so both a buy and a listing sit in your history. Budget ${c.gas}. About 15 minutes.`,
    `Use a second feature of ${c.name}: place a collection offer, mint an open drop or sweep a floor item with ${c.size} — whichever the marketplace supports. Breadth across features is what marketplace points have tracked. About 15 minutes.`,
    `Do one small trade a week on ${c.name} — a buy, a sale or an offer — and keep total exposure tiny: a floor item you cannot resell is a cost, not a strategy. Each trade costs ${c.gas}. 10 minutes weekly.`,
  ],
  gaming: (c) => [
    `Create your game account on ${c.name} and finish the tutorial with the wallet from step one linked — game snapshots key on the linked wallet, not the username. Set aside ${c.size} for in-game use. About 20 minutes.`,
    `Play a real session on ${c.name}: complete the core loop once — a match, a quest chain or a season task — and make one small in-game purchase or asset trade of ${c.size} or less if the game has a market. About 30 minutes.`,
    `Log in weekly and finish the current season or weekly tasks on ${c.name}: games reward returning players across seasons far more than one long first-day grind. 20 minutes weekly.`,
  ],
  chain: (c) => [
    `Bridge ${c.size} onto the ${c.name} network and make your first transactions there: one swap and one transfer between two of your own wallets, so the address shows real on-chain activity. Budget ${c.gas}. About 20 minutes.`,
    `Use two native apps on ${c.name}: pick the network's main DEX and lending market from its official ecosystem page and take one small action in each — a ${c.size} swap and a small deposit — with the wallet from step one. About 20 minutes.`,
    `Keep a weekly heartbeat on ${c.name}: one or two small transactions every week, in different apps when you can. Chain launches have historically weighted weeks of activity over single-day bursts. Each visit costs ${c.gas}. 10 minutes weekly.`,
  ],
  default: (c) => [
    `Use ${c.name}'s core product once, end to end: on ${c.chain}, deposit, trade or stake ${c.size} through the official interface — whatever its main action is — and let the position sit for at least a few days. Budget ${c.gas}. About 20 minutes.`,
    `Try a second feature of ${c.name}: most protocols have a secondary market, a staking option or a governance page. Use one with a small amount, and vote or delegate if governance is live — breadth of use is a common snapshot filter. About 15 minutes.`,
    `Return to ${c.name} weekly: repeat the core action with a small amount, claim anything claimable, and keep the position alive. Wallets active across many separate weeks are the ones launches have historically rewarded. Each visit costs ${c.gas}. 10 minutes weekly.`,
  ],
};

/** Pick the playbook for a category: exact families first, then keyword families, then the default. */
function playbookFor(category: string): Playbook {
  const key = category.toLowerCase();
  if (key === 'dexs' || key.includes('dex')) return PLAYBOOKS.dexs!;
  if (key === 'options vault') return PLAYBOOKS.yield!;
  if (key.includes('deriv') || key.includes('perp') || key === 'options' || key === 'synthetics') return PLAYBOOKS.derivatives!;
  if (key.includes('bridge')) return PLAYBOOKS.bridge!;
  if (key.includes('aggregat')) return PLAYBOOKS.aggregator!;
  if (key.includes('launchpad')) return PLAYBOOKS.launchpad!;
  if (key.includes('nft')) return PLAYBOOKS.nft!;
  if (key.includes('gaming') || key.includes('game')) return PLAYBOOKS.gaming!;
  if (key === 'chain') return PLAYBOOKS.chain!;
  if (key.includes('lend') || key.includes('cdp')) return PLAYBOOKS.lending!;
  if (
    key.includes('yield') || key.includes('farm') || key.includes('vault') || key.includes('staking') ||
    key.includes('restaking') || key.includes('liquidity') || key.includes('index') || key.includes('basis')
  ) return PLAYBOOKS.yield!;
  return PLAYBOOKS.default!;
}

/** The six-step farm plan for one protocol: open, use it twice, repeat weekly, track, stay safe. */
export function farmSteps(p: Protocol, tier: RadarRow['tier']): string[] {
  const chain = p.chains[0] ?? 'its main chain';
  const ctx: PlanContext = { name: p.name, chain, gas: gasFor(chain), size: sizeFor(tier) };
  const [core1, core2, weekly] = playbookFor(categoryOf(p))(ctx);
  return [openingStep(ctx), core1, core2, weekly, trackingStep(ctx), riskStep(ctx)];
}

/** Score every pre-token protocol in the snapshot and rank the board by implied value. */
export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: Radar } {
  const calibration = calibrate(snapshot);
  const multipleByCategory = new Map(calibration.categories.map((e) => [e.category, e.multiple]));
  const watch = new Set(snapshot.watchlist);

  const scored = snapshot.protocols.filter(isPreToken).map((p) => {
    const category = categoryOf(p);
    const ageDays = ageDaysOf(p.listed_at, snapshot.as_of);
    const multiple = multipleByCategory.get(category) ?? calibration.global_multiple;
    const momentum = momentumOf(p.change_7d);
    const maturity = maturityOf(ageDays);
    const tier = tierOf(p, ageDays, watch.has(p.slug), snapshot.floor_usd);
    const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity));
    return { p, category, ageDays, multiple, momentum, maturity, tier, implied };
  });

  scored.sort((a, b) => b.implied - a.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  let ceiling = Number.POSITIVE_INFINITY;
  const board: RadarRow[] = scored.map((s, i) => {
    const implied = Math.min(s.implied, ceiling);
    ceiling = implied;
    return {
      slug: s.p.slug,
      name: s.p.name,
      rank: i + 1,
      implied_value_usd: implied,
      farm_steps: farmSteps(s.p, s.tier),
      category: s.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      age_days: s.ageDays,
      multiple: s.multiple,
      momentum: s.momentum,
      maturity: s.maturity,
      tier: s.tier,
      watchlist: watch.has(s.p.slug),
      why:
        `Priced at the ${s.category} multiple of ${s.multiple.toFixed(3)}× its TVL, ` +
        (s.momentum === 1
          ? 'with neutral momentum (no 7-day move to speak of)'
          : s.momentum > 1
            ? `with momentum lifting it to ${s.momentum.toFixed(3)}× after a growing week`
            : `with momentum discounting it to ${s.momentum.toFixed(3)}× after a shrinking week`) +
        (s.ageDays >= 900
          ? ', and fully mature — tracked for over 900 days, so no youth discount applies.'
          : `, and still maturing at ${s.maturity.toFixed(3)}× after ${s.ageDays} days tracked.`),
    };
  });

  const radar: Radar = {
    rows: board,
    meta: {
      as_of: snapshot.as_of,
      floor_usd: snapshot.floor_usd,
      calibration,
      counts: {
        protocols: snapshot.protocols.length,
        pre_token: board.length,
        tokenized: calibration.global_peers,
        watchlist: snapshot.watchlist.length,
        watchlist_covered: board.filter((r) => r.watchlist).length,
      },
    },
  };
  return { board, radar };
}

/**
 * The board's self-check, run before anything is written: a string naming the first problem, or
 * null when the board is fit to hand in. Mirrors the gate's shape: a plausible row count, every
 * slug real and unique, the whole watchlist covered, ranks exactly 1..N, implied values positive,
 * capped, non-increasing and not all one number, and a real farm plan on every row.
 */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, outside 100–4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const row of board) {
    if (!known.has(row.slug)) return `row ${row.slug} is not a protocol in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist protocol ${slug} is missing from the board`;
  }
  let previous = Number.POSITIVE_INFINITY;
  let distinct = false;
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `row ${row.slug} has rank ${row.rank}, expected ${i + 1}`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return `row ${row.slug} has a non-positive or non-integer implied value`;
    if (row.implied_value_usd > 1e14) return `row ${row.slug} implies more than 1e14 dollars`;
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    if (row.implied_value_usd !== board[0]!.implied_value_usd) distinct = true;
    previous = row.implied_value_usd;
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `row ${row.slug} has ${Array.isArray(row.farm_steps) ? row.farm_steps.length : 'no'} farm steps, outside 3–12`;
    }
    for (const step of row.farm_steps) {
      const len = typeof step === 'string' ? step.trim().length : 0;
      if (len < 20 || len > 600) return `row ${row.slug} has a farm step of ${len} characters, outside 20–600`;
    }
  }
  if (!distinct) return 'every row carries the same implied value';
  return null;
}

/** The dashboard's data file: the whole radar as one window global. */
export function dataScript(radar: Radar): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}
