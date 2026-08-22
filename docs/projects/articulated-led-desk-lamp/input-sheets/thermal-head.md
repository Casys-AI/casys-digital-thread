# G4 — thermal head input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `reviewed for the AL01 YOLO concept run` on 2026-08-22. The method is a
deliberately isolated lumped scalar demonstration, not a qualified lamp-head thermal
model.

## Model boundary and sources

| Required fact                                             | Human/source entry |
| --------------------------------------------------------- | ------------------ |
| Product revision and subject `LampHead`                   | Decision basis: project r34 / Thread r4; `LampHead` only |
| Physical boundary represented by the scalar model         | One lumped temperature state exchanging heat with a fixed ambient boundary |
| Equation source and revision                              | Exact admitted Modelica source below, decision revision 1 |
| Assumptions, exclusions, and applicability range          | Constant `0.5 W/K` conductance, `50 J/K` capacitance and `298.15 K` ambient; no radiation, spatial gradient, temperature-dependent property, coupled FEA, MSL, safety, lifetime, or certification claim |
| Initial-state meaning owned by `lampHeadThermalState`     | Initial lumped temperature `298.15 K` |
| Electrical-power input meaning owned by `electricalPower` | Constant heat input `5 W` for this isolated scenario. G6 later proposes the G5 `0.345924 W` observation as a candidate replacement on a future thermal rerun; it does not mutate this admission now |

Exact reviewed admitted source text:

```modelica
model LampHeadThermal
  parameter Real lampHeadThermalState(unit = "K") = 298.15;
  parameter Real electricalPower(unit = "W") = 5;
  output Real temperature(unit = "K", start = lampHeadThermalState, fixed = true);
equation
  der(temperature) = (electricalPower - 0.5 * (temperature - 298.15)) / 50;
annotation(experiment(StartTime = 0, StopTime = 120, Interval = 1, Tolerance = 0.000001));
end LampHeadThermal;
```

## Parameters, experiment, and criteria

For every parameter, record its stable name, meaning, value, unit, source, and whether
it is an input, initial state, coefficient, or output. Then record:

| Required fact                                                        | Human/source entry |
| -------------------------------------------------------------------- | ------------------ |
| Experiment start, stop, and output grid                              | `0 s` to `120 s`, exact `1 s` interval, tolerance `1e-6` |
| Requested output names and observation method (`final` or `max_abs`) | `temperature`, role `final` |
| Requirement metric, operator, threshold, and unit                    | `temperature <= 313 K` |
| Intended consequence of `pass`, `fail`, and `unresolved`             | `pass`: accept only this scalar scenario; `fail`: retain evidence and revise a reviewed method; `unresolved`: no thermal conclusion |
| Responsible reviewer                                                 | `local-yolo:startup-opt-in`, explicitly delegated in the paired conversation on 2026-08-22 |

Every numeric value above is an explicit delegated demonstration decision. It is not
presented as an observed material or product property. The execution must still publish
OMC evidence, a separate SysON L4 comparison, and an explicit L5 disposition.

The original reversible concept limit was `313.15 K`. AL01 uses the slightly stricter
integer `313 K` limit because SysON 0.5.1 cannot round-trip decimal requirement literals;
the change preserves an exact SysML requirement instead of silently rounding it.

The human supplies engineering semantics, not `.mo` provider envelopes, OMC arguments,
paths, or images. The admitted-source path can compile agent-authored closed-subset
Modelica only from the reviewed sheet. Execution success is not an L4 verdict, and L4 is
not L5.
