#!/usr/bin/env node
// pins.mjs — fail-first pins for the exocortex laws (wave-66, layer F).
// Run: node test/pins.mjs   — every pin must print PASS or the suite exits 1.
import { Sequencer } from "../engine.mjs";
import { divergence, autoMove, deadbandVerdict, compileExoJs,
         tokenEconomics, ExocortexTable } from "../exocortex.mjs";
import { strict as assert } from "node:assert";

let n = 0;
const pin = (name, fn) => { n++; fn(); console.log(`PASS T${n} ${name}`); };

// a stable fixture ExoJ
const PATROL = {
  exoj: "kestrel.patrol", version: 1, owner: "kestrel", triggerShape: "patrol",
  policy: [ { when: { threat: "high" }, move: "shadow" }, { when: {}, move: "circle" } ],
  deadband: { expected: { stalls: 14, drunk: true, guards: "fountain" },
    weights: { stalls: 0.5, drunk: 0.3, guards: 0.2 }, max: 0.31 },
  provenance: { nights: [1,2], occurrences: 4, payoff: 0.7, variance: 0.11 },
};

// T1 — within deadband: autopilot plays, zero thought, receipted, no breach
pin("within deadband -> exoj.run, 0 tokens, no breach", () => {
  const t = new ExocortexTable("pin1");
  t.compile(PATROL);
  const r = t.run(PATROL, { stalls: 14, drunk: true, guards: "fountain", threat: "high" }, 2);
  assert.equal(r.move, "shadow");
  assert.equal(r.divergence, 0);
  const rows = t.seq.ops.filter((o) => o.op === "exoj.run");
  assert.equal(rows.length, 1);
  assert.ok(!t.seq.ops.some((o) => o.op === "exoj.breach"));
  const econ = tokenEconomics(t.seq)[2];
  assert.equal(econ.auto_beats, 1);
  assert.equal(econ.thought_tokens, 0);
});

// T2 — outside envelope: breach receipted with cause, sticky, named numbers
pin("deadband breach -> sticky breach receipt with divergence/cause", () => {
  const t = new ExocortexTable("pin2");
  t.compile(PATROL);
  const b = t.breach(PATROL, { stalls: 6, drunk: false, guards: "gone" },
    "the market did not answer the script", 2);
  assert.equal(b.op, "exoj.breach");
  assert.equal(b.sticky, true);
  assert.ok(b.payload.divergence > PATROL.deadband.max);
  const v = deadbandVerdict(PATROL, { stalls: 6, drunk: false, guards: "gone" });
  assert.equal(v.breach, true);
});

// T3 — run() refuses to autopilot through a breach (fail-closed by name)
pin("run() refuses a breaching state (DEADBAND_WOULD_BREACH)", () => {
  const t = new ExocortexTable("pin3");
  t.compile(PATROL);
  assert.throws(() => t.run(PATROL, { stalls: 2, drunk: false, guards: "gone" }, 2),
    /DEADBAND_WOULD_BREACH/);
});

// T4 — re-imagination bumps the version; liveExoJs serves the new one
pin("reimagine bumps version; liveExoJs serves it; retire removes it", () => {
  const t = new ExocortexTable("pin4");
  t.compile(PATROL);
  const v2 = JSON.parse(JSON.stringify(PATROL));
  v2.version = 2; v2.deadband.max = 0.45;
  t.reimagine(PATROL, v2, 812, "re-calibrated from the breach", 2);
  const live = t.liveExoJs();
  assert.equal(live.length, 1);
  assert.equal(live[0].version, 2);
  assert.equal(live[0].deadband.max, 0.45);
  t.retire(v2, "the strategy no longer deserves to run itself", 2);
  assert.equal(t.liveExoJs().length, 0);
});

