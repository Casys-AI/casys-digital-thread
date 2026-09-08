# ID01 — mass and position closure worksheet

Audience: both · Diátaxis: none · Kind: dated engineering working sheet

Observation **2026-09-08**, primary atelier, local. This is a documentary worksheet
prepared by Codex against project r674 / Thread r93. It does not alter Project or Thread
truth, select components or materials, approve a configuration, or establish flight
readiness.

## Current verdict

An all-up mass and aircraft centre of gravity cannot yet be calculated. The current
record contains a partial candidate-COTS subtotal and geometric volume/centroid evidence
for ten structural occurrences, but it does not contain physical mass for those
structures, a complete installed-item census, or a mass centre for every included item.
Blank cells below are required evidence gaps, not zeroes.

The source basis and candidate arithmetic remain in the
[propulsion and energy pre-sizing note](propulsion-energy-presizing-basis-20260908.md).
All coordinates use the persisted root convention: millimetres, right-handed frame,
front `-Y`, right `+X`.

## Canonical geometry census boundary

The current canonical root contains six child modules and 22 leaf occurrences. Ten are
structural solids; the other twelve are packaging envelopes or static proxies. This is
an exact geometry census, not an installed-item census and not a mass statement.

| Child module     | Leaf occurrences | Structural solids | Envelopes / proxies |
| ---------------- | ---------------: | ----------------: | ------------------: |
| Airframe         |                5 |                 5 |                   0 |
| ElectricalPower  |                2 |                 1 |                   1 |
| Avionics         |                3 |                 1 |                   2 |
| CameraPayload    |                2 |                 1 |                   1 |
| LandingGear      |                2 |                 2 |                   0 |
| PropulsionSystem |                8 |                 0 |                   8 |
| **Current root** |           **22** |            **10** |              **12** |

The twelve non-physical occurrences are `MotorEnvelope ×4`,
`StaticPropellerEnvelope ×4`, `BatteryReservedVolume ×1`, `AutopilotEnvelope ×1`,
`CompanionComputerEnvelope ×1` and `CameraBoardEnvelope ×1`. Their placement evidence
can seed a later packaging or position review, but none may enter `Σm` as an installed
item. The module counts are recorded in the
[geometry closeout](geometry-and-integrity-20260907.md); the exact immediate placements
remain in the controlled JSON sources under [`sources/`](sources/).

## Structural occurrence sheet

Each row is a physical structural occurrence. `r_geo,root` is a source-derived geometric
centroid after the persisted nested placements. It is not a centre of mass. No row
enters `Σm` or `Σmr` until its as-built mass is measured, or a reviewed material and
manufacturing basis makes `ρV` appropriate.

| Structural occurrence    |    Source volume | `r_geo,root` mm                       | Physical mass | Mass evidence                                 | In vehicle sum |
| ------------------------ | ---------------: | ------------------------------------- | ------------- | --------------------------------------------- | -------------- |
| CentralDeck ×1           | 29.758725684 cm³ | `(0, 0.070537, 51.500000)`            | —             | material/process or as-built weighing missing | no             |
| RadialArm rear-right ×1  |  7.919575228 cm³ | `(42.641831, 42.641831, 55.500000)`   | —             | material/process or as-built weighing missing | no             |
| RadialArm front-right ×1 |  7.919575228 cm³ | `(42.641831, -42.641831, 55.500000)`  | —             | material/process or as-built weighing missing | no             |
| RadialArm rear-left ×1   |  7.919575228 cm³ | `(-42.641831, 42.641831, 55.500000)`  | —             | material/process or as-built weighing missing | no             |
| RadialArm front-left ×1  |  7.919575228 cm³ | `(-42.641831, -42.641831, 55.500000)` | —             | material/process or as-built weighing missing | no             |
| BatteryTray ×1           | 15.520000000 cm³ | `(0, 10.000000, 28.046392)`           | —             | material/process or as-built weighing missing | no             |
| AvionicsCarrier ×1       | 19.200000000 cm³ | `(0, 0, 59.500000)`                   | —             | material/process or as-built weighing missing | no             |
| LandingSkid right ×1     | 12.800000000 cm³ | `(30.000000, 0, 21.750000)`           | —             | material/process or as-built weighing missing | no             |
| LandingSkid left ×1      | 12.800000000 cm³ | `(-30.000000, 0, 21.750000)`          | —             | material/process or as-built weighing missing | no             |
| CameraMountBracket ×1    |  6.416129212 cm³ | `(0, -28.969890, 39.440462)`          | —             | material/process or as-built weighing missing | no             |

