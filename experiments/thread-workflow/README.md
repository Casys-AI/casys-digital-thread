# Thread-workflow — frozen authoring prototype

**Prototype only. No production lifecycle. Do not wire into `server.ts` or the operation
registry.**

This directory holds the loader, compiler and executor mechanics of the YAML DAG
authoring prototype, plus their tests. It was built early in the repo's history, before
the server-fixed executor template existed. A reviewed design decision (2026-08-09)
froze it in favour of generic trusted executors in the registry template (MRTR →
fail-closed parse → WAL → dispatch → readback → content-addressed capture → validated
snapshot extension), which this engine does not provide — it has no claim/lease, no WAL,
no capture persistence, no snapshot publication and no MRTR gate.

Why it is kept instead of deleted:

- `executor_test.ts` holds the only end-to-end black-box test of "evaluation is blocked
  when the cross-attestation hashes mismatch";
- its DAG semantics (independent branches proceed when a sibling fails) are a reference
  if a multi-branch verification ever becomes a real need.

`production-boundary_test.ts` enforces the freeze: no module under `server.ts`, `src/`,
or `scripts/` may import from this directory. Documentation may describe the prototype;
production imports are forbidden.
