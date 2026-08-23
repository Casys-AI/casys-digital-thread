# Agent entry

This workspace is the Casys Digital Thread atelier. Engineering provider servers are
**not** in this repo. They run from published images.

Read this file first, then the linked pages. Do not improvise a second authority model
from UI copy or tool descriptions.

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
4. [Workspace map](docs/reference/runtime/workspace-map.md) — ports, YOLO, runtime
   ownership. File census:
   [workspace source map](docs/reference/runtime/workspace-source-map.md).
5. [CLAUDE.md](CLAUDE.md) — commands, hexagonal rules, CM-01 retirement
6. [Run the behave loop from zero](docs/how-to/behave/run-the-behave-loop-from-zero.md)
   — new project, behave only. Do not repair dl05. Do not open make/buy.
7. [Walk the post-proof loop](docs/how-to/behave/walk-the-post-proof-loop.md) — join,
   fail-only correction, `z*`, reseal. Historical **dl05 r16** is `UNLINKED`
   (`assembly_max_*`). A later join on that atelier can be `pass` (Thread r19). Do not
   invent a mapping or a fail.
8. [Three judgement branches](docs/explanations/product/product-direction.md#three-judgement-branches)
   — one STEP, three questions; verdicts do not cross.

## Immediate traps

- `model.write-architecture@1` **renders** SysML and writes SysON.
  `model.seal-architecture-sysml@1` **seals** agent-authored closed-subset SysML as a
  Thread document and **never** calls SysON.
- `sysml-source-capture/1.0` is the renderer envelope.
  `architecture-sysml-source-analysis-capture/1.0` is the agent-authored CAS. They are
  not interchangeable.
- `project_admitted_geometry_export` + `design.write-geometry@1` is the canonical STEP
  path. It reopens parameterized `compile.seal-admission@1` bytes.
  `project_geometry_preview` and `design.preview-geometry@1` are not registered.
  `compile.seal-admission@1` + `design.execute-build123d@1` is the local microVM path. A
  successful isolated execution is **not** canonical geometry.
  `design.seal-isolated-geometry@1` seals that CAD execution as a Thread document only.
  `compile.seal-admission@1` + `simulate.run-admitted-modelica@1` is the CAD analog for
  Modelica closed-subset source. Both use `ReopenAdmittedCompilationSource` then
  `IsolatedCodeRunner`. `simulate.run-qualified-modelica-kit@1` is the pinned kit. They
  are not interchangeable. `compile.seal-admission@1` + `simulate.run-admitted-spice@1`
  is the same pattern for circuit-only SPICE (`spice-circuit-source`). It is not
  mcp-spice and not the LED-driver fiche. Pattern:
  [admitted source isolated execution](docs/reference/pipeline/admitted-source-isolated-execution.md).
- `project_technical_source_capture` takes `profileId`, `sourceId`, and a full
  `resourceRef` from `project_resource_capture`. It does not accept `sourceText`. It
  returns `technical-source-capture-review/1.0`: `parser`, `levers`, and an opaque
  `reference`. `parser.status` is not admission. Pass `result.reference` only. A
  constructor photo is `levers.unresolved`. A reachable literal without `parameterizes`
  is compile `binding.missing`, not `source.no-named-numeric-lever`.
- `project_technical_compilation_preview` takes `projectId` + `result.reference`. The
  server selects the current Thread tip, the unique catalog profile, and unique SysML
  joins. Do not pass bindings or profileRequests. Unresolved previews hoist `gaps`
  (name, relation, recovery). The compilation document keeps its closed diagnostic
  record. The server does not invent a named CAD lever or an AttributeUsage. Declare CAD
  handles on `model.write-architecture@1` with `attribute.<slug>.name` and
  `attribute.<slug>.parent`.
- Product FEA run is `verify.run-fea-static-proof@3` (isolated microVM). Historical MCP
  `@1`/`@2` are not registered. Do not queue them.
- `verify.evaluate-sensitivity-base@1` joins `sensitivity-base-<metric>-<digest>` only.
  A proof-run evaluation cannot authorize `design.apply-vector-correction@1`.
  `compile.capture-corrected-source@1` is not `compile.seal-admission@1`.
- CM-01 is retired. Do not replay retired fixtures as live evidence.
- `deno task check` type-checks Deno sources by glob. Do not add a per-file census. Vite
  UI (`src/ui/src`) is `deno task check:ui`, not that graph.

## Labels stay literal

`unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`,
`demo`, `TRACE GAP`, and `UNLINKED` are contract states. Never drop them to make a
result look complete.
