# ID01 — mission sizing decision sheet

Audience: both · Diátaxis: none · Kind: dated engineering working sheet

Observation **2026-09-08**, primary atelier, local. This is a reversible documentary
sheet prepared by Codex against project r674 / Thread r93. It does not change Project or
Thread truth, approve proposed brief r5, select a component, define an operating
authorization, or establish flight readiness.

## Current decision state

Approved brief r4 remains current. Proposed brief r5,
`inspection-drone-id01:brief:r5:7180b5c1fe7eef09`, remains **pending**. The human has
selected an unarmed civil exterior camera-inspection mission and the priority
`presize-before-simulations`; no duration, range, height, inspection dwell, reserve,
weather envelope, payload duty cycle or thrust-margin criterion has been selected.

Blank cells below mean `unresolved`, never zero. A documentary scenario can organize
questions, but it cannot silently become the mission requirement used to size the
vehicle.

## Reversible scenario shapes

| Scenario shape               | Mission sequence                                                                                   | What it would expose                                                                                                      | Current status                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A — short local façade pass  | launch and climb; short approach; one local façade zone; direct return; land                       | first measured workflow timing, inspection dwell, simultaneous camera/compute/radio duty and a minimal reserve discussion | **Codex proposal for the first screen; not human-approved** |
| B — extended façade coverage | launch and climb; several contiguous façade passes; repositioning and dwell; return; land          | repeated inspection segments, longer capture duty, direction changes and a larger energy sensitivity                      | documentary alternative only                                |
| C — roof/perimeter coverage  | launch and climb to roofline; roof or perimeter transit; downward/oblique inspection; return; land | climb energy, different camera attitude, roofline wind exposure and a distinct path geometry                              | documentary alternative only                                |

Scenario A is proposed first because it is the smallest reversible workflow from which
real durations and electrical duty can be measured. That sequencing proposal does not
assert that A is safe, representative, legally admissible or sufficient for the eventual
product. Review is triggered by either a human scenario choice or the first measured
representative workflow.

## Human decisions still required

| Decision                    | Allowed form                                                                                      | Why it is consequential                                         |
| --------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Mission shape               | choose, revise or reject A/B/C                                                                    | Changes phase order, time aloft and inspection duty             |
| Site and operating envelope | named type of site, people exclusion, altitude/stand-off bounds, wind, temperature and visibility | Controls operational constraints and load/energy cases          |
| Reserve policy              | explicit energy, time or named reserve phase, with one calculation rule                           | Prevents an invented or double-counted reserve                  |
| Thrust-margin criterion     | approved total-thrust-to-weight or another explicit rule                                          | Determines whether a bench operating point is acceptable        |
| Installed-item census       | include/exclude list for payload, navigation, radio, guards, harness, fasteners and retention     | Controls all-up mass and auxiliary power                        |
| Candidate configuration     | exact motor, propeller, ESC, battery and power architecture packet                                | Determines which source data can enter the calculations         |
| Battery keep-in status      | hard packaging constraint, soft starting hypothesis or replacement                                | Controls whether a pack is rejected or the structure is revised |

Codex may prepare options and consequences. It must not supply these human decisions by
placing plausible numbers in the worksheet.

## Numeric mission worksheet

All numeric mission cells remain intentionally blank. Durations are later recorded in
minutes or seconds at observation, then converted to hours for energy arithmetic.

| Phase                      | Duration | Distance or height change | Air/ground speed | Wind and temperature | Propulsion operating point | Camera / compute / radio duty | Evidence owner                                        |
| -------------------------- | -------- | ------------------------- | ---------------- | -------------------- | -------------------------- | ----------------------------- | ----------------------------------------------------- |
| Launch and climb           | —        | —                         | —                | —                    | —                          | —                             | human requirement or measured representative workflow |
| Outbound transit           | —        | —                         | —                | —                    | —                          | —                             | human requirement or measured representative workflow |
| Inspection                 | —        | —                         | —                | —                    | —                          | —                             | human requirement plus instrumented payload workflow  |
| Repositioning, if used     | —        | —                         | —                | —                    | —                          | —                             | scenario-specific observation                         |
| Return transit             | —        | —                         | —                | —                    | —                          | —                             | human requirement or measured representative workflow |
| Descent and landing        | —        | —                         | —                | —                    | —                          | —                             | human requirement or measured representative workflow |
| Reserve phase, if selected | —        | —                         | —                | —                    | —                          | —                             | approved reserve policy                               |

The calculation remains:

`E_mission = Σ_i [(P_prop,i + P_aux,i + P_loss,i) × t_i]`

with every `t_i` expressed in hours and powers in watts. Feasibility requires
`E_mission + E_reserve ≤ E_usable`, unless the approved policy represents reserve as a
named phase already included in the sum. Only one representation may be used.

## Evidence acquisition plan

| Evidence class   | Smallest next evidence                                                                           | Permitted consequence                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Human            | scenario shape, operating envelope, reserve form, margin criterion and include/exclude census    | turns the corresponding blank into an approved requirement or decision |
| Observed         | timed dry-run of the representative inspection workflow, without claiming a flight test          | supplies phase timing and simultaneous duty states                     |
| Supplier / bench | exact component identities, comparable motor–propeller map, battery curve and electrical ratings | supplies candidate-specific inputs only                                |
| Measured         | all-up mass/CG, propulsion electrical/thrust bench and auxiliary-power trace at named states     | replaces catalogue or assumed terms at the measured condition          |
| Calculated       | mass, thrust, current, power, usable-energy and phase-energy arithmetic from the named inputs    | supports a reviewable screen, not an operating authorization           |

The current F1404 and F1507 tables are static manufacturer bench evidence. Their
throttle labels are not mission commands, and neither table supplies a flight power
curve. CalculiX cannot create the missing operational load. Prescribed Chrono cannot
create propeller thrust or stability. Modelica becomes relevant only after a sourced,
admissible lumped model and an exact time-domain question exist; it does not replace the
mission decisions or propulsion bench data.

## Exit criterion for the first sizing pass

The first algebraic vehicle screen may start only when all of the following are named:

1. one reviewed scenario with phase durations and reserve rule;
2. one complete installed-item census and a closed mass estimate or measurement;
3. one exact motor–propeller bench map and its valid operating limits;
4. one exact ESC, battery and current-path architecture;
5. one usable-energy basis at the relevant current, temperature and cutoff;
6. one approved thrust-margin criterion.

Until then, the scenario shapes stay proposals and all numeric mission outputs remain
`unresolved`.

## Review boundary

One bounded native Grok review independently checked the authority split and recommended
opening a worksheet without a solver. Codex retained scenario A only as a reversible
proposal and kept every consequential number and choice blank. No Project/Thread
mutation, provider run, human answer, Astra consultation or flight claim was made.
