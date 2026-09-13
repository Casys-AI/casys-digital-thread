# ID01 — bench revalidation revision 3

Observed 2026-09-07 UTC. Local evidence ledger; project state and immutable captures
remain authoritative. This is the resumed camera-weight bench case, not an installed
mounting or whole-drone proof.

## Source and seal

The source [revision 3](sources/camera-bracket-bench-proof-r3.json) preserves revision
2's target, native requirement source, material, mesh, supports, loads, units and
criterion. Only the case revision and explanation of the resumed review changed.
Revision 2's proposal had been cancelled before execution; its signed Thread r82 basis
cannot be reused as the current r83 review. The public review of that old source
returned `compiled-identities-conflict`, preserving the original declared work.

- Raw source: 5,577 bytes, SHA-256
  `8b5f562dbd2f2f3a2f923d08470e3b7773e0259f11a86da651042dec76ebf308`.
- Parsed source capture:
  `1e6d220c8fd16c73b42ee2d0b4e1dd640b0510dd7d4363176ddfb9efc4124912`.
- Project source file `id01-camera-bracket-bench-proof@3`, workspace r125, preserves
  file revisions 1 and 2 and the existing attachment.
- The registered attachment recross created
  `id01-camera-bracket-bench-proof-attachment@3` at workspace r126, explicitly against
  Thread r84 and the unchanged current architecture.
- Exact new seal review: Thread r83; work item
  `wi-proof-seal-id01-camera-bracket-bench-r3`.
- Seal MRTR fingerprint:
  `6589fccb5d4e248225512868a507f99182f8074a6b187572b4dcd800f06b08c2`.
- The explicitly authorized local YOLO confirmation recorded the approval at project
  r594. Run `run:id01-queue-bench-r3-seal-20260907` completed at project r598, Thread
  r84, artifact
  `fea-proof-184773c90be51e12e52c958cb1f92027969959e0b7af21f3a95b774e4219dcea`.
- Compiled proof digest:
  `cc0c0f83875bd4b82f3356fc88ae3565a8cc1443f51532579c38fdfce2b5600f`.

This is live evidence that the current server crosses F10's former 50-ancestor ceiling
by checking the full intact history. The correction was already in checkpoint
`5429a854`; this resumption changed no platform code to bypass a guard. The historical
refusal remains recorded.

## Published calculation and accepted closeout

The exact new sealed proof was selected explicitly because the current Thread carries
two proof documents. The server generated `verify.run-fea-static-proof@3` bindings to
that proof and the unchanged canonical bracket STEP
`b821e5598b75449636eb57d0ea7db48ea560260ce56a6872ebeaec0f7691d201`.

- Work: `work-fea-isolated-cc0c0f83875bd4b8-r84`.
- Run: `run:id01-queue-bench-r3-fea-20260907`.
- MRTR: `a80be8188d85681ba42e26799fd3989b21d1b8faebce11aba78f9ba9b6e2f72e`; local YOLO
  approval at project r601, queue r602, execution claim r603.
- Execution identity:
  `calculix-isolated-dbfecf3404af3c0d746541ad0a86360e255d202fda2049e2fa16115205b14562`.
- Captured execution evidence:
  `0a8b0ce10c8a8868b15e03a1b18bbd2956d0a36ff1b3da5346e9cf253932cb2b`.
- Captured `result.json`:
  `a37a3aa6d4d7389ee9fafbf7db1dbee05c68d8a452b65d1df7fa563eb7a4bae4`.
- Captured SysON evaluation:
  `0c74b341303b1402f2b7f75576f868545bdaa049cc6690329f00441715e86d29`.

The new solver evidence reports maximum von Mises stress `0.00763815636944611 MPa` and
maximum displacement `0.00001733611556368841 mm`. The oracle response has one `pass`,
comparing `7638.15636944611 Pa` with `260000000 Pa`, with a `259992361.84363055 Pa`
margin.

The first publication attempt failed after both immutable captures existed:

```text
Thread artifact calculix-isolated-input-step-b821e5598b75449636eb57d0ea7db48ea560260ce56a6872ebeaec0f7691d201 conflicts with an already attached artifact.
```

At that point the product WAL was `evaluation-captured`, with no successor snapshot, and
the public run was `running` at project r603. This was a publication failure after
captured computation, not a still-running solver or an uncertain SysON dispatch.

Read-only verification reopened the execution evidence through its typed CAS reader and
independently rehashed all nine output files (8,041,705 bytes total). Their exact hashes
and byte lengths match the captured receipts. The worker attempt records one dispatch,
at `2026-09-07T13:33:36.428Z`, producer generation 0. The original command is
`id01-execute-bench-r3-fea-20260907`, expected project revision 602, issued at
`2026-09-07T13:33:04.000Z`; recovery must retain that identity and the exact run.

The root cause was the digest-only identity of a repeated FEA output branch even though
its producer run is different. The generic correction in checkpoint `0ff72880` keeps
legacy identities when no conflict exists and, on an exact entity conflict, scopes the
entire eleven-artifact branch by the exact Thread run id. Closeout and viewer consumers
accept only the coherent legacy layout or the coherent matching-run layout; mixed,
prefix-only and cross-run layouts remain refused. The bounded gate passed 54 focused
tests, whole-repository type checking, format checks and an independent Terra review.

After controlled local-server adoption, the original execution command
`id01-execute-bench-r3-fea-20260907` was submitted again with the same expected project
revision, issued-at time and run id. It resumed the existing `evaluation-captured` WAL,
published all eleven run-scoped artifacts and completed at project r605 / Thread r85.
The raw worker attempt remains `evidence-captured` with `dispatchCount: 1`; no second
CalculiX solve or SysON evaluation was dispatched.

The published L4 join is `pass` with the exact comparison above. The server then
reopened the r85 branch for closeout with Thread fingerprint
`be1b21e32fd3bdc55e47f5253a29abb2ce860f587e8ac84f7159cb0884bb3c0c` and one eligible
passing criterion. Decision `decision-id01-camera-bracket-bench-r3-closeout-20260907`
bound the exact 39 returned parameters under fingerprint
`662eafa6bbf7b12f074fbe8c5d8420a2d1fe24ca0276daa9d3d0ce8ab4b85003`. The explicitly
authorized local YOLO path recorded human-origin approval at project r608. Run
`run:id01-queue-bench-r3-closeout-20260907` completed at project r612 / Thread r86 with
artifact
`evaluation-closeout-f16c5fd31e7dfa930bb6ad2c1b315607a4dbcb209ac211ee51e0c8a003e24378`.

## Remaining scope

The checkpoint UI commit is `cfaa3690`; its Brief-viewer duplication remains a known
follow-up. Current geometry and root integrity evidence are unchanged. The L5 acceptance
closes only this exact camera-weight bench branch and retains every sealed limitation.
Physical interfaces, fasteners, operational loads, electrical integration and
flight-related questions remain unresolved. No pilot completion, whole-aircraft
strength, flight suitability, manufacturing or certification is claimed.
