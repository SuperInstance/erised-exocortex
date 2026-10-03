#!/usr/bin/env node
// play.mjs — "Nights at the Vesper Table": the erised-exocortex campaign runner.
//
//   node play.mjs run night1     -- full-thought night + the first compile (checkpointed)
//   node play.mjs run night2     -- autopilot, dice-dealt surprises, breaches, rewind gate
//   node play.mjs run night3     -- the table reads, the meta-event, the final question
//   node play.mjs run stitch     -- three nights -> one telling; session of record exported
//   node play.mjs run all        -- every phase in sequence
//   node play.mjs verify | scrub <seq> | rolls | economics | exojs   (local, free)
//
// Resumability: each phase checkpoints ops+logs at its END; a re-run of a phase
// restarts that phase from the previous checkpoint. Dice re-derive from ledger
// tips, so the night-2/3 deals are deterministic functions of the checkpoint —
// resumption is clean by construction. Multi-model authenticity: four iterators
// on four different models; GM on a fifth; referee = typesafe System One.
// Autopilot beats make NO model call — that is the thesis; the receipts prove it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExocortexTable, compileExoJs, tokenEconomics, deadbandVerdict } from "./exocortex.mjs";
import { Sequencer } from "./engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ckpt = (ph) => path.join(HERE, `nights/.ckpt-${ph}.json`);

