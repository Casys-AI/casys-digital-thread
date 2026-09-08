# ID01 — configuration pre-selection matrix

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-08**, primary atelier, local. This matrix organizes already
recorded candidate evidence against project r674 / Thread r93. It does not select a
component, approve proposed brief r5, change CAD, queue an operation or establish flight
readiness.

Its source basis is the
[propulsion and energy note](propulsion-energy-presizing-basis-20260908.md),
[propulsion source-control packet](propulsion-source-control-packet-20260908.md),
[battery packaging sensitivity](battery-packaging-sensitivity-20260908.md),
[electrical architecture basis](electrical-power-architecture-basis-20260908.md),
[mass/position worksheet](mass-and-position-closure-worksheet-20260908.md) and
[gated verification plan](verification-and-test-plan-20260908.md). This document adds
only cross-option arithmetic and ordering.

## Current verdict

There is no closed ID01 vehicle configuration. The useful result is a **documentary
pre-selection HOLD**: two propulsion leads, several battery/tray consequences and two
power-module branches can be compared, but no current column closes identity, mass,
current, usable energy, packaging and interfaces together.

Options below are grouped by exclusive slot. They must not be multiplied into apparent
vehicle configurations. A card may become eligible only when its named blockers are
closed; `candidate`, `screen-pass` and `fits nominally` never mean `selected`.

## Exclusive option cards

| Slot                     | Card             | Evidence that may be retained                                                                                            | Blockers that remain                                                                                                                                | Consequence if later selected                                                                                                         |
| ------------------------ | ---------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Motor–propeller          | `P-F1404`        | F1404 KV4600 facts, candidate 4×M2/Ø9 base drawing and exact rows labelled `GF3016`; four motors conditionally `37.36 g` | exact propeller maker/SKU/revision and mating interface; internal 1.5-versus-2 mm shaft conflict; comparable installed map                          | preserves the current motor-envelope basis; does not preserve an unproven propeller identity                                          |
| Motor–propeller          | `P-F1507`        | F1507 KV3800 facts and exact-name T3140 rows; T3140 `3.1 × 4.0 in`, three blades, polymer, `2 g` and nominal M5 chain    | bench-to-product revision; fit/tolerance, inertia and rotation pairing; supplier limit conflict at 100%; ESC pairing                                | needs motor and propeller-envelope successors; motor-only mass adds `22.64 g`, and four T3140 catalogue items add a conditional `8 g` |
| Battery / current tray   | `B-Gens200`      | nominal and published-maximum geometry fit in at least one orientation                                                   | `6.00 A` label-current screen is below the `20.92 A` first retained F1404 four-motor row; usable energy and installed envelope                      | keep-in may remain geometrically, but this card does not pass the retained current-label screen                                       |
| Battery / tray successor | `B-GNB300-Y`     | nominal `53 × 24 × 17 mm`, `36 ± 2 g`, `4.56 Wh` nameplate arithmetic and `24.00 A` label-current screen                 | maximum dimensions, leads/restraint/service envelope, delivered-current curve, usable energy and mission point                                      | orienting 53 mm on Y requires `Δreserve,Y = 19 mm`; symmetric preserved-gap growth leaves only `1.5 mm` to the named camera footprint |
| Battery / tray successor | `B-Tattu450-75C` | nominal `63 × 16 × 25 mm`, `6.66 Wh` and `33.75 A` label arithmetic                                                      | same page reports both 52 and 58 g; installed envelope, usable energy and mission point                                                             | least nominal horizontal growth is `+25 mm` on X or `+29 mm` on Y, exceeding the named skid or camera gap respectively                |
| Battery / tray successor | `B-Tattu450-HV`  | nominal `62.32 × 16.59/16.95 × 26.7 mm`, `49 g`, `6.84 Wh` and `42.75 A` label arithmetic                                | conflicting width, large published mass tolerance, installed envelope, usable energy and mission point                                              | least nominal horizontal growth is `+24.32 mm` on X or `+28.32 mm` on Y, exceeding the named skid or camera gap respectively          |
| Battery / tray successor | `B-RLine650`     | nominal `61 × 31 × 25 mm`, `82 g`, `9.62 Wh` and `61.75 A` label arithmetic                                              | large published mass tolerance, installed envelope, usable energy and mission point; maximum height needs `+2 mm` if its long side stays horizontal | nominal long-side growth is `+23 mm` on X or `+27 mm` on Y; neither preserves the named neighbor gaps symmetrically                   |
| Battery / tray successor | `B-Tattu650-HV`  | nominal `74 × 17 × 24.5 mm`, `60 g`, `9.88 Wh` and `61.75 A` label arithmetic                                            | large published mass tolerance, installed envelope, usable energy and mission point                                                                 | nominal long-side growth is `+36 mm` on X or `+40 mm` on Y; neither preserves the named neighbor gaps symmetrically                   |
| Power path               | `E-PM02`         | SKU 15010, 20 g, analog measurement/FC supply and recorded PCB ratings                                                   | separate PDB, exact connector/harness/protection/cooling, placement and calibrated simultaneous loads                                               | adds one separate distribution slot; PM02 and PM06 must never both enter the mass sum                                                 |
| Power path               | `E-PM06`         | SKU 15019, 24 g, analog measurement/FC supply, four ESC pads and recorded PCB ratings                                    | published 5/10 mm height and 15.6/18 W conflicts; connector/harness/protection/cooling, placement and calibrated simultaneous loads                 | may remove the separate PDB slot, not the harness/protection/regulator gaps                                                           |

