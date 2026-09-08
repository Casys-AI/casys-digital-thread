# ID01 — proportionate verification and test plan

Audience: both · Diátaxis: none · Kind: dated engineering planning note

Observation **2026-09-08**, primary atelier, local. This is a documentary verification
map prepared by Codex against project r674 / Thread r93. It neither changes that truth
nor authorizes a provider run, laboratory activity, prototype operation or flight. It
contains no invented acceptance value.

## Current verdict

The pilot needs substantially more than the two CalculiX cases already completed. Those
cases remain useful, but only for their exact single-part questions. The next valid work
is to close mission, configuration, mass/CG, current path and source identity, then use
the smallest credible calculation or test for each resulting risk.

Current CalculiX, admitted Modelica and prescribed Chrono do **not** validate
propellers, thrust, endurance, flight dynamics, control stability or autonomous
inspection. The plan below prevents that substitution while retaining places where each
registered surface can later answer a genuinely bounded question.

Approved brief r4 remains current and proposed brief r5 remains **pending**. Every
unnamed mission, configuration, margin, material, load and test criterion below stays
`unresolved`; a planning row is not a requirement.

## Existing evidence stays disjoint

| Existing branch                                     | Exact accepted meaning                                                                                             | Must not be aggregated into                                                               |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| CameraMountBracket r3 CalculiX/SysON branch, L5 r86 | ideal face-clamped, camera-weight-only linear-static stress screen against the named catalogue reference           | deck joint, vibration, flight load, as-built material or vehicle proof                    |
| RadialArm r2 CalculiX/SysON branch, L5 r90          | ideal fixed-root, 5 N transverse single-part displacement screen against the approved 0.2 mm criterion             | motor/arm or arm/deck joint, torque, thrust, landing, modal or fatigue proof              |
| Airframe assembly-integrity branch, L3–L5 r91–r93   | import, occurrence coverage, exact placement recross, BRep validity and zero positive pairwise intersection volume | fit-up, required contact/clearance, fasteners, preload, load transfer, motion or strength |
| F1404 and F1507 manufacturer rows                   | candidate-specific static bench facts and deterministic arithmetic at the named rows                               | vehicle hover, cruise, continuous operation, endurance or selected hardware               |
| StaticPropellerEnvelope and BatteryReservedVolume   | reversible packaging proxies                                                                                       | aerodynamic geometry, physical propeller, cell chemistry, usable energy or mass           |

Passing one row never closes another. In particular, two accepted part proofs plus a
geometric assembly `pass` do not become an aircraft proof.

## Gated sequence

```text
G0 — documentary closure now
  mission + census + source identities + mass/CG basis + power topology
    ↓
G1 — selected configuration
  exact component packet + criteria + operating envelope + physical interfaces
    ↓
G2 — component and model evidence
  guarded propulsion/electrical benches + bounded structural cases + external 6-DoF/SIL
    ↓
G3 — integrated prototype ground evidence
  as-built mass/CG + HIL + restraint + vibration/thermal/EMI/fail-safe checks
    ↓
G4 — progressively restrained operating evidence
  only under separate human, site, safety and regulatory authority
    ↓
G5 — mission-envelope and external conformity evidence
```

Do not run later gates in parallel merely to create activity. A later method consumes
the exact output of the earlier gate that supplies its inputs.

## G0 — documentary closure now

