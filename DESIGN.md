# erised-exocortex — the autopilot layer for erised iterators

Zero-shot design (written before the code, fleet law). Wave 66, layer F.

## The principal's directive, quoted

> players in Erised as a TTRPG plays several nights, they start to build these
> downstream automations from strategies they have already tried and worked and
> then they are on autopilot with a deadband for surprise to reimaging there
> scripts. otherwise, they are using their token budget to look out and think
> about the game-theories of their other iterators. this is like when playing
> risk, the dice rolls are mechanical and you continue on your motion until
> surprise interrupts or concludes for the turn. they are developing an
> algorithmic autoplayer for their own behaviors and outputs just like any
> gamer-programmer stepping back from the game to automate, or the guy who
> thought of putting together components for an autopilot

## The three laws

1. **COMPILE.** A strategy that worked *repeatedly* — same trigger shape,
   positive payoff, low variance, observed across nights — is compiled into an
   **ExoJ** (exocortex job): a mechanical autoplay script. The ExoJ carries a
   trigger, a lookup-table policy (soft joints, table-not-thought), and a
   **deadband** calibrated from the observed variance of the nights it was
   learned from.
2. **DEADBAND.** While the scene state stays inside an ExoJ's envelope, the
   iterator spends **zero thought-tokens** on that beat — the ExoJ plays
   mechanically, and the platonic dice are mechanical too (the Risk law:
   *continue on your motion until surprise interrupts or the turn concludes*).
3. **INTERRUPT.** When the scene state departs the envelope — by dice twist, by
   another iterator's move, by the world — the ExoJ **seizes**: the springs
   sing, the iterator wakes at full thought, and either **re-imagines** the ExoJ
   (version bump, deadband recalibrated from the breach) or retires it. Breaches
   are **sticky** (erised scar law: a breach teaches; the scar survives rewind).

## The economics (the thesis the campaign must receipt)

Thought-tokens are the scarcest thing at the table. The exocortex does not make
them vanish — it **migrates** them:

- Night 1: everything is full-thought. Self-maintenance dominates.
- Night 2: compiled ExoJs absorb routine beats (0 tokens each). What's left is
  spent on interrupts.
- Night 3: the freed budget goes **outward** — each iterator reads the table.
  The same ledger that trained your ExoJ is readable by everyone; your compiled
  double is a *pattern others can learn*. Predictability is the price of
  automation; **getting read is the surprise that matters.**

So the receipt of record must show: thought-tokens per night FALL on routine
beats, interrupt-tokens appear only at breaches, and **table-reading tokens
RISE**. The budget migrates from self-maintenance to other-modeling. That is
the exocortex.

## What an ExoJ is

```jsonc
{
  "exoj": "kestrel.patrol",          // namespaced by owner
  "version": 2,                       // bumps on every re-imagination
  "owner": "kestrel",
  "trigger": { "place": "market", "hurt": false },   // equality pattern, my-turn
  "policy": [                         // ordered; first match wins; MECHANICAL
    { "when": { "threat": "high" }, "move": "shadow" },
    { "when": {},                    "move": "circle" }      // default
  ],
  "deadband": {
    "expected": { "stalls": 14, "drunk": true, "guards": "fountain" },
    "weights":  { "stalls": 0.5, "drunk": 0.3, "guards": 0.2 },
    "max": 0.31                        // breach above this divergence
  },
  "provenance": { "nights": [1,2], "occurrences": 4, "payoff": 0.7, "variance": 0.11 }
}
```

**Divergence metric** (the deadband evaluator): for each expected key, mismatch
cost = weight if the key is missing or the value differs; for numeric values,
normalized |a−b| / max(1, |expected|). Score = Σ costs / Σ weights ∈ [0,1].
Breach iff score > deadband.max. Deterministic, no model, no tokens.

**The compiler** (deterministic): group strategy-ledger rows by
(owner, trigger-shape); require ≥ `minOccurrences` occurrences, mean payoff ≥
`minPayoff`, and a single dominant move per observed state; emit the lookup
table, the expected envelope (per-key mode of observed scene values), and
`deadband.max = clamp(2·variance + margin, 0.15, 0.6)`. Same ledger rows in,
same ExoJs out — byte-identical, forever.

**Ledger ops** (on the vendored erised-sequencer chain — every beat is a
receipt, rewinds keep scars, dice re-derive from the tips):

| op | sticky | meaning |
|----|--------|---------|
| `strategy` | no | one observed decision: trigger-shape, move, payoff, scene keys |
| `exoj.compile` | no | an ExoJ is minted (full object in payload) |
| `exoj.run` | no | an autopilot beat: divergence ≤ max, mechanical move, 0 tokens |
| `exoj.breach` | **yes** | deadband breach: divergence, cause, the springs sang |
| `exoj.reimagine` | no | full-thought wake: new version, new deadband, tokens spent |
| `exoj.retire` | no | the ExoJ is dismantled; its strategy returns to full thought |
| `thought` | no | a full-thought beat (tokens measured from the model's own usage) |
| `read` | no | an opponent-modeling beat: who was read, tokens spent |

## The campaign — "Nights at the Vesper Table"

Three nights, four iterators on four different models (multi-model
authenticity: real characters being themselves through their skins, not one
model imagining the others):

| iterator | class | model | voice |
|----------|-------|-------|-------|
| Kestrel | ranger | Nemotron-3.5-Lightning | clipped, counts things, "never surprised twice" |
| Marrow | cleric of the Record | deepseek-chat | oath-formal, quotes ledger-liturgy |
| Brass | artificer | Hermes-3-405B | warm tinkerer, builds clockwork doubles |
| Wren | bard | Qwen3.5-397B-A17B | oblique, meta-gamer, rhymes when nervous |

GM: GLM-4.6. Referee (mechanical judgments, move adjudication, deadband
arbitration): typesafe System One (`/v1/systemone`, noul/choice/score,
calibrated).

The fiction dramatizes the mechanic: in the Clockwork Quarter of Vesper Gate a
clockmaker sells **doubles** — clockwork replicas that repeat a person's proven
habits while the person is free to watch the room. The party discovers the
city has been on autopilot for weeks: the doubles kept running after their
originals stopped coming home. Brass builds a double of Kestrel to infiltrate
(= compiling her patrol into an ExoJ). Night 2, the doubles **deviate**
(deadband breaches everywhere — the world surprises the scripts). Night 3,
Wren reads the deviation pattern and finds it *rhymes with Brass's own
compiled habits* — the doubles learn from the same ledger the party writes.
The meta-game made literal: whose script is writing whom?

## Work-product duality (fleet-table precedent)

The story is the fiction; the receipt is the fleet artifact. The same three
laws describe the fleet's own lane discipline: state-first, key-scan, and
remote==local verify are compiled ExoJs of wave-running; the DeepSeek key leak
was a deadband breach that forced a re-imagination (key-scan before AND after
push); the result-return deadline is a recurring breach that minted
receipt-of-record-first. Autopilot is not the enemy of awareness — it is what
pays for it.

## Honest scope

- Payoff numbers on the strategy ledger are referee-scored (System One choice
  with fixed criteria) — mechanical, receipted, but still an instrument of the
  table, not ground truth.
- The "token economics" are measured from model usage fields (prompt +
  completion) per full-thought call; autopilot beats cost exactly 0 by
  construction (no call is made).
- The stitch (three nights → one telling) is one GM composition pass over the
  receipted story; canon repair is receipted as `scar` ops, never silent.
