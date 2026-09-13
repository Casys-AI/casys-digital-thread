# ID01 — mission shape A instantiation

Audience: both · Diátaxis: none · Kind: dated engineering working sheet

Observation **2026-09-11**, primary atelier, local. Documentary worksheet only. It does
not replace Project or Thread truth, select hardware, invent a duration, or authorize
flight. F13 and F21 remain open: there is still no registered propulsion/energy
operation and no Thread publication path for this worksheet.

## Control-plane identity (quoted)

| Fact | Value | Class |
| ---- | ----- | ----- |
| Project snapshot | `inspection-drone-id01:project:r707:68cd15d339f82ab6` | quoted |
| Thread tip | r97 `project:inspection-drone-id01:r97:model-write-sensitivity-edges-run:queue-sensitivity-edges-72093069-r96-r703` | quoted |
| Approved brief | r7 `inspection-drone-id01:brief:r7:22fb5d1b598dbd41` | quoted |
| Mission shape | `short-local-facade-pass` via answer `mission-sizing-scenario-shape-r1-delegated-a` | quoted |
| Priority | `presize-before-simulations` via answer `propulsion-energy-presizing-priority-r1-confirmed` | quoted |
| Duration source | `measured-representative-workflow` via answer `mission-shape-a-duration-source-r1-delegated-measured` at project r785 | quoted |
| Inspection-pace bound | superseded: pedestrian 1.2 m/s was not a facade-inspection source | historical |
| Inspection-speed hypothesis | H1 = 2 m/s in quoted 1–3 m/s band via answer `mission-shape-a-inspection-speed-h1-r1-sourced-test` at project r789 | quoted band + estimated test point |
| Local-zone geometry | one Module 3 swath at 10 m via answer `mission-shape-a-local-zone-geometry-r1-sourced-swath` at project r791 | calculated from quoted FOV + stand-off band |
| P_prop screening | HOLD 50% ×4, not selected, via answer `mission-shape-a-pprop-hold50-r1-screen-not-select` at project r793 | quoted bench ×4 |
| Mass vs 50% `m_eq` | COTS partials 174–193 g vs 736.84 / 952.60 g via answer `mission-shape-a-mass-vs-50pct-meq-r1-cots-below` at project r795 | calculated from quoted catalogues |
| HOLD preferred lead | F1404+GF3016 screening via answer `mission-shape-a-hold-preferred-lead-r1-f1404-screen` at project r839 | HOLD, not a SKU |
| Physical weigh of 10 solids | atelier-blocked in this environment (F16) | unresolved, never 0 |

The 2026-09-08 mission-sizing sheet recorded A as recommended and unanswered against
project r675 / pending brief r5. That status is historical. Brief r7 now canonizes
shape A as `mission-sizing-screen`. B and C are not retained.

## Retained sequence

Quoted from the 2026-09-08 shape-A row. This organizes the worksheet; it is not an
operating authorization.

1. launch and climb
2. short approach
3. one local façade zone
4. direct return
5. land

Repositioning is **N/A (A)**, never zero. Shapes B and C are not instantiated here.

## Numeric mission cells

Blank / `unresolved` means no sourced or hypothesized value yet. Do not substitute
`0`, a bench row, CAD volume, the RadialArm 5 N case, or a generated video.
Hypotheses are labelled **H*** and are testable; quoted values cite the source table
below.

| Phase | Duration | Distance or height change | Air/ground speed | Wind and temperature | Propulsion operating point | Camera / compute / radio duty |
| ----- | -------- | ------------------------- | ---------------- | -------------------- | -------------------------- | ----------------------------- |
| Launch and climb | H5: 2.5 s = 5 m / 2 m/s | H3: 5 m AGL | H1: 2 m/s (weaker: same band as pass, not a climb-rate source) | envelope only, not a mission-day | H_P1404 333.12 W or H_P1507 378.28 W (HOLD 50% ×4, not a hover) | 1.785 W Pi typical |
| Short approach | H6: 4.0 s = 20 m / 5 m/s | H4: 20 m | H2: 5 m/s (mid of quoted mapping 3–8 m/s) | envelope only | same HOLD 50% screening | 1.785 W |
| One local façade zone | H7: 6.494 s = 12.988 m / 2 m/s | H8: 12.988 m along-wall | H1: 2 m/s (band 1–3 m/s) | envelope only | same HOLD 50% screening | 2.0 W USB-C viewfinder quote (includes Pi) |
| Direct return | H6: 4.0 s (symmetric with approach) | H4: 20 m | H2: 5 m/s | envelope only | same HOLD 50% screening | 1.785 W |
| Land | H5: 2.5 s (symmetric with climb) | H3: 5 m | H1: 2 m/s (same caveat as climb) | envelope only | same HOLD 50% screening | 1.785 W |
| Reserve phase | `unresolved` | N/A | N/A | envelope only | `unresolved` | `unresolved` |

