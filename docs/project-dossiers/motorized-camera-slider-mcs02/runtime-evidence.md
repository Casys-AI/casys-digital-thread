# MCS-02 — runtime evidence

Audience: both · Diátaxis: none · Kind: tracking evidence

Local observation, primary atelier, **2026-08-25** Asia/Taipei. Gitignored runtime may
drift. These identities record what was reread; this page grants no authority.

## Current heads

- Engineering Project r146:
  `motorized-camera-slider-mcs02:project:r146:22874eb0e7f6ee79`.
- Thread r20:
  `project:motorized-camera-slider-mcs02:r20:decide-accept-admitted-spice-evaluation-run:mcs02-queue-spice-closeout-r142`.
- Workspace r16, event fingerprint
  `7a6352a1a22df54900d00bf0500f1fe88f227752ad7084f37fac7f3f07387757`.
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

Historical r20 observation, recorded under the retired MCP name and not rewritten:
`project_product_navigation_authoring_attachments` observed the active RailFrame
attachment with `basisStatus: different-basis`. The corresponding historical closure
drill-down was `unavailable`; the sealed r4 admission is still carried as exact
historical Thread evidence. The current public names are `project_product_inspect`
and `project_source_closure`.

## Product-navigation live recross

The current four-tool MCP surface was exercised on the loopback YOLO server after the
refactor. `tools/list` exposed exactly `project_product_explore`,
`project_product_search`, `project_product_inspect` and `project_source_closure`; no
retired `project_product_navigation_*` or `project_product_source_closure` alias was
registered.

`project_product_explore` reopened the exact r20 basis, including
`threadSubjectId: project:motorized-camera-slider-mcs02`, and returned the
`MotorizedCameraSlider` root plus seven `PartUsage` children. Searching `RailFrame`
returned its exact `PartDefinition` and `PartUsage` identities. The first inspect kept
the historical RailFrame attachment r1 visible as `different-basis`, and the matching
closure call failed literally as `unavailable / basis.stale`.

The server recovery was then executed without changing source bytes: attachment
`mcs02.attachment.rail-frame` advanced from r1 to r2 against the exact r20 Thread and
unchanged architecture fingerprint. Workspace r16 reopened that successor as
`exact-basis`. Its ready closure call returned `observed` with fingerprint
`ad9c55638cb0d4003011bc059269456ce3e6750629ed11acbdeeb223fb0e51c6`, one exact
`mcs02.rail-frame@2` CAD file and zero dependency edges. This proves both the
fail-closed historical path and the positive current-basis path; it does not add an
assembly claim.

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
