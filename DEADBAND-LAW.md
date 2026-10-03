# The Deadband Law — the genotype doc

*Missing organ #2 from `scouts/geometry-of-seeds.md` (66-e): the deadband gene
expresses in four repos with no canonical statement of what they share and what
actually varies. This is that statement. Home: erised-exocortex, which owns the
only complete implementation (compile → deadband → interrupt → reimagine).*

## The gene, stated once

> A **deadband** is a measured envelope of tolerated divergence between a
> compiled pattern's expectations and the world it runs in. Inside the
> envelope the pattern runs at zero supervision; at the boundary the keeper
> wakes; beyond it the pattern seizes and must be re-imagined or retired.

Three load-bearing properties, all four expressions share:

1. **It is calibrated from history, not authored.** The envelope's width comes
   from observed variance (exocortex: `clamp(2·σ + margin, 0.15, 0.6)`), from
   accumulated silence (jeviter), from a floor the operator once set
   (jev-quilt), from a keeper's discipline (jev-garden). No deadband is
   invented; every deadband is *priced*.
2. **Crossing it is evidence, not failure.** The breach carries its cause
   (exocortex breach receipts; jeviter's single-admission rule; jev-quilt's
   hook invocation). A breach that teaches is the gene's whole point —
   a deadband that never fires is a keeper nobody is watching.
3. **It is readable by others.** The envelope is public to anyone who can read
   the pattern's ledger. Predictability is the price of automation; **getting
   read is the surprise that matters** (the pickpocket precedent, the forged
   order, the fleet table-read's unlocked doors).

## The four expressions (one gene, inverted signs)

| expression | home | envelope source | on breach | polarity |
|------------|------|-----------------|-----------|----------|
| **exocortex** | `erised-exocortex` (`exocortex.mjs`) | observed payoff variance per compiled ExoJ | seize → wake → re-imagine (version bump) or retire; breach is a sticky scar | breach as **payoff** — surprise teaches |
| **ratchet** | `jeviter` | accumulated admissions; the threshold is alive | ONE admission, then silence forever | breach as **noise** — surprise is the enemy |
| **hook floor** | `jev-quilt` | operator-set floor under the hook | hook fires, chain continues | breach as **trigger** — surprise is a feature of the wiring |
| **keeper's discipline** | `jev-garden` | the gardener's ExoJ-borrowed vocabulary | tended, re-planted | breach as **season** — surprise is cyclical |

The variation axis, named: **what the expression believes surprise IS.**
Teaching (exocortex), noise (jeviter), signal (jev-quilt), season
(jev-garden). Same boundary-belief shape; four beliefs about what stands
outside it. The genotype is the boundary; the phenotype is the belief.

## The laws that bound all four

- **Calibration law:** a deadband set without observed history is a guess
  wearing a number; receipt its provenance or name it a guess.
- **Breach law:** every crossing is receipted with its cause; sticky where the
  keeper learns from it (erised scar law), destructive where the keeper does
  not (the ratchet is honest about this; the others should be).
- **Publicity law:** assume the envelope is readable. Price your patterns
  knowing someone is timing them (the pickpocket; the fleet table-read's
  "the dice are public").
- **Retirement law:** a pattern whose envelope must widen every night to keep
  holding is not holding — it is being paid protection. Retire it or narrow
  it; the twice-refused retirement is the cautionary myth (`vesper-act3`).

## What would make this an organ, not an essay

A shared schema for the envelope: `{expected, weights, max, provenance{}}` —
already the ExoJ wire shape — adopted as the canonical genotype; the four
homes become implementations of one interface (`divergence(state) → [0,1]`,
`verdict → {hold | seize}`). Until then this document is the genotype: copy
it, cite it, disagree with it in the wardroom.