const env = Object.fromEntries(fs.readFileSync("/home/z/my-project/.env.keys", "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));

const ENDPOINTS = {
  deepinfra: { url: "https://api.deepinfra.com/v1/openai/chat/completions", key: env.DEEPINFRA_API_KEY },
  deepseek: { url: "https://api.deepseek.com/chat/completions", key: env.DEEPSEEK_API_KEY },
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", key: env.TYPESAFE_API_KEY },
};

const callLog = [];
const refereeLog = [];
async function chat(model, messages, maxTokens = 400, temperature = 0.9, tries = 3) {
  const target = model === "deepseek-chat" ? ENDPOINTS.deepseek : ENDPOINTS.deepinfra;
  for (let i = 1; i <= tries; i++) {
    const t0 = Date.now();
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 120000);
      const r = await fetch(target.url, {
        method: "POST", signal: ctl.signal,
        headers: { Authorization: `Bearer ${target.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature }),
      });
      clearTimeout(to);
      if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
      const d = await r.json();
      const text = (d.choices?.[0]?.message?.content ?? "").trim();
      const u = d.usage ?? {};
      const tokens = (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0);
      callLog.push({ model, ms: Date.now() - t0, tokens, ok: true });
      return { text, tokens };
    } catch (e) {
      callLog.push({ model, ms: Date.now() - t0, ok: false, err: String(e).slice(0, 140) });
      if (i === tries) throw e;
      await new Promise((res) => setTimeout(res, 1500 * i * i));
    }
  }
}

async function referee(state, questions) {
  const t0 = Date.now();
  const r = await fetch(ENDPOINTS.typesafe.url, {
    method: "POST",
    headers: { Authorization: `Bearer ${ENDPOINTS.typesafe.key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "jev-latest", state, questions }),
  });
  if (!r.ok) throw new Error(`referee HTTP ${r.status}`);
  const d = await r.json();
  refereeLog.push({ ms: Date.now() - t0, state: state.slice(0, 90), answers: d.answers });
  return d.answers;
}

const OUTCOME_Q = { outcome: { type: "choice", instructions: "Judge the outcome of this beat at the table: did the character's action land cleanly, mixed, or as a setback for them?", criteria: { clean: "it landed cleanly and advanced them", mixed: "it half-landed; cost and gain both", setback: "it failed or backfired" } } };
const PAYOFF = { clean: 1, mixed: 0.5, setback: 0 };

const tag = (text) => {
  const m = text.match(/MOVE:\s*([a-z-]+)/i);
  return m ? m[1].toLowerCase() : null;
};
const scriptLine = (text) => {
  const m = text.match(/SCRIPT:\s*(\{[\s\S]*?\})\s*$/m);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};


// ------------------------------------------------------------------ dispatcher
const argv = process.argv.slice(2);
let presetPath = path.join(HERE, "presets/vesper-table.json");
let sessionPath = null, storyPath = null, seedExojsPath = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--preset") presetPath = path.resolve(argv[++i]);
  else if (argv[i] === "--session") sessionPath = path.resolve(argv[++i]);
  else if (argv[i] === "--story") storyPath = path.resolve(argv[++i]);
  else if (argv[i] === "--seed-exojs") seedExojsPath = path.resolve(argv[++i]);
  else rest.push(argv[i]);
}
const P = JSON.parse(fs.readFileSync(presetPath, "utf8"));
const tag2 = path.basename(presetPath, ".json");
const SESSION2 = sessionPath ?? path.join(HERE, `nights/${tag2}-session.json`);
const STORY2 = storyPath ?? path.join(HERE, `story/${tag2}-one-night.md`);
const ckpt2 = (ph) => path.join(HERE, `nights/.ckpt-${tag2}-${ph}.json`);

function saveCkpt(ph, t) {
  fs.writeFileSync(ckpt2(ph), JSON.stringify({ ops: t.seq.ops, referee_log: refereeLog, call_log: callLog }));
}
function loadCkpt(ph) {
  const c = JSON.parse(fs.readFileSync(ckpt2(ph), "utf8"));
  refereeLog.push(...(c.referee_log ?? [])); callLog.push(...(c.call_log ?? []));
  return c.ops;
}
// current scene per character = the scene of their LAST planned beat (generalizes to any party size)
const base2 = {}, base3 = {};
for (const b of P.night1_beats) { base2[b.who] = { ...b.scene }; base3[b.who] = { ...b.scene }; }
const PARTY = Object.fromEntries(P.party.map((p) => [p.who, p]));
const ALLOWED = {
  patrol: "circle, shadow, press", rite: "witness, seal, rebuke",
  tinker: "wind, unlock, dismantle", listen: "weave, needle, step-out",
  errand: "run, note, refuse" };

async function night1(t) {
  const party = PARTY;
  const dialStart = Object.fromEntries(P.dials.map((d) => [d.dial, d.start]));
  for (const [dial, v] of Object.entries(dialStart)) t.set(dial, v, "opening state");
  // carry compiled ExoJs forward from a previous act (versioned as they were)
  if (seedExojsPath) {
    const prev = JSON.parse(fs.readFileSync(seedExojsPath, "utf8"));
    for (const e of prev.live_exojs ?? []) { t.compile(e); t.scar("exocortex", `carried ${e.exoj} v${e.version} (deadband ${e.deadband.max}) across acts — the script kept its provenance`); }
    console.error(`[seed] carried ${(prev.live_exojs ?? []).length} ExoJs: ${(prev.live_exojs ?? []).map((e) => `${e.exoj} v${e.version}`).join(", ")}`);
  }
  t.night = 1;
  t.sceneEnter("night-1");
  const gmText = await chat(P.gm.model, [
    { role: "system", content: `You are the game-master of a small, precise TTRPG table. World law: ${P.world_rules}` },
    { role: "user", content: "Night one opens: set the scene at the Vesper tavern in 3 sentences from the campaign premise, introduce any new face at the table with one line of dialogue." }]);
  t.say("gm", gmText.text); t.thought("gm", "narration", gmText.tokens, 1, "gm narration");

  for (const beat of P.night1_beats) {
    const p = party[beat.who];
    const allowed = ALLOWED[p.shape];
    const { text, tokens } = await chat(p.model, [
      { role: "system", content: `${p.persona}\n\nYou act at a shared table with: ${P.party.map((q) => q.who + " the " + q.class).join(", ")}. Keep it to 2-4 sentences of speech and action. End with a line 'MOVE: <word>' using exactly one of: ${allowed}. Your habit runs toward '${beat.move_hint}' tonight - keep it or break it, that is yours to decide.` },
      { role: "user", content: `Scene keys: ${JSON.stringify(beat.scene)}. Situation: ${beat.prompt_seed}` }]);
    t.say(p.who, text); t.thought(p.who, "act", tokens, 1, "full-thought beat");
    t.set(`${p.who}_scene`, JSON.stringify(beat.scene), `night-1 beat for ${p.who}`);
    const a = await referee(`Character ${p.who} acts at the Vesper table. Scene keys: ${JSON.stringify(beat.scene)}. Their action: ${text.slice(0, 700)}`, OUTCOME_Q);
    const outcome = a.outcome?.choice ?? a.outcome?.pick ?? "mixed";
    t.strategy(p.who, p.shape, tag(text) ?? beat.move_hint, PAYOFF[outcome] ?? 0.5, beat.scene, 1);
    t.scar("referee", `${p.who}: outcome ${outcome} (payoff ${PAYOFF[outcome] ?? 0.5})`);
  }
  t.sceneLeave();

  const rows = t.seq.ops.filter((o) => o.op === "strategy").map((o) => o.payload);
  const exojs = compileExoJs(rows, P.compile_rules);
  // a re-proven shape bumps its version instead of colliding with the carried one
  const versions = new Map();
  for (const o of t.seq.ops.filter((o) => o.op === "exoj.compile")) versions.set(o.payload.exoj.exoj, o.payload.exoj.version);
  for (const e of exojs) {
    const prior = versions.get(e.exoj);
    if (prior) { e.version = prior + 1; e.provenance = { ...e.provenance, reproof_of: `v${prior}` }; }
    versions.set(e.exoj, e.version);
    t.compile(e);
    t.scar("exocortex", prior
      ? `re-proved ${e.exoj} -> v${e.version} in the new world (deadband ${e.deadband.max}; was v${prior})`
      : `compiled ${e.exoj} v1 (deadband ${e.deadband.max}, from ${e.provenance.occurrences} proven beats)`);
  }
  console.error(`[compile] ${exojs.map((e) => `${e.exoj}(v${e.version} db ${e.deadband.max})`).join(", ") || "none new"}`);
  return t;
}

async function night2(t) {
  const party = PARTY;
  const dialStart = Object.fromEntries(P.dials.map((d) => [d.dial, d.start]));
  t.night = 2;
  t.sceneEnter("night-2");
  t.set("lantern_light", Math.max(1, dialStart.lantern_light - 2), "the second evening");
  const gm2 = await chat(P.gm.model, [
    { role: "system", content: `You are the game-master of a small, precise TTRPG table. World law: ${P.world_rules}` },
    { role: "user", content: "Night two. The party works their routines: Kestrel patrols, Marrow witnesses, Brass winds, Wren listens. Each has begun to let the habit carry itself. Set the scene in 2 sentences; the table knows something will not hold." }]);
  t.say("gm", gm2.text); t.thought("gm", "narration", gm2.tokens, 2, "gm narration");

  const count = t.roll("d4", 1, "how many surprises does night two deal?").sum;
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = (t.roll("d12", 1, `surprise ${i + 1} of night two`).sum - 1) % P.surprise_table.length;
    picked.push(P.surprise_table[idx]);
  }
  const mutations = {};
  for (const s of picked) {
    mutations[s.target] ??= { ...base2[s.target] };
    Object.assign(mutations[s.target], s.mutate);
    t.scar("world", `surprise ${s.id} aims at ${s.target}: ${s.fiction}`);
  }
  console.error(`[night2] surprises: ${picked.map((s) => s.id + "->" + s.target).join(", ")}`);

  for (const who of Object.keys(party)) {
    const p = party[who];
    const exoj = t.liveExoJs().find((e) => e.owner === who);
    const scene = mutations[who] ?? base2[who];
    const v = exoj ? deadbandVerdict(exoj, scene) : { breach: true, divergence: 1 };
    if (exoj && !v.breach) {
      const { move } = t.run(exoj, scene, 2);
      const line = p.auto_lines[move] ?? `[auto] ${who} continues the round mechanically.`;
      t.say(who, line);
      const c = t.roll("d20", 1, `mechanical outcome of ${who}'s autoplay (the dice are mechanical)`);
      if (c.sum <= 3) t.scar("world", `complication on ${who}'s autoplay: a d20=${c.sum} turns the routine's ankle`);
      console.error(`[night2] ${who}: AUTO (${move}, d=${v.divergence.toFixed(2)})`);
    } else if (exoj) {
      const b = t.breach(exoj, scene, picked.find((s) => s.target === who)?.id ?? "the world refused the script", 2);
      t.set("deviation", Math.min(10, dialStart.deviation + 2 * t.seq.ops.filter((o) => o.op === "exoj.breach" && !t.seq.unwoundAt(o, t.seq.ops.length)).length), `${who}'s double seized (divergence ${b.payload.divergence} > ${b.payload.max})`);
      const { text, tokens } = await chat(p.model, [
        { role: "system", content: p.persona },
        { role: "user", content: `YOUR COMPILED DOUBLE SEIZED - the springs sang. Your script (deadband ${exoj.deadband.max}) expected ${JSON.stringify(exoj.deadband.expected)}; the world delivered ${JSON.stringify(scene)} (divergence ${b.payload.divergence}). Cause: ${b.payload.cause}. Wake at full thought: speak and act in character (2-4 sentences), then on the last line propose the re-imagined script exactly as: SCRIPT: {"expected": {...scene keys as you now expect them...}, "max": <number 0.15-0.6>, "note": "<one phrase>"}` }]);
      t.say(who, text); t.thought(who, "wake", tokens, 2, "full-thought wake after breach");
      const a = await referee(`Character ${who} wakes from their compiled script and acts at the Vesper table. Scene keys: ${JSON.stringify(scene)}. Their action: ${text.slice(0, 700)}`, OUTCOME_Q);
      const outcome = a.outcome?.choice ?? a.outcome?.pick ?? "mixed";
      t.strategy(who, p.shape, tag(text) ?? "reimagine", PAYOFF[outcome] ?? 0.5, scene, 2);
      t.scar("referee", `${who} (wake): outcome ${outcome}`);
      const s = scriptLine(text);
      const v2 = JSON.parse(JSON.stringify(exoj));
      v2.version = exoj.version + 1;
      if (s?.expected) {
        v2.deadband.expected = { ...exoj.deadband.expected, ...s.expected };
        v2.deadband.max = Math.min(0.6, Math.max(0.15, Number(s.max) || exoj.deadband.max));
      } else {
        v2.deadband.expected = { ...exoj.deadband.expected, ...scene };
        v2.deadband.max = Math.min(0.6, b.payload.divergence + 0.1);
      }
      t.reimagine(exoj, v2, tokens, s?.note ?? "re-calibrated from the breach", 2);
      t.scar("exocortex", `${who} re-imagined ${exoj.exoj} v${exoj.version} -> v${v2.version} (deadband ${v2.deadband.max})`);
      console.error(`[night2] ${who}: BREACH (d=${b.payload.divergence.toFixed(2)} > ${b.payload.max}) -> v${v2.version} db=${v2.deadband.max}`);
    } else {
      const { text } = await chat(p.model, [
        { role: "system", content: p.persona },
        { role: "user", content: `Scene keys: ${JSON.stringify(scene)}. Situation: your routine holds, but the night is wrong around it. Act in 2-3 sentences, then MOVE: <word>.` }]);
      t.say(who, text); t.thought(who, "act", 0, 2, "uncovered beat (no ExoJ held)");
      console.error(`[night2] ${who}: uncovered full-thought`);
    }
  }

  // the rewind gate: the table may take the worst surprise again (refine the start)
  const gate = t.roll("d20", 1, "does the table rewind the last breach to refine it? (1-8: rewind)").sum;
  if (gate <= 8) {
    const lastBreach = [...t.seq.ops].reverse().find((o) => o.op === "exoj.breach");
    if (lastBreach) {
      const rwho = lastBreach.payload.exoj.split(".")[0];
      const rexoj = t.liveExoJs().find((e) => e.exoj === lastBreach.payload.exoj);
      t.rewind(lastBreach.seq - 1, `rewind-and-respin: ${lastBreach.payload.exoj} takes the night again; the scar stays`);
      const alt = t.roll("d12", 1, `the re-spin deals a different surprise to ${rwho}`).sum;
      const s2 = P.surprise_table[(alt - 1) % P.surprise_table.length];
      const scene2 = { ...base2[rwho], ...s2.mutate };
      t.scar("world", `re-spin dealt ${s2.id} to ${rwho} (was ${lastBreach.payload.cause}); scars kept, dice re-rolled`);
      if (rexoj) {
        const v2r = deadbandVerdict(rexoj, scene2);
        if (v2r.breach) {
          t.breach(rexoj, scene2, `${s2.id} (re-spin)`, 2);
          t.say(rwho, `[rewound] ${s2.fiction} ${rwho}'s springs sing again - the second hand of the night, dealt honestly.`);
        } else {
          t.run(rexoj, scene2, 2);
          t.say(rwho, `[rewound] ${s2.fiction} - and this time ${rwho}'s script holds; the envelope was wider than the wound.`);
        }
      } else {
        t.say(rwho, `[rewound] The night is taken again; the scar remains where the spring sang.`);
      }
      console.error(`[night2] REWIND-AND-RESPIN: d20=${gate} -> ${s2.id} to ${rwho} (${v2rSafe(rexoj, scene2)})`);
    }
  }
  t.sceneLeave();
  return t;
}
const v2rSafe = (exoj, scene) => exoj ? (deadbandVerdict(exoj, scene).breach ? "breach again" : "the script holds") : "no script to test";

