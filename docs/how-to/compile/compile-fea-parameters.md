# How-to: compile FEA seal parameters and isolated-run bindings

Audience: agent · Diátaxis: how-to · Kind: how-to

Call these two read-only tools instead of typing `fea.proof.*` or guessing the
`geometry` binding. They write nothing and grant no MRTR.

There is no `fea.run.*` grammar. Product run is isolated
`verify.run-fea-static-proof@3`. Historical MCP `@1`/`@2` are not registered.

Domain contracts: [mechanical proof case V1](../../reference/domains/fea/mechanical-proof-case-v1.md)
and [CalculiX static proof V3](../../reference/domains/fea/calculix-static-proof-v3.md).

The Git catalog is data, not a compiler capability switch: a new project proof adds one
validated JSON declaration and one `config/mechanical-proof-cases/catalog.json` entry.
A new physics/method needs shared schema, generic lowering, and qualification; do not
try to encode it as another V1 catalog field.

## The short path

```jsonc
{ "projectId": "desk-lamp-dl06" } // proof only; both tools
{ "projectId": "new-project", "sensitivityCatalogOptIn": true } // proof + exact catalog offer
```

1. `project_fea_proof_seal_review` — after geometry + requirements exist. Read
   `selected` first. Paste `next.append.arguments` into `project_change_append`, then
   `next.propose.arguments` into `project_decision_propose`. The catalog-owned
   `workItemId` and `decisionId` are already compiled; do not rename them. Omission or
   `false` seals only the proof. Send `sensitivityCatalogOptIn: true` only when
   `sensitivityCatalog.status` is `ready-for-opt-in`: the returned `decisionParameters`
   then sign the offer digest and exact admission identity in this same MRTR.
2. After that seal is on the Thread tip: `project_fea_isolated_run_review`. Same two
   argument envelopes. `geometry` is the canonical part STEP, not a cad-model.
   Cad-models are in `rejectedLookalikes`. The proposal restates those identities; it
   is not a `fea.run.*` grammar. Historical MCP FEA runs are not registered.

Omit `caseId`, `basis` and `proofArtifactId` when they are unique. The server picks the
catalog case, the current Thread tip (max revision, **not** `latest`), and the unique
sealed proof document.

Name those fields only when several cases, tips or seals exist.

## Sensitivity catalog opt-in

The review derives the offer from facts the server can reopen. It requires exactly one
causal numeric lever in one ready Build123d admission, exact source fingerprint and byte
count equality with the proof's parametric CAD definition, and a unique `result` binding
to the proof target. The live metric contract supplies units (`maxVonMises` is `MPa`);
the caller supplies none of these values.

After approval, `verify.seal-proof-case@1` recompiles the offer from the signed
admission and publishes a separate `sensitivity-catalog-offer` artifact derived from
both the sealed proof and that admission. The offer keeps `step.status = not-compiled`.
`project_sensitivity_study_seal_review` is the next hop: it compiles that missing step
from the sealed proof mesh. It does not invent a catalog JSON.

Heron remains unlinked until a new parameterized admission exactly matches its proof CAD
definition and target. Its historical `design.write-geometry@1` STEP is a separate
legacy artifact, not an admission substitute.

## What the caller may not send

Material, mesh, loads, boxes, hashes, SysON UUIDs, a JSON path, or `latest`.

## When it stays unresolved or unavailable

`resolved` is reserved for an appendable review: current project head, no identity
conflict, and a readable consistent geometry/STEP source. Anything else is a contractual
label, never a softened `resolved`.

| Code                                                                   | Status        | Meaning                                    |
| ---------------------------------------------------------------------- | ------------- | ------------------------------------------ |
| `catalog-absent` / `catalog-ambiguous`                                 | `unresolved`  | No unique catalog declaration              |
| `catalog-unavailable` / `catalog-integrity-failed`                     | `unresolved`  | Declared catalog source unreadable/bad     |
| `basis-latest` / `basis-absent` / `basis-ambiguous` / `basis-mismatch` | `unresolved`  | Thread tip                                 |
| `basis-not-current` / `project-state-unavailable`                      | `unavailable` | Historical or missing project head         |
| `project-state-mismatch` / `compiled-identities-conflict`              | `unresolved`  | Incompatible or already-used identities    |
| `geometry-capture-unavailable` / `step-unavailable`                    | `unavailable` | Geometry capture or canonical STEP unread  |
| `geometry-capture-invalid` / `step-mismatch`                           | `unresolved`  | Capture/STEP inconsistent with the case    |
| `step-absent` / `geometry-absent` / `requirements-absent`              | `unresolved`  | Seal too early                             |
| `proof-absent` / `proof-not-document`                                  | `unresolved`  | Run before a seal, or cad-model as proof   |
| `geometry-is-cad-model`                                                | `unresolved`  | `@2` `geometry` must be STEP               |
| `sensitivity-catalog-unavailable`                                      | `unresolved`  | Requested opt-in has no exact causal offer |

An unresolved or unavailable review returns no parameters, bindings, or `next`. Reopen
the current head instead of adapting an old append.

## What this is not

Not case authoring. Not a solve. Not `@1` historical MCP. Not isolated `@3`. Not a split
of `mechanical-proof-case/1.0`.
