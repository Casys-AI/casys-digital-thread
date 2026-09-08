# ID01 — propulsion and energy pre-sizing basis

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-08**, primary atelier, local. This document is a reversible,
documentary calculation basis prepared by Codex. It does not replace Project or Thread
truth, approve a component, authorize an operation, or establish flight readiness.

## Status and outcome

The live control plane is at project r674 / Thread r93. Question
`propulsion-energy-presizing-priority-r1` has a human-sourced answer selecting
`presize-before-simulations`. Proposed brief r5,
`inspection-drone-id01:brief:r5:7180b5c1fe7eef09`, is still **pending**; approved brief
r4 remains current.

No whole-vehicle thrust, power, current, endurance, centre-of-gravity or
operational-load result can yet be reported. The current evidence does not provide a
quantified mission, a complete mass inventory, a selected motor/propeller/ESC/battery
set, or comparable operating curves. Those states remain `unresolved`; the CAD envelopes
and the 5 N RadialArm bench case are not substituted for them.

## Evidence classes

| Class                   | Current evidence                                                                                                    | Permitted use                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Human intent            | Civil exterior camera inspection; pre-size propulsion and energy before another solver demonstration                | Orders the next work, without selecting hardware or a performance number              |
| Project observation     | Four motor occurrences; one coarse motor envelope; a static 3-inch-class propeller proxy; a battery reserved volume | Defines architecture and packaging questions only                                     |
| Primary external source | LIGPOWER F1404 product specification and bench table, inspected 2026-09-08                                          | Candidate data point, with exact variant, propeller, voltage and test caveat retained |
| Calculated              | Unit conversions, sums and equations below                                                                          | Reproducible consequences of named inputs only                                        |
| Assumption              | None accepted yet for the vehicle sizing                                                                            | Any future provisional value needs an owner and review trigger                        |

The solid `MotorEnvelope` is not a motor mass model. The `StaticPropellerEnvelope` has
no airfoil, pitch, twist, hub interface or rotation. The `BatteryReservedVolume` is not
a cell chemistry, capacity, current rating or usable energy value.

## Candidate source observation — F1404 KV4600 with GF3016

The [manufacturer page](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html)
lists several F1404 variants. For **KV4600** it reports 9.34 g including cable, diameter
17.9 mm by height 16.6 mm, 138 mΩ internal resistance, 2 mm shaft, 3–4S LiPo, 0.6 A idle
current at 10 V, 20 A peak current for 60 s, and 316 W maximum power for 60 s. These are
catalogue facts, not an ID01 selection or compatibility proof.

Two rows from the same manufacturer's KV4600 + **GF3016** bench table are retained as a
minimal traceable bracket:

| Throttle label |    Thrust | Voltage | Current |      Speed | Reported power | Efficiency |
| -------------- | --------: | ------: | ------: | ---------: | -------------: | ---------: |
| 50%            | 184.21 gf | 15.93 V |  5.23 A | 26,532 rpm |        83.28 W |  2.21 gf/W |
| 100%           | 344.73 gf | 15.64 V | 17.54 A | 40,053 rpm |       274.32 W |  1.26 gf/W |

The source labels thrust and efficiency with `g`; here it is qualified as gram-force
(`gf`), not component mass. With standard gravity it corresponds to 1.806482996 N and
3.380646454 N for the two retained thrust rows; those conversions remain bench-point
observations, not a four-rotor vehicle capability.

The table names an 8 °C ambient condition and reports 50 °C motor-surface temperature
after the 100% one-minute run. The manufacturer says its bench data are for reference
only and discourages comparison across motor types. `V × I` gives 83.3139 W and 274.3256
W for the two rows; the small differences from the reported values are consistent with
display rounding, not an independent validation.

If, and only if, four exact KV4600 motors were later selected, their catalogue mass
would sum to `4 × 9.34 g = 37.36 g` before propellers, fasteners, connectors or ESCs.
That conditional sum is not part of an approved mass budget.

