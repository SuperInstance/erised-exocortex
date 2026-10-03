#!/usr/bin/env node
// exocortex.mjs — the autopilot layer for erised iterators (wave-66, layer F).
//
// Three laws (DESIGN.md):
//   COMPILE    a strategy proven across nights (same trigger shape, positive
//              payoff, low variance) is compiled into an ExoJ — a mechanical
//              autoplay script with a deadband calibrated from observation.
//   DEADBAND   while the scene stays inside an ExoJ's envelope, the beat costs
//              ZERO thought-tokens — the ExoJ plays, the dice are mechanical.
//   INTERRUPT  outside the envelope the ExoJ seizes (the springs sing); the
//              iterator wakes at full thought and re-imagines (version bump,
//              deadband recalibrated) or retires. Breaches are STICKY.
//
// Everything here is deterministic. The only randomness is the sequencer's
// platonic dice, re-derived from the ledger itself. No model is called, no
// wall clock is read. The economics receipt is a pure fold over the ledger.
import { Sequencer } from "./engine.mjs";

const canon = (o) => JSON.stringify(o, Object.keys(o).sort());
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

// ------------------------------------------------------------------ divergence
// Envelope divergence in [0,1]: weighted key mismatch, numeric keys normalized.
// Missing keys count as full mismatch (the world forgot something the script
// assumed — that IS surprise).
export function divergence(exoj, state) {
  const { expected, weights } = exoj.deadband;
  const all = Object.keys(expected);
  let cost = 0, total = 0;
  for (const k of all) {
    const w = weights[k] ?? 0.1;
    total += w;
    const want = expected[k], got = state?.[k];
    if (got === undefined || got === null) { cost += w; continue; }
    if (typeof want === "number" && typeof got === "number") {
      cost += w * Math.min(1, Math.abs(got - want) / Math.max(1, Math.abs(want)));
    } else if (String(want) !== String(got)) cost += w;
  }
  for (const k of Object.keys(weights)) {
    if (!(k in expected)) { total += weights[k]; if (state && k in state) cost += weights[k]; }
  }
  return total === 0 ? 0 : cost / total;
}

// ------------------------------------------------------------------- autopilot
// The mechanical move: first matching policy rule wins. NO model, NO tokens.
export function autoMove(exoj, state) {
  for (const rule of exoj.policy) {
    const when = rule.when ?? {};
    const hit = Object.keys(when).every((k) => String(state[k]) === String(when[k]));
    if (hit) return rule.move;
  }
  return null; // no rule covers this state -> the script cannot play it
}

// The deadband verdict, in one place so the pins can fail first here.
export function deadbandVerdict(exoj, state) {
  const d = divergence(exoj, state);
  return { divergence: d, breach: d > exoj.deadband.max,
           margin: exoj.deadband.max - d };
}

// -------------------------------------------------------------------- compiler
// Strategy rows -> ExoJs. Deterministic: sorted keys, stable tie-breaks.
// A strategy row (already on the ledger as op `strategy`):
//   { who, shape, move, payoff, scene }   // shape = trigger-shape id,
//                                         // scene = observed scene keys
// An ExoJ compiles when a (who, shape) group has >= minOccurrences rows, all
// agreeing on ONE dominant move, mean payoff >= minPayoff, and >= 2 distinct
// scene keys observed (a deadband needs an envelope to guard).
export const COMPILE_DEFAULTS = { minOccurrences: 3, minPayoff: 0, margin: 0.1 };

