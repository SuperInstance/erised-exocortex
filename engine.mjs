#!/usr/bin/env node
// engine.mjs — erised-sequencer: a rewindable TTRPG scene engine (wave-66).
//
// erised's time economy (ticks, resonance, scars-that-survive-rewind) fused
// with platonic-randomness dice and the fleet's custody law. The play IS the
// work-product: every beat is a receipt on a sha256 chain; any past state is
// a stable point you can scrub to, rewind through, or spin back up from.
//
//   op          effect (all deterministic, wall-clock-free)
//   ----------  -----------------------------------------------------------
//   init        name the session, seed the platonic table
//   set         move a scene dial {dial, to, why}
//   say         a line of narration {who, text}
//   roll        platonic dice {solid: d4|d6|d8|d10|d12|d20, n, why}
//               seed = sha256(prev_tip|seq|solid|n) → replayable forever
//   tick        spend ticks {who, n, on}
//   earn        resonance earns ticks {who, n, for}
//   scar        sticky mark {who, text} — SURVIVES rewind (erised law)
//   scene.enter / scene.leave   nest a scene {name}
//   rewind      spin down to seq {to, note} — later ops are unwound (kept in
//               the ledger, ignored by fold) EXCEPT scars; the future after
//               the rewind re-rolls (new tips → new dice), the past replays
//               byte-identical
//
// CLI: node engine.mjs verify | analytics | state <seq>
import { createHash, createHmac } from "node:crypto";

export const sha = (s) => createHash("sha256").update(s).digest("hex");
const canon = (o) => JSON.stringify(o, Object.keys(o).sort());

// ------------------------------------------------------------- platonic dice
// Vertex-count "temperament" of each solid: fewer vertices = sharper fate.
export const SOLIDS = { d4: 4, d6: 6, d8: 8, d10: 10, d12: 12, d20: 20 };

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function platonicRoll(solid, n, seedMaterial) {
  const sides = SOLIDS[solid];
  if (!sides) throw new Error("BAD_SOLID");
  const seed = parseInt(sha(`${seedMaterial}|${solid}|${n}`).slice(0, 8), 16) >>> 0;
  const rng = mulberry32(seed);
  const rolls = Array.from({ length: n }, () => 1 + Math.floor(rng() * sides));
  return { solid, sides, rolls, sum: rolls.reduce((a, b) => a + b, 0),
           max: rolls.reduce((a, b) => a + (b === sides ? 1 : 0), 0),
           seed: seed.toString(16).padStart(8, "0") };
}