| ID   | Verification question                       | Entrance evidence                                                                                           | Smallest credible method and output                                                                                                            | Criterion owner                                        | Explicit non-claim                                                                   |
| ---- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| G0.1 | What mission is being sized?                | human-selected civil façade/roof mission kind; r5 pending                                                   | complete the [mission decision sheet](mission-sizing-decision-sheet-20260908.md) with one reviewed scenario, phases, envelope and reserve rule | human                                                  | scenario A/B/C proposals are not requirements or operating authorization             |
| G0.2 | What is physically installed?               | current architecture, COTS leads and missing-item census                                                    | freeze include/exclude rows for every occurrence, harness, fastener, guard and retention item                                                  | human for inclusion; supplier or measurement for facts | an envelope occurrence is not an installed item                                      |
| G0.3 | What are mass, CG and inertia inputs?       | G0.2 plus sourced/measured mass and position                                                                | complete `Σm` and `Σmr`; measure as-built items when available; retain inertia `unresolved` until sourced or measured                          | human measurement/process basis                        | CAD volume and geometric centroid are not physical mass, CoM or inertia              |
| G0.4 | Which propulsion packet is exact?           | [source-control packet](propulsion-source-control-packet-20260908.md): F1404/`GF3016` and F1507/T3140 HOLDs | supplier-controlled maker/SKU/revision, geometry, interface, limits and comparable bench map                                                   | human selects only after source closure                | a bench label or decoded product name is not a controlled cross-reference            |
| G0.5 | Which battery and power topology are exact? | six battery screens; PM02/PM06 leads; no viable current+keep-in combination                                 | select one pack and one main-path topology; draw every net, measurement plane, branch, regulator, connector and protection element             | human                                                  | catalogue C-rate and supply ratings are not delivered mission current or consumption |
| G0.6 | What static packaging survives?             | exact selected envelopes and placement basis                                                                | orthogonal keep-in, connector/service volume, CG and nominal clearance worksheet                                                               | human clearance/keep-in policy                         | containment is not retention, cooling, electrical safety or dynamic clearance        |
| G0.7 | What are the acceptance criteria?           | mission/configuration decisions above                                                                       | name thrust margin, usable-energy/reserve rule, electrical limits and interface/test criteria with provenance                                  | human or external authority                            | the agent does not choose plausible values                                           |

G0 exits only when one candidate configuration can be calculated without filling an
unknown with a default. Until then no solver is needed.

## Sensitivity activation rule

Sensitivity is already active where the inputs are explicit and reversible: the battery
note checks every orthogonal orientation, the configuration matrix compares exclusive
candidate substitutions, and the propulsion source packet calculates the
static-clearance effect of replacing the 3.0-inch proxy by the sourced 3.1-inch T3140
datum. The pre-sizing basis also retains all eleven exact F1507/T3140 rows as a discrete
lookup basis, without interpolation or a same-throttle candidate ranking.

A whole-vehicle sensitivity sweep is **not active yet**. It starts only after G0.1, G0.2
and G0.4 provide one reviewed mission scenario, an installed-item census and one exact
propulsion packet. Its first bounded variables will be sourced or human-approved ranges
for total mass, mission-phase duration/power, usable battery energy, reserve and the
applicable motor–propeller operating region. No default range or probability
distribution is inserted by the agent.

The registered `verify.evaluate-sensitivity-base@1` operation is not a generic vehicle
sizing tool: it evaluates an exact FEA sensitivity-base identity and cannot replace this
documentary configuration/mission analysis or authorize a source correction.

## G1–G2 — component, aerodynamic and structural evidence

| ID | When                            | Verification question                                                                    | Entrance evidence                                                                                       | Smallest credible method and output                                                                                                    | Criterion owner                           | Explicit non-claim                                                           |
| -- | ------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------- |
| P1 | after configuration             | Does the exact motor–propeller–ESC unit produce a usable map?                            | exact identities/interfaces, guarded protocol and stop limits                                           | guarded thrust stand measuring voltage, current, thrust, speed, torque where available and temperature versus named duration           | human protocol plus component limits      | isolated unit map is not installed four-rotor or flight performance          |
| P2 | after P1 and closed mass        | Where is ideal static balance and thrust margin?                                         | all-up mass, justified four-way load share, P1 map and approved margin                                  | algebraic `T_hover,total = mg` and `Γ_T = 4T_max/(mg)` on exact rows or justified interpolation                                        | human margin                              | hover arithmetic is not stability, climb, cruise or wind capability          |
| P3 | after configuration             | Are propeller clearances credible?                                                       | selected diameter/interface, exact centres and tolerance policy                                         | nominal and worst-case static clearance; later measured/deformed operating envelope                                                    | human clearance policy                    | current proxy, assembly integrity and Chrono do not prove rotating clearance |
| P4 | after prototype                 | What changes when four rotors are installed on the cell?                                 | P1, integrated airframe, safe restraint and instrumented bus                                            | guarded installed-propulsion bench comparing thrust/power/temperature with isolated-unit evidence                                      | human protocol                            | installed restrained data are not closed-loop flight stability               |
| E1 | after mission and configuration | Is usable energy sufficient for the named phases?                                        | phase durations/powers, measured auxiliary duty, pack curve, current, cutoff and temperature            | reproducible algebraic phase sum and sensitivity; measured pack discharge where needed                                                 | human reserve/cutoff policy               | `Wh_nameplate / P_bench` is not endurance                                    |
| S1 | after P1/P2                     | What loads reach each structural part?                                                   | selected thrust/torque, mass, manoeuvre/landing envelope and physical load path                         | derive named load cases with units and provenance before any FEA                                                                       | human operating/load envelope             | CalculiX cannot invent the load                                              |
| S2 | after S1                        | Does one exact part pass an admitted linear-static question?                             | canonical part STEP, one isotropic material basis, admissible AABB supports/forces and native criterion | a new `verify.run-fea-static-proof@3` branch only when the question fits its contract                                                  | human MRTR/criterion; SysON L4 comparator | no contact, joint, assembly, modal, fatigue, thermal or dynamic conclusion   |
| S3 | after interface selection       | Do arm/deck, motor/arm, tray/deck, carrier/frame, skid/deck and camera/deck joints work? | controlled interface drawings, fasteners, material/process, access and load transfer                    | geometry recross plus hand calculation and physical joint/coupon tests; use another qualified method only if its exact question exists | human interface/process criteria          | matching holes and zero intersections do not prove a joint                   |
| S4 | after configuration/prototype   | Are modal, rotor-vibration and camera-jitter risks acceptable?                           | rotor speed/excitation ranges, as-built mass/stiffness, mounts and image criterion                      | qualified modal/vibration method outside current FEA surface plus instrumented sweep and image evidence                                | human vibration/image criteria            | current CalculiX `@3` has no modal or harmonic coverage                      |
| S5 | after configuration/prototype   | Are landing/skid loads acceptable?                                                       | all-up mass and approved landing envelope                                                               | proportional hand screen, then instrumented drop/landing fixture; a part FEA only for a separately admissible sourced load             | human landing criterion                   | no invented acceleration multiplier or nonlinear-impact claim                |

