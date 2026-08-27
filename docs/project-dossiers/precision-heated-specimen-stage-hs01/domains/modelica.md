# HS01 — Modelica

Admitted closed-subset v2 path. Not the qualified kit.

## Worked

- Source [HeatedStagePlate.mo](../sources/HeatedStagePlate.mo) = CAS
  `7384350d…7085`.
- Admission r8 `technical-compilation-admission-3dcf2ab2…d7b9`
  (`hs01-queue-modelica-admission-r55`).
- L3 r9 `simulate.run-admitted-modelica@1` run `hs01-queue-modelica-run-r62`.
  OMC 1.27.0 / DASSL, 0–120 s, interval 1 s, tolerance `1e-6`.
  `temperature.final` = `temperature.max_abs` = `305.1378579691034 K`.
  Parameters used: `298.15 K`, `5 W`, `0.5 W/K`, `50 J/K`.

Thread artifacts: capture `d960c4e4…7fb4`, evidence `cd06eafb…573a`, result
`a703437b…1461`. Status `succeeded`. Limitations: documentary L3, not a spatial
thermal proof.

## Initial evaluation (archived)

The first resource-backed method sheet was sealed at r16
(`modelica-thermal-method-sheet-seal-ba9a0bc7…6eda`, sheet
`hs01-heated-stage-thermal-method-r1`, typed fingerprint `571d0d47…91d4`).
The initial r17 `verify.evaluate-admitted-modelica-observations@1` capture
`accfccc2…afbd` is **`unresolved`**, not a fail: three criteria share
RequirementUsage `c1f…`, and the old selector chose the first occurrence
(`maxDisplacement`). That closeout never existed.

r23 `record.archive-lineage@1` (`hs01-queue-lineage-retirement-r161`) retired
that method sheet, the r17 evaluation, the ambiguous `maxDisplacement`
evaluation row, and the first impact seal/evaluation that consumed them.
Append-only archive; r17 was not rewritten.

## AX successor — r24 / r25 / r26

AX requires `requirementMetric` in each method-sheet output and output
binding, and resolves the exact `(RequirementUsage, metric)` pair before
evidence, SysON or MRTR. The r2 source
[hs01-thermal-method-sheet.json](../sources/hs01-thermal-method-sheet.json)
identifies `temperature`.

An unexecuted r1-on-r22 correction work item was abandoned
(`work-hs01-seal-thermal-method-r22-correction`). The live successor is
`work-hs01-seal-thermal-method-r23-r2` on the r23 Thread basis:

- r24 `verify.seal-modelica-thermal-method-sheet@1` run
  `hs01-queue-thermal-method-r2-r168` sealed
  `hs01-heated-stage-thermal-method-r2`, typed fingerprint `6a5aabdd…c42f`,
  document `modelica-thermal-method-sheet-seal-8a15f3ab…51b0`.
- r25 `verify.evaluate-admitted-modelica-observations@1` run
  `hs01-queue-modelica-evaluation-r2-r175` captured
  `modelica-admitted-observation-evaluation-f61032db…6887`. SysON evaluated
  `temperature ≤ 313 K` with actual `305.1378579691034 K`, status **`pass`**,
  margin `7.862142030896621 K`. `unresolved: []`.
- r26 `decide.accept-admitted-modelica-evaluation@1` run
  `hs01-queue-modelica-closeout-r2-r182` accepted
  `modelica-admitted-observation-evaluation-closeout-c6f4fa39…f18c`. Limits
  include `engineCalls: none` and `l4PassIsNotL5: true`.

This L5 is the sealed lumped scalar method only. It is not spatial
uniformity, contact, convection, or a whole-stage thermal claim.

## Friction

Lumped 0-D model. Brief excludes uniformity, convection, contact, coupled
thermo-mechanics. The `.mo` and method sheet both used generic resource
ingress. The typed method-sheet fingerprint remains distinct from its raw CAS
digest. Archive of r16/r17 did not mutate those snapshots.