export function compileExoJs(strategyRows, opts = {}) {
  const cfg = { ...COMPILE_DEFAULTS, ...opts };
  const groups = new Map();
  for (const r of strategyRows) {
    const key = `${r.who}|${r.shape}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const out = [];
  for (const [key, rows] of [...groups.entries()].sort()) {
    if (rows.length < cfg.minOccurrences) continue;
    const [who, shape] = key.split("|");
    // dominant move: most common, tie broken by highest mean payoff then name
    const byMove = new Map();
    for (const r of rows) {
      if (!byMove.has(r.move)) byMove.set(r.move, []);
      byMove.get(r.move).push(r);
    }
    const ranked = [...byMove.entries()]
      .map(([move, rs]) => ({ move, n: rs.length,
        payoff: rs.reduce((a, r) => a + r.payoff, 0) / rs.length }))
      .sort((a, b) => b.n - a.n || b.payoff - a.payoff || a.move.localeCompare(b.move));
    const top = ranked[0];
    if (top.n / rows.length < 0.5) continue;                 // no dominant move
    if (top.payoff < cfg.minPayoff) continue;                // never profitable
    const sceneKeys = [...new Set(rows.flatMap((r) => Object.keys(r.scene ?? {})))].sort();
    if (sceneKeys.length < 2) continue;                      // no envelope to guard
    // policy: within the dominant move's rows, argmax payoff per observed
    // exception-key state; default = the dominant move itself.
    const ruleMap = new Map();
    for (const r of rows.filter((r) => r.move === top.move)) {
      for (const [k, v] of Object.entries(r.scene ?? {})) {
        const ruleKey = `${k}=${v}`;
        if (!ruleMap.has(ruleKey)) ruleMap.set(ruleKey, { key: k, value: v, rows: [] });
        ruleMap.get(ruleKey).rows.push(r);
      }
    }
    const policy = [...ruleMap.values()]
      .filter((e) => e.rows.length >= 2 &&
        e.rows.reduce((a, r) => a + r.payoff, 0) / e.rows.length >= top.payoff)
      .sort((a, b) => b.rows.length - a.rows.length || a.key.localeCompare(b.key))
      .slice(0, 4)
      .map((e) => ({ when: { [e.key]: e.value }, move: top.move }));
    policy.push({ when: {}, move: top.move });
    // envelope: per-key mode of observed scene values; weights: observation
    // frequency of the key among rows (what the owner kept looking at).
    const expected = {}, weights = {};
    for (const k of sceneKeys) {
      const vals = rows.map((r) => String(r.scene?.[k])).filter((v) => v !== "undefined");
      if (!vals.length) continue;
      const tally = new Map();
      for (const v of vals) tally.set(v, (tally.get(v) ?? 0) + 1);
      const mode = [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
      const isNum = vals.every((v) => !isNaN(parseFloat(v)) && isFinite(v));
      expected[k] = isNum ? parseFloat(mode) : mode;
      weights[k] = Math.round((vals.length / rows.length) * 100) / 100;
    }
    // variance of payoff within the group calibrates the deadband width.
    const mean = rows.reduce((a, r) => a + r.payoff, 0) / rows.length;
    const variance = Math.round(
      rows.reduce((a, r) => a + (r.payoff - mean) ** 2, 0) / rows.length * 1e4) / 1e4;
    const max = clamp(2 * Math.sqrt(variance) + cfg.margin, 0.15, 0.6);
    out.push({
      exoj: `${who}.${shape}`, version: 1, owner: who, triggerShape: shape,
      policy, deadband: { expected, weights, max: Math.round(max * 100) / 100 },
      provenance: { nights: [...new Set(rows.map((r) => r.night))].sort(),
        occurrences: rows.length, payoff: Math.round(mean * 100) / 100, variance },
    });
  }
  return out.sort((a, b) => a.exoj.localeCompare(b.exoj));
}

// ------------------------------------------------------------------ accounting
// The token-economics receipt: a pure fold over the ledger. The thesis curve.
export function tokenEconomics(seq) {
  const nights = {};
  for (const row of seq.ops) {
    if (row.op === "rewind") continue;
    const night = row.payload?.night ?? 1;
    const n = (nights[night] ??= { thought_tokens: 0, full_thought_beats: 0,
      auto_beats: 0, breaches: 0, reimagines: 0, reading_tokens: 0, reads: 0 });
    const p = row.payload ?? {};
    switch (row.op) {
      case "thought": n.full_thought_beats++; n.thought_tokens += p.tokens ?? 0; break;
      case "exoj.run": n.auto_beats++; break;
      case "exoj.breach": n.breaches++; break;
      case "exoj.reimagine": n.reimagines++; n.thought_tokens += p.tokens ?? 0; break;
      case "read": n.reads++; n.reading_tokens += p.tokens ?? 0; break;
    }
  }
  for (const k of Object.keys(nights).sort((a, b) => a - b)) {
    const n = nights[k];
    n.total_tokens = n.thought_tokens + n.reading_tokens;
    n.auto_share = Math.round((n.auto_beats /
      Math.max(1, n.auto_beats + n.full_thought_beats)) * 100) / 100;
  }
  return nights;
}

// ------------------------------------------------------- ledger-backed wrapper
// Ops land on the vendored sequencer so rewinds keep scars and dice re-derive.
export class ExocortexTable {
  constructor(name, ops = null) {
    this.seq = new Sequencer();
    if (ops) { this.seq.ops = ops; }
    else this.seq.append("init", { name });
  }
  _p(op, payload, opts) { return this.seq.append(op, payload, opts); }

  strategy(who, shape, move, payoff, scene, night) {
    return this._p("strategy", { who, shape, move, payoff, scene, night });
  }
  compile(exoj) { return this._p("exoj.compile", { exoj }); }
  run(exoj, state, night) {
    const v = deadbandVerdict(exoj, state);
    if (v.breach) throw new Error(`DEADBAND_WOULD_BREACH ${exoj.exoj} d=${v.divergence.toFixed(3)}`);
    const move = autoMove(exoj, state);
    if (move === null) throw new Error(`NO_POLICY_COVERAGE ${exoj.exoj}`);
    this._p("exoj.run", { exoj: exoj.exoj, version: exoj.version, move,
      divergence: Math.round(v.divergence * 1000) / 1000, night });
    return { move, divergence: v.divergence };
  }
  breach(exoj, state, cause, night) {
    const v = deadbandVerdict(exoj, state);
    // sticky: the breach teaches; the scar survives rewind (erised law)
    return this._p("exoj.breach", { exoj: exoj.exoj, version: exoj.version,
      divergence: Math.round(v.divergence * 1000) / 1000, max: exoj.deadband.max,
      cause, state, night }, { sticky: true });
  }
  reimagine(exoj, newExoj, tokens, note, night) {
    // `next` carries the full re-imagined ExoJ so the fold can serve it live
    return this._p("exoj.reimagine", { exoj: exoj.exoj, from_version: exoj.version,
      to_version: newExoj.version, tokens, note, night, next: newExoj });
  }
  retire(exoj, why, night) {
    return this._p("exoj.retire", { exoj: exoj.exoj, version: exoj.version, why, night });
  }
  // a script outliving its author: same ExoJ, new keeper, provenance receipted
  handoff(exoj, newOwner, why, night) {
    const next = JSON.parse(JSON.stringify(exoj));
    next.owner = newOwner;
    next.provenance = { ...next.provenance, handed_from: exoj.owner, handed_at_night: night };
    this._p("exoj.handoff", { exoj: exoj.exoj, version: exoj.version,
      from: exoj.owner, to: newOwner, why, night });
    this._p("exoj.compile", { exoj: next });
    return next;
  }
  thought(who, beat, tokens, night, note) {
    return this._p("thought", { who, beat, tokens, night, note });
  }
  read(who, target, tokens, night, note) {
    return this._p("read", { who, target, tokens, night, note });
  }
  // live ExoJs = latest compile per name (rewind-aware: unwound ops don't count),
  // minus retired, version advanced by re-imagines (`next` carries the new form).
  liveExoJs(k = this.seq.ops.length) {
    const latest = new Map(), retired = new Set();
    for (const row of this.seq.ops) {
      if (row.seq > k) break;
      if (row.op !== "rewind" && this.seq.unwoundAt(row, k)) continue;
      const p = row.payload ?? {};
      if (row.op === "exoj.compile") latest.set(p.exoj.exoj, p.exoj);
      if (row.op === "exoj.reimagine" && p.next) latest.set(p.exoj, p.next);
      if (row.op === "exoj.retire") retired.add(p.exoj);
    }
    for (const name of retired) {
      const r = this.seq.ops.findLast?.((o) => o.op === "exoj.retire" && o.payload?.exoj === name && !this.seq.unwoundAt(o, k));
      if (r) latest.delete(name);
    }
    return [...latest.entries()].filter(([n]) => !retired.has(n)).map(([, e]) => e)
      .sort((a, b) => a.exoj.localeCompare(b.exoj));
  }
  // -------- convenience passthroughs to the sequencer
  set(dial, to, why) { return this._p("set", { dial, to, why }); }
  say(who, text) { return this._p("say", { who, text }); }
  roll(solid, n, why) { return this.seq.roll(solid, n, why); }
  scar(who, text) { return this._p("scar", { who, text }, { sticky: true }); }
  sceneEnter(name) { return this._p("scene.enter", { name }); }
  sceneLeave() { return this._p("scene.leave", {}); }
  rewind(to, note) { return this.seq.rewind(to, note); }
  verify() { return this.seq.verify(); }
}
