# How-to: verify a new wall hook from source

Audience: both · Diátaxis: how-to · Kind: how-to

Start a **new** Behave-only wall-hook project from this checkout, load the repo-owned
two-file CAD source, and walk the registered proof path. This is not maintenance of
historical `wall-hook-wh01`, `dl04`, or `dl05`. Do not clone those vehicles.

The paired conversation commands. The Workbench is read-only. The person never types a
provider tool. The agent may author a new `mechanical-proof-case-source/1.0` JSON from
the approved brief, but never chooses a provider, runtime, lowering, provider envelope,
or tool arguments; those are server-owned. It never invents a verdict or human
signature.

Authority sequence:
[Verify a new design from scratch](verify-a-new-design-from-scratch.md). CAD source:
[examples/wall-hook-wh01](../../../examples/wall-hook-wh01/). Exact-run identities for
one live walk sit in the
[WH01 runtime evidence record](../../../examples/wall-hook-wh01/runtime-evidence.md);
they are not the reusable procedure.

## Host and start

Supported host for this walkthrough: macOS Apple Silicon, Deno 2.9.2, Docker daemon
running. The SDK is bundled as pinned `microsandbox@0.6.8`; a global `msb` CLI is not a
prerequisite.

This is a local developer / non-production baseline. Image licence stays `unknown`. The
developer baseline remains `productionEligible: false`. Candidate receipts remain
`eligibleForPromotion: false`. No release, promotion, or redistribution claim.

Source gates: [Validate a source checkout](../setup/validate-a-source-checkout.md).
Then:

```bash
npm --prefix src/ui ci
npm --prefix src/ui run build:thread
deno task start:yolo
```

Optional Workbench: `deno task preview:thread` (`http://127.0.0.1:5173/`). Connect the
agent to `http://127.0.0.1:3020/mcp`. Every named tool on this page is a public MCP
command. Loopback writes go through the existing stateless client:

```bash
deno task mcp:call --name=<tool> --args='{}'
```

Pass `--args=-` for a JSON object on stdin. Do not import application use cases or write
`state/local`.

