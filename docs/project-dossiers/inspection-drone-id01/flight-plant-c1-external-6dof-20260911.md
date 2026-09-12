# ID01 — C1 flight plant: external 6-DoF, not Chrono

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-11**, primary atelier, local. Documentary method packet only. It
does not replace Project or Thread truth, invent a registered flight operation, select
hardware, fill mission cells, or authorize flight.

## Why this page exists

Human intent: model flight. Registered Chrono is **prescribed kinematics** (imposed
joint ramp, e.g. a later camera gimbal). It does not compute rotor force/torque, free
6-DoF, contact, landing, or stabilization.

Admitted Modelica and CalculiX `@3` are equally not a flight plant. Wrapping Gazebo or
PX4 as a new engineering MCP would invent a verification authority. That is a platform
lot, not an ID01 shortcut.

The [verification-and-test-plan](verification-and-test-plan-20260908.md) already names
C1: a separately qualified **external** 6-DoF aerodynamic/rigid-body model. This page
records that method for ID01 without pretending it is a Thread L4.

## Sequence (BE)

1. **G0** — scenario A phase times, duties, reserve, then `E_mission`. Cells stay
   `unresolved` until a human requirement or a measured workflow exists. See
   [scenario A](mission-sizing-scenario-a-instantiation-20260911.md). Priority remains
   `presize-before-simulations`.
2. **P1** — measured motor–propeller–ESC map. Not a catalogue row, not F1404 as ID01
   hover.
3. **C1** — external 6-DoF plant (PX4 SITL, Gazebo, or another named calibrated stack)
   using G0 + P1 + measured or declared mass/CG/inertia. Evidence class: **external /
   documentary**. Not `verify.run-prescribed-kinematics@1`, not Modelica, not CalculiX.
4. **C2 / C3** — SIL then HIL on that plant. Still not Thread L4.
5. **T3** — physical flight only under separate operator/regulatory authority. No
   Thread evaluation authorizes it.

## What an external C1 run may claim

| May record | Must not claim |
| ---------- | -------------- |
| Named simulator, version, airframe SDF/URDF identity, firmware identity | That Chrono, Modelica, or CalculiX proved hover |
| Input mass, inertia, mixer, and the G0/P1 packet actually loaded | That those inputs were true of the ID01 article if they were assumed |
| Time traces: attitude, rates, altitude, motor commands, as exported | Thread `pass` / `fail` on a named SysML requirement |
| Calibration and uncertainty notes | Certification, fleet reliability, or legal flight |

Capture later as a `supporting-document` (draft, `grants: none`) unless F21 grows a
Thread worksheet seal. Do not bind the run as `prescribed-kinematics` or as FEA.

## Current blockers (literal)

- Scenario A numeric cells: `unresolved` (never `0`).
- Reserve policy, image criterion, site envelope, thrust-margin rule, installed census:
  not selected.
- Motor / propeller / ESC / battery: configuration matrix `HOLD`.
- F13: no registered propulsion/energy operation. F21: no Thread publication path for
  this class of worksheet.
- Pending brief r8 remains unconfirmed (F22). Canonical brief is r7.

Until G0 has sourced durations and a reserve rule, do not start SITL/Gazebo as if it
sized the vehicle.

## Non-goals

- A new MCP server or unregistered `simulate.*` operation.
- Chrono as free-flight dynamics.
- YOLO or agent-invented phase times, hover power, or usable energy.
- Closing leftover `wi-proof-seal-id01-camera-bracket-bench-r2` (F45).