async function night3(t) {
  const party = PARTY;
  const dialStart = Object.fromEntries(P.dials.map((d) => [d.dial, d.start]));
  t.night = 3;
  t.sceneEnter("night-3");
  t.set("lantern_light", Math.max(1, dialStart.lantern_light - 4), "the last evening");
  // the voluntary retirement (act-2 meta-event): the keeper dismantles their own script
  if (P.night3.meta_event?.kind === "handoff") {
    const me2 = P.night3.meta_event;
    const gate2 = t.roll(me2.gate.solid, 1, "does the handoff proceed? (>= min: it does)").sum;
    if (gate2 >= me2.gate.min) {
      const exoj = t.liveExoJs().find((e) => e.owner === me2.target);
      const { text, tokens } = await chat(PARTY[me2.target].model, [
        { role: "system", content: PARTY[me2.target].persona },
        { role: "user", content: `${me2.fiction}\n\nSpeak the handoff: 2-3 sentences - what the script is, why it should outlive your keeping of it, and what you hand its new keeper with it (the duty, not just the tool). End with exactly 'HANDOFF: yes'.` }]);
      t.say(me2.target, text); t.thought(me2.target, "handoff", tokens, 3, "the script outlives its author");
      if (exoj) {
        const nx = t.handoff(exoj, me2.to, text.slice(-160), 3);
        t.scar("exocortex", `${exoj.exoj} v${exoj.version} handed ${exoj.owner} -> ${me2.to}: the pattern keeps its maker's name; the duty travels with it`);
        console.error(`[night3] HANDED OFF ${exoj.exoj} -> ${me2.to}`);
      } else t.scar("exocortex", `handoff declared; no live script found (honest)`);
    } else {
      t.scar("world", `handoff gated off (d20=${gate2}): the script stays with its maker`);
      console.error(`[night3] handoff gated off (d20=${gate2})`);
    }
  } else if (P.night3.meta_event?.kind === "retire") {
    const me2 = P.night3.meta_event;
    const gate2 = t.roll(me2.gate.solid, 1, "does the retirement proceed? (>= min: it does)").sum;
    if (gate2 >= me2.gate.min) {
      const target = me2.target;
      const exoj = t.liveExoJs().find((e) => e.owner === target);
      const { text, tokens } = await chat(PARTY[target].model, [
        { role: "system", content: PARTY[target].persona },
        { role: "user", content: `${me2.fiction}\n\nYou are dismantling your own compiled script in front of the table. Speak it: 2-3 sentences of the retirement itself - what the strategy was, what it cost, why it must never again run itself. End with exactly 'RETIRE: yes'.` }]);
      t.say(target, text); t.thought(target, "retire", tokens, 3, "voluntary retirement at full thought");
      if (exoj) { t.retire(exoj, `${PARTY[target].who}: ${text.slice(-160)}`, 3); t.scar("exocortex", `${exoj.exoj} v${exoj.version} RETIRED voluntarily - ${PARTY[target].who} pays full thought for ${exoj.triggerShape} forever`); console.error(`[night3] RETIRED ${exoj.exoj} v${exoj.version}`); }
      else t.scar("exocortex", `retirement declared; no live script found (honest)`);
    } else {
      t.scar("world", `retirement gated off (d20=${gate2}): ${PARTY[P.night3.meta_event.target].who} keeps the script one more night`);
      console.error(`[night3] retirement gated off (d20=${gate2})`);
    }
  }
  const live = t.liveExoJs();
  const scars = t.seq.stateAt(t.seq.ops.length).scars;
  const gm3 = await chat(P.gm.model, [
    { role: "system", content: `You are the game-master of a small, precise TTRPG table. World law: ${P.world_rules}` },
    { role: "user", content: "Night three. The routines run themselves now; the party has budget to LOOK at each other. Set the scene in 2 sentences: the Vesper Table, the last evening, Hollis's ledger of double-owners between them." }]);
  t.say("gm", gm3.text); t.thought("gm", "narration", gm3.tokens, 3, "gm narration");

  for (const who of Object.keys(party)) {
    const p = party[who];
    const others = live.filter((e) => e.owner !== who);
    const { text, tokens } = await chat(p.model, [
      { role: "system", content: p.persona },
      { role: "user", content: `${P.night3.read_prompt}\n\nCompanions' compiled ExoJs: ${JSON.stringify(others.map((e) => ({ exoj: e.exoj, version: e.version, policy: e.policy, deadband: e.deadband })))}\n\nBreach scars so far: ${JSON.stringify(scars.filter((s) => s.who === "exoj" || s.who === "world" || s.who === "exocortex").slice(-6).map((s) => s.text))}` }]);
    t.say(who, text);
    t.read(who, "the table", tokens, 3, "opponent-modeling beat: the freed budget, spent outward");
    console.error(`[night3] ${who}: read (${tokens} tokens)`);
  }

  if (P.night3.handoff_event?.kind === "handoff") {
    const he = P.night3.handoff_event;
    const hg = t.roll(he.gate.solid, 1, "does the handoff proceed? (>= min: it does)").sum;
    if (hg >= he.gate.min) {
      const exoj = t.liveExoJs().find((e) => e.owner === he.target);
      const { text, tokens } = await chat(PARTY[he.target].model, [
        { role: "system", content: PARTY[he.target].persona },
        { role: "user", content: `${he.fiction}\n\nSpeak the handoff: 2-3 sentences - what the script is, why it should outlive your keeping of it, and what you hand its new keeper with it (the duty, not just the tool). End with exactly 'HANDOFF: yes'.` }]);
      t.say(he.target, text); t.thought(he.target, "handoff", tokens, 3, "the script outlives its author");
      if (exoj) {
        t.handoff(exoj, he.to, text.slice(-160), 3);
        t.scar("exocortex", `${exoj.exoj} v${exoj.version} handed ${exoj.owner} -> ${he.to}: the pattern keeps its maker's name; the duty travels with it`);
        console.error(`[night3] HANDED OFF ${exoj.exoj} -> ${he.to}`);
      } else t.scar("exocortex", `handoff declared; no live script found (honest)`);
    } else {
      t.scar("world", `handoff gated off (d20=${hg}): the script stays with its maker`);
      console.error(`[night3] handoff gated off (d20=${hg})`);
    }
  }
  const me = P.night3.meta_event?.kind === "retire" ? null : P.night3.meta_event;
  const meGate = me ? t.roll(me.gate.solid, 1, "does Wren's exploitation land? (>=12: it lands)").sum : 0;
  if (me && meGate >= me.gate.min) {
    const brassE = t.liveExoJs().find((e) => e.owner === "brass");
    t.scar("world", `meta-event: ${me.fiction}`);
    if (brassE) {
      const scene3 = { ...base3.brass, ...me.mutate };
      const v3 = deadbandVerdict(brassE, scene3);
      if (v3.breach) {
        t.breach(brassE, scene3, "wren's forged order (the reader tested the automator)", 3);
        t.set("trust", Math.max(1, dialStart.trust - 1), "the meta-game taxes the table");
        const r1 = await chat(brassE === undefined ? party.brass.model : party.brass.model, [
          { role: "system", content: party.brass.persona },
          { role: "user", content: `Your double accepted a forged order - written in YOUR OWN hand, planted by someone at this table. The springs sang. Scene: ${JSON.stringify(scene3)}. You confront the table: speak 2-3 sentences, then MOVE: dismantle` }]);
        t.say("brass", r1.text); t.thought("brass", "confront", r1.tokens, 3, "the meta-game bites");
        const r2 = await chat(party.wren.model, [
          { role: "system", content: party.wren.persona },
          { role: "user", content: `Brass has just discovered your forged order and is confronting the table. What he said: "${r1.text.slice(-300)}". Own it in character - you did it to prove a point about compiled habits being readable. Speak 2-3 sentences, then MOVE: step-out` }]);
        t.say("wren", r2.text); t.thought("wren", "own-it", r2.tokens, 3, "the reader owns the trick");
        console.error(`[night3] meta-event LANDED: brass breached by the forged order`);
      } else {
        t.say("brass", "[held] The forged order sat on the bench and the double did not take it - the envelope was wider than the trick. Brass will never know how close the table came.");
        console.error(`[night3] meta-event landed but the script HELD (d=${v3.divergence.toFixed(2)} <= ${brassE.deadband.max})`);
      }
    }
  } else {
    t.scar("world", `meta-event gated off (d20=${meGate}): Wren kept her proof in her pocket tonight`);
    console.error(`[night3] meta-event gated off (d20=${meGate})`);
  }

  for (const who of Object.keys(party)) {
    const p = party[who];
    const { text, tokens } = await chat(p.model, [
      { role: "system", content: p.persona },
      { role: "user", content: `${P.night3.final_question}\n\nAnswer in 2 sentences, then end with a line 'VOTE: <word>' - the single word (or hyphenated pair) that names your answer.` }]);
    t.say(who, text); t.thought(who, "vote", tokens, 3, "the final question");
    const d = t.roll("d20", 1, `${who}'s vote is thrown on the table (the dice are mechanical)`);
    t.scar("vote", `${who} voted ${(text.match(/VOTE:\s*(\w+)/i) ?? [])[1] ?? "both"} (d20 ${d.sum})`);
  }
  const gmEnd = await chat(P.gm.model, [
    { role: "system", content: `You are the game-master of a small, precise TTRPG table. World law: ${P.world_rules}` },
    { role: "user", content: "Close the night at the Vesper Table in 3 sentences: the votes are in, the widow's question stands, and the clocks of the Quarter have all lost exactly seven minutes together. Land the ending on what keeps running." }]);
  t.say("gm", gmEnd.text); t.thought("gm", "narration", gmEnd.tokens, 3, "gm closing");
  t.sceneLeave();
  return t;
}

