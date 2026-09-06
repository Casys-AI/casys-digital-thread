# How-to: verify a new wall hook from source

Audience: both · Diátaxis: how-to · Kind: how-to

Start a **new** Behave-only wall-hook project from this checkout, load the repo-owned
two-file CAD source, and walk the registered proof path. This is not maintenance of
historical `wall-hook-wh01`, `dl04`, or `dl05`. Do not clone those vehicles.

The paired conversation commands. The Workbench is read-only. The person never types a
provider tool. The agent never chooses a provider, runtime, lowering, or solver payload,
and never invents a verdict or human signature.

Authority sequence:
[Verify a new design from scratch](verify-a-new-design-from-scratch.md). CAD source:
[examples/wall-hook-wh01](../../../examples/wall-hook-wh01/). Exact-run identities for
one live walk sit in [Exact-run evidence](#exact-run-evidence); they are not the
reusable procedure.

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
[Exact-run evidence](#exact-run-evidence).

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
registry pull. Keep those facts distinct in [Exact-run evidence](#exact-run-evidence).

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

Thresholds stay safe integers. Brief `MPa` → stored `Pa` is the one code-owned rescale.

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

## Exact-run evidence

Reusable steps above. This section records one completed live walk of
`wall-hook-wh01-20260906`. Concept verification only: not certification, material
release, joint qualification, fatigue, stability, safety, manufacturing, or a
whole-product claim. Material, support, and load remain approved assumptions. Its
exact-run fingerprints are illustrative capture evidence, not expected outputs for the
checked-in example: its bytes and resulting fileIds differ from the live source.

| Fact                           | Value                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Public clone tested            | GitHub SHA `c7cdcc893fa86ddf2d53f7d9163d15685ecdddec`                                                                           |
| Live project                   | `wall-hook-wh01-20260906`                                                                                                       |
| Focus payload                  | `{ "workspaceId": "primary", "target": { "kind": "project", "projectId": "wall-hook-wh01-20260906" } }`                         |
| YOLO actor                     | `local-yolo:startup-opt-in`                                                                                                     |
| Anonymous CalculiX source      | `ghcr.io/casys-ai/casys-digital-thread-calculix-worker@sha256:0c96ae7f16c05aaa1b082740e1272ae6b4e35ac58866a4537f9d6e74cb236462` |
| Product MSB target             | `docker.io/casys/calculix-microsandbox-worker@sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771`          |
| Runtime product image          | `sha256:2dc7d17454833a2c17b5812eb1e5504c4a025ef3764fc771fda2938d49fa9771`                                                       |
| Licence / baseline / promotion | `unknown` / `productionEligible: false` / `eligibleForPromotion: false`                                                         |
| Baseline                       | Thread r1 completed                                                                                                             |

Keep these three cache facts distinct:

1. **Anonymous registry access** was demonstrated. Docker reused already-cached layers.
   That is not a cold download.
2. **Before brief confirmation** the product MSB target was absent.
3. **Brief confirmation** produced a new journalled `cache.calculix` intent generation 1
   and an observed terminal. That is a real server-owned import/preload, distinct from
   the anonymous pull.

### CAD closure and canonical geometry

Live captured resources of this run. A new project recaptures the checked-in two-file
source; do not reconstruct these fingerprints.

| Identity                   | Value                                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Parameter file resource    | SHA-256 `8bffddbc35b79a38ff6edfc5805ff4b6a52c41ab4443c4326571320543e28e69`, 87 bytes                                                                         |
| Root file resource         | SHA-256 `f491bff723905723ac91d977b2ca2731342b5036f49d8c12d4e07ae11abc3ea5`, 138 bytes                                                                        |
| Workspace event            | SHA-256 `245ac7eff7ca50d08b5395ca3212d4e923f3a7d70a7028486862348df6ca1a70`                                                                                   |
| Source locator fingerprint | `83f2a4f0ed732265dcc61909e9a24317fe8f90c97be7bb0e59ef864451a87ef4`                                                                                           |
| Closure / `technical-unit` | SHA-256 `916063a639e7fd27e4dd157bb57c69752aa9dd557d2142392918e1cbb54c8a99`                                                                                   |
| Effective script           | SHA-256 `29ab37861b113bf55be43f8dab32a6ddbe97f63038840a705ba483829eb2ee52`                                                                                   |
| Lowering manifest          | SHA-256 `f26a8b72d789a60616ae7b9644f755dde09d67256a3a7dc2b5ab03cae51d67e4`                                                                                   |
| Admission                  | Thread r5 `project:wall-hook-wh01-20260906:r5:compile-seal-admission-run:wh01-20260906-queue-cad-admission`                                                  |
| Canonical export draft     | digest `d7276a4ba3a6003c92c5a3993ce311fcd1c600b00c39c1763e249fa7937e1805`                                                                                    |
| STEP                       | 15,427 bytes, SHA-256 `22ffe33585cd6abde9415265d7229e74dc121514ec4b9bae3ca0964eb231dfef`                                                                     |
| GLTF                       | 3,388 bytes, SHA-256 `2fe5ebaac6f48656b570f4f17fac50c3fc500d318a28947b83910806a7423e75`                                                                      |
| Canonical geometry join    | Thread r6 `project:wall-hook-wh01-20260906:r6:design-write-geometry-016bd284642adc81130213e579a0eab034f2a66f721f3e7799a9835852517105`                        |
| Geometry artifact          | `geometry-016bd284642adc81130213e579a0eab034f2a66f721f3e7799a9835852517105`                                                                                  |
| STEP artifact              | `cad-asset-016bd284642adc81130213e579a0eab034f2a66f721f3e7799a9835852517105-definition-0-0-22ffe33585cd6abde9415265d7229e74dc121514ec4b9bae3ca0964eb231dfef` |

### FEA, L4, and L5 closeout

| Identity                  | Value                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Proof-case resource       | `mechanical-proof-case-source/1.0` SHA-256 `85e2a3f258fd939508332741fac069000afd4b8a5155e2e7e8f1cdf5af5a331a`          |
| Opaque source fingerprint | `f1ba5210eee6949e3b0925a5e822d1f9646a3e86ae29ec055c6268629e093c9e`                                                     |
| Compiled proof digest     | `fceaea293ebc8c5aeae8e1a109ff56afc55e83683e53597b05811f25927e7a82`                                                     |
| Proof seal                | Thread r7 `project:wall-hook-wh01-20260906:r7:verify-seal-proof-case-run:queue-fea-wh01-proof-seal-r1`                 |
| Proof artifact            | `fea-proof-acf0551fe78e396ba2070b4cc44224ec1ac7ead09b4b33c7698b8c7a0f39d206`                                           |
| Isolated run              | `run:queue-fea-wh01-isolated-r7` completed                                                                             |
| Isolated Thread           | r8 `project:wall-hook-wh01-20260906:r8:calculix-isolated-run:queue-fea-wh01-isolated-r7`                               |
| Runtime                   | Microsandbox `0.6.8`, CalculiX `2.21`, Gmsh `4.12.1`, network none, exit code 0, destruction proven                    |
| Mesh                      | 413 nodes, 1,241 elements; FIXED 32 nodes; LOADED 32 nodes                                                             |
| Maximum displacement      | `0.00662401646545873 mm` at node 8                                                                                     |
| Maximum von Mises         | `4.144414913788316 MPa` at element 878 (observed; not a declared proof criterion)                                      |
| Declared criterion        | max displacement `<= 2 mm`, literal L4 `pass`                                                                          |
| Execution evidence        | `calculix-isolated-evidence-78a2fa9388db214a72743ca107b7644ece78d8170704bce568b10a4ea4162ca5`                          |
| L4 evaluation capture     | `calculix-isolated-syson-evaluation-3740df2abc990360e73953b0f9b3c4ced79cc513b90d776d9993d6735b78b3c6`                  |
| YOLO L5 accept            | Thread r9 `project:wall-hook-wh01-20260906:r9:decide-accept-evaluation-closeout-run:queue-wh01-mechanical-closeout-r8` |
| Closeout artifact         | `evaluation-closeout-1d463adadf063e37ce7522aa253bf5901c0489a2a0e5c7bbe4324e544628837c`                                 |

## What this walkthrough does not do

- Repair or replay historical `wall-hook-wh01`, `dl04`, or `dl05`.
- Treat isolated CAD, parser status, or a queue receipt as canonical STEP or a product
  verdict.
- Add Modelica or SPICE multi-file lowering.
- Claim a public release, image promotion, or certification.
