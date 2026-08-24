# MCS-02 — runtime evidence

Audience: both · Diátaxis: none · Kind: tracking evidence

Local observation, primary atelier, **2026-08-25** Asia/Taipei. Gitignored runtime may
drift. These identities record what was reread; this page grants no authority.

## Current heads

- Engineering Project r146:
  `motorized-camera-slider-mcs02:project:r146:22874eb0e7f6ee79`.
- Thread r20:
  `project:motorized-camera-slider-mcs02:r20:decide-accept-admitted-spice-evaluation-run:mcs02-queue-spice-closeout-r142`.
- Workspace r15, event fingerprint
  `0cb8b448174c7bb18af9584d7a2b03a1af1dc23219437f118dcc892252806092`.
- Approved brief fingerprint
  `61b35129dac6bf613f5ee62ac5e7a58980a800aef41b1dbeba7fad652291f917`.

## Thread map

| r | Recorded result |
| - | --------------- |
| 1–3 | Brief baseline, SysON seed, reviewed architecture |
| 4–6 | CAD, Modelica and SPICE `compile.seal-admission@3` documents |
| 7 | Canonical RailFrame geometry and STEP |
| 8–9 | System and RailFrame requirements |
| 10–12 | FEA proof seal, CalculiX evaluation, mechanical L5 accept |
| 13–16 | Admitted Modelica run, method, L4 evaluation, L5 accept |
| 17–20 | Admitted SPICE run, method, L4 evaluation, L5 accept |

## Literal results

- CalculiX: `0.3645119986 mm <= 1 mm` and
  `3.486239191 MPa <= 55 MPa`; L5 r12.
- Modelica: final carriage position `399.9999999999999 mm` against the reviewed
  `>= 400 mm` criterion; the comparator recorded `pass` within its numeric tolerance;
  L5 r16.
- SPICE: native `@rphase[i] = 1.92 A`, inside `[-2 A, +2 A]`; L5 r20.

## Projection checks

Read-only Workbench GET on r20 returned 20 engineering activities. The Modelica
activity contains both
`work-mcs02-run-admitted-modelica` and
`work-mcs02-run-admitted-modelica-r2` in one `revisionIds` chain. The first queued run
was cancelled before claim; no OMC provider call occurred for it.

`project_product_navigation_authoring_attachments` still observes the active RailFrame
attachment on r20 with `basisStatus: different-basis`. The corresponding historical
closure drill-down is currently `unavailable`; the sealed r4 admission is still carried
as exact historical Thread evidence.

## Current review localization

After the current worktree server was reloaded, the three execution reviews were called
again against MCS-02. Each returned one closed `CompilationAdmissionRunOperation` whose
`compilationAdmission` reference names Thread r20, not the admission creation revision:

- `design.execute-build123d@1` → CAD admission created at r4, localized at r20;
- `simulate.run-admitted-modelica@1` → Modelica admission created at r5, localized at
  r20;
- `simulate.run-admitted-spice@1` → SPICE admission created at r6, localized at r20.

The artifact ids remain the exact sealed identities listed in the domain pages. These
provider-free reviews returned no source bytes or runtime capability and changed no
project or Thread state.
