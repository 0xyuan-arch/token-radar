// Token Launch Radar — the entrypoint (Node 22, standard library only, no build step).
//
// Reads the sealed snapshot (--input <file|dir>, default /input), scores every pre-token
// protocol with the model in lib/model.ts, and writes the hand-in to the output directory
// (--output, else $MAKEFUN_OUTPUT_DIR, else /output):
//
//   board.json    the ranked board, { rows }
//   data.js       the same radar as window.RADAR_DATA, which the dashboard reads
//   dashboard/    a copy of this repository's dashboard/
//   screenshots/  a copy of this repository's screenshots/
//   dossier.json  the judge's summary, written last with the vendored make.fun library
//
// The board is checked by the model's own boardIssue before anything is written: a board the
// gate would refuse is a bug in the model, and the program exits 1 rather than hand it in.

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

// The caps the starter's contract fixes: the dossier's text cap shapes its bytes, the rest refuse.
const DOSSIER_TEXT_MAX = 65_536;
const DOSSIER_SCREENSHOTS = { max: 4, max_bytes: 524_288 };
const DOSSIER_DASHBOARD = { max_files: 400, max_bytes: 4_194_304 };
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read `--name value` or `--name=value` from argv, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const glued = args.find((a) => a.startsWith(`--${name}=`));
  return glued === undefined ? fallback : glued.slice(name.length + 3);
}

function fail(message: string, code: number): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(code);
}

const inputArg = readArg('input', '/input');
const snapshotPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath} — pass --input <snapshot.json|directory> or mount the sealed input at /input`, 2);
}
const outDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`, 1);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a directory's regular files (dot-names skipped) into a sibling directory of the output. Returns the names copied. */
function copyTree(name: string): string[] {
  const from = join(repoDir, name);
  if (!existsSync(from)) return [];
  const to = join(outDir, name);
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const entry of readdirSync(from)) {
    if (entry.startsWith('.')) continue;
    const source = join(from, entry);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, entry));
    names.push(entry);
  }
  return names;
}

const dashboardFiles = copyTree('dashboard');
const shotFiles = copyTree('screenshots');
if (shotFiles.length < 3) {
  fail(`screenshots/ holds ${shotFiles.length} image(s) — hand in 3: the board, a detail view and a filtered view`, 1);
}
for (const name of shotFiles) {
  if (!IMAGE_NAME.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`, 1);
}

// Written last: the scorer rebuilds the dossier from this same output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, { text_max_bytes: DOSSIER_TEXT_MAX, screenshots: DOSSIER_SCREENSHOTS, dashboard: DOSSIER_DASHBOARD }),
);

const { counts, calibration } = radar.meta;
process.stdout.write(
  `token-radar: ${counts.protocols} protocols in the snapshot, ${counts.tokenized} tokenized peers calibrated ` +
    `(global median multiple ${calibration.global_multiple}x), ${board.length} pre-token protocols ranked, ` +
    `${counts.watchlist_covered}/${counts.watchlist} watchlist covered\n` +
    `token-radar: ${board.length} launch candidates ranked; ${radar.meta.excluded_products.total} wrapped, staked or ` +
    `bridged products set aside — they are not token launches\n` +
    `token-radar: wrote board.json (${board.length} rows), data.js, dashboard/ (${dashboardFiles.length} files), ` +
    `screenshots/ (${shotFiles.length} images) and dossier.json to ${outDir}\n`,
);
