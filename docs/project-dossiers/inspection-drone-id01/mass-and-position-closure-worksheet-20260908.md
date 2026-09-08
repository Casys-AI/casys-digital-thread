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

## Purchased and installed-item census

The table separates a sourced candidate mass from a selected installed occurrence. A CAD
envelope or reserved volume may supply a packaging reference, but it is not the item,
its physical mass, or its mass centre.

| Item/category                                         |            Current mass datum | Current position datum                               | Evidence class                                                      | In vehicle sum |
| ----------------------------------------------------- | ----------------------------: | ---------------------------------------------------- | ------------------------------------------------------------------- | -------------- |
| F1404 KV4600 motor ×4                                 | `9.34 g` each, cable included | four `MotorEnvelope` axes only; physical CoM absent  | official candidate catalogue; exact propeller pairing unresolved    | no             |
| F1507 KV3800 motor ×4                                 |   `15 g` each, cable included | no fitting CAD envelope; physical CoM absent         | separate official candidate; T3140 bench name, interface unresolved | no             |
| F35A ESC ×4                                           |                  `4.3 g` each | no CAD occurrence or installation position           | official related-product image; pairing and installation unresolved | no             |
| Pixhawk 6C Mini Model A Current ×1                    |                      `42.4 g` | `AutopilotEnvelope` pose only; physical CoM absent   | official technical specification, candidate                         | no             |
| Camera Module 3 standard ×1                           |                         `4 g` | `CameraBoardEnvelope` pose only; physical CoM absent | official hardware table, candidate                                  | no             |
| Raspberry Pi Zero 2 W ×1                              |                        `12 g` | provisional `CompanionComputerEnvelope` pose only    | lower-assurance official editorial mass; installed assembly absent  | no             |
| Exact propeller ×4 plus attachment hardware           |                             — | static proxy axes only                               | `GF3016` unresolved; T3140 mass/interface also unresolved           | no             |
| Selected battery plus restraint                       |                             — | reserved-volume keep-in only                         | no candidate passes both current bounded screens                    | no             |
| Holybro PM02 V3 candidate ×1                          |                          20 g | —                                                    | official candidate; no built-in PDB; not selected                   | no             |
| Holybro PM06 V2 14S candidate ×1                      |                          24 g | —                                                    | alternative with four PDB pads; height conflict; not selected       | no             |
| Companion regulator/BEC and remaining protection      |                             — | —                                                    | absent; F35A has no BEC                                             | no             |
| GPS, radio/telemetry and antennas                     |                             — | —                                                    | absent                                                              | no             |
| Motor, camera, carrier, tray, skid and deck fasteners |                             — | —                                                    | holes and contact observations are not hardware                     | no             |
| Signal/power wiring, connectors and cable retention   |                             — | —                                                    | absent beyond cable explicitly included with each motor             | no             |
| Pi storage, headers, cooling and enclosure            |                             — | —                                                    | excluded from the 12 g editorial datum                              | no             |
| Camera CSI cable and mounting spacer                  |                             — | —                                                    | absent; current camera/bracket geometry retains a nominal gap       | no             |
| Guards, skid pads and other protection                |                             — | —                                                    | absent                                                              | no             |

The separate `100.96 g` strict candidate-COTS subtotal and `112.96 g` subtotal including
the lower-assurance Pi datum remain useful arithmetic checks. They are neither an all-up
mass nor a lower bound: every included item still depends on an eventual configuration
choice, while many physical categories above remain absent. The F1507, PM02 and PM06
rows are mutually alternative or topology-dependent leads; none is silently added to the
original F1404-based subtotal. See the
[electrical architecture basis](electrical-power-architecture-basis-20260908.md) and
[battery packaging sensitivity](battery-packaging-sensitivity-20260908.md) before
forming a configuration subtotal.

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

One bounded native Grok review independently audited the current source, placement and
mass ledgers and returned `SHIP` for opening this worksheet without a solver. Codex
checked the placements, recalculated the transformed structural centroids and retained
only the documentary census and equations. No material density, component selection,
vehicle sum, CG, provider run, broad test campaign or Astra consultation was introduced.
