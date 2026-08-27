# How-to: compile FEA seal parameters and isolated-run bindings

Audience: agent · Diátaxis: how-to · Kind: how-to

Call `project_fea_proof_case_capture` then these two read-only tools instead of typing
`fea.proof.*` or guessing the `geometry` binding. Capture writes draft CAS only. The
reviews write nothing and grant no MRTR.

There is no `fea.run.*` grammar. Product run is isolated
`verify.run-fea-static-proof@3`. Historical MCP `@1`/`@2` are not registered.

Domain contracts:
[mechanical proof-case source](../../reference/domains/fea/mechanical-proof-case-source.md),
[mechanical proof case V1](../../reference/domains/fea/mechanical-proof-case-v1.md)
and [CalculiX static proof V3](../../reference/domains/fea/calculix-static-proof-v3.md).

A new project proof adds one validated `mechanical-proof-case-source/1.0` JSON capture.
Do not add TypeScript, a Git catalog row, or a desk-lamp/dl/CA fixture. A new
physics/method needs shared schema, generic lowering, and qualification; do not try to
encode it as another V1 catalog field.

Historical JSON under `src/testing/fixtures/fea/mechanical-proof-cases/` is
test/conformance data only. It is not live production authority.

## The short path

```jsonc
{ "resourceRef": { "... AgentResourceReference from project_resource_capture ..." } }
{ "projectId": "new-project", "caseRef": { "fingerprint": "<sha256>" } }
{ "projectId": "new-project", "caseRef": { "fingerprint": "<sha256>" }, "sensitivityCatalogOptIn": true }
```

1. `project_resource_capture` then `project_fea_proof_case_capture` with that full
   `resourceRef`. Pass `result.reference` only.
2. `project_fea_proof_seal_review` — after geometry + requirements exist. Read
   `selected` first. Paste `next.append.arguments` into `project_change_append`, then
   `next.propose.arguments` into `project_decision_propose`. Server-owned
   `workItemId` and `decisionId` are already derived from source identity/revision; do
   not rename them. Omission or `false` seals only the proof. Send
   `sensitivityCatalogOptIn: true` only when `sensitivityCatalog.status` is
   `ready-for-opt-in`: the returned `decisionParameters` then sign the offer digest
   and exact admission identity in this same MRTR.
3. After that seal is on the Thread tip: `project_fea_isolated_run_review`. Same two
   argument envelopes. `geometry` is the canonical part STEP, not a cad-model.
   Cad-models are in `rejectedLookalikes`. The proposal restates those identities; it
   is not a `fea.run.*` grammar. Historical MCP FEA runs are not registered.

The server picks the unique current Thread tip (max revision, **not** `latest`) and the
unique sealed proof document when `proofArtifactId` is omitted.

## Sensitivity catalog opt-in

The review derives the offer from facts the server can reopen. It requires exactly one
causal numeric lever in one ready Build123d admission, exact source fingerprint and byte
count equality with the proof's parametric CAD definition, and a unique `result` binding
to the proof target. The live metric contract supplies units (`maxVonMises` is `MPa`);
the caller supplies none of these values. Sensitivity does not choose the proof source.

After approval, `verify.seal-proof-case@1` recompiles the offer from the signed
admission and publishes a separate `sensitivity-catalog-offer` artifact derived from
both the sealed proof and that admission. The offer keeps `step.status = not-compiled`.
`project_sensitivity_study_seal_review` is the next hop: it compiles that missing step
from the sealed proof mesh. It does not invent a catalog JSON.

Heron remains unlinked until a new parameterized admission exactly matches its proof CAD
definition and target. Its historical `design.write-geometry@1` STEP is a separate
legacy artifact, not an admission substitute.

## What the caller may not send

Material, mesh, loads, boxes, hashes, SysON UUIDs, a JSON path, catalog id, or `latest`.

## When it stays unresolved or unavailable

`resolved` is reserved for an appendable review: current project head, no identity
conflict, and a readable consistent geometry/STEP source. Anything else is a contractual
label, never a softened `resolved`.

| Code                                                                   | Status        | Meaning                                    |
| ---------------------------------------------------------------------- | ------------- | ------------------------------------------ |
| `source-absent` / `source-corrupt` / `source-unavailable`              | `unresolved`  | Captured source missing or unreadable      |
| `project-mismatch` / `subject-mismatch`                                | `unresolved`  | Source project/subject vs requested        |
| `cad-lineage-unavailable` / `cad-lineage-ambiguous`                    | `unresolved`  | Unique part CAD provenance missing         |
| `basis-latest` / `basis-absent` / `basis-ambiguous` / `basis-mismatch` | `unresolved`  | Thread tip                                 |
| `basis-not-current` / `project-state-unavailable`                      | `unavailable` | Historical or missing project head         |
| `project-state-mismatch` / `compiled-identities-conflict`              | `unresolved`  | Incompatible or already-used identities    |
| `geometry-capture-unavailable` / `step-unavailable`                    | `unavailable` | Geometry capture or canonical STEP unread  |
| `geometry-capture-invalid` / `step-mismatch`                           | `unresolved`  | Capture/STEP inconsistent with the case    |
| `step-absent` / `geometry-absent` / `requirements-absent`              | `unresolved`  | Seal too early                             |
| `proof-absent` / `proof-not-document`                                  | `unresolved`  | Run before a seal, or cad-model as proof   |
| `geometry-is-cad-model`                                                | `unresolved`  | `@3` `geometry` must be canonical STEP     |
| `sensitivity-catalog-unavailable`                                      | `unresolved`  | Requested opt-in has no exact causal offer |

An unresolved or unavailable review returns no parameters, bindings, or `next`. Reopen
the current head instead of adapting an old append.

## What this is not

Not a Git catalog. Not compiled-case authoring. Not a solve. Not `@1` historical MCP.
Not isolated `@3`. Not a split of `mechanical-proof-case/1.0`.
