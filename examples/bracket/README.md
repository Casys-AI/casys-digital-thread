# The bracket — illustrative documented demo, not a SysON record

A mounting bracket (Al 6061), used as an illustrative documented demo of the links
between requirements, geometry, a STEP file, a load case, and comparisons with explicit
units. The [run fixture](../../state/fixtures/runs/bracket-demo.json) is labelled
`source: "demo"`. The [evidence bundle](../console/bracket-evidence.json) records
`freshCadExecution: false` and `freshFeaExecution: false`. The values below are not a
fresh CAD or FEA execution.

## 1. Documented requirements (illustrative, not a SysON record)

The checked-in text below illustrates the documented target values. It is not a SysON
record, and no requirement extraction or evaluation dispatch is attested.

```sysml
part bracket {
    attribute totalMass;
    constraint massBudget { totalMass <= 0.070 [kg] }
}
requirement holdLoad {
    doc /* Under 500 N vertical service load, stress stays below Al 6061 yield with SF 1.5 */
    // maxStress <= 160 [MPa]   (240 MPa yield / 1.5)
}
```

## 2. Geometry — [bracket.py](bracket.py) and [bracket.step](bracket.step)

With `density_kg_m3: 2700` (explicit — mass is never guessed from a name):

| metric         | value                    |
| -------------- | ------------------------ |
| volume         | 21 079.9 mm³             |
| **mass**       | **56.92 g**              |
| centre of mass | (−12.43, 0.00, 11.51) mm |
| bbox           | 60 × 40 × 52.5 mm        |

These are checked-in geometry values recorded by the demo fixture, not a fresh CAD
execution or a newly produced canonical STEP.

## 3. Physics — [solve-case.json](solve-case.json)

The checked-in load case documents one fixed selection, a 500 N downward load, and a 3
mm mesh setting. The result values are documented example values, not a freshly
dispatched FEA solve.

| result            | value        |
| ----------------- | ------------ |
| max displacement  | 0.043 mm     |
| **max von Mises** | **26.6 MPa** |

## 4. Recorded comparisons, units included

This is a recorded fixture comparison, not a current constraint evaluation or a
requirement verdict.

| constraint | recorded value | documented limit | outcome                 |
| ---------- | -------------- | ---------------- | ----------------------- |
| massBudget | 56.92 g        | 70 g             | within documented limit |
| holdLoad   | 26.6 MPa       | 160 MPa          | within documented limit |

The example shows why units matter: a kg/lb mismatch must remain visible rather than
being silently accepted on bare numbers. It does not claim a live satisfiability or
constraint-solver response.

## Check the persisted demo

```bash
deno task verify:evidence
deno task verify:docs
```

These commands validate the persisted evidence and documentation links; they do not
start the MCP fleet or dispatch CAD, FEA, or SysON work.

## Create fresh project evidence instead

This folder is not a provider-run recipe. Follow the
[engineering-project walkthrough](../../docs/how-to/verify-design/walk-through-an-engineering-project.md)
for review and human MRTRs. The exact fresh-evidence sequence is: admission
(`compile.seal-admission@3`) → `design.execute-build123d@1` → isolated noncanonical
draft; versus `project_admitted_geometry_export` → human MRTR →
`design.write-geometry@1` → canonical STEP; then sealed proof case →
`verify.run-fea-static-proof@3`. This demo does not queue or dispatch any route.