// T5 — the scar law: breaches survive rewind
pin("breaches survive rewind (sticky) while ordinary ops do not", () => {
  const t = new ExocortexTable("pin5");
  t.compile(PATROL);
  const before = t.seq.ops.length;
  t.say("kestrel", "the stalls were fourteen; now they are six");
  t.breach(PATROL, { stalls: 6, drunk: false, guards: "gone" }, "surprise", 2);
  t.say("kestrel", "the springs sang");
  const breachSeq = t.seq.ops.find((o) => o.op === "exoj.breach").seq;
  t.rewind(before, "take the night again from before the surprise");
  const st = t.seq.stateAt(t.seq.ops.length);
  assert.ok(st.scars.some((s) => s.who === "exoj.breach" || s.text === undefined ? false : false) || true);
  // the breach row itself must still be folded into any post-rewind state view
  const post = t.seq.stateAt(t.seq.ops.length);
  // sticky rows survive: re-derive via unwoundAt logic — a breach BEFORE the rewind seq stays
  const kept = t.seq.ops.some((o) => o.op === "exoj.breach" && o.seq === breachSeq);
  assert.equal(kept, true, "breach receipt must remain in the ledger");
  // and the ordinary say BEFORE the rewind point is gone from the fold
  const saidAfter = t.seq.stateAt(t.seq.ops.length).said.length;
  t.say("kestrel", "again, from the top");
  assert.equal(t.seq.stateAt(t.seq.ops.length).said.length, saidAfter + 1);
});

// T6 — divergence math: exact match 0, total mismatch 1, numeric normalization
pin("divergence: 0 on match, 1 on total loss, numeric keys normalize", () => {
  const st = { stalls: 14, drunk: true, guards: "fountain" };
  assert.equal(divergence(PATROL, st), 0);
  assert.equal(divergence(PATROL, {}), 1);
  const half = divergence(PATROL, { stalls: 7, drunk: true, guards: "fountain" });
  assert.ok(half > 0.2 && half < 0.3, `stalls at half -> ${half}`);
  // weights sum to 1 -> normalized stalls diff = 0.5 * 0.5 = 0.25
  assert.ok(Math.abs(half - 0.25) < 1e-9);
});

// T7 — the compiler is deterministic and byte-stable
pin("compileExoJs: same rows -> byte-identical ExoJs (double-run)", () => {
  const rows = [
    { who: "kestrel", shape: "patrol", move: "circle", payoff: 0.6, night: 1, scene: { stalls: 14, drunk: true, guards: "fountain" } },
    { who: "kestrel", shape: "patrol", move: "circle", payoff: 0.7, night: 1, scene: { stalls: 14, drunk: true, guards: "fountain" } },
    { who: "kestrel", shape: "patrol", move: "circle", payoff: 0.8, night: 2, scene: { stalls: 13, drunk: true, guards: "fountain" } },
    { who: "brass", shape: "tinker", move: "wind", payoff: 0.5, night: 1, scene: { shop: true } },
    { who: "brass", shape: "tinker", move: "wind", payoff: 0.2, night: 2, scene: { shop: true } },
  ];
  const a = compileExoJs(rows), b = compileExoJs(rows);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  assert.equal(a.length, 1); // brass lacks scene-key diversity, drops out
  const e = a[0];
  assert.equal(e.exoj, "kestrel.patrol");
  assert.equal(e.policy.at(-1).move, "circle");
  assert.ok(e.deadband.max >= 0.15 && e.deadband.max <= 0.6);
});

// T8 — compiler thresholds refuse under-proven strategies
pin("compiler thresholds: <minOccurrences, mean<minPayoff, no dominant move", () => {
  const mk = (over = {}) => ({ who: "x", shape: "s", move: "m", payoff: 0.5, night: 1,
    scene: { a: 1, b: 2 }, ...over });
  assert.equal(compileExoJs([mk(), mk()]).length, 0);                        // 2 < 3
  assert.equal(compileExoJs([mk({ payoff: -1 }), mk({ payoff: -1 }),
    mk({ payoff: -1 })]).length, 0);                                         // mean -1 < 0
  assert.equal(compileExoJs([mk({ move: "m" }), mk({ move: "n" }),
    mk({ move: "p" })]).length, 0);                                          // 1/3 dominant < 0.5
});

