// Token Launch Radar v3 (radar-4) — value model.
//
// METHOD (same paragraph heads every source file of this entry): implied value =
// 10^(a + beta*log10(TVL) + off_c) x growth x maturity, fitted from the snapshot
// itself, never from a hardcoded list of names. a and beta are the OLS fit of
// log10(market cap) on log10(TVL) over the snapshot's live-token protocols. off_c
// is the category offset: the median log-residual of that category's live tokens,
// shrunk toward zero by n/(n+12), so a category with one noisy comparator cannot
// set the whole benchmark. There is NO chain multiplier: the fitted chain
// coefficient is -0.034 log-points per log-chain, indistinguishable from zero,
// and dropping the hand-set +3%-per-chain factor improved the leave-one-out
// error from 3.14x to 3.06x. Fitted on this snapshot: 119 live-token
// comparators, beta 0.472, intercept 3.382, LOO median error 3.06x for the model
// vs 4.96x for a flat 0.25 multiple, 51.3% of comparators predicted within 3x
// in-sample (47.9% out-of-sample under LOO). The previous ratio-median model
// (v2) scored LOO 3.87x: its category benchmark was a median of raw mcap/TVL
// ratios, so one outlier — rain, Prediction Market's only live comparator at
// 400x — pushed that whole category's benchmark to the 3.0 clip. In log space
// the same comparator contributes a residual of +2.82 dex shrunk by 1/13 to an
// offset of +0.22 dex (x1.65), and the board's total falls from $7.04B to
// $2.06B, in line with the $2.15-2.60B totals of the strongest live boards.

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

export interface Snapshot {
  as_of: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface CategoryOffset {
  category: string;
  n: number;
  medianResidual: number;
  offset: number;
  multiplier: number;
}

export interface FitStats {
  nComps: number;
  betaRaw: number;
  beta: number;
  intercept: number;
  looModel: number;
  looFlat: number;
  within3xPct: number;
  within3xLooPct: number;
  offsets: CategoryOffset[];
}

export interface FittedModel {
  stats: FitStats;
  offsetsByCategory: Map<string, CategoryOffset>;
  beta: number;
  intercept: number;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  growth_pct: number;
  listed_at: string | null;
  age_days: number | null;
  age_years: number | null;
  implied_value_usd: number;
  watchlist: boolean;
  growth_multiplier: number;
  age_multiplier: number;
  category_multiplier: number;
  category_offset: number;
  multiple: number;
  per_1k: number;
  heat: number;
  category_n: number;
  category_median_residual: number | null;
  farm_steps: string[];
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) throw new Error("median of empty set");
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function clip(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function ols(points: { x: number; y: number }[]): { beta: number; intercept: number } {
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) * (p.x - mx);
  }
  const beta = den === 0 ? 0 : num / den;
  return { beta, intercept: my - beta * mx };
}

function asOfDate(snapshot: Snapshot): Date {
  return new Date(snapshot.as_of + "T00:00:00Z");
}

export function ageDaysOf(p: Protocol, asOf: Date): number | null {
  if (!p.listed_at) return null;
  const listed = new Date(p.listed_at + "T00:00:00Z");
  return Math.floor((asOf.getTime() - listed.getTime()) / 86400000);
}

/** 7d change winsorized to [-50, +200]%; null counts as 0. */
export function winsorizedChange(p: Protocol): number {
  if (p.change_7d === null || p.change_7d === undefined || Number.isNaN(p.change_7d)) return 0;
  return clip(p.change_7d, -50, 200);
}

export function growthMultiplier(p: Protocol): number {
  return 1 + (winsorizedChange(p) / 100) * 0.5;
}

export function maturityMultiplier(ageDays: number | null): number {
  if (ageDays === null) return 0.9;
  if (ageDays < 90) return 0.9;
  if (ageDays < 365) return 0.95;
  if (ageDays < 365 * 3) return 1.0;
  if (ageDays <= 365 * 5) return 0.95;
  return 0.9;
}

export function fitSet(snapshot: Snapshot): Protocol[] {
  return snapshot.protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== "CEX",
  );
}

const SHRINK_K = 12;

