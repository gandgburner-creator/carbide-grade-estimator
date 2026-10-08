# UB-0 Phase 1: analytical predictions recomputed

> **Notice added 2026-10-08 (amendment A2, D2).** The map's release fraction ρ_rel is corrected to ρ\* = (1 − e²)/(2(N_c − 1) + 1 − e²), the exact mean balance of A-16 as coded (see [`UB0_DESIGN_AMENDMENT_2.md`](UB0_DESIGN_AMENDMENT_2.md) §2). This is a derivation erratum. Both outputs (`results/ub0/predictions_review-inputs.*`, `results/ub0/predictions_stage0.*`) were regenerated at 5deceda:
> - the map's ρ_rel values are 0.03069, 0.00629 and 0.00151;
> - §1b now gives T_kin/T_int = 1 under the map, and keeps the superseded design values only as an erratum record;
> - the design check classifies `map.rhoRel.*` as ERRATUM (A2): 142 values, 0 discrepancies;
> - every output carries a `map` marker (post-D2).
>
> No other value changed. The text below still quotes the earlier ρ_rel where it did so; the outputs govern.

> **Notice added 2026-10-07. The text below is unchanged from a7a1889.** The two open decisions at the end of this document are settled in [`UB0_DESIGN_AMENDMENT_1.md`](UB0_DESIGN_AMENDMENT_1.md):
> - the three values are recorded as errata, and the computed values are authoritative;
> - the wall rule is replaced.
>
> The regenerated output (`results/ub0/predictions_review-inputs.*`) now also contains:
> - the wall-regime table;
> - the bulk-limit check of the W-MF functional;
> - the errata classification;
> - section 1b, added after the G1 release-law test (see [`UB0_IMPLEMENTATION_RECORD.md`](UB0_IMPLEMENTATION_RECORD.md) §5). It gives the equipartition that the implemented release law gives with the design's ρ_rel. No earlier value changed.

**Status.** This is the Phase 1 analytical calculation for UB-0.

- It uses no Universe B simulation data.
- It is not a pre-registration.
- No Universe B code or experiment exists yet.
- The Item 1, 2 and 3 classifications are untouched.

| file | content |
|---|---|
| `src/universeB/CoarseGrainMap.ts` | the map 𝓜_{N_c} (the equations every Universe B run will be built from) |
| `src/universeB/Predictions.ts` | the analytical predictions: mean-field closure, sound band, RPA coupling, 1D wall density functional, planned-configuration windows |
| `scripts/ub0-predictions.ts` | deterministic driver; checks every number against the design review |
| `results/ub0/predictions_review-inputs.{txt,json}` | the output (equations, values, status labels, review check, wall profiles) |
| `tests/universeB.predictions.test.ts` | identities and normalisations |

Reproduce with:

```
npx tsx scripts/ub0-predictions.ts
```

It is deterministic and takes about 2 minutes.

## Inputs

The inputs are the same as the design review's. Each is labelled in the output.

- The Henderson hard-disk equation of state (an EXTERNAL benchmark), for Z and K_T,A.
- Item 2's c₀ = 2.170.
- The φ = 0.2 Couette values λ = 0.96 and μ = 0.351.
- An Enskog estimate of the collision rate.

Stage 0 replaces these with Universe A measurements at gate G3:
`npx tsx scripts/ub0-predictions.ts --inputs <stage0.json>`.

## How each number is labelled

| label | meaning |
|---|---|
| exact | follows from the parcel definition or Universe A's exact scale symmetry |
| mechanics | exact identity evaluated with a mean-field input (the wall contact theorem) |
| mean-field | the closure: k_s, P_occ, K_B, Z_B/Z_A, the Γ_self band, the c_B/c_A band, W̃, S_p(0) |
| estimate | RPA coupling measures |
| design | planned configurations and seed counts |
| input | a Universe A reference value |

No mean-field value is presented as exact.

## Result of the check against the design review (d068755)

142 printed values were recomputed.

- **133 agree:** they round to the printed value.
- **6 are rounding-level:** they differ by ≤ 1 %, from input rounding such as a collision rate of 1.29 versus 1.287.
- **3 do not round to the printed value and differ by more than 1 %.** Under the Phase 1 rule this is a stop condition, so they are reported here and left unchanged in the review.

| quantity | review | recomputed | difference | cause |
|---|---|---|---|---|
| Γ_c = u(0)/kT at N_c = 64, c_h = 2 (§2.4) | 3.7 | 3.647 | −1.4 % | double rounding in the review (3.647 → 3.65 → 3.7) |
| u(D)/kT at N_c = 4, c_h = 2 (§2.4) | 2.0 | 2.051 | +2.6 % | double rounding in the review (2.051 → 2.05 → 2.0) |
| minimum Re_δ for N_c = 16 at Ma 0.3 (§13) | 48 | 47.2 | −1.6 % | the review used c_A ≈ 2.2 and a ≈ 1.44 instead of 2.170 and 1.436 |

None of the three enters a criterion, a margin or a configuration.

## A finding that bears on the design: the wall prediction is not theory-sharp

The design review (§9.3) pre-declares a rule, which it calls **INCONCLUSIVE-THEORY**:

> "the wall verdict is INCONCLUSIVE-THEORY regardless of data if the local-density and a weighted-density hard-core functional differ by more than 20 % in the integrated excess at either N_c."

The recomputation triggers it. The integrated excess over [D/2, D/2 + 1.5h] is computed in canonical form at the run geometry, H = 10h.

| case | LDA | SDA | difference |
|---|---|---|---|
| N_c = 4, c_h = 2 | 0.128 n_b h | 0.189 n_b h | **47 %** |
| N_c = 16, c_h = 2 | 0.193 n_b h | 0.247 n_b h | **28 %** |
| N_c = 4, c_h = 4 (arm) | 0.127 n_b h | 0.161 n_b h | 27 % |

The cause is the contact layer. The contact density obeys an exact theorem; the table gives the φ-equivalent contact density.

| case | exact | LDA | SDA |
|---|---|---|---|
| plain hard wall (N_c = 1, no occupancy) | 0.314 | 0.200 | 0.309 |
| N_c = 4 | 1.025 | 0.379 | 0.926 |
| N_c = 16 | 3.871 | 0.587 | 3.085 |

The local-density approximation, which gave the review's §9.2 table, cannot represent the hard-core contact layer. The smoothed-density functional nearly satisfies the contact theorem.

So the review's wall numbers are reproduced by the review's own method. But that method is the less accurate one at the wall.

**Deviation from the design wording.** The weighted-density functional implemented here is a Nordholm-type smoothed-density approximation with a uniform disk weight of radius D. It is **not** fundamental-measure theory, which the design named in parentheses. Fundamental-measure theory is not implemented.

## What is decided and what is not

Left unchanged:

- the review's numbers and rules;
- the wall-classification rule.

Two decisions are for the user before the pre-registration is written:

1. whether to accept the three rounding-level corrections above;
2. how to treat the wall verdict, given that the pre-declared INCONCLUSIVE-THEORY condition is met.