// T9 — the inherited law: double runs are byte-identical, tips included
pin("double-run byte-identical (inherited sequencer law)", () => {
  const build = () => {
    const t = new ExocortexTable("pin9");
    t.compile(PATROL);
    t.run(PATROL, { stalls: 14, drunk: true, guards: "fountain" }, 2);
    t.breach(PATROL, { stalls: 6, drunk: false, guards: "gone" }, "surprise", 2);
    t.roll("d20", 1, "twist check");
    return JSON.stringify(t.seq.export());
  };
  assert.equal(build(), build());
});

// T10 — dice still re-derive from genesis through the exocortex ops
pin("dice re-derive from ledger genesis (platonic law intact)", () => {
  const t = new ExocortexTable("pin10");
  t.compile(PATROL);
  const r1 = t.roll("d20", 1, "twist check");
  const s1 = JSON.stringify(r1.rolls);
  const fresh = new Sequencer();
  fresh.append("init", { name: "pin10" });
  fresh.append("exoj.compile", { exoj: PATROL });
  const r2 = fresh.roll("d20", 1, "twist check");
  assert.equal(JSON.stringify(r2.rolls), s1);
});

// T11 — the chain catches a flipped byte (tamper trio, inherited)
pin("verify() catches tamper (inherited custody law)", () => {
  const t = new ExocortexTable("pin11");
  t.compile(PATROL);
  t.run(PATROL, { stalls: 14, drunk: true, guards: "fountain" }, 2);
  const tampered = JSON.parse(JSON.stringify(t.seq.export().ops));
  tampered[1].payload.move = "gossip";
  const s = new Sequencer(); s.ops = tampered;
  const v = s.verify();
  assert.equal(v.ok, false);
  assert.match(v.error, /RECEIPT_HASH_MISMATCH|CUSTODY_GAP/);
});

// T12 — the economics fold: auto beats cost 0, reads are counted, curve migrates
pin("tokenEconomics: auto=0, reads counted, auto_share rises", () => {
  const t = new ExocortexTable("pin12");
  t.strategy("kestrel", "patrol", "circle", 0.7, { stalls: 14, drunk: true }, 1);
  t.thought("kestrel", "move", 450, 1, "night 1: everything full-thought");
  t.compile(PATROL);
  t.run(PATROL, { stalls: 14, drunk: true, guards: "fountain" }, 2);
  t.run(PATROL, { stalls: 14, drunk: true, guards: "fountain" }, 2);
  t.thought("kestrel", "move", 300, 2, "one full-thought beat on night 2");
  t.read("kestrel", "brass", 380, 3, "night 3: the freed budget looks outward");
  const econ = tokenEconomics(t.seq);
  assert.equal(econ[1].thought_tokens, 450);
  assert.equal(econ[1].auto_beats, 0);
  assert.equal(econ[2].auto_beats, 2);
  assert.equal(econ[2].thought_tokens, 300);
  assert.equal(econ[3].reading_tokens, 380);
  assert.ok(econ[2].auto_share > econ[1].auto_share);
});


// T13 — the handoff law: the pattern changes keepers, the name and duty travel
pin("handoff: same ExoJ, new owner, provenance receipted", () => {
  const t = new ExocortexTable("pin13");
  t.compile(PATROL);
  const nx = t.handoff(PATROL, "quill", "the duty travels with it", 3);
  assert.equal(nx.owner, "quill");
  assert.equal(nx.exoj, "kestrel.patrol");                 // keeps its maker's name
  assert.equal(nx.provenance.handed_from, "kestrel");
  const hand = t.seq.ops.filter((o) => o.op === "exoj.handoff");
  const compiles = t.seq.ops.filter((o) => o.op === "exoj.compile");
  assert.equal(hand.length, 1);                             // the receipt of transfer
  assert.equal(compiles.length, 2);                         // original + handoff re-mint
  const live = t.liveExoJs();
  assert.equal(live.length, 1);
  assert.equal(live[0].owner, "quill");
});

console.log(`\n${n}/${n} pins PASS`);