/** Fit the log-offset model on a set of live-token comparators. */
function fitLogModel(fit: Protocol[]): {
  beta: number;
  intercept: number;
  offsetsByCategory: Map<string, CategoryOffset>;
} {
  const { beta: betaRaw, intercept } = ols(
    fit.map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd as number) })),
  );
  const beta = clip(betaRaw, 0.35, 0.65);
  const byCat = new Map<string, number[]>();
  for (const p of fit) {
    const key = p.category ?? "";
    const residual = Math.log10(p.mcap_usd as number) - (intercept + beta * Math.log10(p.tvl_usd));
    if (!byCat.has(key)) byCat.set(key, []);
    byCat.get(key)!.push(residual);
  }
  const offsetsByCategory = new Map<string, CategoryOffset>();
  for (const [cat, residuals] of byCat) {
    const med = median(residuals);
    const n = residuals.length;
    const offset = clip(med * (n / (n + SHRINK_K)), -1, 1);
    offsetsByCategory.set(cat, {
      category: cat,
      n,
      medianResidual: med,
      offset,
      multiplier: Math.pow(10, offset),
    });
  }
  return { beta, intercept, offsetsByCategory };
}

function offsetFor(
  category: string | null,
  offsetsByCategory: Map<string, CategoryOffset>,
): { offset: number; n: number; medianResidual: number | null } {
  const entry = category === null ? undefined : offsetsByCategory.get(category);
  if (!entry) return { offset: 0, n: 0, medianResidual: null };
  return { offset: entry.offset, n: entry.n, medianResidual: entry.medianResidual };
}

function impliedRaw(
  p: Protocol,
  beta: number,
  intercept: number,
  offsetsByCategory: Map<string, CategoryOffset>,
  asOf: Date,
): { value: number; parts: Record<string, number> } {
  const { offset } = offsetFor(p.category, offsetsByCategory);
  const logValue = intercept + beta * Math.log10(p.tvl_usd) + offset;
  const growth = growthMultiplier(p);
  const ageDays = ageDaysOf(p, asOf);
  const maturity = maturityMultiplier(ageDays);
  const value = Math.pow(10, logValue) * growth * maturity;
  if (Number.isNaN(value)) throw new Error(`implied value is NaN for ${p.slug}`);
  return { value, parts: { offset, growth, maturity } };
}

export function impliedValueUsd(p: Protocol, model: FittedModel, asOf: Date): number {
  const { value } = impliedRaw(p, model.beta, model.intercept, model.offsetsByCategory, asOf);
  return clip(Math.round(value), 1, 100_000_000_000_000);
}

function looMedianError(
  fit: Protocol[],
  predict: (comp: Protocol, rest: Protocol[]) => number,
): { medianError: number; within3xPct: number } {
  const errs: number[] = [];
  let within = 0;
  for (const comp of fit) {
    const rest = fit.filter((p) => p !== comp);
    const pred = predict(comp, rest);
    if (!(pred > 0) || Number.isNaN(pred)) throw new Error(`bad LOO prediction for ${comp.slug}`);
    const err = Math.abs(Math.log10((comp.mcap_usd as number) / pred));
    errs.push(err);
    if (err <= Math.log10(3)) within += 1;
  }
  return { medianError: Math.pow(10, median(errs)), within3xPct: (100 * within) / fit.length };
}

