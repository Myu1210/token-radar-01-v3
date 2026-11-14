// Token Launch Radar v3 (radar-4) — program entry point.
//
// METHOD (same paragraph heads every source file of this entry): implied value =
// 10^(a + beta*log10(TVL) + off_c) x growth x maturity, fitted from the snapshot
// itself, never from a hardcoded list of names. a and beta are the OLS fit of
// log10(market cap) on log10(TVL) over the snapshot's live-token protocols. off_c
// is the category offset: the median log-residual of that category's live tokens,
// shrunk toward zero by n/(n+12). There is NO chain multiplier: the fitted chain
// coefficient is -0.034 log-points per log-chain, indistinguishable from zero.
// Fitted on this snapshot: 119 live-token comparators, beta 0.472, intercept
// 3.382, LOO median error 3.06x for the model vs 4.96x for a flat 0.25 multiple,
// 51.3% of comparators predicted within 3x in-sample (47.9% out-of-sample under
// LOO). A flat multiple overprices giants and underprices small protocols, and
// a median of raw mcap/TVL ratios lets one outlier set a whole category: rain,
// Prediction Market's only live comparator at 400x, pushed that benchmark to
// the 3.0 clip in the previous model; in log space it contributes +0.22 dex.
//
// Reads the sealed snapshot, fits the model, writes board.json, data.js, the
// dashboard and screenshots into the output directory, and writes dossier.json
// with buildDossier from vendor/makefun-board.ts. Deterministic: every date comes
// from the snapshot's as_of; no wall clock, no randomness in the output path.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { buildBoard, fitModel, liveTop } from "./lib/model.ts";
import type { Snapshot } from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { input: string } {
  let input = "/input/snapshot.json";
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--input" && i + 1 < argv.length) input = argv[i + 1];
    const eq = argv[i].match(/^--input=(.+)$/);
    if (eq) input = eq[1];
  }
  return { input };
}

function main(): void {
  const { input: inputArg } = parseArgs(process.argv.slice(2));
  const input = inputArg.endsWith(".json") ? inputArg : path.join(inputArg, "snapshot.json");
  if (!fs.existsSync(input)) {
    process.stderr.write(`token radar v3: no snapshot at ${input}: pass --input <snapshot.json|directory>\n`);
    process.exit(2);
  }
  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  const snapshot: Snapshot = JSON.parse(fs.readFileSync(input, "utf-8"));

  const model = fitModel(snapshot);
  const rows = buildBoard(snapshot, model);
  // Verification, per spec: the board must be exactly the rankable set (198 on
  // this snapshot) and cover the whole watchlist. Never silently change the rule.
  if (rows.length !== 198) {
    process.stderr.write(`token radar v3: board has ${rows.length} rows, expected exactly 198 — refusing to write\n`);
    process.exit(1);
  }
  const watchCovered = rows.filter((r) => r.watchlist).length;
  if (watchCovered !== snapshot.watchlist.length) {
    process.stderr.write(`token radar v3: watchlist coverage ${watchCovered}/${snapshot.watchlist.length} — refusing to write\n`);
    process.exit(1);
  }
  const live = liveTop(snapshot, 24);
  const s = model.stats;

  fs.mkdirSync(outDir, { recursive: true });
  fs.mkdirSync(path.join(outDir, "dashboard"), { recursive: true });
  fs.mkdirSync(path.join(outDir, "screenshots"), { recursive: true });

  // board.json
  fs.writeFileSync(path.join(outDir, "board.json"), JSON.stringify({ rows }, null, 2) + "\n");

  // data.js — the dashboard's dataset (window.RADAR), written beside the page.
  const dataset = {
    asOf: snapshot.as_of,
    stats: {
      nComps: s.nComps,
      betaRaw: s.betaRaw,
      beta: s.beta,
      intercept: s.intercept,
      looModel: s.looModel,
      looFlat: s.looFlat,
      within3xPct: s.within3xPct,
      within3xLooPct: s.within3xLooPct,
      offsets: s.offsets,
    },
    liveTop: live,
    liveCount: s.nComps,
    rows,
  };
  fs.writeFileSync(path.join(outDir, "data.js"), "window.RADAR = " + JSON.stringify(dataset) + ";\n");

  // dashboard/ + screenshots/ copied from the repository.
  fs.cpSync(path.join(__dirname, "dashboard"), path.join(outDir, "dashboard"), { recursive: true });
  fs.cpSync(path.join(__dirname, "screenshots"), path.join(outDir, "screenshots"), { recursive: true });
  const shots = fs.readdirSync(path.join(outDir, "screenshots")).filter((n) => !n.startsWith("."));
  if (shots.length < 3) {
    process.stderr.write(`token radar v3: screenshots/ holds ${shots.length} images: hand in 3\n`);
    process.exit(1);
  }

  // dossier.json — byte-identical to what buildDossier writes from /output.
  // buildDossier returns the dossier bytes (Uint8Array), not a string.
  const dossier = buildDossier(outDir, {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 524288 },
    dashboard: { max_files: 400, max_bytes: 4194304 },
  });
  fs.writeFileSync(path.join(outDir, "dossier.json"), dossier);

  // ---- stdout: fit statistics, board summary, determinism note ----
  const totalImplied = rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  console.log(`fit: n live comps = ${s.nComps}`);
  console.log(`fit: beta raw = ${s.betaRaw.toFixed(4)} (clipped to ${s.beta.toFixed(4)})`);
  console.log(`fit: intercept a = ${s.intercept.toFixed(4)}`);
  console.log(`fit: LOO median error model = ${s.looModel.toFixed(2)}x`);
  console.log(`fit: LOO median error flat-0.25 = ${s.looFlat.toFixed(2)}x`);
  console.log(`fit: within-3x (in-sample) = ${s.within3xPct.toFixed(1)}%`);
  console.log(`fit: within-3x (LOO) = ${s.within3xLooPct.toFixed(1)}%`);
  console.log(`board: rows = ${rows.length}`);
  console.log(`board: watchlist covered = ${rows.filter((r) => r.watchlist).length} / ${snapshot.watchlist.length}`);
  console.log(`board: total implied value = $${totalImplied.toLocaleString("en-US")}`);
  console.log("board: top 10:");
  for (const r of rows.slice(0, 10)) {
    console.log(`  #${r.rank} ${r.slug} $${r.implied_value_usd.toLocaleString("en-US")}`);
  }
  console.log("determinism: all dates from snapshot as_of; no Date.now()/random in output path; run twice and diff -r to verify.");
}

main();
