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
`a703437b…1461`. Status `succeeded`. Limitations: documentary L3, not L4,
not a spatial thermal proof.

## Initial evaluation and AX replay

The resource-backed [hs01-thermal-method-sheet.json](../sources/hs01-thermal-method-sheet.json)
was sealed at r16. The initial r17
`verify.evaluate-admitted-modelica-observations@1` capture is **`unresolved`**,
not a fail: three criteria share RequirementUsage `c1f…`, while the old
selector chose the first occurrence. The resulting closeout review is therefore
ambiguous/unresolved and no thermal L5 exists.

AX makes `requirementMetric` breaking-required in both the output and its
output-requirement binding. Current resolution is the exact pair
`(requirementElementId, criterion.metric)` and a zero, multiple or ambiguous
match fails the review before evidence, SysON or MRTR. The checked-in successor
source identifies `temperature`; it must still be resource-recaptured with a new
typed fingerprint, sealed, evaluated and closed. Do not promote the initial
313 K comparison to a verdict or rewrite r17.

## Friction

Lumped 0-D model. Brief excludes uniformity, convection, contact, coupled
thermo-mechanics. The `.mo` and method sheet both used generic resource ingress.
The typed method-sheet fingerprint remains distinct from its raw CAS digest.