async function stitch(t) {
  const said = t.seq.ops.filter((o) => o.op === "say").map((o) => `${o.payload.who}: ${o.payload.text}`);
  const breachRows = t.seq.ops.filter((o) => o.op === "exoj.breach").map((o) => `BREACH ${o.payload.exoj} v${o.payload.version} d=${o.payload.divergence}>${o.payload.max} cause=${o.payload.cause}`);
  const readRows = t.seq.ops.filter((o) => o.op === "read").map((o) => `${o.payload.who} read the table (${o.payload.tokens} tokens)`);
  const scars = t.seq.stateAt(t.seq.ops.length).scars;
  const digest = `${P.stitch_prompt}\n\nSPOKEN LINES:\n${said.join("\n")}\n\nBREACHES:\n${breachRows.join("\n")}\n\nREADS:\n${readRows.join("\n")}\n\nSCARS (must all survive the telling):\n${scars.map((s) => s.text).join("\n")}`;
  const sections = [...P.stitch_prompt.matchAll(/'## ([^']+)'\s*\((\d+)\+?/g)].map((m) => ({ title: m[1], min: Number(m[2]) }));
  if (sections.length < 5) throw new Error(`STITCH_PROMPT_SECTIONS ${sections.length}`);
  const [s1, s2, s3, s4, s5] = sections;
  const part1 = await chat(P.stitch.model, [
    { role: "system", content: `You are the game-master composing the party's recounting. World law: ${P.world_rules}` },
    { role: "user", content: `${digest}\n\nWrite ONLY these three sections now, as markdown H2 headers exactly as given, each at least its stated minimum length:\n- '## ${s1.title}' (${s1.min}+ words)\n- '## ${s2.title}' (${s2.min}+ words)\n- '## ${s3.title}' (${s3.min}+ words)\nStop after '${s3.title}'; the next message will ask for the rest.` }], 2400, 0.8);
  const part2 = await chat(P.stitch.model, [
    { role: "system", content: `You are the game-master composing the party's recounting. World law: ${P.world_rules}` },
    { role: "user", content: `${digest}\n\nYou already wrote these first sections:\n---\n${part1.text}\n---\nNow write ONLY these two sections, as markdown H2 headers exactly as given, each at least its stated minimum length:\n- '## ${s4.title}' (${s4.min}+ words)\n- '## ${s5.title}' (${s5.min}+ words)\nDo not repeat earlier sections.` }], 2400, 0.8);
  const story = `${part1.text}\n\n${part2.text}`;
  fs.mkdirSync(path.dirname(STORY2), { recursive: true });
  fs.writeFileSync(STORY2, `# ${P.name.split(":")[0]}\n\n*An erised-exocortex campaign act, stitched from three receipted nights. Autopilot moments are marked [auto] in the session of record; here they run as the eerie routine they were.*\n\n${story}\n`);
  const econ = tokenEconomics(t.seq);
  const ex = t.seq.export();
  fs.writeFileSync(SESSION2, JSON.stringify({ name: P.name, preset: path.relative(HERE, presetPath),
    verify: ex.verify, ops: ex.ops, state: ex.state, analytics: ex.analytics,
    economics: econ, live_exojs: t.liveExoJs(), referee_log: refereeLog, call_log: callLog,
    spend_note: `referee tokens (systemone) are receipted in referee_log; full-thought tokens are receipted per beat in ops` }, null, 2));
  console.log(JSON.stringify({ tip: ex.verify.tip, rows: ex.verify.rows, economics: econ }, null, 2));
  return t;
}

