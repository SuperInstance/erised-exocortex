#!/usr/bin/env node
// play.mjs — "Nights at the Vesper Table": the erised-exocortex campaign runner.
//
//   node play.mjs run            -- the live instrument: real models, real dice, real spend
//   node play.mjs verify         -- re-verify the session of record from genesis
//   node play.mjs scrub <seq>    -- the exact folded state at seq (local, free)
//   node play.mjs rolls          -- re-derive every die from genesis with provenance
//   node play.mjs economics      -- the token-migration receipt (local, free)
//   node play.mjs exojs          -- the live ExoJs at end of session
//
// Multi-model authenticity: four iterators on four different models; GM on a
// fifth; the referee is typesafe System One (calibrated, mechanical). Autopilot
// beats make NO model call — that is the thesis, and the receipts prove it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ExocortexTable, compileExoJs, tokenEconomics, divergence, deadbandVerdict } from "./exocortex.mjs";
import { Sequencer } from "./engine.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRESET = JSON.parse(fs.readFileSync(path.join(HERE, "presets/vesper-table.json"), "utf8"));
const SESSION = path.join(HERE, "nights/vesper-session.json");
const STORY = path.join(HERE, "story/one-night.md");

const env = Object.fromEntries(fs.readFileSync("/home/z/my-project/.env.keys", "utf8")
  .split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));

const ENDPOINTS = {
  deepinfra: { url: "https://api.deepinfra.com/v1/openai/chat/completions", key: env.DEEPINFRA_API_KEY },
  deepseek: { url: "https://api.deepseek.com/chat/completions", key: env.DEEPSEEK_API_KEY },
  typesafe: { url: "https://api.typesafe.ai/v1/systemone", key: env.TYPESAFE_API_KEY },
};

