# Reference: FEA domain

Audience: both · Diátaxis: reference · Kind: index

The FEA bounded context owns agent-authored mechanical proof **source**, server-compiled
proof declarations, isolated CalculiX static solves, and the evidence/evaluation
boundary. A case label or past result never selects a solver deck. A new project case is
one validated `mechanical-proof-case-source/1.0` JSON capture; new physics remains a
shared-schema and lowering change, not catalog data.

- [Mechanical proof-case source](mechanical-proof-case-source.md) defines the closed
  agent document and public capture.
- [Mechanical proof case V1](mechanical-proof-case-v1.md) defines the compiled internal
  declaration and seal boundary.
- [Boundedness](boundedness.md) inventories source/declaration cardinality and the
  fixed CalculiX byte and output-role ceilings.
- [CalculiX static proof V3](calculix-static-proof-v3.md) defines generic lowering of a
  sealed proof and exact STEP into the isolated CalculiX worker.
- [Coverage](coverage.md) separates the product surface, exclusions, and future method
  candidates.
- [Extension runbook](../../../how-to/extend/extend-fea-product-surface.md) lists the required
  schema-to-proof path for a new FEA capability.

The shared product sequence is `project_fea_proof_case_capture` →
`project_fea_proof_seal_review` → `verify.seal-proof-case@1` →
`project_fea_isolated_run_review` →
`verify.run-fea-static-proof@3`, then human L5 closeout
([review static-mechanical closeout](../../../how-to/verify-design/close-out-a-static-mechanical-proof.md)).
Cross-domain `analyze.evaluate-mechanical-preservation@2` rereads that exact
proof/closeout after an impact decision; it does not run CalculiX. Impact
inventory: [impact coverage](../impact/coverage.md).