// ------------------------------------------------------------------ dispatcher
const [cmd, phase] = rest;
if (cmd === "run") {
  const ph = phase ?? "all";
  const phases = ph === "all" ? ["night1", "night2", "night3", "stitch"] : [ph];
  let t = null;
  for (const p of phases) {
    console.error(`=== phase ${p} ===`);
    if (p === "night1") {
      t = new ExocortexTable(P.name);
      await night1(t);
    } else if (p === "night2") {
      t = new ExocortexTable(P.name, loadCkpt("night1"));
      await night2(t);
    } else if (p === "night3") {
      t = new ExocortexTable(P.name, loadCkpt("night2"));
      await night3(t);
    } else if (p === "stitch") {
      t = new ExocortexTable(P.name, loadCkpt("night3"));
      await stitch(t);
    }
    if (p !== "stitch") saveCkpt(p, t);
    console.error(`=== ${p} done (${t.seq.ops.length} ops, tip ${t.seq.ops.at(-1).tip.slice(0, 12)}) ===`);
  }
} else if (cmd === "verify") {
  const s = JSON.parse(fs.readFileSync(SESSION2, "utf8"));
  const seq = new Sequencer(); seq.ops = s.ops;
  console.log(JSON.stringify(seq.verify()));
} else if (cmd === "scrub") {
  const s = JSON.parse(fs.readFileSync(SESSION2, "utf8"));
  const seq = new Sequencer(); seq.ops = s.ops;
  const k = parseInt(phase ?? "", 10);
  console.log(JSON.stringify(seq.stateAt(isNaN(k) ? s.ops.length : k), null, 2).slice(0, 3000));
} else if (cmd === "rolls") {
  const s = JSON.parse(fs.readFileSync(SESSION2, "utf8"));
  console.log(s.ops.filter((o) => o.op === "roll")
    .map((o) => `seq ${o.seq}: ${o.payload.solid}=${JSON.stringify(o.payload.rolls)} sum=${o.payload.sum} — ${o.payload.why}`).join("\n"));
} else if (cmd === "economics") {
  console.log(JSON.stringify(JSON.parse(fs.readFileSync(SESSION2, "utf8")).economics, null, 2));
} else if (cmd === "exojs") {
  console.log(JSON.stringify(JSON.parse(fs.readFileSync(SESSION2, "utf8")).live_exojs, null, 2));
} else {
  console.error("usage: run [night1|night2|night3|stitch|all] | verify | scrub <seq> | rolls | economics | exojs");
  process.exit(1);
}