## G2–G3 — electrical, thermal, controls and integration

| ID  | When                        | Verification question                                                                      | Entrance evidence                                                                  | Smallest credible method and output                                                                      | Criterion owner                           | Explicit non-claim                                                       |
| --- | --------------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------ |
| EL1 | after configuration         | Can every series element carry the named current?                                          | exact battery, connector, wire, PDB/module, ESC branches, duration and temperature | rating/derating worksheet followed by four-wire voltage-drop and temperature measurement                 | human design limits plus supplier ratings | PM/XT60 catalogue comparison is not installed qualification              |
| EL2 | after configuration         | Is the regulated flight-controller and companion supply adequate?                          | exact regulators and simultaneous Pixhawk/Pi/camera/GNSS/radio states              | instrumented input/output voltage, current, efficiency, transient and thermal traces                     | human rail limits                         | Pi PSU capacity and camera guidance are not mission consumption          |
| EL3 | after a closed circuit      | Is an operating-point voltage drop explainable?                                            | exact netlist and sourced/measured component values                                | admitted circuit-only SPICE only if the question fits; compare with measurement                          | human method/criterion                    | SPICE does not supply LiPo dynamics, EMC, protection safety or endurance |
| TH1 | after prototype             | Do motor, ESC, power module, regulator and battery stay within selected limits?            | installed cooling and P1/EL operating points                                       | thermocouples/IR with synchronized electrical data at named durations                                    | human test protocol plus supplier limits  | catalogue one-minute temperature is not installed continuous evidence    |
| C1  | after G0/P1                 | Is a six-degree-of-freedom plant credible?                                                 | measured mass/CG/inertia and rotor thrust/torque map                               | separately qualified external 6-DoF aerodynamic/rigid-body model with calibration and uncertainty record | human model acceptance                    | no current registered Modelica or Chrono surface supplies this model     |
| C2  | after C1                    | Do controller modes and guidance work on the model?                                        | frozen controller software, mixer, sensors, mission geometry and C1 plant          | software-in-the-loop traces for attitude, navigation and fail-safe transitions                           | human control/mission criteria            | SIL proves behavior on the model, not the aircraft                       |
| C3  | after C2 and exact hardware | Do real flight controller, ESC interfaces and sensors behave with simulated plant/signals? | frozen hardware/software, exact wiring and accepted C1/C2 basis                    | hardware-in-the-loop with motors disabled or safely restrained                                           | human HIL protocol                        | HIL does not establish thrust, vibration, EMI or flight readiness        |
| C4  | after prototype             | Are vibration, magnetic, radio and conducted/radiated coupling controlled?                 | installed rotors, harness, antennas, current paths and sensor logs                 | restrained measurements, spectrum/log analysis and external EMC work where required                      | human/laboratory criteria                 | SPICE operating point and static FEA are not EMC evidence                |
| C5  | after C2/C3                 | Do loss-of-link, undervoltage and other fail-safe policies behave as approved?             | explicit human policy, thresholds and safe test states                             | ground/SIL/HIL demonstrations first; later physical cases only under separate authority                  | human/operator/regulatory authority       | no current solver grants fail-safe or autonomous-operation assurance     |

