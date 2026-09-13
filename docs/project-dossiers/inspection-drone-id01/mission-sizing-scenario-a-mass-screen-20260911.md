# ID01 — scenario A mass vs 50% equivalent-supported-mass screen

Audience: both · Diátaxis: none · Kind: dated engineering working sheet

Observation **2026-09-11**, primary atelier, local. Documentary G0 only. Does not select
a SKU, weigh structure, close CG, seal Thread mass (F13/F16/F21), or authorize flight.
Configuration matrix stays **HOLD**. The 6082 density arithmetic stays **excluded** from
the vehicle sum.

Companions:
[mass worksheet](mass-and-position-closure-worksheet-20260908.md),
[energy basis](propulsion-energy-presizing-basis-20260908.md),
[energy leads](mission-sizing-scenario-a-energy-leads-20260911.md).

## Quoted equivalent supported mass (static bench, four motors)

From the energy basis, `m_eq = 4 × T_motor,gf / 1000`. Not hover, not AUW, not Γ_T.

| HOLD lead | 50% `m_eq` | 100% `m_eq` | Class | Use |
| --------- | ---------: | ----------: | ----- | --- |
| F1404 KV4600 + GF3016 | **0.73684 kg** (736.84 g) | 1.37892 kg | calculated from quoted thrust | screening ceiling for H_P1404 |
| F1507 KV3800 + T3140 | **0.95260 kg** (952.60 g) | 2.69532 kg | calculated from quoted thrust | screening ceiling for H_P1507 |

100% remains a 60 s peak row, not a mission point.

## Quoted candidate-COTS partials (not in `Σm`)

Reused from the mass worksheet / energy basis. Include/exclude is **not** frozen;
every row is still `no` in the vehicle sum.

| Partial (mutually alternative topologies) | Mass | Class | Notes |
| ----------------------------------------- | ---: | ----- | ----- |
| F1404×4 + F35A×4 + Pixhawk 6C Mini + Camera Module 3 | 100.96 g | calculated from quoted catalogues | energy basis: `37.36+17.2+42.4+4` |
| same + Pi Zero 2 W editorial 12 g | 112.96 g | calculated; Pi is lower-assurance | |
| F1404 path + PM06 24 g + Micro M10 14 g + SiK 23.5 g (no battery, no structure) | **174.46 g** | calculated from quoted candidates | **H_COTS_A** screening partial |
| F1507×4 + T3140×4 + Mini F45A + Pixhawk + camera + Pi | 135.60 g | calculated | energy basis 123.60 g without Pi |
| F1507 path + PM02 20 g + Micro M10 + SiK | **193.10 g** | calculated | **H_COTS_B** |
| Gens ace 200 mAh catalogue 22 g | +22 g | quoted, **fails 20.92 A** current screen | not added to a selected AUW |
| Ten structural solids | `unresolved` | F16; volumes known, mass not | **never 0** |
| 6082-T6 solid-equivalent all ten (2.71 g/cm³ × 128.173 cm³) | 347.35 g | excluded consistency screen | Hydro datasheet density; **not** in `Σm` |

GF3016 propeller mass remains `unresolved` (F17). Fasteners, harness, RC, battery
restraint remain `unresolved`.

## Screen (not a hover proof)

| Comparison | COTS partial | 50% `m_eq` | Partial / `m_eq` | Headroom if structure+battery were 0 |
| ---------- | -----------: | ---------: | ---------------: | -----------------------------------: |
| H_COTS_A vs F1404 50% | 174.46 g | 736.84 g | 23.7% | 562.38 g |
| H_COTS_B vs F1507 50% | 193.10 g | 952.60 g | 20.3% | 759.50 g |
| H_COTS_A + excluded 6082 fill vs F1404 50% | 521.81 g | 736.84 g | 70.8% | 215.03 g |

**H_mass:** known sourced COTS on either HOLD path is **well below** that path’s 50%
equivalent-supported-mass. Adding the **excluded** solid-6082 fill still stays below
both 50% rows. Therefore the 50% `P_prop` screen is **not contradicted** by “COTS already
heavier than static thrust”. It is also **not confirmed**: structure, battery, harness
and GF3016 mass are missing (F16/F17/F20). Γ_T = 4T/W is **not** reported — W is not
closed.

Do not treat 174.46 g as AUW or as a lower bound (missing categories can add hundreds of
grams). Do not fill structural mass with `0`. Do not select 6082.

## Test

Weigh the ten finished structural occurrences (mass worksheet closure #1), or a reviewed
ρV after a material/process decision. Then recompute partial+structure vs 736.84 g /
952.60 g. If the closed `Σm` exceeds 736.84 g, **reject** H_P1404 as a static-balance
screen (move to a higher tabulated row only with a new sourced map — do not interpolate
silently). If `Σm` exceeds 952.60 g, reject H_P1507 the same way.

## Still not in the vehicle sum

All-up mass, CG, thrust margin criterion, `E_usable`, reserve, SKU selection.
