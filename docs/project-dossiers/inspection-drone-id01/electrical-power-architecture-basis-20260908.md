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
ratings are below the current F1404 four-motor 100% bench sum. The vehicle operating
point, battery, protection, wiring, auxiliary loads and cooling remain unresolved.

## Proposed block boundary

```text
selected 4S battery
  └─ main connector + isolation/protection [unresolved]
       └─ measured main path / current-sense plane [candidate PM02 or PM06]
            ├─ regulated flight-controller output
            │    └─ Pixhawk 6C Mini POWER1 [candidate, analog]
            ├─ four protected/distributed high-current branches
            │    └─ ESC ×4 ── motor ×4 [candidate identities unresolved]
            └─ separately regulated 5 V companion/payload branch [proposal]
                 └─ Pi Zero 2 W + camera/storage/radio loads [duty unresolved]
```

PM02 V3 would require a separate distribution element downstream of its measured main
path if whole-bus current is to be observed. PM06 V2 is an alternative with four
integrated ESC power pads. They are not used together in this proposal. Whether the
companion branch lies inside the measured plane is itself unresolved. Return/reference
routing, switching, fusing, transient suppression, EMI control, cable strain relief and
failure isolation are deliberately not invented by this diagram.

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

## Current-path arithmetic screen

The existing F1404 KV4600 + `GF3016` manufacturer table gives `4 × 5.23 = 20.92 A` at
its first retained 50% row and `4 × 17.54 = 70.16 A` at its 100% row. These sums exclude
ESC losses and every auxiliary load. They are static bench-row consequences, not FEA
results, measured vehicle current, hover current or a continuous mission point. The 100%
row retains the source's one-minute context.

| Published current element           | Rating used | Margin at 20.92 A | Margin at 70.16 A | Bounded interpretation                                                                   |
| ----------------------------------- | ----------: | ----------------: | ----------------: | ---------------------------------------------------------------------------------------- |
| PM02 V3 PCB continuous              |        60 A |          +39.08 A |          −10.16 A | first row passes an arithmetic nameplate screen; 100% row exceeds continuous rating      |
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

## Regulated-load boundary

| Load or rail                | Sourced fact                                                                                                     | What may be calculated                                  | What remains unknown                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Pixhawk 6C Mini             | POWER1 exists; POWER2 is absent; technical specification gives 1.5 A output limiters for named peripheral groups | interface and output-limit screens only                 | controller self-draw, attached peripherals, heater/sensor duty and installed supply margin           |
| Raspberry Pi Zero 2 W       | 350 mA typical bare-board reference; 2 A recommended PSU; product brief states 5 V DC, 2.5 A input supply        | `5.1 V × 0.350 A = 1.785 W` as one reference point only | mission workload, peaks, encoding, storage, radio and peripheral draw                                |
| Camera Module 3             | generic Raspberry Pi camera guidance names 250 mA; exact Module 3 brief identifies CSI-2                         | retain a later supply-sizing input                      | rail voltage at that statement, capture-mode consumption and simultaneous duty                       |
| PM02/PM06 regulated output  | 5.2 V, 3 A max, intended for flight controller                                                                   | compare only after Pixhawk and port loads are known     | spare current, thermal derating and any permitted external load path                                 |
| Companion/payload regulator | none selected                                                                                                    | no mass, loss or power term                             | input range, 5 V current, efficiency map, transient behavior, cooling, protection, mass and envelope |

“The Pi cannot be powered from the Pixhawk” would be too strong. The supported
conclusion is narrower: no Pixhawk-to-Pi path is demonstrated or dimensioned, and a
named Pixhawk peripheral group limit of 1.5 A is below both the Pi's 2 A recommended
supply capacity and its product brief's 2.5 A input-supply value. Those two Pi values
are supply sizing, not consumption. A direct, separately regulated companion branch is
therefore the current proposal, pending topology and instrumented simultaneous-load
evidence.

## Closure packet before calculation or CAD

1. Select one exact battery and one alternative main-path topology: PM02 plus separate
   PDB, PM06 integrated distribution, or a different sourced design.
2. Draw the exact net/connector topology, including battery isolation, protection,
   current-sense plane, four ESC branches, returns and the companion rail.
3. Source continuous/burst ratings at named durations and temperatures for every series
   element; size wire and connectors from a reviewed vehicle operating envelope.
4. Measure Pixhawk, Pi, camera, storage, GNSS/radio and regulator input power under the
   representative simultaneous mission states.
5. Add mass, envelope and installed position for module, distribution, regulator,
   harness, connectors and protection to the mass/CG worksheet.
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
introduced.
