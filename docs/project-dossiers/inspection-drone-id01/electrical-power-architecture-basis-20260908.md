# ID01 — electrical power architecture basis

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-08**, primary atelier, local. This document separates sourced
component facts, derived current screens, architecture proposals and unknowns. It does
not select a battery, power module, distribution board, regulator, connector or harness;
it does not establish electrical safety or flight readiness.

## Current verdict

ID01 has no closed electrical configuration. A minimally reviewable architecture needs
one battery-side high-current path to four ESC branches, one measured battery-voltage /
current path and regulated flight-controller supply, and a separately dimensioned
companion/payload supply path. That is an architecture proposal, not evidence that the
current parts can be connected safely.

Neither of the two Holybro power-module leads closes the design as sold. PM02 V3 lacks
power distribution; PM06 V2 provides four ESC pads but has conflicting published height
and output-power fields; both ship with an XT60/12 AWG path whose published current
ratings are below both retained candidates' four-motor 100% bench sums. Neither 100% row
is an accepted vehicle operating point; the F1507/T3140 endpoint also conflicts with its
motor page's own 60-second ratings. The vehicle operating point, battery, protection,
wiring, auxiliary loads and cooling remain unresolved.

## Proposed block boundary

```text
selected 4S battery
  └─ main connector + isolation/protection [unresolved]
       └─ measured main path / current-sense plane [candidate PM02 or PM06]
            ├─ regulated flight-controller output
            │    └─ Pixhawk 6C Mini POWER1 [candidate, analog]
            │         ├─ one GNSS/compass [candidate standard or Micro M10]
            │         └─ one airborne telemetry radio [candidate SiK V3]
            ├─ four protected/distributed high-current branches
            │    └─ four individual ESCs or one four-channel ESC ── motor ×4
            │         [exclusive candidate identities unresolved]
            └─ separately regulated 5 V companion/payload branch [proposal]
                 └─ Pi Zero 2 W + camera/storage [duty unresolved]
```

PM02 V3 would require a separate distribution element downstream of its measured main
path if whole-bus current is to be observed. PM06 V2 is an alternative with four
integrated ESC power pads. They are not used together in this proposal. Whether the
companion branch lies inside the measured plane is itself unresolved. Return/reference
routing, switching, fusing, transient suppression, EMI control, cable strain relief and
failure isolation are deliberately not invented by this diagram.

The F1507 page's Mini F45A 4-in-1 matching-guide lead can occupy the shared four-channel
ESC slot only after its exact identity and limits are closed. Its F7 35A AIO lead also
contains a flight controller and therefore represents a different control architecture;
it is not inserted into this Pixhawk diagram or added beside a separate ESC card.

The diagram does not contain an RC command link. The SiK candidate is documented as a
Pixhawk-to-ground-station telemetry link and must not be silently promoted into that
safety-critical role. The exact RC architecture, receiver, antenna, power and fail-safe
policy remain separate unresolved occurrences.

The Pixhawk 6C Mini has one POWER1 port and no POWER2 port. Holybro's analog-module
comparison lists both PM02 V3 and PM06 V2 as applicable to Pixhawk 6C/6C Mini. This
supports a candidate interface class, not a completed ID01 wiring diagram or firmware
configuration.

## Candidate power-module evidence