`start:yolo` is an explicit loopback opt-in. Positive confirmations persist durable
actor `local-yolo:startup-opt-in`. YOLO does not bypass admission, qualification, WAL,
or validators. Contract:
[local runtime and ports](../../reference/runtime/local-runtime-and-ports.md#local-yolo-approval-mode).

Do not start root Compose. H1 owns JIT provider groups after operational authorization.

## 1. New project, then cockpit focus

Call `project_start` with the person's plain-language wall-hook intent. Then
`cockpit_focus_set`. The schema requires a nested target; `{ "projectId": "…" }` is
refused:

```json
{
  "commandId": "<stable-focus-command-id>",
  "workspaceId": "primary",
  "target": { "kind": "project", "projectId": "<returned-project-id>" }
}
```

`mcp:call` fills `issuedAt` when `commandId` is present. Omit `expectedRevision` unless
you already have the current cockpit focus revision. The live walk's project id is in
the
[WH01 runtime evidence record](../../../examples/wall-hook-wh01/runtime-evidence.md).

## 2. Brief, then freeze it

Interview, propose, and confirm through the public project tools. Procedure:
[Verify a new design from scratch](verify-a-new-design-from-scratch.md) §2 and
[review project capability authorization](../agents/review-project-capability-authorization.md).

The reviewed live brief for this vehicle:

- verification authority `static-structural-fea@1.0`;
- geometry 30 × 12 × 5 mm;
- Aluminium 6061 assumption 69000 MPa and 0.33;
- fixed root, 10 N downward tip load;
- max displacement ≤ 2 mm;
- the reproducible check-in source is
  [examples/wall-hook-wh01](../../../examples/wall-hook-wh01/); the exact live brief
  instead named
  `src/testing/fixtures/fea/mechanical-proof-cases/wall-hook-wh01-hook-cantilever.json`
  as its `sourceRef`. The new example bytes were not used in that live run;
- Make, Buy, and certification are excluded.

Echo the exact `capabilityProposalFingerprint` on `project_brief_confirm`. Brief
confirmation may journal a server-owned CalculiX cache intent; that is not an anonymous
registry pull. Keep those facts distinct in the
[WH01 runtime evidence record](../../../examples/wall-hook-wh01/runtime-evidence.md).

At every review, send the returned `next.append.arguments` or `next.propose.arguments`
unchanged through `deno task mcp:call`; do not reconstruct an operation payload. A
proposal returns the fingerprint that approval consumes. Only then queue and execute the
server-derived work item/run. Never copy any recorded WH01 digest, id, revision, or
fingerprint below as a new input.

## 3. Documentary r1, seed, architecture, requirements

Follow [Verify a new design from scratch](verify-a-new-design-from-scratch.md) §§3–4 and
[sequence a SysON seed](../agents/sequence-a-syson-seed.md). Seed via
`project_change_append`, never the initial plan.

This vehicle is a single-part system. Compile architecture with empty `components` and
declare CAD handles for later unique `parameterizes` joins:
[compile brief parameters](../compile/compile-brief-parameters.md). Names:

- `length`, `width`, `thickness`
- parent = the unique WallHook `PartDefinition`

Thresholds stay safe integers. Named compilation-boundary rescales include brief
`MPa` → stored `Pa` and exact `0.2 mm` → `200000 nm`. Do not invent another.

## 4. Load the two-file CAD source

Capture and workspace how-tos:
[capture an agent resource](../compile/capture-an-agent-resource.md),
[author a project source workspace](../compile/author-project-source-workspace.md).
Lowering contract:
[workspace-closure lowering v1](../../reference/domains/cad/build123d-workspace-closure-lowering-v1.md).

Stable identities:

| Field            | Value                                                                |
| ---------------- | -------------------------------------------------------------------- |
| Module           | `moduleId` `wh01`, slug `wh01`                                       |
| Leaf `fileId`    | `wh01-dimensions` · logical name `dimensions.py` · role `cad-script` |
| Root `fileId`    | `wh01-hook` · logical name `hook.py` · role `cad-script`             |
| `captureRequest` | `{ "profileId": "build123d-closed-subset-v1" }`                      |
| Virtual import   | `casys_workspace.f_776830312d64696d656e73696f6e73`                   |

1. `project_resource_capture` each file (`name`, `mimeType` `text/x-python`, UTF-8
   `text`). Keep each full `reference`.
2. `project_source_workspace_snapshot`. New workspaces start at revision `0`.
3. `project_source_module_put`, then put the leaf with `dependencies: []`, then put the
   root. Each mutation names the exact returned `workspaceRevision`. The root dependency
   is the leaf's exact `fileId@fileRevision` from `project_source_search` /
   `project_source_file_read` at that snapshot. Do not type `latest`.
4. After architecture exists, `project_source_attachment_put` attaches **the root**
   (`wh01-hook`) to the exact WallHook `PartDefinition`. `declaredAgainst` is the unique
   current Thread tip and its `architecture-capture/4.0`. Attachment role
   `{ "id": "design-source", "version": 1 }`.
5. `project_technical_source_capture` names only `projectId`, `workspaceRevision`,
   `attachmentId`, and `attachmentRevision`. Pass `result.reference` only to
   `project_technical_compilation_preview`.

Optional handoff helper, same public MCP, no use-case import:

```bash
deno task probe:wall-hook-wh01-source --project-id=<returned-project-id>
```

It captures the two files, chains workspace revisions, and prints the identities needed
for attachment. It does not attach, admit, export, or run FEA.

Continue only on literal `ready-for-review`. Canonical geometry, not isolated CAD:

```text
compile.seal-admission@3
  → project_admitted_geometry_export
  → design.write-geometry@1
```

Paths: [CAD execution paths](../../reference/domains/cad/execution-paths.md). Isolated
execution is documentary and cannot feed this proof.

## 5. Proof, then stop

```text
project_fea_proof_case_capture
  → project_fea_proof_seal_review
  → verify.seal-proof-case@1
  → project_fea_isolated_run_review
  → verify.run-fea-static-proof@3
```

How-to: [compile FEA parameters](../compile/compile-fea-parameters.md). Do not type
`fea.proof.*`. Do not queue historical MCP FEA `@1`/`@2`. Do not bind a `cad-model` as
`geometry`. Historical JSON under `src/testing/fixtures/fea/mechanical-proof-cases/` is
conformance data, not live authority; capture a new `mechanical-proof-case-source/1.0`
for this project.

A joined `pass` ends the Behave walk. Do not open make or buy.
[Three judgement branches](../../explanations/product/product-direction.md#three-judgement-branches).
Human L5 is a separate walk:
[Close out a static mechanical proof](close-out-a-static-mechanical-proof.md).

## What this walkthrough does not do

- Repair or replay historical `wall-hook-wh01`, `dl04`, or `dl05`.
- Treat isolated CAD, parser status, or a queue receipt as canonical STEP or a product
  verdict.
- Add Modelica or SPICE multi-file lowering.
- Claim a public release, image promotion, or certification.
