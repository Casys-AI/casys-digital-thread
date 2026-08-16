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

1. [Agent workspace reference](docs/reference/agent-workspace.md) — lookalikes, tools,
   operations, code placement
2. [Source analysis and authority pipeline](docs/reference/analysis-authority-pipeline.md)
   — capture → analysis → MRTR → dispatch
3. [Workspace map](docs/reference/workspace-map.md) — files, CAS roots, local ports
4. [CLAUDE.md](CLAUDE.md) — commands, hexagonal rules, CM-01 retirement
5. [Walk the post-proof loop](docs/how-to/walk-the-post-proof-loop.md) — **behave**
   branch: join, fail-only correction, `z*`, reseal. Make (DFM) and buy (BOM)
   are later. Local dl05 r16 is `UNLINKED` and `pass`; do not invent a mapping
   or a fail.
6. [Three judgement branches](docs/explanations/product-direction.md#three-judgement-branches)
   — one STEP, three questions; verdicts do not cross.

## Immediate traps

- `model.write-architecture@1` **renders** SysML and writes SysON.
  `model.seal-architecture-sysml@1` **seals** agent-authored closed-subset SysML as a
  Thread document and **never** calls SysON.
- `sysml-source-capture/1.0` is the renderer envelope.
  `architecture-sysml-source-analysis-capture/1.0` is the agent-authored CAS. They are
  not interchangeable.
- Legacy `project_geometry_preview` + `design.write-geometry@1` is the MCP sandbox path.
  `compile.seal-admission@1` + `design.execute-build123d@1` is the local microVM path. A
  successful isolated execution is **not** canonical geometry.
  `design.seal-isolated-geometry@1` seals that execution as a Thread document only.
- `verify.run-fea-static-proof@1`, `@2`, and `@3` are distinct authorities. Do not
  reroute one plan to another.
- `verify.evaluate-sensitivity-base@1` joins `sensitivity-base-<metric>-<digest>`
  only. A proof-run `@2` evaluation cannot authorize
  `design.apply-vector-correction@1`. `compile.capture-corrected-source@1` is
  not `compile.seal-admission@1`.
- CM-01 is retired. Do not replay retired fixtures as live evidence.
- A `verify.run-fea-static-proof@2` success is only a captured, reread Thread revision.
  This atelier may hold such receipts for `desk-lamp-dl04` and `desk-lamp-dl05` under
  `state/local/` (gitignored). Absence of that revision is `unavailable`. Do not relabel
  `@1`.
- New non-test modules must be listed in `deno.json` `check`. Omitting them is a silent
  type-check hole.

## Labels stay literal

`unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`,
`demo`, `TRACE GAP`, and `UNLINKED` are contract states. Never drop them to make a
result look complete.