const callLog = [];
async function chat(model, messages, maxTokens = 400, temperature = 0.9, tries = 3) {
  const ep = ENDPOINTS.deepinfra; // all OpenAI-compatible endpoints live here by name below
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

// typesafe System One referee — mechanical, calibrated, cheap
const refereeLog = [];
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

// ------------------------------------------------------------------ the nights
async function run() {
  const t = new ExocortexTable(PRESET.name);
  const party = Object.fromEntries(PRESET.party.map((p) => [p.who, p]));
  const gm = PRESET.gm;
  const spend = { referee_tokens: 0, calls: 0 };
  const track = (u) => { spend.referee_tokens += (u?.input_tokens ?? 0) + (u?.output_tokens ?? 0); };

  const dialStart = Object.fromEntries(PRESET.dials.map((d) => [d.dial, d.start]));
  for (const [dial, v] of Object.entries(dialStart)) t.set(dial, v, `${PRESET.name}: opening state`);

  const gmCall = async (prompt, maxTokens = 320) => {
    const { text, tokens } = await chat(gm.model, [
      { role: "system", content: `You are the game-master of a small, precise TTRPG table. World law: ${PRESET.world_rules}` },
      { role: "user", content: prompt }]);
    t.say("gm", text); t.thought("gm", "narration", tokens, t.night ?? 1, "gm narration");
    return text;
  };
  const personaCall = async (p, userPrompt, night, maxTokens = 420) => {
    const { text, tokens } = await chat(p.model, [
      { role: "system", content: `${p.persona}\n\nYou act at a shared table with: ${PRESET.party.map((q) => q.who + " the " + q.class).join(", ")}. Keep it to 2-4 sentences of speech and action. End with a line 'MOVE: <word>' using exactly one of the allowed moves.` },
      { role: "user", content: userPrompt }]);
    t.thought(p.who, "act", tokens, night, "full-thought beat");
    return { text, tokens };
  };
  const score = async (who, text, scene, night) => {
    const a = await referee(`Character ${who} acts at the Vesper table. Scene keys: ${JSON.stringify(scene)}. Their action: ${text.slice(0, 700)}`, OUTCOME_Q);
    track(a.outcome?._usage);
    const outcome = a.outcome?.choice ?? a.outcome?.pick ?? "mixed";
    t.strategy(who, party[who].shape, tag(text) ?? "hold", PAYOFF[outcome] ?? 0.5, scene, night);
    t.scar("referee", `${who}: outcome ${outcome} (payoff ${PAYOFF[outcome] ?? 0.5})`);
    return outcome;
  };

  // ================= NIGHT 1 — everything full-thought =================
  t.night = 1;
  t.sceneEnter("night-1");
  await gmCall("Night one opens the job: the party has taken a missing-persons commission that led them to Master Alabaster Hollis, the clockmaker of the Clockwork Quarter, who sells 'doubles' - clockwork replicas that repeat a person's proven habits. Set the lantern-hour scene at the Vesper tavern in 3 sentences, then give Hollis one line of welcome.");
  for (const beat of PRESET.night1_beats) {
    const p = party[beat.who];
    const allowed = { patrol: "circle, shadow, press", rite: "witness, seal, rebuke", tinker: "wind, unlock, dismantle", listen: "weave, needle, step-out" }[p.shape];
    const { text } = await personaCall(p, `Scene keys: ${JSON.stringify(beat.scene)}. Situation: ${beat.prompt_seed}`, 1);
    t.say(p.who, text); t.set(`${p.who}_scene`, JSON.stringify(beat.scene), `night-1 beat for ${p.who}`);
    await score(p.who, text, beat.scene, 1);
  }
  t.sceneLeave();

  // ================= COMPILE — the first exocortexes =================
  const rows = t.seq.ops.filter((o) => o.op === "strategy").map((o) => o.payload);
  const exojs = compileExoJs(rows, PRESET.compile_rules);
  if (!exojs.length) throw new Error("COMPILE_PRODUCED_NOTHING");
  for (const e of exojs) { t.compile(e); t.scar("exocortex", `compiled ${e.exoj} v1 (deadband ${e.deadband.max}, from ${e.provenance.occurrences} proven beats)`); }
  console.error(`[compile] ${exojs.map((e) => `${e.exoj}(db ${e.deadband.max})`).join(", ")}`);

  // night-2 base scenes (the ordinary continuation) and night-3 scenes
  const base2 = { kestrel: { stalls: 14, drunk: true, guards: "fountain", threat: "low" },
    marrow: { witnesses: 3, candle: "lit", quiet: true },
    brass: { shop: "open", order: "none", deadline: 1 },
    wren: { rumor: "doubles", crowd: "thick", mood: "fearful" } };
  const base3 = { kestrel: { stalls: 14, drunk: true, guards: "fountain", threat: "low" },
    marrow: { witnesses: 3, candle: "lit", quiet: true },
    brass: { shop: "open", order: "none", deadline: 1 },
    wren: { rumor: "doubles", crowd: "thick", mood: "fearful" } };

  // ================= NIGHT 2 — autopilot, then the springs sing =================
  t.night = 2;
  t.sceneEnter("night-2");
  t.set("lantern_light", Math.max(1, dialStart.lantern_light - 2), "the second evening");
  await gmCall("Night two. The party works their routines: Kestrel patrols, Marrow witnesses, Brass winds, Wren listens. Each has begun to let the habit carry itself. Set the scene in 2 sentences; the table knows something will not hold.");
  const count = t.roll("d4", 1, "how many surprises does night two deal?").sum;
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = (t.roll("d12", 1, `surprise ${i + 1} of night two`).sum - 1) % PRESET.surprise_table.length;
    picked.push(PRESET.surprise_table[idx]);
  }
  const mutations = {};
  for (const s of picked) {
    mutations[s.target] ??= { ...base2[s.target] };
    Object.assign(mutations[s.target], s.mutate);
    t.scar("world", `surprise ${s.id} aims at ${s.target}: ${s.fiction}`);
  }
  for (const who of Object.keys(party)) {
    const p = party[who];
    const exoj = t.liveExoJs().find((e) => e.owner === who);
    const scene = mutations[who] ?? base2[who];
    const v = exoj ? deadbandVerdict(exoj, scene) : { breach: true, divergence: 1 };
    if (exoj && !v.breach) {
      const { move } = t.run(exoj, scene, 2);
      const line = p.auto_lines[move] ?? `[auto] ${who} continues the round mechanically.`;
      t.say(who, line);
      const c = t.roll("d20", 1, `mechanical outcome of ${who}'s autoplay (Risk law: the dice are mechanical)`);
      if (c.sum <= 3) t.scar("world", `complication on ${who}'s autoplay: a d20=${c.sum} turns the routine's ankle`);
    } else if (exoj) {
      const b = t.breach(exoj, scene, picked.find((s) => s.target === who)?.id ?? "the world refused the script", 2);
      t.set("deviation", Math.min(10, dialStart.deviation + 2 * t.seq.ops.filter((o) => o.op === "exoj.breach").length), `${who}'s double seized (divergence ${b.payload.divergence} > ${b.payload.max})`);
      const { text, tokens } = await personaCall(p,
        `YOUR COMPILED DOUBLE SEIZED - the springs sang. Your script (deadband ${exoj.deadband.max}) expected ${JSON.stringify(exoj.deadband.expected)}; the world delivered ${JSON.stringify(scene)} (divergence ${b.payload.divergence}). Cause: ${b.payload.cause}. Wake at full thought: speak and act in character (2-4 sentences), then on the last line propose the re-imagined script exactly as: SCRIPT: {"expected": {...scene keys as you now expect them...}, "max": <number 0.15-0.6>, "note": "<one phrase>"}`, 2);
      t.say(who, text);
      await score(who, text, scene, 2);
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
    } else {
      const { text } = await personaCall(p, `Scene keys: ${JSON.stringify(scene)}. Situation: your routine holds, but the night is wrong around it. Act.`, 2);
      t.say(who, text); await score(who, text, scene, 2);
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
      const p = party[rwho];
      const alt = t.roll("d12", 1, `the re-spin deals a different surprise to ${rwho}`).sum;
      const s2 = PRESET.surprise_table[(alt - 1) % PRESET.surprise_table.length];
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
    }
  }
  t.sceneLeave();

  // ================= NIGHT 3 — the freed budget looks outward =================
  t.night = 3;
  t.sceneEnter("night-3");
  t.set("lantern_light", Math.max(1, dialStart.lantern_light - 4), "the last evening");
  const live = t.liveExoJs();
  const scars = t.seq.stateAt(t.seq.ops.length).scars;
  await gmCall("Night three. The routines run themselves now; the party has budget to LOOK at each other. Set the scene in 2 sentences: the Vesper Table, the last evening, Hollis's ledger of double-owners between them.");
  for (const who of Object.keys(party)) {
    const p = party[who];
    const others = live.filter((e) => e.owner !== who);
    const { text, tokens } = await chat(p.model, [
      { role: "system", content: p.persona },
      { role: "user", content: `${PRESET.night3.read_prompt}\n\nCompanions' compiled ExoJs: ${JSON.stringify(others.map((e) => ({ exoj: e.exoj, version: e.version, policy: e.policy, deadband: e.deadband })))}\n\nBreach scars so far: ${JSON.stringify(scars.filter((s) => s.who === "exoj" || s.who === "world" || s.who === "exocortex").slice(-6).map((s) => s.text))}` }]);
    t.say(who, text); t.read(who, "the table", tokens, 3, "opponent-modeling beat: the freed budget, spent outward");
  }
  // the meta-event: the reader tests the automator
  const me = PRESET.night3.meta_event;
  const meGate = t.roll(me.gate.solid, 1, "does Wren's exploitation land? (>=12: it lands)").sum;
  if (meGate >= me.gate.min) {
    const brassE = t.liveExoJs().find((e) => e.owner === "brass");
    t.scar("world", `meta-event: ${me.fiction}`);
    if (brassE) {
      const scene3 = { ...base3.brass, ...me.mutate };
      const v3 = deadbandVerdict(brassE, scene3);
      if (v3.breach) {
        t.breach(brassE, scene3, "wren's forged order (the reader tested the automator)", 3);
        t.set("trust", Math.max(1, dialStart.trust - 1), "the meta-game taxes the table");
        const brassP = party.brass;
        const r1 = await personaCall(brassP, `Your double accepted a forged order - written in YOUR OWN hand, planted by someone at this table. The springs sang. Scene: ${JSON.stringify(scene3)}. You confront the table: speak (2-3 sentences), then MOVE: dismantle`, 3);
        t.say("brass", r1.text);
        const r2 = await personaCall(party.wren, `Brass has just discovered your forged order and is confronting the table. What he said: "${r1.text.slice(-300)}". Own it in character - you did it to prove a point about compiled habits being readable. Speak (2-3 sentences), then MOVE: step-out`, 3);
        t.say("wren", r2.text);
        await score("brass", r1.text, scene3, 3);
        await score("wren", r2.text, scene3, 3);
      } else {
        t.say("brass", `[held] The forged order sat on the bench and the double did not take it - the envelope was wider than the trick. Brass will never know how close the table came.`);
      }
    }
  } else {
    t.scar("world", `meta-event gated off (d20=${meGate}): Wren kept her proof in her pocket tonight`);
  }
  // the final question - each speaks, each die is thrown
  for (const who of Object.keys(party)) {
    const p = party[who];
    const { text, tokens } = await chat(p.model, [
      { role: "system", content: p.persona },
      { role: "user", content: `${PRESET.night3.final_question}\n\nAnswer in 2 sentences, then end with exactly 'VOTE: routine' or 'VOTE: person' or 'VOTE: both'.` }]);
    t.say(who, text); t.thought(who, "vote", tokens, 3, "the final question");
    const d = t.roll("d20", 1, `${who}'s vote is thrown on the table (the dice are mechanical)`);
    t.scar("vote", `${who} voted ${(text.match(/VOTE:\s*(\w+)/i) ?? [])[1] ?? "both"} (d20 ${d.sum})`);
  }
  await gmCall(`Close the night at the Vesper Table in 3 sentences: the votes are in, the widow's question stands, and the clocks of the Quarter have all lost exactly seven minutes together. Land the ending on what keeps running.`);
  t.sceneLeave();

  // ================= STITCH — one night, canon repaired =================
  const said = t.seq.ops.filter((o) => o.op === "say").map((o) => `${o.payload.who}: ${o.payload.text}`);
  const breachRows = t.seq.ops.filter((o) => o.op === "exoj.breach").map((o) => `BREACH ${o.payload.exoj} v${o.payload.version} d=${o.payload.divergence}>${o.payload.max} cause=${o.payload.cause}`);
  const readRows = t.seq.ops.filter((o) => o.op === "read").map((o) => `${o.payload.who} read the table (${o.payload.tokens} tokens)`);
  const { text: story } = await chat(gm.model, [
    { role: "system", content: `You are the game-master. World law: ${PRESET.world_rules}` },
    { role: "user", content: `${PRESET.stitch_prompt}\n\nSPOKEN LINES:\n${said.join("\n")}\n\nBREACHES:\n${breachRows.join("\n")}\n\nREADS:\n${readRows.join("\n")}\n\nSCARS (must all survive the telling):\n${scars.map((s) => s.text).join("\n")}` }], 2000, 0.8);
  fs.mkdirSync(path.dirname(STORY), { recursive: true });
  fs.writeFileSync(STORY, `# Nights at the Vesper Table\n\n*An erised-exocortex campaign, stitched from three receipted nights. Autopilot moments are marked [auto] in the session of record; here they run as the eerie routine they were.*\n\n${story}\n`);

  // ================= EXPORT — the session of record =================
  fs.mkdirSync(path.dirname(SESSION), { recursive: true });
  const econ = tokenEconomics(t.seq);
  const ex = t.seq.export();
  const out = { name: PRESET.name, preset: "presets/vesper-table.json",
    verify: ex.verify, ops: ex.ops, state: ex.state, analytics: ex.analytics,
    economics: econ, live_exojs: t.liveExoJs(), referee_log: refereeLog, call_log: callLog,
    spend_note: `referee tokens (systemone): ${spend.referee_tokens}; full-thought tokens are receipted per beat in ops` };
  fs.writeFileSync(SESSION, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ tip: ex.verify.tip, rows: ex.verify.rows, economics: econ }, null, 2));
}

