// Coral City Heat — entrypoint for the make.fun program harness.
//
// What this does, in order:
//   1. works out where this entry lives (its own folder) and where the
//      harness wants the finished entry written (MAKEFUN_OUTPUT_DIR,
//      falling back to /output);
//   2. copies the playable game (game/) and the screenshot set
//      (screenshots/) across, byte for byte;
//   3. asks the vendored dossier builder to describe the copied entry and
//      writes that description to dossier.json in the output folder.
//
// The game itself is plain static files — open game/index.html in a
// desktop browser and play. Nothing here touches the network.

import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

// The caps this bounty holds a dossier to. Text is the readable source of
// the entry; screenshots are the four JPEG scenes; the game tree is the
// whole static site, three.js module included.
const DOSSIER_CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
};

function main(): void {
  const entryDir = fileURLToPath(new URL('.', import.meta.url));
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

  mkdirSync(outputDir, { recursive: true });

  // The two payloads of the entry: the game you play and the pictures
  // that prove it. Everything else (this file included) is scaffolding
  // the scorer reads from the repository instead.
  for (const part of ['game', 'screenshots']) {
    cpSync(join(entryDir, part), join(outputDir, part), { recursive: true });
  }

  const dossier = buildDossier(outputDir, DOSSIER_CAPS);
  writeFileSync(join(outputDir, 'dossier.json'), dossier);

  // Report what was actually sealed, so a bad copy (a missing folder, an
  // oversized screenshot) is visible in the run log instead of surfacing
  // later as a scorer rejection. buildDossier hands back the canonical
  // JSON as raw bytes, so decode before parsing.
  const summary = JSON.parse(new TextDecoder().decode(dossier));
  const totals = /Totals: (\d+) files and directories \((\d+) bytes\)/.exec(summary.text ?? '');
  const shots = summary.images?.length ?? 0;
  console.log(`coral-city-heat: entry written to ${outputDir} — game tree ${totals ? `${totals[1]} files, ${totals[2]} bytes` : 'unread'}, ${shots} screenshots, dossier ${dossier.byteLength} bytes`);
}

main();
