# Thread-workflow — frozen authoring prototype

**Prototype only. No production lifecycle. Do not wire into `server.ts` or the operation
registry.**

This directory holds the YAML DAG authoring prototype: the reviewed grammar
(`coffee-machine-mechanical-v1.yaml`), its loader → compiler → executor engine, and 14
tests. It was built early in the repo's history, before the server-fixed executor
template existed. A reviewed design decision (2026-08-09, sol design critique, recorded
in the FEA generalization dossier) froze it in favour of option B: physical verification
runs are implemented as generic trusted executors in the registry template (MRTR →
fail-closed parse → WAL → dispatch → readback → content-addressed capture → validated
snapshot extension), which this engine does not provide — it has no claim/lease, no WAL,
no capture persistence, no snapshot publication, and no MRTR gate.

Why it is kept instead of deleted:

- the YAML is the only machine-validated specification of the 4-step FEA proof sequence
  (constraints → solve → normalize → evaluate);
- `executor_test.ts` holds the only end-to-end black-box test of "evaluation is blocked
  when the cross-attestation hashes mismatch";
- its DAG semantics (independent branches proceed when a sibling fails) are a reference
  if a multi-branch verification ever becomes a real need.

`production-boundary_test.ts` enforces the freeze: no module under `server.ts`, `src/`,
or `scripts/` may import from this directory. A documentary path reference (e.g. the
CM-01 kit qualification metadata) is allowed; an import is not.