The ten occurrence volumes sum to `128.173155808 cm³`. If, and only if, every repeated
part made from a common source later shares one reviewed effective density in `g/cm³`,
the conditional structural expression is:

`m_struct,g = 29.758725684 ρ_deck + 31.678300912 ρ_arm + 15.52 ρ_tray + 19.2 ρ_carrier + 25.6 ρ_skid + 6.416129212 ρ_bracket`.

This equation preserves the missing inputs; it supplies none. Infill, wall strategy,
inserts, coatings and manufacturing variation can make a bulk catalogue density
inappropriate. Weighing the finished occurrences is the stronger closure route.

### Conditional 6082 consistency screen — excluded from vehicle mass

The two existing single-part FEA branches label the four `RadialArm` occurrences and the
one `CameraMountBracket` occurrence with a **theoretical** EN AW-6082-T6 catalogue
idealization. That label is not an as-built material selection. The radial-arm source,
Hydro's
[EN AW-6082 technical datasheet](https://www.hydro.com/globalassets/08-about-hydro/hydro-worldwide/austria/nenzing/alloy-data-sheets/hydro-en-aw-6082.pdf),
also reports a bulk density of `2.71 g/cm³`; density was not an input needed by either
linear-static proof.

The following arithmetic is therefore a documentary consistency screen only:

| Conditional scope              |                                          Volume | Extra condition imposed for the calculation                   | Solid-equivalent mass |
| ------------------------------ | ----------------------------------------------: | ------------------------------------------------------------- | --------------------: |
| Four arms plus camera bracket  | `31.678300912 + 6.416129212 = 38.094430124 cm³` | all five occurrences use the same `2.71 g/cm³` bulk density   |     `103.235905636 g` |
| All ten structural occurrences |                             `128.173155808 cm³` | extend that same density to deck, tray, carrier and skids too |     `347.349252240 g` |

Neither result enters the vehicle ledger. The first reuses a theoretical material label
from two proof cases that explicitly disclaim as-built material; the second additionally
assigns 6082 to five source families for which the current authority assigns no material
at all. Both assume fully solid manufactured geometry and omit inserts, coatings,
fasteners and process variation. They are not lower bounds, upper bounds, mass
estimates, recommendations or evidence that the parts can be made from the named alloy.
Their useful conclusion is narrower: a catalogue density is available, but the
material/process decision and finished-part evidence needed to close G0.2 are not.

## Purchased and installed-item census

The table separates a sourced candidate mass from a selected installed occurrence. A CAD
envelope or reserved volume may supply a packaging reference, but it is not the item,
its physical mass, or its mass centre. Every `no` in the final column means “not
admitted to the arithmetic because include/exclude is not frozen”; it is not a decision
that the physical item will be absent.

| Item/category                                         |            Current mass datum | Current position datum                               | Evidence class                                                                 | In vehicle sum |
| ----------------------------------------------------- | ----------------------------: | ---------------------------------------------------- | ------------------------------------------------------------------------------ | -------------- |
| F1404 KV4600 motor ×4                                 | `9.34 g` each, cable included | four `MotorEnvelope` axes only; physical CoM absent  | official candidate catalogue; exact propeller pairing unresolved               | no             |
| F1507 KV3800 motor ×4                                 |   `15 g` each, cable included | no fitting CAD envelope; physical CoM absent         | separate official candidate; nominal T3140/M5 chain, fit unresolved            | no             |
| F35A ESC ×4                                           |                  `4.3 g` each | no CAD occurrence or installation position           | official related-product image; pairing and installation unresolved            | no             |
| Mini F45A 6S 4-in-1 ESC ×1                            |                       `9.2 g` | no CAD occurrence or installation position           | official F1507 matching-guide lead; no bench identity; firmware conflict       | no             |
| F7 35A AIO flight-controller/ESC ×1                   |                             — | no CAD occurrence or installation position           | official F1507 matching-guide lead; combined role and exact variant unresolved | no             |
| Pixhawk 6C Mini Model A Current ×1                    |                      `42.4 g` | `AutopilotEnvelope` pose only; physical CoM absent   | official technical specification, candidate                                    | no             |
| Camera Module 3 standard ×1                           |                         `4 g` | `CameraBoardEnvelope` pose only; physical CoM absent | official hardware table, candidate                                             | no             |
| Raspberry Pi Zero 2 W ×1                              |                        `12 g` | provisional `CompanionComputerEnvelope` pose only    | lower-assurance official editorial mass; installed assembly absent             | no             |
| Exact `GF3016` propeller ×4 plus attachment hardware  |                             — | static proxy axes only                               | bench label has no controlled maker/SKU/revision or interface                  | no             |
| T3140 candidate propeller ×4                          |         `2 g` each, catalogue | static proxy axes only; physical CoM absent          | exact-name bench lead; revision, inertia and installed mass absent             | no             |
| Propeller retention hardware ×4                       |                             — | —                                                    | F1507 drawing and packing show a nominal M5 chain only                         | no             |
| Selected battery plus restraint                       |                             — | reserved-volume keep-in only                         | no candidate passes both current bounded screens                               | no             |
| Holybro PM02 V3 candidate ×1                          |                          20 g | —                                                    | official candidate; no built-in PDB; not selected                              | no             |
| Holybro PM06 V2 14S candidate ×1                      |                          24 g | —                                                    | alternative with four PDB pads; height conflict; not selected                  | no             |
| Companion regulator/BEC and remaining protection      |                             — | —                                                    | absent; F35A has no BEC                                                        | no             |
| GPS, radio/telemetry and antennas                     |                             — | —                                                    | absent                                                                         | no             |
| Motor, camera, carrier, tray, skid and deck fasteners |                             — | —                                                    | holes and contact observations are not hardware                                | no             |
| Signal/power wiring, connectors and cable retention   |                             — | —                                                    | absent beyond cable explicitly included with each motor                        | no             |
| Pi storage, headers, cooling and enclosure            |                             — | —                                                    | excluded from the 12 g editorial datum                                         | no             |
| Camera CSI cable and mounting spacer                  |                             — | —                                                    | absent; current camera/bracket geometry retains a nominal gap                  | no             |
| Guards, skid pads and other protection                |                             — | —                                                    | absent                                                                         | no             |

The separate `100.96 g` strict candidate-COTS subtotal and `112.96 g` subtotal including
the lower-assurance Pi datum remain useful arithmetic checks. They are neither an all-up
mass nor a lower bound: every included item still depends on an eventual configuration
choice, while many physical categories above remain absent. The F1507, F35A, Mini F45A,
F7 AIO, PM02 and PM06 rows are mutually alternative or topology-dependent leads; none is
silently added to the original F1404-based subtotal. In particular, the F7 AIO overlaps
flight-controller and four-channel ESC roles and must not be added beside both Pixhawk
and another ESC card without a deliberate architecture decision. See the
[electrical architecture basis](electrical-power-architecture-basis-20260908.md) and
[battery packaging sensitivity](battery-packaging-sensitivity-20260908.md) before
forming a configuration subtotal.

The official T3140 card now permits the isolated conditional arithmetic `4 × 2 g = 8 g`.
Combining it only with the four F1507 motor catalogue masses gives `60 + 8 = 68 g`
before propeller nuts, other retention hardware, ESCs or wiring. The
[source-control packet](propulsion-source-control-packet-20260908.md) keeps the missing
revision, tolerance, inertia and installed-mass evidence visible; this arithmetic is not
entered in the vehicle sum.

## Completion rule

Use one row per installed occurrence with these fields:

`occurrence · quantity · configuration status · mass · mass provenance · r_k in root frame · position provenance · include/exclude rationale`.

The worksheet may report `m = Σm_k` only after every included physical item has a
non-zero sourced or measured mass and every excluded item has an explicit rationale. It
may report `r_G = Σ(m_k r_k) / Σm_k` only when every included item also has a mass
centre in the same root frame. A geometric-envelope centre must remain visibly
provisional and must not be mixed silently with measured centres of mass.

## Highest-value closure work

1. Weigh the ten finished structural occurrences, or first decide and document their
   material and manufacturing process. This closes the largest current class of unknown
   terms without adding a solver.
2. Freeze one reviewable include/exclude census for battery, exact propellers, GPS,
   radio, selected power-module/distribution topology, regulated companion power,
   harness, connectors, protection, retention and fasteners.
3. Record each selected item's installed mass centre in the root frame, especially the
   four ESCs, battery and cable routes. Do not substitute the centre of a reserved
   volume.

No CalculiX, Modelica or Chrono run closes this inventory. A solver becomes useful only
after the mass/configuration evidence exposes a specific physical question that the
registered operation can actually answer.

## Review boundary

Two bounded native Grok reviews independently audited the current source, placement and
mass ledgers. The later review returned `HOLD` on G0.2 closure and identified the
22-leaf geometry split. Codex checked the controlled placement counts, recalculated the
transformed structural centroids and retained only the documentary census and equations.
Codex later added the explicitly excluded 6082 consistency screen above from the named
catalogue density; it does not select a material or close a mass row. No component
selection, vehicle sum, CG, provider run, broad test campaign or Astra consultation was
introduced.
