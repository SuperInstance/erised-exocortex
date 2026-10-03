# erised-exocortex

**The autopilot layer for erised iterators** — iterators that play several nights
compile their proven strategies into reusable autoplay scripts (**ExoJs**), run
them with a **deadband for surprise**, spend the freed thought-budget reading
*each other*, and re-imagine their scripts when the world refuses them.

Part of the erised line: [erised](https://github.com/SuperInstance/erised) (the
mirror) · [erised-sequencer](https://github.com/SuperInstance/erised-sequencer)
(the rewindable engine, vendored unmodified @ `b8c0c3d8`) ·
[erised-fleet-table](https://github.com/SuperInstance/erised-fleet-table) (the
fleet playtest) · **this repo: the exocortex layer** (wave 66, directive layer F).

## The three laws

| law | what it says | where it lives |
|-----|--------------|----------------|
| **COMPILE** | a strategy proven across nights (same trigger shape, positive payoff, one dominant move, low variance) is compiled into an ExoJ: trigger + lookup-table policy + deadband calibrated from observed variance | `compileExoJs` — deterministic, byte-stable |
| **DEADBAND** | inside an ExoJ's envelope the beat costs **zero thought-tokens** — the script plays, the dice are mechanical (the Risk law: *continue on your motion until surprise interrupts or the turn concludes*) | `run` / `deadbandVerdict` / `divergence` |
| **INTERRUPT** | outside the envelope the ExoJ **seizes** — the springs sing — the iterator wakes at full thought and **re-imagines** (version bump, recalibrated deadband) or retires; breaches are **sticky scars** that survive rewind | `breach` / `reimagine` / `retire` |

## What an ExoJ is

```jsonc
{
  "exoj": "kestrel.patrol", "version": 2, "owner": "kestrel",
  "policy": [ { "when": { "threat": "high" }, "move": "shadow" },
              { "when": {}, "move": "circle" } ],        // first match wins; MECHANICAL
  "deadband": {
    "expected": { "stalls": 14, "drunk": true, "guards": "fountain" },
    "weights":  { "stalls": 0.5, "drunk": 0.3, "guards": 0.2 },
    "max": 0.31                                          // breach above this divergence
  },
  "provenance": { "nights": [1,2], "occurrences": 4, "payoff": 0.7, "variance": 0.11 }
}
```

Divergence = weighted key-mismatch of the actual scene vs the expected envelope,
∈ [0,1], missing keys count as full mismatch. No model, no tokens, no wall clock.

## The campaign — "Nights at the Vesper Table"

Four iterators on **four different models** (multi-model authenticity — real
characters being themselves through their skins, not one model imagining the
others): Kestrel the ranger (Nemotron-3.5-Lightning), Marrow the cleric of the
Record (deepseek-chat), Brass the artificer (Hermes-3-405B), Wren the bard
(Qwen3.5-397B-A17B). GM: GLM-4.6. Referee: typesafe System One (calibrated,
mechanical). Stitch: deepseek-chat.

The fiction dramatizes the mechanic: in the Clockwork Quarter of Vesper Gate a
clockmaker sells **doubles** — clockwork replicas that repeat a person's proven
habits while the person is free to watch the room. The city was already on
autopilot; the doubles kept running after their originals stopped coming home.
The party's own tools mirror the mechanic, and on the last night the meta-game
bites: **the reader tests the automator** (Wren forges an order in the style of
Brass's compiled habit — and the double takes it).

## The session of record — what the receipts proved

Three live nights, **178 hash-chained ops**, tip `2ba6142762cf…`, chain verifies
from genesis; every die re-derived from the ledger with its *why*.

**The token-migration curve (the thesis, receipted):**

| night | self-maintenance tokens | auto beats (0 tokens) | breaches | re-imagines | reading tokens (outward) |
|-------|------------------------|----------------------|----------|-------------|--------------------------|
| 1 — full thought | **8111** | 0 | 0 | 0 | 0 |
| 2 — autopilot + surprises | **3627** | 1 | 3 | 3 | 0 |
| 3 — the table read | **3851** | 0 | 1 | 0 | **4100** |

Self-maintenance **halved** after the compile and stayed halved; the freed
budget migrated **outward** into opponent-modeling (4,100 tokens, the largest
outward category of the session). Autopilot is not the enemy of awareness — it
is what pays for it.

**The earned surprises (all dice-dealt, all receipted):**

- Night 2's d4 dealt the **maximum four surprises**. Kestrel's wide deadband
  (0.6 — calibrated from her own payoff variance) **absorbed** the bench-double
  surprise at divergence 0.50: she kept circling while the watch left the
  fountain, for **zero tokens**. A wall that holds while the room empties is
  still a wall around nothing — the story says so, not us.
- Wren's breach came from **no dice at all**: her script expected a *curious*
  room (a deterministic tie-break of night-1 observations) and the room had
  gone *fearful* — divergence 0.33 > 0.15. The world outgrew the script.
- The rewind gate rolled 10 (no rewind) — receipted honestly; the gate was
  priced at 1-8 and the dice said play on.
- Night 3's meta-event gate rolled 13 ≥ 12: **Wren's forged order landed**,
  Brass's double took it, and the confrontation was played at full thought.

**The votes, thrown on the table (d20s are mechanical):** Kestrel 17 →
*routine* · Marrow 9 → *person* · Brass 16 → *both* · Wren 16 → *both*.
Two and two, and no clean majority, which is its own kind of record. The story:
[`story/one-night.md`](story/one-night.md).

## The work-product duality (fleet-table precedent)

The same three laws describe the fleet's own lane discipline: state-first,
key-scan, and remote==local verify are **compiled ExoJs** of wave-running —
checklists that run at zero thought once proven. The DeepSeek key leak was a
**deadband breach** that forced a re-imagination (key-scan before AND after
push, sticky ever since). The result-return deadline is a recurring breach that
minted receipt-of-record-first. When this repo's own night-1 run died silently
at a tool-call boundary, the fix was an ExoJ, not a hope: **phase checkpoints**
(a re-run restarts a phase; dice re-derive from ledger tips, so resumption is
clean by construction). Autopilot, breached, taught, re-imagined — the loop
works on us too.

## Run it

```sh
node test/pins.mjs            # 12/12 fail-first pins (no network)
node play.mjs run night1      # live: full-thought night + first compile (checkpointed)
node play.mjs run night2      # live: autopilot, dice-dealt surprises, breaches, rewind gate
node play.mjs run night3      # live: the table reads, the meta-event, the final question
node play.mjs run stitch      # live: three nights -> one telling; session of record exported
node play.mjs verify          # re-verify the chain from genesis (free)
node play.mjs rolls           # every die re-derived with provenance (free)
node play.mjs economics       # the token-migration receipt (free)
node play.mjs scrub 120       # the exact folded state at seq 120 (free)
node play.mjs exojs           # the live ExoJs at end of session (free)
```

Keys live in `/home/z/my-project/.env.keys` (chmod 600, gitignored, never
committed). `run` is the only networked command; everything else re-derives
from `nights/vesper-session.json` locally and forever.

## The viewer

```sh
node export-viewer.mjs          # precompute per-seq snapshots (no fold in the browser)
python3 -m http.server 8901     # then open http://localhost:8901/viewer.html
```

Two tabs — Act I and Act II. Scrub the ledger: dials move, ExoJs compile and
re-imagine, breaches flash red with their causes, `[auto]` lines carry the
green tag, and the token-migration bars show the thesis live: blue
(self-maintenance) falls, purple (reading outward) rises, green (auto beats)
appears where the scripts hold, red (breaches) is where the springs sang.
Frontend-only feel, backend-is-data — the browser never re-folds, so it cannot
diverge from the engine.

## Act II — "The Widow's Clause" (five voices)

```sh
node play.mjs --preset presets/vesper-act2.json --seed-exojs nights/vesper-session.json run night1
node play.mjs --preset presets/vesper-act2.json run night2
node play.mjs --preset presets/vesper-act2.json run night3
node play.mjs --preset presets/vesper-act2.json run stitch
```

A fifth voice joins (Quill, the clockmaker's apprentice — gpt-oss-20b). The
Act-I scripts carry forward with their provenance and a re-proven strategy
BUMPS its version in the changed world. What the act receipted: the wide
deadbands absorbed the act's own thesis surprises (kestrel d=0.50 twice;
marrow d=0.40 on a double asking to be witnessed — the script stopped waking
for exactly the thing the act is about); wren and quill breached and
re-imagined (v4 / v2, the same 0.433 deadband, an underlined coincidence); and
the voluntary-retirement meta-event was **gated off by a d20=1** — the dice
deferring the one thing the table planned, which became the story's spine:
*a rite that dies on schedule was never a rite; it was a policy.* The final
question (prisoner or promise) went 11/13/20/4/14 — promise, promise,
unresolved-potential, both, both — and the story: `story/vesper-act2-one-night.md`.

## Honest scope

- Payoffs are referee-scored (System One `choice` with fixed criteria) —
  mechanical and receipted, but an instrument of the table, not ground truth.
- Token counts are the models' own usage fields (prompt + completion) per call;
  autopilot beats cost exactly 0 by construction (no call is made).
- The stitch is a two-part GM composition over the receipted story; canon
  repair is receipted as `scar` ops, never silent. The story honors every
  breach number and every die.
- The compiler's tie-breaks are alphabetical-stable; Wren's "curious-room"
  breach is exactly such a tie-break — a law working as written, and the table
  chose to keep the wound rather than patch the law mid-campaign.

MIT © SuperInstance — part of the erised × platonic-randomness × quilt line,
wave 66. The world was crafted once; the fiction plays itself; and now the
players do too — until the springs sing.