## G3–G5 — progressive physical evidence

| ID | When                                   | Entrance gate                                                                                   | Smallest credible evidence                                                                          | Owner                                    | Explicit non-claim                                                                      |
| -- | -------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| T1 | after integrated prototype             | frozen installed census and safe article                                                        | all-up mass and CG measurement; configuration photographs and serialized component record           | human/atelier                            | does not establish stability or strength                                                |
| T2 | after T1 and component benches         | restrained, protected propulsion/electrical article                                             | current, voltage, temperature, vibration and control logs under narrowly named ground states        | human test lead                          | ground restraint is not free flight                                                     |
| T3 | after C2–C5 and external authorization | approved site, people exclusion, weather envelope, emergency/fail-safe plan and legal authority | progressively restrained hover and short translation, beginning with the smallest approved envelope | operator and applicable authority        | no Thread L4/L5 or engineering calculation authorizes this test                         |
| T4 | after T3 evidence review               | approved mission scenario and unchanged/reviewed configuration                                  | progressive mission-like inspection with synchronized flight, power and payload-quality evidence    | operator and applicable authority        | one successful sortie is not certification, fleet reliability or all-weather capability |
| T5 | when market/operation scope is known   | jurisdiction, product/operation classification and declared claims                              | external regulatory, radio/EMC, battery transport, operating and conformity evidence as applicable  | external authority/operator/manufacturer | Casys planning and local solver evidence do not grant conformity                        |

No physical test is queued or authorized by this plan. Safety procedure, test site,
personnel competence, emergency response and regulatory route require their own exact
review.

## Exact role of current engineering surfaces

| Surface                                  | Valid later use for ID01                                                                                                                                    | Invalid substitution                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| CalculiX `verify.run-fea-static-proof@3` | one exact canonical solid part, linear-static, isotropic material, fixed/force AABB selections, displacement and/or von Mises criterion                     | whole assembly, bolts/contact, modal/vibration, fatigue, thermal, landing impact, rotor or flight dynamics                |
| Admitted Modelica v2                     | a sourced closed scalar ODE/algebraic sensitivity, for example a single constant-condition energy state, only if the grammar and evidence contract fit      | phased aircraft model, battery chemistry, MSL components, connectors, arrays, 6-DoF, autopilot, aerodynamics or stability |
| Prescribed Chrono                        | an explicitly mapped immediate rigid-body revolute mechanism with prescribed ramp and sample schedule, for example a future declared camera gimbal question | free dynamics, rotor force/torque, collision/swept clearance, contact, landing or flight stabilization                    |
| Circuit-only SPICE                       | a closed, admitted operating-point circuit question after exact source values exist                                                                         | pack discharge curve, four-ESC vehicle behavior, transient mission energy, EMC, battery safety or certification           |
| Assembly integrity                       | exact import/topology/placement/intersection observations and five fixed geometric criteria                                                                 | required fit/contact/clearance, fasteners, motion, load transfer, strength or manufacturability                           |
| External model or physical bench         | 6-DoF, aerodynamics, modal/vibration, thermal, EMC and installed behavior when separately governed and calibrated                                           | automatic Project/Thread authority or certification                                                                       |

The most important “simulation” for the next step is therefore not a Chrono rotor run.
It is the transparent G0 calculation fed by closed mission and component evidence. Later
simulation is chosen only after a specific risk and its input packet exist.

## Review boundary

Three bounded native Grok 4.6 reviews independently covered propulsion/aerodynamics,
flight-controls/software and structure/electrical/prototype testing. All returned `SHIP`
for a documentary gated plan and rejected using current CalculiX, Modelica, Chrono or
SPICE as a flight proxy. Codex reread the repository coverage contracts, removed
suggestions that depended on an unregistered tool or an invented criterion, and retained
only the method/entrance/owner/non-claim structure above. No Astra consultation,
provider call, Project/Thread mutation, component decision, physical test or broad test
campaign occurred.