// ------------------------------------------------------------------- ledger
export class Sequencer {
  constructor() { this.ops = []; }
  append(op, payload, opts = {}) {
    const seq = this.ops.length + 1;
    const prev = this.ops.length ? this.ops[this.ops.length - 1].tip : "genesis";
    const row = { seq, op, payload, sticky: !!opts.sticky, prev };
    row.tip = sha(`${seq}|${op}|${canon(payload)}|${prev}|${row.sticky}`);
    this.ops.push(row);
    return row;
  }
  roll(solid, n, why) {
    const prev = this.ops.length ? this.ops[this.ops.length - 1].tip : "genesis";
    const r = platonicRoll(solid, n, `${prev}|${this.ops.length + 1}`);
    this.append("roll", { ...r, why });
    return r;
  }
  // is `row` unwound as of seq k? (a rewind at seq r <= k with to < row.seq)
  unwoundAt(row, k) {
    return this.ops.some((r) =>
      r.seq <= k && r.op === "rewind" && r.payload.to < row.seq && row.seq < r.seq);
  }
  stateAt(k) {
    const st = { dials: {}, ticks: {}, scars: [], scenes: [], said: [], rolls: [] };
    for (const row of this.ops) {
      if (row.seq > k) break;
      const p = row.payload;
      const gone = row.op !== "rewind" && this.unwoundAt(row, k);
      if (gone && !row.sticky) continue;
      switch (row.op) {
        case "init": st.name = p.name; break;
        case "set": st.dials[p.dial] = p.to; break;
        case "say": st.said.push({ seq: row.seq, who: p.who, text: p.text }); break;
        case "roll": st.rolls.push({ seq: row.seq, ...p }); break;
        case "tick": st.ticks[p.who] = (st.ticks[p.who] ?? 0) - p.n; break;
        case "earn": st.ticks[p.who] = (st.ticks[p.who] ?? 0) + p.n; break;
        case "scar": st.scars.push({ seq: row.seq, who: p.who, text: p.text }); break;
        case "scene.enter": st.scenes.push(p.name); break;
        case "scene.leave": st.scenes.pop(); break;
        case "rewind": break; // handled by unwoundAt
      }
    }
    st.seq = k;
    return st;
  }
  rewind(to, note) {
    if (to < 0 || to > this.ops.length) throw new Error("REWIND_OUT_OF_RANGE");
    return this.append("rewind", { to, note });
  }
  // ------------------------------------------------------------- checkpoints
  mint(passphrase) {
    const tip = this.ops[this.ops.length - 1]?.tip ?? "genesis";
    const manifest = { seq: this.ops.length, tip };
    return { ...manifest,
             sig: createHmac("sha256", passphrase).update(canon(manifest)).digest("hex") };
  }
  static verifyCheckpoint(cp, passphrase) {
    const want = createHmac("sha256", passphrase)
      .update(canon({ seq: cp.seq, tip: cp.tip })).digest("hex");
    return want === cp.sig ? { ok: true } :
      { ok: false, error: "CHECKPOINT_SIGNATURE_MISMATCH" };
  }
  verify() {
    let prev = "genesis";
    for (const r of this.ops) {
      const want = sha(`${r.seq}|${r.op}|${canon(r.payload)}|${prev}|${r.sticky}`);
      if (r.prev !== prev) return { ok: false, error: "CUSTODY_GAP", seq: r.seq };
      if (r.tip !== want) return { ok: false, error: "RECEIPT_HASH_MISMATCH", seq: r.seq };
      prev = r.tip;
    }
    return { ok: true, rows: this.ops.length, tip: prev };
  }
  // ---------------------------------------------------------------- gesture
  // Dial history → 3D curve (t, value, cumulative earned). Twist energy marks
  // the moment a dial moves WHILE earning opens the third axis — an earned
  // surprise has geometry. Same formulas as quilt's packages/core/src/gesture.ts.
  dialHistory(dial, k = this.ops.length) {
    const pts = []; let earned = 0;
    for (const row of this.ops) {
      if (row.seq > k) break;
      if (row.op === "earn") earned += row.payload.n;
      if (row.op === "set" && row.payload.dial === dial && !this.unwoundAt(row, k))
        pts.push([row.seq, row.payload.to, earned]);
    }
    return pts;
  }
  static gesture(pts) {
    if (pts.length < 2) return { arcLength: 0, bending: 0, twist: 0, planarity: 1 };
    const sub = pts.slice(1).map((p, i) => p.map((v, d) => v - pts[i][d]));
    const norm = (v) => Math.hypot(...v);
    const arcLength = sub.reduce((a, s) => a + norm(s), 0);
    let bending = 0;
    for (let i = 1; i < sub.length; i++) {
      const c = sub[i - 1].map((v, d) => v * sub[i][d]).reduce((a, b) => a + b, 0);
      const m = norm(sub[i - 1]) * norm(sub[i]);
      if (m > 0) bending += 1 - c / m;
    }
    let twist = 0;
    if (pts.length >= 4) {
      for (let i = 3; i < pts.length; i++) {
        const a = pts[i - 3].map((v, d) => v - pts[i - 2][d]);
        const b = pts[i - 2].map((v, d) => v - pts[i - 1][d]);
        const c = pts[i - 1].map((v, d) => v - pts[i][d]);
        const n1 = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
        const n2 = [b[1] * c[2] - b[2] * c[1], b[2] * c[0] - b[0] * c[2], b[0] * c[1] - b[1] * c[0]];
        const m = Math.hypot(...n1) * Math.hypot(...n2);
        if (m > 0) twist += 1 - (n1.map((v, d) => v * n2[d]).reduce((x, y) => x + y, 0)) / m;
      }
    }
    const planarity = 1 / (1 + twist);
    return { arcLength, bending, twist, planarity };
  }
  analytics(k = this.ops.length) {
    const dials = {};
    for (const row of this.ops) {
      if (row.op === "set" && row.seq <= k) dials[row.payload.dial] = true;
    }
    return Object.fromEntries(Object.keys(dials).map((d) =>
      [d, Sequencer.gesture(this.dialHistory(d, k))]));
  }
  export(k = this.ops.length) {
    return { verify: this.verify(), state: this.stateAt(k),
             analytics: this.analytics(k),
             ops: this.ops.filter((r) => r.seq <= k) };
  }
}