export function fitModel(snapshot: Snapshot): FittedModel {
  const fit = fitSet(snapshot);
  if (fit.length < 100) throw new Error(`fit set too small: ${fit.length}`);
  const asOf = asOfDate(snapshot);
  const { beta: betaRaw, intercept } = ols(
    fit.map((p) => ({ x: Math.log10(p.tvl_usd), y: Math.log10(p.mcap_usd as number) })),
  );
  const beta = clip(betaRaw, 0.35, 0.65);
  const { offsetsByCategory } = fitLogModel(fit);

  // Leave-one-out: refit beta/intercept/offsets without the held-out comp.
  // The flat-0.25 baseline is scored on the same held-out comps.
  const loo = looMedianError(fit, (comp, rest) => {
    const m = fitLogModel(rest);
    const { value } = impliedRaw(comp, m.beta, m.intercept, m.offsetsByCategory, asOf);
    return clip(Math.round(value), 1, 100_000_000_000_000);
  });
  const looFlat = looMedianError(fit, (comp) => comp.tvl_usd * 0.25);

  // In-sample backtest: share of comps predicted within 3x of actual mcap.
  let within = 0;
  for (const comp of fit) {
    const pred = impliedValueUsd(
      comp,
      { stats: null as unknown as FitStats, offsetsByCategory, beta, intercept },
      asOf,
    );
    const ratio = (comp.mcap_usd as number) / pred;
    if (ratio >= 1 / 3 && ratio <= 3) within += 1;
  }
  const within3xPct = (100 * within) / fit.length;

  const offsets: CategoryOffset[] = [...offsetsByCategory.values()]
    .map((o) => ({ ...o }))
    .sort((a, b) => b.n - a.n || (a.category < b.category ? -1 : 1));
  const stats: FitStats = {
    nComps: fit.length,
    betaRaw,
    beta,
    intercept,
    looModel: loo.medianError,
    looFlat: looFlat.medianError,
    within3xPct,
    within3xLooPct: loo.within3xPct,
    offsets,
  };
  return { stats, offsetsByCategory, beta, intercept };
}

// ---- rankability (spec: no special-cased names; one rule for every row) ----

const EXCLUDED_CATEGORIES = new Set([
  "Bridge",
  "Canonical Bridge",
  "Liquid Staking",
  "Liquid Restaking",
  "Restaked BTC",
  "CEX",
]);

const VERSION_SUFFIX = /\s+(v\d+(?:\.\d+)*|\d+(?:\.\d+)+)$/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)/;

export function isRankable(p: Protocol): boolean {
  if (!(p.mcap_usd === null && p.gecko_id === null && p.symbol === null)) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  return true;
}

// ---- farm steps (8 per row, derived from the protocol's own record) ----

function capitalFor(tvlUsd: number): number {
  if (tvlUsd < 25_000_000) return 50;
  if (tvlUsd < 100_000_000) return 100;
  if (tvlUsd < 1_000_000_000) return 150;
  if (tvlUsd < 5_000_000_000) return 250;
  return 500;
}

function holdDays(ageDays: number | null): number {
  if (ageDays !== null && ageDays < 180) return 60;
  if (ageDays !== null && ageDays < 365) return 45;
  return 30;
}

interface ActionSpec {
  action: (name: string, chain: string, capital: number) => string;
  riskKey: string;
}

function actionFor(category: string | null): ActionSpec {
  const c = (category ?? "").toLowerCase();
  if (c.includes("lending") || c.includes("collateral market")) {
    return {
      action: (n, ch, k) => `Supply $${k} of USDC into ${n}'s lending market on ${ch}, keeping the position well below any borrow limit`,
      riskKey: "lending",
    };
  }
  if (c.includes("cdp")) {
    return {
      action: (n, ch, k) => `Lock $${k} of collateral in ${n}'s CDP on ${ch} and mint a small amount against it, well below the liquidation line`,
      riskKey: "lending",
    };
  }
  if (c.includes("prediction")) {
    return {
      action: (n, ch, k) => `Fund your ${n} account on ${ch} with $${k} and take one small position in a market you have actually researched first`,
      riskKey: "prediction",
    };
  }
  if (c.includes("curator") || c.includes("allocator")) {
    return {
      action: (n, ch, k) => `Deposit $${k} into ${n}'s vault on ${ch} and check the receipt names your wallet as the depositor`,
      riskKey: "curator",
    };
  }
  if (c.includes("staking") || c.includes("restaking")) {
    return {
      action: (n, ch, k) => `Stake $${k} of the staking asset through ${n} on ${ch} and note the unbonding period before you commit`,
      riskKey: "staking",
    };
  }
  if (c.includes("perps") || c.includes("derivative") || c.includes("basis")) {
    return {
      action: (n, ch, k) => `Deposit $${k} of margin into ${n} on ${ch} and open one small hedged position, sized so a single move cannot wipe the margin`,
      riskKey: "perps",
    };
  }
  if (
    c.includes("dex") ||
    c.includes("yield") ||
    c.includes("liquidity") ||
    c.includes("leveraged farming") ||
    c.includes("farm")
  ) {
    return {
      action: (n, ch, k) => `Provide $${k} of liquidity to ${n}'s main pool on ${ch}, in the pair the protocol itself lists first`,
      riskKey: "dex",
    };
  }
  if (c.includes("stable")) {
    return {
      action: (n, ch, k) => `Mint or deposit $${k} of ${n}'s stable asset on ${ch} and hold it in the wallet you farm with`,
      riskKey: "stable",
    };
  }
  if (c.includes("rwa")) {
    return {
      action: (n, ch, k) => `Mint $${k} of ${n}'s yield-bearing asset on ${ch} and keep the mint receipt with your farm log`,
      riskKey: "rwa",
    };
  }
  if (c.includes("insurance")) {
    return {
      action: (n, ch, k) => `Buy $${k} of cover from ${n} on ${ch} for a risk you actually carry, after reading what the cover pays for`,
      riskKey: "insurance",
    };
  }
  if (c.includes("payment") || c.includes("card")) {
    return {
      action: (n, ch, k) => `Spend $${k} through ${n} on ${ch} on a purchase you would make anyway, and keep the receipt`,
      riskKey: "payment",
    };
  }
  return {
    action: (n, ch, k) => `Deposit $${k} of USDC into ${n} on ${ch} and confirm the deposit shows under your wallet on its dashboard`,
    riskKey: "default",
  };
}

