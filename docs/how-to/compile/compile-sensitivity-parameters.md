# How-to: compile sensitivity-study seal parameters

Audience: agent · Diátaxis: how-to · Kind: how-to

Call this read-only tool instead of inventing `sensitivity.case.*` or a `cadSource`. It
writes nothing and grants no MRTR.

`analyze.seal-sensitivity-study@1` is a provider-free Thread-document seal. It is not a
solve and not `verify.seal-proof-case@1`. The review and seal live under
[`src/application/use-cases/sensitivity/study/`](../../../src/application/use-cases/sensitivity/study)
and [`src/adapters/sensitivity/study/`](../../../src/adapters/sensitivity/study). They
are not `compile.seal-admission@3`.

The MCP process must be the current `server.ts`. A server started before this tool was
registered will not list it. Restart with `deno task start` or `deno task start:yolo`,
then call through `:3020/mcp`.

## The short path

```bash
deno task mcp:call --name=project_sensitivity_study_seal_review \
  --args='{"projectId":"desk-lamp-dl05","caseId":"dl05-arm-thickness-isolated"}'
```

1. After a unique readable `compile.seal-admission@3` admission exists on the current
   Thread tip, call `project_sensitivity_study_seal_review`.
2. Read `selected` first. Paste `next.append.arguments` into `project_change_append`,
   then `next.propose.arguments` into `project_decision_propose`. The server-owned
   `workItemId` and `decisionId` are already compiled from the case id; do not rename
   them. `selected.authority` is `catalog` or `signed-offer`.
3. `cadSource` is that admission's `thread-artifact://<projectId>/<artifactId>` URI plus
   sha256. It is not a cad-model, a STEP, `design.write-geometry@1`, or
   `design.seal-isolated-geometry@1`.

Omit `caseId` and `basis` when they are unique. The server picks the unique catalog
template for that `project.id` and the current Thread tip (max revision, **not**
`latest`).

`desk-lamp-dl05` currently has two templates. Name `dl05-arm-thickness-isolated` (Thread
metric ids) unless a unique signed catalog-offer is already on that tip — omitted
`caseId` then compiles from the offer instead of staying `catalog-ambiguous`. Do not
reseal from `dl05-arm-thickness-sensitivity` (`assembly_max_*`, historical UNLINKED
join). A sibling `dl05-*` `caseId` on dl06 is `project-mismatch` / `subject-mismatch`,
not a borrowed case. A named id that is not the compiled offer id is
`catalog-offer-case-mismatch`, not `catalog-absent`.

`desk-lamp-dl06` has no reviewed catalog JSON. Omitted `caseId` stays `catalog-absent`
until a unique signed `sensitivity-catalog-offer` exists on the current tip. After the
FEA-seal opt-in publishes that offer, this same tool reopens it, recompiles it, and
copies the sealed proof mesh target size as `step`. `analyze.seal-sensitivity-study@1`
reopens that same unique signed offer; it does not invent mesh, loads, or a dl06 JSON,
and it does not retire this review tool. A named historical `caseId` still wins over an
offer. Several offers stay `catalog-offer-ambiguous`.

## What a live call returns

These are loopback `tools/call` results on a current `:3020` process, not softened
labels.

| Call                                                                         | Status       | Diagnostic                                                                                      |
| ---------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------- |
| `{ "projectId": "desk-lamp-dl06" }`                                          | `unresolved` | `catalog-absent` — no catalog JSON and no unique signed offer on the tip                        |
| `{ "projectId": "desk-lamp-dl06", "caseId": "dl05-arm-thickness-isolated" }` | `unresolved` | `project-mismatch` and `subject-mismatch` — the catalogued case stays dl05                      |
| `{ "projectId": "desk-lamp-dl05" }`                                          | `unresolved` | `catalog-ambiguous` when the tip has no unique signed offer; name `dl05-arm-thickness-isolated` |
| `{ "projectId": "desk-lamp-dl05", "caseId": "dl05-arm-thickness-isolated" }` | `unresolved` | `admission-ambiguous` when several admissions bind `arm_thickness`                              |

`resolved` with `next.append` / `next.propose` appears only when that project has a
unique current admission for the template `semanticKey` and the identities are not
already compiled. An atelier that already walked the isolated loop (several admissions
on the tip) stays `admission-ambiguous`. Do not pick one by hand.

## What the caller may not send

Mesh, loads, boxes, hashes, SysML, `arm_thickness`, a JSON path, a cadSource, or
`latest`.

## When it stays unresolved or unavailable

`resolved` is reserved for an appendable review: current project head, no identity
conflict, and a unique readable admission whose source has exactly one module-level
numeric binding equal to the template `target.semanticKey`. Anything else is a
contractual label, never a softened `resolved`.

| Code                                                                   | Status        | Meaning                                                   |
| ---------------------------------------------------------------------- | ------------- | --------------------------------------------------------- |
| `catalog-absent` / `catalog-ambiguous`                                 | `unresolved`  | No unique catalogued template, and no unique signed offer |
| `catalog-offer-case-mismatch`                                          | `unresolved`  | Named `caseId` is not the compiled offer id               |
| `catalog-offer-ambiguous` / `catalog-offer-integrity-failed`           | `unresolved`  | Signed offer is not unique or no longer recompiles        |
| `catalog-offer-unavailable`                                            | `unavailable` | Signed offer or its proof capture is unread               |
| `catalog-offer-admission-unlinked`                                     | `unresolved`  | Signed offer admission drifted or no longer joins         |
| `catalog-unavailable` / `catalog-integrity-failed`                     | `unresolved`  | Declared catalog source unreadable/bad                    |
| `basis-latest` / `basis-absent` / `basis-ambiguous` / `basis-mismatch` | `unresolved`  | Thread tip                                                |
| `basis-not-current` / `project-state-unavailable`                      | `unavailable` | Historical or missing project head                        |
| `project-state-mismatch` / `compiled-identities-conflict`              | `unresolved`  | Incompatible or already-used identities                   |
| `admission-absent` / `semantic-key-unbound`                            | `unresolved`  | No unique admission binding the template semanticKey      |
| `admission-ambiguous`                                                  | `unresolved`  | Several admissions bind the same semanticKey              |
| `admission-parameter-mismatch`                                         | `unresolved`  | Admission parameter does not match the template           |
| `admission-unavailable`                                                | `unavailable` | Admission artifact present but unread                     |
| `project-mismatch` / `subject-mismatch`                                | `unresolved`  | Named `caseId` belongs to another project                 |
| `cad-source-lookalike`                                                 | `unresolved`  | cad-model / write-geometry / STEP offered as source       |
| `proposal-grammar-rejected`                                            | `unresolved`  | Compiled case failed the existing proposal grammar        |

An unresolved or unavailable review returns no parameters or `next`. Reopen the current
head instead of adapting an old append.

## What this is not

Not case authoring. Not a solve. Not `verify.evaluate-sensitivity-base@1`. Not vector
correction. Not a substitute for the signed FEA-seal catalog opt-in. Not a new dl06 /
Heron catalog JSON. The signed offer is the precursor; this tool compiles the missing
`step` from that offer.
