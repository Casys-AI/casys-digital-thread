# Reference: mechanical proof case and its execution receipt

> **Diátaxis category: reference.** This page describes
> [`mechanical-proof-case.ts`](../../src/domain/analysis/mechanical-proof-case.ts), the
> reviewed cases under
> [`config/mechanical-proof-cases/`](../../config/mechanical-proof-cases/), and the run
> that turns one into evidence.

`mechanical-proof-case/1.0` is a strict declaration of candidate analysis inputs. The
declaration itself is never a solver result or thread evidence — its validator checks
JSON shape, units, bounded values, identities and internal consistency only. The
execution receipt is a separate contract, described at the end of this page.

Editing or validating the file cannot authorize a run or create evidence. The file
becomes effective only once `verify.seal-proof-case@1` resolves it through the
server-owned catalog `FEA_PROOF_CASE_SOURCES`, verifies every clear-text MRTR parameter
against the canonical bytes, and publishes it as a content-addressed thread artifact. A
proof case absent from that catalog is refused by name — a JSON file on disk is not an
authority.

## Declared scope

| Area               | What the declaration records                                                | What validation does not prove                              |
| ------------------ | --------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Project context    | Project, subject, exact base `ThreadSnapshot`, target and model-element IDs | That the target exists in the live project or model         |
| Review pointers    | Work-item and decision IDs                                                  | That a human approved the current proposal fingerprint      |
| Requirement source | SysON editing-context and element IDs                                       | That SysON was queried or returned the declared constraints |
| CAD                | Source limitations and expected STEP SHA-256 plus byte count                | That these bytes were generated or consumed by CalculiX     |
| Analysis           | Linear-static material, target mesh size, fixed supports, forces and limits | That these values became effective provider arguments       |
| Solver             | Intended `calculix_solve_static` result schema                              | That a call ran, succeeded, or produced a result            |

Version 1 accepts one isotropic linear-elastic material, a positive tetrahedral target
size, non-empty fixed supports and force loads, and exactly the displacement and von
Mises upper-bound criteria. Support and load selection boxes are closed and must not
overlap; touching faces or edges are rejected because they may select shared entities.

`elementOrder` is deliberately absent. The registered generic proof route does not carry
an element order into its reviewed effective arguments, so the declaration rejects that
field rather than recording a value the workflow cannot enforce.

## Two distinct authorities: seal, then execution

The `authorization` object carried by a `mechanical-proof-case/1.0` is the **historical
seal authorization** only. Its `workItemId` and `decisionId` identify the human-reviewed
`verify.seal-proof-case@1` work that turned the declaration into a sealed thread
artifact. It establishes neither a queued solver run nor permission to execute one.

`verify.run-fea-static-proof@2` has a separate **execution admission**: its own work
item, exact run basis, server-sealed `resolved-operation-plan/2.0`, and its own MRTR
approval. The plan binds the sealed proof and geometry artifacts as inputs; it does not
copy or reinterpret the old seal decision. The two decisions are expected to have
different IDs and may occur in different project revisions. Equality between a proof
case's seal references and the `@2` run's admission references is therefore a rejection
of a valid two-stage history, not a safety check.

Both stages remain fail-closed. The seal is accepted only when its declared work,
decision, approved brief binding, completed trusted run, sealing timestamp and resulting
artifact can be verified from immutable project and thread history. The execution is
accepted only when the new plan, run MRTR, exact basis and bound artifacts independently
verify. Neither successful seal nor queued execution is a CalculiX result.

## Limited identity binding

`validateMechanicalDeclarationIdentityBinding()` compares only project, subject, base
snapshot, target, CAD-source, and expected CAD-byte identities. Its input type is named
`MechanicalDeclarationIdentityBinding` to make that limited claim explicit.

It does not bind material, mesh, supports, loads, requirement limits, decision state,
SysON extraction, provider operation, or result content. A successful identity match
must never be presented as a fail-closed execution attestation.

## The execution receipt, and what it binds

`verify.run-fea-static-proof@1` is the earlier execution receipt. Its additive `@2`
successor uses the distinct execution admission described above. Both re-read the sealed
case, re-verifies the requirements tip on the execution basis, stages the exact STEP
bytes under a purely content-addressed name, dispatches CalculiX with three-point
SHA-256 cross-attestation, evaluates through `syson_constraint_evaluate` at native
units, and publishes observations, evaluations and any named violations with proposed
actions. A `fail` verdict is publishable; `error` and `unresolved` never become `pass`.

The earlier `@1` receipt ran on 2026-08-10, on `desk-lamp-dl03` (thread r9) and
`desk-lamp-dl04` (thread r8). Both published a mechanical verdict on an isolated
articulated arm. `desk-lamp-dl04` is now the generic candidate for a real `@2`
qualification, but no `@2` success may be claimed until that new run is captured,
persisted and read back.

### Provenance a published run must satisfy

Building the extension is not enough; the merged snapshot must pass
`validateThreadSnapshot`. Three rules govern it, and each one rejected the first real
run before it was met:

1. **Every artifact-to-artifact `derived_from` needs a verified consumption** in which
   the downstream producer attests the upstream fingerprint it read. The verdict
   declares three inputs — solver result, sealed proof case, sealed requirements — so it
   owes three attestations, not one. A derivation without its consumption is asserted
   rather than demonstrated.
2. **Every verified consumption needs its `uses` link back** to the artifact it attests.
   The consumption is the attestation; the link is what makes it reachable from the
   graph.
3. **An evaluation names the thread requirement, never the proof-case id.** A proof case
   names its requirements locally; the thread names them
   `requirement-<sealed artifact digest>-<metric>`. The executor resolves each one by
   sealed source artifact plus metric and stops the run unless the match is unique —
   keeping the local id evaluates a subject the snapshot does not contain.

### Failure that cannot be retried blindly

An error after CalculiX acknowledges the dispatch quarantines the run: it may not be
retried automatically, and the write-basis guard blocks its sibling runs until a human
reconciles it through `record.reconcile-uncertain-writer@1`. The terminal receipt
carries the structural cause verbatim and bounded — without it a quarantined run cannot
be diagnosed from its own record, which is exactly how one project stalled for a day. If
inspection accepts an uncaptured write effect, reconciliation does not lift the lock:
the server opens a separate exact basis-release decision, and the guard requires its
re-hashed proposal plus one matching human approval before any sibling writer proceeds.