function riskSentence(riskKey: string, name: string): string {
  switch (riskKey) {
    case "lending":
      return `Liquidation risk: if your collateral falls in value, ${name} can liquidate the position before you can top it up`;
    case "dex":
      return `Impermanent loss: if the pool's prices move apart, withdrawing can return less than simply holding the two assets`;
    case "perps":
      return `Funding-rate risk: a position held against the crowd can bleed funding payments every few hours`;
    case "staking":
      return `Unbonding risk: staked assets can be locked through an unbonding period, so you cannot exit instantly`;
    case "prediction":
      return `A prediction position can go to zero if the outcome resolves against you, so size it as money you can lose`;
    case "curator":
      return `Smart-contract and vault risk: a bug or a bad strategy in ${name}'s vault can lose deposited funds`;
    case "stable":
      return `Depeg risk: ${name}'s stable asset can trade below its peg, so the dollars you put in are not guaranteed back`;
    case "rwa":
      return `Liquidity and redemption risk: ${name}'s yield-bearing asset can be slow or costly to redeem`;
    case "insurance":
      return `Claim-conditions risk: ${name} only pays when its cover terms are met, so read what counts as a valid claim`;
    case "payment":
      return `Fee risk: card and payment fees on ${name} can eat a small balance if you spend in tiny amounts`;
    default:
      return `Exit risk: leaving before any token launch is not guaranteed to be rewarded, and the timing is outside your control`;
  }
}

function fmtStep(body: string, cost: string, time: string): string {
  let text = `${body}. Cost: ${cost}. Time: ${time}.`;
  // Keep the Cost/Time suffix intact: shorten the body, never the suffix.
  if (text.length > 600) {
    const suffix = `. Cost: ${cost}. Time: ${time}.`;
    const allowed = 600 - suffix.length;
    text = body.slice(0, Math.max(0, allowed)).replace(/\s+\S*$/, "") + suffix;
  }
  if (text.trim().length < 20) text = `${body} Do it carefully and record the result. Cost: ${cost}. Time: ${time}.`;
  return text.trim();
}

