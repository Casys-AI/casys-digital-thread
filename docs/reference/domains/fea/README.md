# Reference: FEA domain

Audience: both · Diátaxis: reference · Kind: index

The FEA bounded context owns catalogued mechanical proof declarations, isolated CalculiX
static solves, and the evidence/evaluation boundary. Proof cases are data-driven server
manifests; a case label or past result never selects a solver deck. A new project case
is one validated JSON declaration plus one manifest entry; new physics remains a
shared-schema and lowering change, not catalog data.

- [Mechanical proof case V1](mechanical-proof-case-v1.md) defines the catalogued
  declaration and seal boundary.
- [CalculiX static proof V3](calculix-static-proof-v3.md) defines generic lowering of a
  sealed proof and exact STEP into the isolated CalculiX worker.
- [Coverage](coverage.md) separates the product surface, exclusions, and future method
  candidates.
- [Extension runbook](../../../how-to/extend/fea-surface.md) lists the required
  schema-to-proof path for a new FEA capability.

The shared product sequence is `project_fea_proof_seal_review` →
`verify.seal-proof-case@1` → `project_fea_isolated_run_review` →
`verify.run-fea-static-proof@3`.
