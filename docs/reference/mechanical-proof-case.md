# Reference: candidate mechanical-analysis declaration

> **Diátaxis category: reference.** This page describes
> [`mechanical-proof-case.ts`](../../src/domain/mechanical-proof-case.ts) and the
> tracked CM-01 example under
> [`config/mechanical-proof-cases/`](../../config/mechanical-proof-cases/).

`mechanical-proof-case/1.0` is a strict declaration of candidate analysis inputs. It is
not an execution receipt, solver result, project authorization, or canonical thread
evidence. The validator checks JSON shape, units, bounded values, identities, and
internal consistency only.

The declaration is not loaded by the CM-01 mechanical runner, its capture adapter, or
the workflow executor. Editing or validating it therefore cannot authorize a run, change
the effective CalculiX arguments, or create evidence.

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

`elementOrder` is deliberately absent. The current CM-01 runner does not carry an
element order into the reviewed effective arguments, so the declaration rejects that
field rather than recording a value the workflow cannot enforce.

## Limited identity binding

`validateMechanicalDeclarationIdentityBinding()` compares only project, subject, base
snapshot, target, CAD-source, and expected CAD-byte identities. Its input type is named
`MechanicalDeclarationIdentityBinding` to make that limited claim explicit.

It does not bind material, mesh, supports, loads, requirement limits, decision state,
SysON extraction, provider operation, or result content. A successful identity match
must never be presented as a fail-closed execution attestation.

## Gap to a fail-closed execution receipt

A future runner integration needs a separate durable receipt that binds all of the
following to one immutable run:

1. the exact project revision, human decision, approved proposal fingerprint, and actor;
2. the exact SysON project/editing context and extracted constraint response, including
   a stable revision or content fingerprint;
3. the canonical effective material, mesh, support, load, force, and limit arguments
   actually sent to the provider;
4. the consumed STEP SHA-256 and byte count, provider operation identity, result schema,
   solver outcome, output hashes, and normalized requirement evaluations;
5. the resulting canonical `ThreadSnapshot` and project-run transition that cite that
   receipt.

Until such a receipt is implemented and checked at the execution boundary, this schema
remains a reviewable candidate declaration only. The existing
[`run-coffee-machine-mechanical.ts`](../../scripts/run-coffee-machine-mechanical.ts)
continues to derive its inputs from the approved project proposal and does not consume
this file.
