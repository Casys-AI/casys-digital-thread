# Domain reference: mechanical proof-case source

Audience: both · Diátaxis: reference · Kind: domain contract

`mechanical-proof-case-source/1.0` is the closed agent-authored engineering intent for
the current static-mechanical CalculiX capability. Capture stores canonical JSON in
draft CAS. It is not a Thread document, not a solver deck, and not the compiled
`mechanical-proof-case/1.0` sealed later by `verify.seal-proof-case@1`.

Source contracts:

- [`mechanical-proof-case-source.ts`](../../../../src/domain/fea/seal-case/mechanical-proof-case-source.ts)
- [`fea-proof-case-source-capture.ts`](../../../../src/domain/fea/seal-case/fea-proof-case-source-capture.ts)

The compiled internal declaration remains
[Mechanical proof case V1](mechanical-proof-case-v1.md). Historical JSON under
`src/testing/fixtures/fea/mechanical-proof-cases/` is **not** live authority.

## Agent source

| Area     | `mechanical-proof-case-source/1.0` accepts                                            |
| -------- | ------------------------------------------------------------------------------------- |
| Identity | `id`, `revision`, `scope`, `evidenceBoundary`                                         |
| Project  | `project.id` and `project.subjectId` only                                             |
| Target   | `target.id` and `target.modelElementId`                                               |
| SysML    | `requirementsSource.editingContextId` and `elementId` (no provider)                   |
| Analysis | `linear-static`, isotropic linear-elastic material, tetrahedral mesh                  |
| Supports | One or more fully `fixed` closed mm boxes                                             |
| Loads    | One or more non-zero force vectors in `N` on closed mm boxes                          |
| Criteria | One or two positive upper bounds: `maximum-displacement` / `maximum-von-mises-stress` |

Numeric values stay sourced project data. Units and operators stay the closed capability
(`MPa`, `mm`, `N`, `Pa`, `<=`).

## Forbidden

The source must not contain `baseThreadSnapshot`, `authorization`,
`requirementsSource.provider`, solver/provider/tool/result schema, CAD
provider/tool/provenance, expected STEP hash/bytes, provider envelope, `.inp`,
image/profile/runtime/timeout/`elementOrder`, artifact URI/path, verdict, or
fingerprint. Extra keys fail closed.

## Capture and compile

1. `project_fea_proof_case_capture` takes a full `resourceRef` from
   `project_resource_capture` (max 262144 bytes). The server reopens exact UTF-8 JSON,
   parses, validates, stores canonical JSON, rereads it, and returns
   `fea-proof-case-source-capture-review/1.0` with opaque `reference.fingerprint` only.
   That case fingerprint may differ from the raw resource SHA. Grants none. No project
   or Thread mutation.
2. `project_fea_proof_seal_review` takes `projectId` + `caseRef.fingerprint` and
   optional `sensitivityCatalogOptIn`. The server selects the unique current Thread tip
   — never `latest` — and recrosses unique canonical part STEP, CAD provenance, SysON
   requirements, the fixed CalculiX contract, and deterministic
   `workItemId`/`decisionId` from source identity/revision.
3. `verify.seal-proof-case@1` reopens that exact source and repeats the same recross. It
   does not call `catalog.read` or select by `caseId`.

MRTR `fea.proof.source.fingerprint` names the captured source. `fea.proof.digest` still
names the fully compiled case.