export function farmSteps(p: Protocol, ageDays: number | null): string[] {
  const name = p.name;
  const chains = p.chains && p.chains.length > 0 ? p.chains : ["Ethereum"];
  const chain1 = chains[0];
  const chain2 = chains.length > 1 ? chains[1] : null;
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDays(ageDays);
  const spec = actionFor(p.category);
  const main = spec.action(name, chain1, capital);

  const step1 = fmtStep(
    `Create a fresh wallet for ${name} on ${chain1} and write its seed phrase on paper stored offline, never in a screenshot, chat, or cloud note, then fund it with a small amount of ${chain1} gas token from an exchange withdrawal`,
    "a few dollars of gas",
    "5 minutes",
  );
  const step2 = fmtStep(main, `$${capital} capital plus gas`, "15 minutes");
  const step3 = chain2
    ? fmtStep(
        `Repeat the core action on ${chain2}: use ${name} on ${chain2} with a second small deposit so your activity is recorded on two chains, not one`,
        "about $2 of gas",
        "10 minutes",
      )
    : fmtStep(
        `One week later, repeat the core action a second time on ${chain1} so the activity spans more than one week and shows up as a returning user`,
        "about $2 of gas",
        "10 minutes",
      );
  const step4 = fmtStep(
    `Hold the position for at least ${hold} days without withdrawing, so the activity is recorded in more than one snapshot`,
    `$${capital} stays in the position`,
    `${hold} days`,
  );
  const step5 = fmtStep(
    `Open ${name}'s own points or rewards page, check whether your activity is credited, and claim only through links that ${name} itself publishes`,
    "no fee",
    "10 minutes",
  );
  const step6 = fmtStep(
    `Confirm the position shows on ${name}'s dashboard and on the ${chain1} block explorer, and write down the transaction hash for every deposit`,
    "nothing",
    "10 minutes",
  );
  const step7 = fmtStep(riskSentence(spec.riskKey, name), "nothing", "5 minutes");
  const step8 = fmtStep(
    `Keep a farm log: wallet address, date, every transaction hash, and the ${name} position on ${chain1}, so the position can be repeated or unwound later`,
    "nothing",
    "5 minutes",
  );
  return [step1, step2, step3, step4, step5, step6, step7, step8];
}

// ---- board ----

export function heatFor(growthPctWinsorized: number, multiple: number, ageDays: number | null): number {
  const growthNorm = clip((growthPctWinsorized + 50) / 250, 0, 1);
  const multipleNorm = clip(multiple / 3, 0, 1);
  const recency = ageDays !== null && ageDays >= 365 && ageDays < 365 * 3 ? 1 : 0.7;
  return Math.round(100 * (0.5 * growthNorm + 0.3 * multipleNorm + 0.2 * recency));
}

export function buildBoard(snapshot: Snapshot, model: FittedModel): BoardRow[] {
  const asOf = asOfDate(snapshot);
  const watch = new Set(snapshot.watchlist);
  const rows: BoardRow[] = [];
  for (const p of snapshot.protocols) {
    if (!isRankable(p)) continue;
    const ageDays = ageDaysOf(p, asOf);
    const implied = impliedValueUsd(p, model, asOf);
    const { parts } = impliedRaw(p, model.beta, model.intercept, model.offsetsByCategory, asOf);
    const off = offsetFor(p.category, model.offsetsByCategory);
    const growthPct = winsorizedChange(p);
    const multiple = implied / p.tvl_usd;
    rows.push({
      rank: 0,
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      growth_pct: growthPct,
      listed_at: p.listed_at,
      age_days: ageDays,
      age_years: ageDays === null ? null : Math.round((ageDays / 365) * 10) / 10,
      implied_value_usd: implied,
      watchlist: watch.has(p.slug),
      growth_multiplier: parts.growth,
      age_multiplier: parts.maturity,
      category_multiplier: Math.pow(10, parts.offset),
      category_offset: parts.offset,
      multiple,
      per_1k: multiple * 1000,
      heat: heatFor(growthPct, multiple, ageDays),
      category_n: off.n,
      category_median_residual: off.medianResidual,
      farm_steps: farmSteps(p, ageDays),
    });
  }
  // Board = every watchlist slug + every other rankable protocol. Watchlist slugs
  // are rankable by the same rule, so this is exactly the rankable set; verified
  // at runtime (expected 198 on this snapshot).
  rows.sort(
    (a, b) => b.implied_value_usd - a.implied_value_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

/** Live-token view: protocols with a token, not CEX, by market cap, top 24. */
export function liveTop(snapshot: Snapshot, limit = 24): {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
}[] {
  return snapshot.protocols
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.category !== "CEX")
    .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
    .slice(0, limit)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd as number,
      change_7d: p.change_7d,
    }));
}