The battery growth values preserve the current 1 mm reserve-to-inner lateral gap and 2
mm tray walls. A symmetric X growth consumes the total 6 mm skid-gap budget; a symmetric
Y growth consumes the total 22 mm front-camera budget. Only the nominal GNB Y
orientation stays within that one named front relation, and only by `1.5 mm`. Rearward
space, tolerance, leads, retention, cooling and dynamic clearance remain `unresolved`,
so this is not a CAD recommendation.

## Current-path compatibility screens

| Propulsion row         | Four-motor current | Battery label observations                                               | PM02 / PM06 as-sold observation                                                                | Bounded conclusion                                                                                                  |
| ---------------------- | -----------------: | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| F1404 + `GF3016`, 50%  |          `20.92 A` | GNB `+3.08 A`; 450/650 cards arithmetically above; Gens `−14.92 A`       | both PCB cards above the row; common XT60/12 AWG path only `+9.08 A` before losses/auxiliaries | useful first-row screen only; not hover or a design margin                                                          |
| F1404 + `GF3016`, 100% |          `70.16 A` | every recorded battery label-current arithmetic result is below this sum | PM02 PCB `−10.16 A`, PM06 PCB `−0.16 A`; common continuous path `−40.16 A`                     | current as-sold branches do not contain this one-minute source row; the row is not a continuous vehicle requirement |
| F1507 + T3140, 50%     |          `24.64 A` | GNB `−0.64 A`; higher-label cards remain geometry/energy candidates only | common XT60/12 AWG arithmetic margin `+5.36 A` before losses/auxiliaries                       | cannot transfer the F1404 screen or infer hover                                                                     |
| F1507 + T3140, 100%    |         `103.48 A` | every recorded battery label-current arithmetic result is below this sum | common continuous path `−73.48 A`; both PCB continuous ratings are also below                  | source endpoint also exceeds the motor page's own 60-second ratings and is not an accepted operating point          |

Catalogue C-rate multiplication is only a label-current screen. It does not establish
delivered voltage, temperature, ageing, cutoff, connector capability or usable energy.
Likewise, the shared XT60/12 AWG rating is one as-sold path statement; it does not
assign separate limits to contacts, wire and termination.

## Mass ledger without false closure

One card per exclusive slot may enter this conditional expression:

`m_recorded,conditional = m_motor-card + 17.2 g_ESC + 42.4 g_Pixhawk + 4 g_camera + [12 g_Pi] + m_power-card + m_battery-card`.

The square-bracket Pi term is lower-assurance editorial evidence and omits its storage,
headers, cooling and enclosure. `m_power-card` is either 20 g for PM02 or 24 g for PM06,
never both. `m_battery-card` is at most one exact battery mass. The expression still
excludes structural mass, propellers and attachment hardware, battery restraint,
separate PDB when PM02 is used, companion regulator, GPS/radio/antennas, remaining
harness/connectors/protection, fasteners, guards and skid pads.

The already recorded F1404 partial subtotals are `100.96 g` without Pi and `112.96 g`
with its 12 g datum. Replacing only the four-motor mass term by the F1507 datum gives
conditional partial arithmetic of `123.60 g` and `135.60 g`. That substitution does not
prove F35A compatibility or form a vehicle configuration. None of these numbers is an
all-up mass or a lower bound, and none can produce CG while installed mass centres
remain missing.

The T3140 catalogue adds a separate conditional `4 × 2 = 8 g` propeller datum to the
F1507 lead. It is not inserted into the partial vehicle subtotal because the exact bench
revision, installed retention hardware and configuration decision remain open.

## Decision order

1. Keep approved brief r4 current and proposed r5 pending until the human reviews the
   mission, reserve, thrust-margin and keep-in decisions.
2. Close one exact motor–propeller–ESC source packet and the complete installed-item
   census.
3. Close mass/position sufficiently to locate the required thrust and current region.
4. Compare battery usable energy and current at that region; only then decide whether
   the keep-in is hard or a successor tray is justified.
5. Select one complete power topology and add its missing physical occurrences.
6. Only after those decisions, create source successors and run the proportionate G1/G2
   verification work.

No current option reaches step 4 without an unresolved input. This ordering avoids
redesigning the tray for a pack that later fails the mission or redesigning the motor
interface for a bench lead that lacks a controlled propeller packet.

## Review boundary

In the original pre-selection pass, three of four bounded native Grok 4.6 read-only
reviews completed; the propulsion review exceeded its bounded workflow and was stopped,
so none of its unfinished output was accepted. A later four-way source-control pass
audited F1404, T3140, `GF3016`, and F1507/T3140 and all four completed. Codex
independently inspected the official drawings and T3140 specification, recomputed the
geometry, current and mass arithmetic, and retained the unresolved supplier states. No
Astra or Terra escalation, component selection, CAD edit, Project/Thread mutation,
provider run or broad test campaign occurred in that source-control pass.