Sum of hypothesized `t_i` excluding reserve: **19.494 s** (0.005415 h).
`P_prop` screening (HOLD, not selected) and incomplete `E_screen` are in
[scenario A energy leads](mission-sizing-scenario-a-energy-leads-20260911.md):
**1.814 Wh** (F1404 50% ×4) / **2.058 Wh** (F1507 50% ×4) plus ~0.01 Wh aux.
`P_loss` omitted. Nameplate Wh is not `E_usable` (F20). Gens 200 mAh keep-in pack
fails the 20.92 A current screen. Matrix stays HOLD.

`E_mission = Σ_i [(P_prop,i + P_aux,i + P_loss,i) × t_i]`

with `t_i` in hours and powers in watts. A retained F1404 50 % bench row is not an
ID01 hover or mission point.

## Sourced geometry and speed (then hypotheses)

Skill contract: inspect external sources before inventing a number; class the
evidence; pose a hypothesis; test it. A generated video is not a source. The
1.2 m/s pedestrian bound is **retired**.

Skill contract: inspect external sources before inventing a number; class the
evidence; pose a hypothesis; test it. A generated video is not a source. The
1.2 m/s pedestrian bound is **retired** (it was an unsourced assumption).

Quoted / external (inspected 2026-09-11):

| Source | What it states | Class | Use here |
| ------ | -------------- | ----- | -------- |
| [TarmacView flight-planning glossary](https://www.tarmacview.com/glossary/flight-planning-drone/), Facade Mapping Missions / Flight Speed, inspected 2026-09-11 | Facade inspection: **1–3 m/s** for detailed vertical passes. Mapping/photogrammetry typically 3–8 m/s (different mission). | quoted (industry glossary, not ID01) | band for the façade-zone hypothesis |
| Ruiz et al., *Rev. ALCONPAT* 11(1), [doi:10.21041/ra.v11i1.517](https://doi.org/10.21041/ra.v11i1.517), Table 2 flight log, Phantom 4 Pro V2.0 | Recorded flight velocity **3–10 km/h** (≈ **0.83–2.78 m/s**); several inspection-style rows at 3–4 km/h | quoted (other building, other airframe) | shows the 1–3 m/s band is occupied in a published facade survey log |
| Chen et al., *Geomatics* 2025, 5, 79, BIM-aware UAV path planning | Estimated flight time **at 2.00 m/s** (incl. hover/wind) | quoted (construction-inspection planning, not ID01) | mid-band planning point |
| Jinghong LD491 product/case page | **20 m/s** listed as aircraft flight speed | quoted, **out of scope** | max airframe speed, not a facade-pass speed. Do not use. |
| Generated demo clip | none | not evidence | discarded for G0 |
| ID01 camera geometry basis, Module 3 Standard, `α_H = 66°`, `α_V = 41°`, formula `W(d)=2 d tan(α_H/2)` | At **1.000 m**: `1.298815 m × 0.747769 m`. Scales linearly with `d`. | calculated from quoted field angles | footprint of **one local zone** at chosen stand-off |
| TarmacView Facade Mapping; THE FUTURE 3D facade guide (inspected 2026-09-11) | Distance to object **5–20 m** (TarmacView) / **5–15 m** typical, **3–5 m** detail (Future 3D). Airteam capture sheet **5–10 m**. UgCS San Lorenzo example **20 m**. | quoted | stand-off band. H-standoff = **10 m** (mid 5–15) |
| M’Nkanatha et al. 2025 building-height paper; Designs CAD 7-storey elevation note | Residential floor height typically **2.7–3.06 m**; 3 m often adopted | quoted (not ID01) | one storey ≈ 3 m. Zone height from FOV at 10 m is 7.48 m ≈ 2.5 storeys |
| UgCS vertical facade example (SPH / Brass, San Lorenzo) | Minimum height **5 m**, distance to facade **20 m** | quoted (other site, DJI M300) | H3 climb to **5 m** AGL; H4 short approach **20 m** |
| TarmacView mapping/photogrammetry speed | **3–8 m/s** typical mapping (not the facade-detail pass) | quoted | H2 transit **5 m/s** (mid-band) for approach/return only |
| EASA Open category | Height ≤ **120 m** AGL; no numeric wind cap in the Open rules | quoted regulation | ceiling, not a mission height. Wind stays an envelope, not a day |

### Hypotheses (test with the measured walk)

| Id | Statement | Class | How it is obtained | Test |
| -- | --------- | ----- | ------------------ | ---- |
| H-standoff | Optical distance to wall **10 m** | estimated | mid of 5–15 m / 5–20 m quoted bands | measure later; reject if outside 5–20 m |
| H8 | One local zone along-wall length **12.988 m** | calculated | `W(10 m) = 2×10×tan(33°) = 12.988152 m` from Module 3 `α_H`. Matches 1.298815 m × 10. | measure a real bay; reject if the walked zone is not one camera swath |
| H-zone-h | Zone height **7.478 m** | calculated | `H(10 m) = 2×10×tan(20.5°) = 7.477694 m` | same |
| H1 | Façade-zone ground-track **2 m/s** | estimated | mid of quoted 1–3 m/s; Geomatics 2.00 m/s planning | `v = s/t` on the walk; reject H1 if outside 1–3 m/s |
| H7 | Zone duration **6.494 s** | calculated | `t = 12.988152 / 2` | follows H8 and H1 |
| H3 | Climb/land height change **5 m** | quoted-as-hypothesis | UgCS example min height 5 m (above one ~3 m storey) | measure pad-to-start AGL |
| H4 | Approach/return distance **20 m** | quoted-as-hypothesis | UgCS example distance-to-facade 20 m as short-approach order of magnitude | measure pad-to-start horizontal |
| H2 | Approach/return speed **5 m/s** | estimated | mid of quoted mapping 3–8 m/s (transit, not detail pass) | measure; reject if outside 3–8 m/s |
| H5 | Climb/land duration **2.5 s** | calculated | `5 / 2` using H1 speed (climb-rate is **not** independently sourced — weakest H) | measure vertical `t` |
| H6 | Approach/return duration **4.0 s** | calculated | `20 / 5` | follows H4 and H2 |
| H9 | Camera records during the façade zone | assumed | Module 3 can record; no ID01 duty cycle sourced | log on/off |
| Envelope | Close-in inspection not in strong wind; professional go/no-go tables often 5–35 °C | estimated practice, **not a mission day** | not a cell fill | site log |

One local zone is **one Module 3 Standard swath at 10 m**, not a whole building and not a 140 m Zurich block. Steel-housing floor spans 3.5–5.5 m and Dutch plot widths ~5 m are **not** used as `s`: they describe rooms/plots, not the inspection swath.

**Test (already recorded):** `measured-representative-workflow`. Walk (or later restrained article) the five beats; log `s` and `t`; compare to the H row. Do not keep a rejected H silently.

## Still unresolved (cannot source without a selection or a policy)

- reserve policy (energy, time, or named phase — one rule) — **human**
- image **criterion** (defect size / GSD target). TarmacView quotes 0.5–1 cm/pixel for crack detection; that is a **different** question from stand-off
- site, people exclusion, **mission-day** wind/temperature/visibility
- thrust-margin criterion
- installed-item census include/exclude
- motor / propeller / ESC / battery / power-architecture — matrix `HOLD`
- battery keep-in status
- every `P_*` and therefore `E_mission` / `E_usable`
- climb **rate** as a dedicated source (H5 borrows H1)

Configuration matrix remains `HOLD`. No component is selected by this sheet.

Beat cards (optional stills, **not** a speed source):
[scenario A beats](demo/scenario-a/README.md).

## C1 after G0 (not Chrono)

Flight plant work is **not** a Chrono run. Method packet:
[C1 external 6-DoF](flight-plant-c1-external-6dof-20260911.md). PX4 SITL / Gazebo stay
external documentary evidence after sourced G0 + P1. They do not fill the cells above
and do not authorize flight.

## Capture boundary

This file may enter the ProjectSourceWorkspace as a `supporting-document`. That is
draft authoring, `grants: none`. It is not a Thread document (F21).
