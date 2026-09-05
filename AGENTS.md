# Agent entry

This workspace is the Casys Digital Thread atelier. Engineering provider servers are
**not** in this repo. They run from published images.

Read this file first, then the linked pages. Do not improvise a second authority model
from UI copy or tool descriptions.

Reusable workflows live in the [agent skill catalogue](.agents/skills/README.md). Skills
route into the authorities below; they never redefine operation identities, contracts,
or persisted truth.

**Motto: verification stays proportionate to the actual risk and scope of the change.**
Use the smallest evidence set that can support the claim; do not turn a bounded check
into a parallel product effort.

## Non-negotiable

| Actor     | Owns                                                     | Must not                                                                                                         |
| --------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Agent     | Propose, plan, queue, execute **registered** operations  | Choose provider/tool/args, invent SysML/CAD text for a renderer path, self-approve MRTR, invent numbers or units |
| Human     | Intent and consequential decisions (signed MRTR in chat) | Be asked to author solver payloads or provider envelopes                                                         |
| Server    | Sequences, profiles, parsers, lowering, recovery         | Accept `latest`, aliases, or caller-selected runtimes                                                            |
| Workbench | Read-only projection (`GET` + SSE)                       | Receive commands, MCP authority, or provider credentials                                                         |

## Start here

1. [Agent workspace reference](docs/reference/agent/agent-workspace.md) — tools,
   operations, code placement
2. [Lookalike traps](docs/reference/agent/lookalike-traps.md) — pairs that are not
   substitutes
3. [Source analysis and authority pipeline](docs/reference/pipeline/analysis-authority-pipeline.md)
   — capture → analysis → MRTR → dispatch
4. [Local runtime and ports](docs/reference/runtime/local-runtime-and-ports.md) — ports,
   YOLO, runtime ownership. File census:
   [codebase map](docs/reference/codebase/codebase-map.md).
5. [Validate a source checkout](docs/how-to/setup/validate-a-source-checkout.md) —
   commands and source/UI gates; CM-01 retirement is below
6. [Run the behave loop from zero](docs/how-to/verify-design/verify-a-new-design-from-scratch.md)
   — new project, behave only. Do not repair dl05. Do not open make/buy.
7. [Verify prescribed kinematics](docs/how-to/verify-design/verify-prescribed-kinematics.md)
   — brief capability, SysON Product Structure, exact source attachments, then L1–L5.
8. [Walk the post-proof loop](docs/how-to/verify-design/review-and-correct-after-a-proof.md)
   — join, fail-only correction, `z*`, reseal. Historical **dl05 r16** is `UNLINKED`
   (`assembly_max_*`). A later join on that atelier can be `pass` (Thread r19). Do not
   invent a mapping or a fail.
9. [Three judgement branches](docs/explanations/product/product-direction.md#three-judgement-branches)
   — one STEP, three questions; verdicts do not cross.

## Immediate traps

- `model.write-architecture@1` **renders** SysML and writes SysON.
  `model.seal-architecture-sysml@1` **seals** agent-authored closed-subset SysML as a
  Thread document and **never** calls SysON.
- `sysml-source-capture/1.0` is the renderer envelope.
  `architecture-sysml-source-analysis-capture/1.0` is the agent-authored CAS. They are
  not interchangeable.
- `project_admitted_geometry_export` + `design.write-geometry@1` is the canonical STEP
  path. It reopens parameterized `compile.seal-admission@3` bytes.
  `project_geometry_preview` and `design.preview-geometry@1` are not registered.
  `compile.seal-admission@3` + `design.execute-build123d@1` is the local microVM path. A
  successful isolated execution is **not** canonical geometry.
  `design.seal-isolated-geometry@1` seals that CAD execution as a Thread document only.
  `compile.seal-admission@3` + `simulate.run-admitted-modelica@1` is the CAD analog for
  Modelica closed-subset source. Both use `ReopenAdmittedCompilationSource` then
  `IsolatedCodeRunner`. `simulate.run-qualified-modelica-kit@1` is the pinned kit. They
  are not interchangeable. `compile.seal-admission@3` + `simulate.run-admitted-spice@1`
  is the same pattern for circuit-only SPICE (`spice-circuit-source`). It is not
  mcp-spice and not the LED-driver fiche. Pattern:
  [admitted source isolated execution](docs/reference/pipeline/admitted-source-isolated-execution.md).
- `project_technical_source_capture` names only `projectId`, `workspaceRevision`,
  `attachmentId` and `attachmentRevision`. The named attachment revision must be the
  unique active head at that exact workspace snapshot. The server resolves the root
  file, registered profile and deterministic `project-source-closure/1.0`. It returns
  `technical-source-capture-review/4.0`: `parser`, `levers`, and an opaque
  `technical-source-analysis-capture-locator/4.0`. `parser.status` is not admission.
  Pass `result.reference` only. A constructor photo is `levers.unresolved`. A reachable
  literal without `parameterizes` is compile `binding.missing`, not
  `source.no-named-numeric-lever`. MIME, path, `sourceText`, `profileId`, `sourceId`,
  `fileId`, `fileRevision` and `resourceRef` are refused. The Build123d 3.0 profile
  lowers only the direct scalar-leaf closure defined in
  [workspace-closure lowering v1](docs/reference/domains/cad/build123d-workspace-closure-lowering-v1.md).
  Its `technical-unit:<closure sha256>` is not the workspace `fileId`; authored closure
  and attachment remain the evidence. Modelica and SPICE multi-file closures stay
  `unresolved` / `source.dependency-lowering-unavailable`.
- `project_technical_compilation_preview` takes `projectId` + `result.reference`. The
  server selects the current Thread tip, the unique catalog profile, and unique SysML
  joins. Do not pass bindings or profileRequests. It returns a closed
  `technical-compilation/2.0` document; unresolved previews hoist `gaps` (name,
  relation, recovery). The server does not invent a named CAD lever or an
  AttributeUsage. Declare CAD handles on `model.write-architecture@1` with
  `attribute.<slug>.name` and `attribute.<slug>.parent`.
- Product FEA run is `verify.run-fea-static-proof@3` (isolated microVM). Historical MCP
  `@1`/`@2` are not registered. Do not queue them.
- `verify.evaluate-sensitivity-base@1` joins `sensitivity-base-<metric>-<digest>` only.
  A proof-run evaluation cannot authorize `design.apply-vector-correction@1`.
  Corrections return only through `project_resource_capture` plus a successor
  ProjectSourceWorkspace file revision. `compile.capture-corrected-source@1` is not
  registered.
- CM-01 is retired. Do not replay retired fixtures as live evidence.
- `deno task check` type-checks Deno sources by glob. Do not add a per-file census. Vite
  UI (`src/ui/src`) is `deno task check:ui`, not that graph.

## Labels stay literal

`unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`,
`demo`, `TRACE GAP`, and `UNLINKED` are contract states. Never drop them to make a
result look complete.