The test label `GF3016` is not accompanied by an exact propeller part reference on the
LIGPOWER page. The official
[Gemfan Hurricane 3016 page](https://www.gemfanhobby.com/3016-hurricane-pc-3-blade.html)
reports a 76.49 mm diameter, 1.6 inch pitch, 1.18 g mass, 5.5 mm hub thickness,
three-hole mounting and recommended 1108–1303 motor classes, which do not include 1404.
Its leading specification block says `1.5 mm, 2 mm, 3-hole design`, while its detailed
table says only `1.5 mm, 3-hole design`. LIGPOWER specifies a 2 mm F1404 shaft and
nevertheless reports `GF3016` bench rows on that motor. A nominal 2 mm propeller variant
could match that one diameter, but the shared label does not prove the same maker, SKU,
revision or mounting variant, nor the complete shaft/hub/three-hole interface. The
literal verdict remains **identity unresolved**. The smallest closing supplier packet is
a cross-reference from the bench label to an exact propeller maker, SKU/revision and
mounting variant, plus the mating interface drawing. If the 76.49 mm diameter were later
proven to be the tested part, the same nominal layout would give 64.931356 mm between
adjacent discs and 11.755 mm radially to the deck planform.

The [F35A manufacturer page](https://www.ligpower.com/product/f35a-fpv-esc.html) is
linked as a related product and describes a 3–6S individual racing ESC with DShot and
AM32 support. A related-product link is not evidence that it is the correct ESC for ID01
or for every point in the motor table. Exact continuous/burst conditions, mass,
dimensions, efficiency, cooling, wiring and compatibility therefore remain unresolved.

## Calculated exact-row four-motor envelope

The complete KV4600 + GF3016 table permits a deterministic arithmetic screen without
interpolation. For each exact manufacturer row below:

- equivalent supported mass at static thrust balance is
  `m_equivalent = 4 × T_motor,gf / 1000`;
- summed motor current is `I_4motors = 4 × I_motor`;
- summed reported motor power is `P_4motors = 4 × P_motor,reported`.

| Manufacturer throttle label | Thrust per motor | Bench voltage | Equivalent supported mass | Four-motor current | Four-motor reported power |
| --------------------------: | ---------------: | ------------: | ------------------------: | -----------------: | ------------------------: |
|                         50% |        184.21 gf |       15.93 V |                0.73684 kg |            20.92 A |                  333.12 W |
|                         55% |        210.22 gf |       15.91 V |                0.84088 kg |            25.48 A |                  405.04 W |
|                         60% |        233.36 gf |       15.88 V |                0.93344 kg |            30.56 A |                  485.60 W |
|                         65% |        254.72 gf |       15.85 V |                1.01888 kg |            35.40 A |                  561.12 W |
|                         70% |        268.50 gf |       15.84 V |                1.07400 kg |            40.04 A |                  633.96 W |
|                         75% |        287.60 gf |       15.81 V |                1.15040 kg |            45.28 A |                  715.80 W |
|                         80% |        300.59 gf |       15.78 V |                1.20236 kg |            50.00 A |                  789.28 W |
|                         85% |        316.02 gf |       15.75 V |                1.26408 kg |            54.80 A |                  863.32 W |
|                         90% |        330.89 gf |       15.71 V |                1.32356 kg |            59.92 A |                  941.64 W |
|                         95% |        340.24 gf |       15.68 V |                1.36096 kg |            64.96 A |                 1018.16 W |
|                        100% |        344.73 gf |       15.64 V |                1.37892 kg |            70.16 A |                 1097.28 W |

These are calculated consequences of four identical candidate motors operating at the
same static bench row. They do not establish an ID01 hover point: vehicle mass and load
sharing are unresolved, and the calculation excludes ESC losses, battery sag,
auxiliaries, rotor–vehicle interaction, dynamic inflow, reserve and thrust margin. The
manufacturer throttle label is not an ID01 flight-controller command. The 100% row also
retains the source's one-minute test context and is not treated as continuous operation.

This table also exposes its own coverage boundary. A closed all-up mass below 0.73684 kg
would place symmetric static balance below the first reported row; a mass between two
listed values would require an explicitly justified interpolation or new bench data; a
mass above 1.37892 kg would exceed the four-motor maximum reported static thrust under
these exact bench conditions. None of the lower cases proves suitability, because a
propulsion margin and continuous thermal/electrical operating limits are still required.
The current partial mass ledger is too incomplete to place ID01 in any one of these
cases.

## Documented battery-candidate screen

The current `BatteryReservedVolume` is a 38 × 34 × 25 mm orthogonal placeholder. The
tray source has a 40 × 36 mm inner footprint, 32 mm wall height and a 44 × 40 × 35 mm
outer bounding box. Three official Tattu 4S pages provide candidate facts; they do not
create an ID01 battery selection.

| Candidate source                                                                                                                                       | Manufacturer nominal pack |                      Manufacturer mass state | Calculated nameplate energy | Calculated label-current screen | Reserve result              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------: | -------------------------------------------: | --------------------------: | ------------------------------: | --------------------------- |
| [R-Line 650 mAh 4S 14.8 V 95C, `TA-RL-95C-650-4S1P-XT30`](https://genstattu.com/tattu-r-line-95c-650mah-4s1p-xt30-plug-lipo-battery.html)              |           61 × 31 × 25 mm |                      82 g, page states ±20 g |    `14.8 × 0.650 = 9.62 Wh` |          `0.650 × 95 = 61.75 A` | **fail** for this candidate |
| [650 mAh 4S 15.2 V 95C LiHV long, `TA-95C-650-4S1P-HV-L-XT30`](https://genstattu.com/tattu-650mah-4s-15-2v-95c-lipo-battery-long-pack-with-xt30-plug/) |         74 × 17 × 24.5 mm |                      60 g, page states ±20 g |    `15.2 × 0.650 = 9.88 Wh` |          `0.650 × 95 = 61.75 A` | **fail** for this candidate |
| [450 mAh 4S 14.8 V 75C long, `TA-75C-450-4S1P-L-XT30`](https://genstattu.com/ta-75c-450-4s1p-l-xt30.html)                                              |           63 × 16 × 25 mm | **unresolved**: same page says 52 g and 58 g |    `14.8 × 0.450 = 6.66 Wh` |          `0.450 × 75 = 33.75 A` | **fail** for this candidate |

No permutation of any candidate's nominal dimensions fits inside 38 × 34 × 25 mm: its
largest dimension is respectively 61, 74 or 63 mm, while the reserve's largest dimension
is 38 mm. Even the pages' stated minimum length after the ±5 mm tolerance is 56, 69 or
58 mm, still greater than both the 38 mm reserve and the tray's largest 44 mm outer
dimension. This is a robust nominal orthogonal-containment failure for these three packs
only. It is not evidence that no 4S pack exists, and it ignores connector and cable
keep-outs, swelling, cooling, restraint and a manufacturing-clearance policy.

At the exact LIGPOWER F1404 KV4600 + GF3016 50% row, `4 × 83.28 W = 333.12 W`. Dividing
the three nameplate energies by that propulsion-only power gives respectively 1.733,
1.780 and 1.200 minutes. These are only `E_nameplate / P_propulsion` ratios at one
candidate bench row. They are not usable-energy values, an ID01 hover point, endurance
estimates or physical ceilings. The same boundary applies to the C-rate products above:
they are label-derived current screens, not proof of delivered current, burst duration,
thermal acceptability or safety. For context only, the four-motor 100% row sums to 70.16
A before ESC losses and auxiliaries.

The immediate design consequence is therefore narrow: the present battery reserve must
not be presented as compatible with any of these three candidates. Changing the CAD now
would still be premature. The mission duration, closed mass ledger and a reviewable
battery/propulsion candidate packet must first determine whether to enlarge or relocate
the reserve, or to source a different pack.

## Partial source-backed mass ledger

The already named candidate components allow a partial ledger. Variant identity and
source quality remain attached to every number; missing structural mass is not filled
from CAD volume.

| Candidate occurrence                                                                                                                   |               External mass evidence | Ledger treatment and exclusions                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Four LIGPOWER F1404 **KV4600** motors](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html)                                  |                 `4 × 9.34 = 37.36 g` | Manufacturer mass includes each 150 mm motor cable; parts bags, fasteners, propellers and ESCs excluded                                                                          |
| [Holybro Pixhawk 6C Mini **Model A Current**](https://docs.holybro.com/autopilot/pixhawk-6c-mini/technical-specification)              |                               42.4 g | Manufacturer technical specification for this exact variant; cables, GPS and power module inclusion is not established and they remain excluded                                  |
| [Raspberry Pi Camera Module 3 **standard**](https://www.raspberrypi.com/documentation/accessories/camera.html#hardware-specifications) |                                  4 g | Official hardware table; camera cable, mount and fasteners excluded                                                                                                              |
| [Raspberry Pi Zero 2 W](https://www.raspberrypi.com/news/what-can-you-build-with-raspberry-pi-zero/)                                   | 12 g, lower-assurance external datum | Raspberry Pi's official 2025 editorial comparison reports 12 g, but the current product page and product brief omit mass; microSD, header, cable, cooling and enclosure excluded |
| [Gemfan Hurricane 3016](https://www.gemfanhobby.com/3016-hurricane-pc-3-blade.html)                                                    |                 1.18 g per propeller | Official Gemfan candidate fact, but excluded from the configuration subtotal because identity with LIGPOWER's `GF3016` and F1404 fit remain unresolved                           |

The strict technical-specification subtotal for four motors, camera and autopilot is
`37.36 + 4 + 42.4 = 83.76 g`. Adding the lower-assurance official editorial value for
the companion board gives `95.76 g`. Conditional arithmetic with the non-fitting battery
candidates is:

| Conditional documentary subtotal         | Calculation          |                                                   Result |
| ---------------------------------------- | -------------------- | -------------------------------------------------------: |
| Named COTS plus R-Line 650 mAh 14.8 V    | `95.76 + 82`         |              177.76 g nominal; battery page states ±20 g |
| Named COTS plus 650 mAh 15.2 V LiHV long | `95.76 + 60`         |              155.76 g nominal; battery page states ±20 g |
| Named COTS plus 450 mAh 14.8 V long      | `95.76 + {52 or 58}` | 147.76 g or 153.76 g; source conflict prevents one value |

These are not candidate configurations or vehicle masses: each listed battery has
already failed the current containment screen, and the sums omit the complete airframe,
landing gear, tray, carrier, camera bracket, four ESCs, four exact propellers,
fasteners, retention, power distribution, non-motor wiring and connectors, GPS, radio,
antennas, storage and any guards or protection. Installed positions and centre of
gravity also remain unresolved.

## Current static propeller-proxy clearance screen

The captured placement basis puts the four motor centres 100 mm from the local origin at
the four cardinal positions. The current static propeller proxy has radius 38.1 mm; the
CentralDeck has a 100 mm square planform. These are geometric design hypotheses, not
selected hardware.

| Screen                                 | Calculation             | Nominal result |
| -------------------------------------- | ----------------------- | -------------: |
| Adjacent motor-centre distance         | `sqrt(100² + 100²)`     |  141.421356 mm |
| Adjacent proxy-disc edge gap           | `141.421356 − 2 × 38.1` |   65.221356 mm |
| Opposite proxy-disc edge gap           | `200 − 2 × 38.1`        |       123.8 mm |
| Radial proxy-disc to deck-planform gap | `100 − 38.1 − 50`       |        11.9 mm |

The common later 45° root rotation does not change these distances. The calculation is a
useful static packaging screen only. It excludes real blade geometry, pitch, elastic
deflection, motor-axis tolerances, shaft/hub fit, guards, nearby subsystems, airflow and
rotation. A selected propeller diameter and deformed operating envelope must replace the
proxy before any dynamic-clearance claim.

## Calculation contract

No default derating, reserve, thrust-to-weight ratio or safety factor is inserted. Each
coefficient must be sourced or approved before it becomes a number.

| Quantity                   | Equation                                                       | Required evidence before evaluation                                      |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Vehicle mass               | `m = Σ m_k`                                                    | As-built or supplier mass for every item, including wiring and fasteners |
| Weight                     | `W = m g₀`, with `g₀ = 9.80665 m/s²`                           | Closed mass inventory                                                    |
| Ideal hover thrust         | `T_hover,total = W`; for a symmetric quad, `T_hover,i = W / 4` | Mass, rotor count and justified symmetric load sharing                   |
| Thrust margin              | `Γ_T = 4 T_max,i / W`                                          | Comparable motor-propeller operating map and approved margin criterion   |
| Electrical point           | `P_e = U I`                                                    | Voltage and current measured or sourced at the same operating point      |
| Vehicle electrical power   | `P_total = Σ P_propulsion + P_avionics + P_payload + P_losses` | Simultaneous operating points and documented auxiliaries/losses          |
| Usable energy              | `E_usable = ∫ U(t) I(t) dt` over admitted battery limits       | Cell/pack curve, capacity, temperature, current and cutoff evidence      |
| Mission feasibility        | `∫ P_total(t) dt ≤ E_usable`                                   | Time-resolved mission phases and an explicitly approved reserve          |
| Centre of gravity          | `r_G = Σ(m_k r_k) / Σ m_k`                                     | Mass and installed position for every item in one coordinate frame       |
| Static propeller clearance | `c = d_motor-centres − D_propeller`                            | Exact motor placements, selected propeller diameter and tolerance policy |

The constant-power shortcut `t = E_usable / P_average` is allowed only when an
evidence-backed mission-average power is available and its limitations are recorded.
Manufacturer throttle labels are not a universal control command or an interpolation
law.

## Inputs still required

| Input packet         | Minimum content                                                                                                                            | Current state                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Mission              | Endurance target, inspection dwell, transit, reserve, wind/temperature envelope, payload duty cycle                                        | `unresolved`                                                                      |
| Mass and position    | Airframe, four propulsion units, battery, avionics, camera, wiring, fasteners and landing gear                                             | Partial COTS ledger only; total and CG `unresolved`; CAD volume is not mass       |
| Motor                | Exact variant, mass, dimensions, voltage/current/thermal limits and matching test map                                                      | F1404 KV4600 is a documented candidate only                                       |
| Propeller            | Exact maker/part, diameter, pitch, blade count, mass/inertia, hub interface and thrust/torque map                                          | `GF3016` identity/fit `unresolved`; current CAD is a proxy                        |
| ESC                  | Exact part, mass/envelope, voltage, continuous/burst current conditions, efficiency, cooling and protocol                                  | `unresolved`                                                                      |
| Battery              | Chemistry, series/parallel layout, pack mass/envelope, capacity curve, resistance, continuous/burst current, cutoff and temperature limits | Three sourced candidates fail current containment; selection remains `unresolved` |
| Payload and avionics | Actual mass, centre, voltage/current and simultaneous duty                                                                                 | camera envelope partly sourced; installed system remains `unresolved`             |
| Interfaces           | Propeller–shaft, motor–arm, ESC cooling/wiring, battery retention/connector and protection                                                 | `unresolved`                                                                      |

## Verification sequence

1. Close a source packet for one or more explicitly labelled candidate configurations.
2. Build the mass/position ledger and mission phases; preserve unknowns instead of
   silently filling them.
3. Evaluate the algebraic mass–thrust–power–energy–endurance balance with units and
   sensitivity to the still-provisional inputs.
4. Check centre of gravity, static and deformed propeller clearances, current paths,
   thermal limits and physical interfaces.
5. Derive named structural load cases from the selected operating envelope.
6. Only then select the smallest fitting verification: current CalculiX for an
   admissible single-part static question; a future modal/vibration or assembly
   extension if screening justifies it; Modelica only for an admitted closed scalar
   model; Chrono only for a prescribed mechanism question. Neither current Modelica nor
   Chrono proves propeller thrust or aircraft stability.
7. A later physical programme would separately require mass/CG measurement, a guarded
   motor-propeller thrust bench, electrical/thermal checks and progressively controlled
   prototype tests. This note authorizes none of them.

## Review boundary

Five completed native Grok consultations ran across three bounded review passes. The
first pair used a clean, repository-free sandbox for method cross-checks; after the
human explicitly requested continued Grok-native work on this project, the later reviews
read only the relevant dossier files and independently checked the full motor
arithmetic, battery screen and partial mass ledger. A separate supplier-identity run was
cancelled after a permission-classifier timeout and contributed no accepted verdict.
Codex inspected the source pages and repository facts, recalculated the values, retained
the useful equations and sequencing, and rejected three overreaches: current CAD cannot
supply physical mass or inertia without sourced material and component data,
`E_nameplate / P_bench` is not an endurance ceiling, and an official editorial mass is
not equivalent to a technical-sheet datum. Terra was used for two targeted checks:
authority order, then the unresolved propeller identity. No Astra consultation, broad
test campaign, provider execution or project confirmation was used for this note.