// ------------------------------------------------------- local, free, receipts
function load() {
  const s = JSON.parse(fs.readFileSync(SESSION, "utf8"));
  const seq = new Sequencer();
  seq.ops = s.ops;
  return { s, seq };
}
const [cmd, arg] = process.argv.slice(2);
if (cmd === "run") await run();
else if (cmd === "verify") console.log(JSON.stringify(load().s.verify));
else if (cmd === "scrub") {
  const { s } = load();
  const seqN = parseInt(arg ?? "", 10);
  const seq = new Sequencer(); seq.ops = s.ops;
  const st = seq.stateAt(isNaN(seqN) ? s.ops.length : seqN);
  console.log(JSON.stringify(st, null, 2).slice(0, 3000));
}
else if (cmd === "rolls") {
  const { s } = load();
  console.log(s.ops.filter((o) => o.op === "roll").map((o) => `seq ${o.seq}: ${o.payload.solid}=${JSON.stringify(o.payload.rolls)} sum=${o.payload.sum} — ${o.payload.why}`).join("\n"));
} else if (cmd === "economics") console.log(JSON.stringify(load().s.economics, null, 2));
else if (cmd === "exojs") console.log(JSON.stringify(load().s.live_exojs, null, 2));
else { console.error("usage: run | verify | scrub <seq> | rolls | economics | exojs"); process.exit(1); }
