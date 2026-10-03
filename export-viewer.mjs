#!/usr/bin/env node
// export-viewer.mjs — precompute per-seq snapshots for the static viewer.
// The browser never re-folds the ledger (no fold divergence); it renders.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExocortexTable, tokenEconomics } from "./exocortex.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const files = [
  ["vesper-table", "nights/vesper-session.json"],
  ["vesper-act2", "nights/vesper-act2-session.json"],
  ["vesper-act3", "nights/vesper-act3-session.json"],
];
const out = { acts: [] };
for (const [name, file] of files) {
  const p = path.join(HERE, file);
  if (!fs.existsSync(p)) { console.error(`skip ${file} (missing)`); continue; }
  const s = JSON.parse(fs.readFileSync(p, "utf8"));
  const t = new ExocortexTable(s.name, s.ops);
  const N = s.ops.length;
  const seqs = [];
  for (let k = 1; k <= N; k++) {
    const st = t.seq.stateAt(k);
    const econ = tokenEconomics(t.seq);
    seqs.push({
      seq: k, op: s.ops[k - 1].op, who: s.ops[k - 1].payload?.who ?? null,
      dials: st.dials, scars: st.scars.length, saidCount: st.said.length,
      exojs: t.liveExoJs(k).map((e) => ({ exoj: e.exoj, version: e.version, max: e.deadband.max, owner: e.owner })),
      econSoFar: Object.fromEntries(Object.entries(econ).map(([n, v]) => [n, {
        thought: v.thought_tokens, auto: v.auto_beats, breaches: v.breaches,
        reading: v.reading_tokens }])),
    });
  }
  out.acts.push({
    name, title: s.name, tip: s.verify.tip, rows: N,
    economics: s.economics, live_exojs: s.live_exojs,
    said: s.ops.filter((o) => o.op === "say").map((o) => ({ seq: o.seq, who: o.payload.who, text: o.payload.text })),
    rolls: s.ops.filter((o) => o.op === "roll").map((o) => ({ seq: o.seq, solid: o.payload.solid, rolls: o.payload.rolls, sum: o.payload.sum, why: o.payload.why })),
    breaches: s.ops.filter((o) => o.op === "exoj.breach").map((o) => ({ seq: o.seq, exoj: o.payload.exoj, v: o.payload.version, d: o.payload.divergence, max: o.payload.max, cause: o.payload.cause })),
    seqs,
  });
  console.error(`[viewer] ${name}: ${N} seqs`);
}
fs.writeFileSync(path.join(HERE, "viewer-data.json"), JSON.stringify(out));
console.log(`viewer-data.json written: ${out.acts.length} acts, ${out.acts.reduce((a, x) => a + x.rows, 0)} seqs`);
