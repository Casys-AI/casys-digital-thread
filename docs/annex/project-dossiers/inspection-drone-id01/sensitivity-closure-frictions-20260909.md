# ID01 sensitivity closure frictions — 2026-09-09

Scope: the real `arm_height` 5 → 6 mm finite-difference study, its requirement
evaluation, and its typed sensitivity relation. This note is separate because the main
ID01 friction ledger was being edited concurrently; no concurrent entry was overwritten.

| ID                   | State          | Friction                                                                                                                                                                                                                                                                                                                          | Evidence / disposition                                                                                                                                                                                         |
| -------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ID01-SENS-CONTROL-01 | closed         | The public control plane could check the study-to-requirement join but emitted no typed MRTR/next hop for `verify.evaluate-sensitivity-base@1`, and exposed no review route for `model.write-sensitivity-edges@1`.                                                                                                                | Added closed `sensitivity-study-consumer-admission/1.0`, both read-only reviews, proposal grammar gates, executor recross, and tests. Live completion produced Thread r96 and r97.                             |
| ID01-SENS-CONTROL-02 | closed         | Refreshing a consumer review after `project_change_append` returned `compiled-identities-conflict`, so a client that did not retain the first response could not recover the still-pending proposal step. Observed live at project r694.                                                                                          | Consumer reviews now emit `propose-only` only after exact append audit, phase/work/decision, binding, untouched status, current Thread head, and no-run checks. Drift remains fail-closed.                     |
| ID01-RUNTIME-VIEW-01 | deferred       | Capability review can report top-level `covered` while its full append-only ledger still contains the historical blocked Build123d administrative-lock event. The state is correct but the raw response is easy to misread as a current blocker.                                                                                  | No authority or ledger history was rewritten. Keep the top-level effective state and latest authorization explicit in future projection work.                                                                  |
| ID01-SENS-UX-01      | closed-in-code | The Overview domain classifier does not recognize `analyze.run-fea-sensitivity@1` or `verify.evaluate-sensitivity-base@1`. It therefore fails closed to `unassigned`, rendered as `Recorded items` in separate Physics and Verdict hulls, even though the engineering graph contains the measured parameter-to-response relation. | Mapping now exists in `src/ui/src/project/overview/hulls/domain-groups.ts` (FEA hull). Workbench Physics 18/20 Planned is the Path leftover `wi-proof-seal-id01-camera-bracket-bench-r2`, not this classifier. |

The completed study remains a local two-point result under the sealed load, material,
mesh, boundary conditions, and 5–6 mm neighborhood. It is not a global optimizer,
whole-drone qualification, or flight evidence.

**2026-09-12 historical projection (read-only, original ID01 bytes unchanged):** the
same measured study
`sensitivity-study-72093069ff760744dc7726bef90005c18de2977790fc8e2e026b49699928d8a9` and
evaluation
`sensitivity-base-evaluation-9bf8e4d4cd0f2993297902226bdfeba70e854d68e08dfa21c6ce40812b0514da`
appear as a historical measured relation on the current RadialArm `PASS` row (1 hop, 2
historical evaluations, plural `sourceArtifacts[]`). That current `PASS` is unchanged
read-only fact on r882 / Thread r118; the historical evaluations do not cause or
authorize it. That is not a new study, not current-requirement recross, and not F27
reuse.
