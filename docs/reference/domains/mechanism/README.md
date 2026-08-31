# Reference: mechanism

Audience: both · Diátaxis: reference · Kind: domain index

Mechanism owns bounded evidence about a declared, prescribed rigid-body motion. It does
not own static assembly integrity, CAD publication, provider selection, runtime
administration, or a product verdict.

| Read                                                                                    | Use it for                                                                                  |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [Implementation coverage](coverage.md)                                                  | What exists end to end, what is qualified separately, and what remains absent               |
| [Evidence claim boundary](prescribed-kinematics.md)                                     | The V1 engineering question and the claims its evidence cannot make                         |
| [Source contract](prescribed-kinematics-source-contract.md)                             | Exact canonical JSON, workspace file and architecture attachments                           |
| [Case and architecture binding](prescribed-kinematics-case-and-architecture-binding.md) | The exact source, workspace, assembly context, and body `PartUsage` identities that form L1 |
| [Evidence lifecycle](prescribed-kinematics-evidence-lifecycle.md)                       | The explicit L1 → L2 → L3 → L4 → L5 authority chain                                         |
| [Method and evaluation](prescribed-kinematics-method-and-evaluation.md)                 | Exact method sheet, five criterion kinds and deterministic L4 aggregation                   |
| [Operations](operations.md)                                                             | Brief authority, semantic capability, reviews and registered operations                     |
| [Boundedness](boundedness.md)                                                           | Enforced source, observation and provider bounds, plus literal missing limits               |
| [Observation recovery](../../pipeline/prescribed-kinematics-observation-recovery.md)    | The one-dispatch L3 WAL and unknown-outcome recovery boundary                               |
| [Chrono provider boundary](../../providers/chrono/README.md)                            | The private server-owned provider adapter and its non-claims                                |

How-to guides:
[verify prescribed kinematics](../../../how-to/verify-design/verify-prescribed-kinematics.md)
and
[recover a prescribed-kinematics observation](../../../how-to/run/recover-prescribed-kinematics-observation.md).
Shared extensions start at
[extend the mechanism product surface](../../../how-to/extend/extend-mechanism-product-surface.md).

## Availability is layered

The repository capability catalogue has an `unqualified` baseline. That is not a
statement that every host is unqualified forever. A particular host can carry one exact,
current qualification attestation for an emulated AMD64 runtime; that attestation is
host-local, binding-specific, and does not rewrite the catalogue or create product
evidence.

Even with that exact host attestation, product L3 requires all of the following:

- a project authorization for the provider-neutral prescribed-kinematics capability;
- the exact L2 MRTR and a sealed `resolved-operation-plan/2.0` for the registered L3
  operation;
- a current, writable Thread basis; and
- the server's JIT capability-session lease for the sealed runtime.

If any condition is absent, the result is `unavailable`; an agent must not select a
provider or substitute a direct provider call.

## Boundary with static assembly integrity

Static assembly integrity proves only its own static import, occurrence, placement,
BRep, and pairwise-intersection criteria. It does not infer bodies, joints, motion, or
mechanism availability. Conversely, a prescribed-kinematics L3 observation is factual
motion evidence, not a static-assembly, clearance, force, strength, safety, or product
fitness verdict. See [assembly integrity](../cad/assembly-integrity.md).
