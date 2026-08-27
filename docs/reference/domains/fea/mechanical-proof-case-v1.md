# Domain reference: mechanical proof case V1

Audience: both · Diátaxis: reference · Kind: domain contract

`mechanical-proof-case/1.0` is the **compiled** internal declaration consumed by the
current static FEA method. Agents do not author this document. They author
[`mechanical-proof-case-source/1.0`](mechanical-proof-case-source.md); the server
recrosses Thread CAD, STEP, SysON and authorization facts, then validates this compiled
form. Validating or sealing it does not mesh a part, run CalculiX or establish a
requirement verdict.

Source contracts:

- [`mechanical-proof-case.ts`](../../../../src/domain/fea/seal-case/mechanical-proof-case.ts)
- compiled from
  [`mechanical-proof-case-source.ts`](../../../../src/domain/fea/seal-case/mechanical-proof-case-source.ts)

Historical vehicle JSON under `src/testing/fixtures/fea/mechanical-proof-cases/` is
test/conformance data only. It is **not** live production authority.

## Accepted compiled case

| Area     | `mechanical-proof-case/1.0` accepts                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------ |
| Identity | Exact project, subject, base Thread snapshot, target and model-element ids                                               |
| CAD      | Parametric or imported/reconstructed provenance, engineering limitations, and expected STEP SHA-256 plus byte count      |
| Analysis | `linear-static` only                                                                                                     |
| Material | One `isotropic-linear-elastic` material; positive Young's modulus in `MPa`; Poisson ratio strictly between `0` and `0.5` |
| Mesh     | `tetrahedral-volume`; positive target size in `mm`                                                                       |
| Supports | One or more fully `fixed` supports selected by closed axis-aligned boxes in `mm`                                         |
| Loads    | One or more non-zero force vectors in `N`, also selected by closed axis-aligned boxes                                    |
| Criteria | **One or two** positive upper bounds: `maximum-displacement` in `mm`, `maximum-von-mises-stress` in `Pa`, or both        |

Support and load selection names are unique. Their closed boxes must not overlap; even
touching faces or edges are rejected because they can select shared mesh entities. IDs,
features and requirement metrics are unique within the case.

The solver result contains both maximum displacement and maximum von Mises stress. The
Thread publishes an observation only for each criterion actually declared by the proof
case. Therefore one declared criterion is valid; both are not mandatory.

`elementOrder` and timeout are deliberately absent from this schema. The server adds the
effective element order (`1 | 2`) and timeout to the separately reviewed run plan. Their
absence from the proof declaration does not mean the isolated worker runs without them.

## Not admitted by V1

These are outside this case contract even when the CalculiX engine can support a related
native feature:

- modal, buckling, dynamic, thermal, creep or coupled analyses;
- geometric or material nonlinearity, plasticity and contact;
- orthotropic, hyperelastic, temperature-dependent or multiple materials;
- beam or shell models and non-tetrahedral mesh declarations;
- pressure, moment, gravity/body-force, temperature or prescribed-displacement loads;
- pinned, roller, spring or contact supports;
- fatigue, factor-of-safety, reaction-force, principal-stress or lifetime criteria.

Adding one of those capabilities requires a new versioned case and qualified method. It
must not be smuggled into V1 through an extra JSON field or a hand-written solver deck.

## Authority

`project_fea_proof_case_capture` is the public authoring capture. Production does not
select preinstalled desk-lamp, dl, CA, or other Git catalog cases. The caller does not
send material, mesh, loads, boxes, hashes, units or SysON identifiers.

`project_fea_proof_seal_review` is read-only. It takes `projectId` plus opaque
`caseRef.fingerprint`. The agent uses its returned `next.append.arguments` and
`next.propose.arguments`; a human signs the exact MRTR.
`verify.seal-proof-case@1` then reopens the signed source capture, recrosses the unique
current Thread tip, and publishes a content-addressed Thread document.

The compiled `authorization.workItemId` and `authorization.decisionId` identify that
seal decision only. Running [`verify.run-fea-static-proof@3`](calculix-static-proof-v3.md)
requires a new plan, work item and MRTR bound to the sealed proof and canonical STEP.

Operational guide:
[compile FEA parameters](../../../how-to/compile/compile-fea-parameters.md).
