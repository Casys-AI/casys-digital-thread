# How-to: compile FEA seal parameters and recorded-run bindings

Call these two read-only tools instead of typing `fea.proof.*` or guessing the `@2`
`geometry` binding. They write nothing and grant no MRTR.

There is no `fea.run.*` grammar. `@1`, `@2` and `@3` stay distinct.

## The short path

```jsonc
{ "projectId": "desk-lamp-dl06" } // both tools
```

1. `project_fea_proof_seal_review` — after geometry + requirements exist. Read
   `selected` first. Paste `next.append.arguments` into `project_change_append`, then
   `next.propose.arguments` into `project_decision_propose`. The catalog-owned
   `workItemId` and `decisionId` are already compiled; do not rename them.
2. After that seal is on the Thread tip: `project_fea_recorded_run_review`. Same two
   argument envelopes. `geometry` is the canonical part STEP, not a cad-model or the
   isolated `@3` authority. Cad-models are in `rejectedLookalikes`. The proposal
   restates those identities; it is not a `fea.run.*` grammar.

Omit `caseId`, `basis` and `proofArtifactId` when they are unique. The server picks the
catalog case, the current Thread tip (max revision, **not** `latest`), and the unique
sealed proof document.

Name those fields only when several cases, tips or seals exist.

## What the caller may not send

Material, mesh, loads, boxes, hashes, SysON UUIDs, a JSON path, or `latest`.

## When it stays unresolved or unavailable

`resolved` is reserved for an appendable review: current project head, no identity
conflict, and a readable consistent geometry/STEP source. Anything else is a contractual
label, never a softened `resolved`.

| Code                                                                   | Status        | Meaning                                   |
| ---------------------------------------------------------------------- | ------------- | ----------------------------------------- |
| `catalog-absent` / `catalog-ambiguous`                                 | `unresolved`  | No unique catalog declaration             |
| `catalog-unavailable` / `catalog-integrity-failed`                     | `unresolved`  | Declared catalog source unreadable/bad    |
| `basis-latest` / `basis-absent` / `basis-ambiguous` / `basis-mismatch` | `unresolved`  | Thread tip                                |
| `basis-not-current` / `project-state-unavailable`                      | `unavailable` | Historical or missing project head        |
| `project-state-mismatch` / `compiled-identities-conflict`              | `unresolved`  | Incompatible or already-used identities   |
| `geometry-capture-unavailable` / `step-unavailable`                    | `unavailable` | Geometry capture or canonical STEP unread |
| `geometry-capture-invalid` / `step-mismatch`                           | `unresolved`  | Capture/STEP inconsistent with the case   |
| `step-absent` / `geometry-absent` / `requirements-absent`              | `unresolved`  | Seal too early                            |
| `proof-absent` / `proof-not-document`                                  | `unresolved`  | Run before a seal, or cad-model as proof  |
| `geometry-is-cad-model`                                                | `unresolved`  | `@2` `geometry` must be STEP              |

An unresolved or unavailable review returns no parameters, bindings, or `next`. Reopen
the current head instead of adapting an old append.

## What this is not

Not case authoring. Not a solve. Not `@1` historical MCP. Not isolated `@3`. Not a split
of `mechanical-proof-case/1.0`.
