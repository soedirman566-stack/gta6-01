// main.ts — entrypoint for the Coral City Heat make.fun entry.
//
// The game itself is a folder of static files (game/index.html plus ES
// modules, no build step, no network). This program copies game/ and
// screenshots/ into the output directory and writes dossier.json there
// using the vendored make.fun dossier library, so the scorer can read a
// verified summary of exactly what was handed in.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// Preflight: fail loudly and early, with a message a human can act on,
// instead of letting the dossier builder trip over a missing piece.
function preflight(): void {
  const problems: string[] = [];
  if (!existsSync(join(here, 'game', 'index.html'))) {
    problems.push('game/index.html is missing');
  }
  const shotsDir = join(here, 'screenshots');
  const shots = existsSync(shotsDir)
    ? readdirSync(shotsDir).filter((f) => /\.(png|jpe?g)$/i.test(f))
    : [];
  if (shots.length === 0) problems.push('screenshots/ holds no PNG or JPEG renders');
  if (problems.length > 0) {
    throw new Error(`coral-city-heat: cannot stage entry — ${problems.join('; ')}`);
  }
}

function stageInto(dir: string): void {
  mkdirSync(dir, { recursive: true });
  for (const name of ['game', 'screenshots']) {
    const src = join(here, name);
    const dst = join(dir, name);
    if (!existsSync(src)) continue;
    rmSync(dst, { recursive: true, force: true });
    cpSync(src, dst, { recursive: true });
  }
}

function main(): void {
  preflight();
  stageInto(outDir);
  const dossier = buildDossier(outDir, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  });
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  console.log(`coral-city-heat: staged game + screenshots into ${outDir} and wrote dossier.json (${dossier.byteLength} bytes)`);
}

main();