| Candidate                                                                                 | Official facts observed                                                                                                                                                                                                                   | Derived use in this screen                                                    | Unresolved before selection                                                                                                                                  |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Holybro PM02 V3, SKU 15010](https://holybro.com/products/pm02-v3-12s-power-module)       | 2–12S; PCB 60 A continuous / 100 A burst `<60 s`; 120 A sensing; 5.2 V, 3 A max output; 20 g; analog; no built-in distribution; [comparison](https://docs.holybro.com/power-module-and-pdb/power-module-comparison) gives 25 × 25 × 10 mm | candidate battery measurement and Pixhawk supply ahead of a separate PDB      | exact placement, separate distribution, connector/harness replacement if required, cooling, protection and calibration                                       |
| [Holybro PM06 V2 14S, SKU 15019](https://holybro.com/products/micro-power-module-pm06-v2) | 2–14S; PCB 70 A continuous / 120 A burst `<60 s`; 5.2 V, 3 A max; page separately says 18 W max; 24 g; analog; four ESC distribution pads                                                                                                 | candidate integrated measurement, Pixhawk supply and four-branch distribution | `5.2 V × 3 A = 15.6 W`, not 18 W; product page says 35 × 35 × 5 mm while the comparison says 35 × 35 × 10 mm; placement, cooling, protection and calibration |
| As-sold XT60 + 12 AWG on either page                                                      | 30 A continuous / 60 A burst `<60 s`; maker instructs changing plug/wire for higher current                                                                                                                                               | limiting published element of the as-sold main path                           | actual connector pair, contacts, wire length, installation temperature, termination and protection                                                           |

The PM06 store also exposes a 10S SKU 15009 and a 14S SKU 15019; this note names the
observed 14S variant explicitly. Variant availability is commercial state, not an
engineering selection criterion.

## Candidate downstream cards

| Candidate                                                                                         | Official facts observed                                                                                                                                     | Permitted architecture role                                | Unresolved before selection                                                                                                     |
| ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Holybro PDB 60 A, SKU 18069 / 18069A](https://holybro.com/products/power-distribution-board-pdb) | explicitly for PM02/PM02D; 60 A, 120 A `<60 s`; 45 × 45 mm mounting; 18069A adds pre-soldered XT30s; no BEC stated                                          | distribution after PM02 when four individual ESCs are used | engineering mass and board envelope, per-pad limits, exact harness, cooling, retention and protection                           |
| [Holybro UBEC 5 A, SKU 15034](https://holybro.com/products/ubec-5a-3-14s)                         | 3–14S / 8–60 V input; 5.2 V at 5 A continuous; 10 A burst without duration; generic efficiency over 90%; 35 × 24 × 6.5 mm; 6.7 g; TVS and named protections | candidate separately regulated companion/payload rail      | connectors, efficiency curve, transient duration, cooling, installed input/output trace and simultaneous Pi/camera/storage duty |

These cards make three topology branches explicit. PM02 plus four individual ESCs needs
the PDB role; PM02 plus a four-in-one ESC does not add that PDB because the shared ESC
input occupies distribution; PM06 already exposes four ESC pads. PM06 plus a four-in-one
is therefore not a free combination, and F7 AIO would replace both the separate Pixhawk
and ESC cards. None of the branches yet names a battery-isolation/fuse/anti-spark
device. A bounded Holybro/AMASS source search did not identify such a lightweight
main-path SKU; that is an unresolved search result, not proof that the wider market has
no solution.

## Current-path arithmetic screen

The existing F1404 KV4600 + `GF3016` manufacturer table gives `4 × 5.23 = 20.92 A` at
its first retained 50% row and `4 × 17.54 = 70.16 A` at its 100% row. These sums exclude
ESC losses and every auxiliary load. They are static bench-row consequences, not FEA
results, measured vehicle current, hover current or a continuous mission point. The 100%
row retains the source's one-minute context.

| Published current element           | Rating used | Margin at 20.92 A | Margin at 70.16 A | Bounded interpretation                                                                   |
| ----------------------------------- | ----------: | ----------------: | ----------------: | ---------------------------------------------------------------------------------------- |
| PM02 V3 PCB continuous              |        60 A |          +39.08 A |          −10.16 A | first row passes an arithmetic nameplate screen; 100% row exceeds continuous rating      |
| PDB 60 A continuous                 |        60 A |          +39.08 A |          −10.16 A | same bounded screen; no per-pad, thermal or installed-chain qualification                |
| PM06 V2 PCB continuous              |        70 A |          +49.08 A |           −0.16 A | first row passes; 100% row is already above the literal rating before losses/auxiliaries |
| As-sold XT60 + 12 AWG continuous    |        30 A |           +9.08 A |          −40.16 A | only a narrow first-row catalogue margin; not a design margin                            |
| As-sold XT60 + 12 AWG burst `<60 s` |        60 A |          +39.08 A |          −10.16 A | 100% row exceeds the current value and its one-minute duration is outside `<60 s`        |

The PM02/PM06 PCB burst values exceed 70.16 A arithmetically, but their `<60 s`
condition does not contain a source row reported after one minute. They are not used to
rescue the 100% screen. Conversely, failure at that row does not prove the eventual
vehicle needs 70.16 A continuously; mass and operating point are still unknown.

Per motor, the candidate F35A ESC's 35 A continuous nameplate is 29.77 A above the 5.23
A first row and 17.46 A above the 17.54 A 100% row. This is only a per-channel catalogue
comparison. It does not validate pairing, switching losses, firmware, cooling, four-way
distribution, harness or motor operation.

The F1507 `Matching Guide` separately names Mini F45A 4-in-1 and F7 35A AIO leads, but
its T3140 bench table does not identify the tested ESC. Their smallest per-channel
nameplate screen is:

| F1507 guide lead | Catalogue continuous label | Margin at 6.16 A (50%) | Margin at 25.87 A (100%) | Still unresolved                                                                               |
| ---------------- | -------------------------: | ---------------------: | -----------------------: | ---------------------------------------------------------------------------------------------- |
| F7 35A AIO       |                       35 A |                28.84 A |                   9.13 A | peak duration, exact variant, board input/thermal limit, bench identity and settings           |
| Mini F45A 4-in-1 |                       45 A |                38.84 A |                  19.13 A | peak duration, AM32/BLHeli_32 conflict, board input/thermal limit, bench identity and settings |

Every exact T3140 row is below those per-channel labels. That does not qualify a
four-channel board, and the 100% motor row remains in conflict with its own 23 A / 372 W
60-second labels. The controlled source split is in the
[propulsion source packet](propulsion-source-control-packet-20260908.md#esc-guide-and-bench-identity-boundary).

## Regulated-load boundary

| Load or rail                                   | Sourced fact                                                                                                     | What may be calculated                                   | What remains unknown                                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pixhawk 6C Mini                                | POWER1 exists; POWER2 is absent; technical specification gives 1.5 A output limiters for named peripheral groups | interface and output-limit screens only                  | controller self-draw, attached peripherals, heater/sensor duty and installed supply margin              |
| Raspberry Pi Zero 2 W                          | 350 mA typical bare-board reference; 2 A recommended PSU; product brief states 5 V DC, 2.5 A input supply        | `5.1 V × 0.350 A = 1.785 W` as one reference point only  | mission workload, peaks, encoding, storage and peripheral draw                                          |
| Camera Module 3                                | generic Raspberry Pi camera guidance names 250 mA; exact Module 3 brief identifies CSI-2                         | retain a later supply-sizing input                       | rail voltage at that statement, capture-mode consumption and simultaneous duty                          |
| M10 standard or Micro M10 GNSS candidate       | each official card states `<200 mA @ 5 V`; variants are mutually alternative                                     | less than 1 W from the published upper-current statement | exact variant, attached functions, installed current, cable/mount scope, firmware and simultaneous duty |
| SiK V3 100 mW airborne telemetry candidate     | 5 V; 100 mA transmit at 20 dBm and 25 mA receive; 433/915 MHz variants are region-dependent                      | 0.5 W TX and 0.125 W RX source-point arithmetic only     | legal band, duty cycle, cable loss/mass, coexistence, installation and whether the link is used         |
| PM02/PM06 regulated output                     | 5.2 V, 3 A max, intended for flight controller                                                                   | compare only after Pixhawk and port loads are known      | spare current, thermal derating and any permitted external load path                                    |
| UBEC 5 A companion/payload regulator candidate | 5.2 V at 5 A continuous; generic efficiency over 90%; 10 A burst without duration; 6.7 g                         | `5.2 V × 5 A = 26 W` supply capacity only                | exact load, connectors, input current, efficiency map, transient behavior, cooling and installed margin |

“The Pi cannot be powered from the Pixhawk” would be too strong. The supported
conclusion is narrower: no Pixhawk-to-Pi path is demonstrated or dimensioned, and a
named Pixhawk peripheral group limit of 1.5 A is below both the Pi's 2 A recommended
supply capacity and its product brief's 2.5 A input-supply value. Those two Pi values
are supply sizing, not consumption. A direct, separately regulated companion branch is
therefore the current proposal, pending topology and instrumented simultaneous-load
evidence.

Likewise, the UBEC's 26 W output-capacity arithmetic does not establish Pi/camera
consumption, thermal margin or mission energy. The manufacturer states only a generic
efficiency over 90%, not an operating-point map, and gives no duration for its 10 A
burst value. No auxiliary subtotal is promoted from these ratings.

## Closure packet before calculation or CAD

1. Select one exact battery, one ESC/control card and one complete main-path topology:
   PM02 plus PDB and individual ESCs; PM02 plus a four-in-one ESC; PM06 plus individual
   ESCs; or a different sourced design.
2. Draw the exact net/connector topology, including battery isolation, protection,
   current-sense plane, four ESC branches, returns, the companion rail and the distinct
   command/telemetry connections.
3. Source continuous/burst ratings at named durations and temperatures for every series
   element; size wire and connectors from a reviewed vehicle operating envelope.
4. Measure Pixhawk, Pi, camera, storage, GNSS, command receiver, telemetry and regulator
   input power under representative simultaneous mission states.
5. Add mass, envelope and installed position for the selected ESC/control card, power
   module, distribution, regulator, GNSS, command receiver, airborne telemetry, harness,
   connectors and protection to the mass/CG worksheet.
6. Only then use circuit or time-domain simulation for an exact question it can answer,
   such as voltage drop or energy-state sensitivity. SPICE does not supply a battery
   curve; Modelica does not supply propeller aerodynamics; Chrono and CalculiX do not
   close this electrical architecture.

No power-module envelope is added to CAD until one topology is selected and its complete
connector/service keep-out is known.

## Review boundary

One targeted Terra review checked the local evidence split, arithmetic and wording.
Codex then inspected the official Holybro pages, retained the PM06 height conflict and
its 15.6-versus-18 W output conflict, and rejected the absolute claim that a Pi can
never be powered through Pixhawk. No component selection, schematic authority,
Project/Thread mutation, provider run, broad test campaign or Astra consultation was
introduced. A later bounded native Grok review separated the two F1507 matching-guide
cards from the unnamed bench ESC; Codex independently reopened the official F1507, Mini
F45A, F7 AIO and catalogue pages before accepting the source distinction and arithmetic
screens. The latest bounded native Grok power-chain audit returned `HOLD`; Codex
independently reopened the Holybro PDB, UBEC, GNSS, telemetry and Pixhawk interface
sources before retaining the candidate cards above. PM07 and larger/digital alternatives
were rejected as scope-expanding distractions. No component, topology or protection
device was selected.
