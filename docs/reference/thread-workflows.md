# Reference: native thread workflow YAML

> **Diátaxis category: reference.** This page documents the reviewed authoring format in
> [`config/thread-workflows/`](../../config/thread-workflows/).

A thread workflow declares a causal engineering DAG. YAML is the human- and
agent-friendly authoring form; the loader validates it and the compiler produces a
typed, deterministically ordered `thread-workflow-dag` before any operation can run.
Loading, validating, or compiling a workflow performs no MCP call.

## Document shape

```yaml
schemaVersion: "1.0"
kind: thread-workflow
id: coffee-machine-mechanical-v1
name: Coffee machine mechanical verification
inputs:
  syson_editing_context_id:
    type: string
  reviewed_material_e_mpa:
    type: number
nodes:
  requirements:
    server: syson
    tool: syson_constraint_extract
    needs: []
    arguments:
      editing_context_id: "${inputs.syson_editing_context_id}"
    outputs:
      constraints:
        select: constraints
        type: array
        minItems: 1
  cad:
    server: build123d
    tool: build123d_export
    needs: [requirements]
    arguments: {}
    outputs:
      step_sha256:
        select: files.0.sha256
        type: string
  mechanical:
    server: calculix
    tool: calculix_solve_static
    needs: [cad]
    arguments:
      expected_step_sha256: "${cad.step_sha256}"
    outputs: {}
```

Top-level `inputs` declare the typed runtime values that an explicit execution request
must supply. A workflow cannot read them from dashboard state or silently invent a SysON
identifier. The CoffeeMachine mechanical workflow also requires reviewed density,
elastic constants, and load instead of embedding example physics as product defaults.

Each node declares:

| Field                | Meaning                                                                                    |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `server`             | Reviewed backend provider identity                                                         |
| `tool`               | Exact provider-native tool name                                                            |
| `needs`              | Explicit predecessor node IDs; use `[]` when there are none                                |
| `arguments`          | Literal JSON values or typed `${node.output}` bindings                                     |
| `outputs`            | Named selections from the tool's `structuredContent`                                       |
| `outputs.*.type`     | `array`, `artifact-uri`, `boolean`, `number`, `object`, `quantity`, `string`, or `unknown` |
| `outputs.*.minItems` | Optional non-empty lower bound for array evidence                                          |

Bindings add inferred dependencies. The compiler rejects unknown workflow inputs, nodes
or outputs, invalid paths, cycles, references to non-predecessors, and conflicting
dependency declarations. The executor validates required input values and output types,
including `minItems`, before dependent work continues. Nodes are topologically sorted
with a deterministic lexical tie-break.

## Execution boundary

The executor is backend-only and runs only after an explicit execution request. It is
not connected to page load, snapshot reads, or dashboard selection.

- The browser reads a projection over normal HTTP and receives no MCP endpoint,
  credentials, or generic tool-call authority.
- The Deno backend resolves reviewed server IDs to stateless MCP `tools/call` clients.
- It does not automatically retry engineering calls because they may be expensive or
  have durable effects.
- A failed node blocks its descendants. Independent branches may still complete and are
  recorded separately.
- Selected `structuredContent` outputs, arguments, timestamps, durations, failures, and
  blocked dependencies form the execution record.

The in-process `digital-thread` provider currently owns only
`thread_observations_normalize`. It preserves provider-native tool contracts while
normalizing unit-bearing evidence and refusing a producer/consumer hash mismatch.

## Fixed V3 SysON container seed (not workflow YAML)

`architecture.seed-syson-model@2` is not authored as a workflow and does not accept a
YAML graph, provider selection, tool name, arguments, SysML text, or result from the
agent. It is the first provider-backed V3 operation after
`baseline.from-approved-brief@1` has published the exact approved-brief documentary
`ThreadSnapshot` r1 and an additive project change has declared the seed.

The server owns the complete fixed sequence:

```text
exact documentary r1
  -> create blank SysON project container
  -> create blank SysML document + root package
  -> read back root package
  -> normalize identities + persist capture
  -> publish descendant ThreadSnapshot r2
```

The `syson-model-seed-capture/2.0` record contains normalized project, document, and
root-package identities plus the exact approved-brief, project-change and documentary
artifact authorization chain. It does not add a system architecture, requirements, CAD,
simulation, measurement, or verification verdict. Before each non-idempotent SysON
creation, the executor persists a write-ahead attempt record. If the provider outcome is
unknown, it stops for explicit review instead of blindly retrying a possibly successful
creation. This control flow is a closed executor contract, not a reusable YAML-node
pattern.

## Historical r6 mechanical slice

[`coffee-machine-mechanical-v1.yaml`](../../config/thread-workflows/coffee-machine-mechanical-v1.yaml)
drives the retained r6 provenance only. The current CM-01 V3 golden path uses its own
registered code-owned executors and captures, not a generic YAML operation; see the
[golden-run guide](../how-to/run-cm01-v3-golden-local.md).

That historical YAML declares the solve/normalize/evaluate DAG. The CM-01 product runner
surrounds it with the approved SysON preflight and build123d generation:

```text
SysON preflight ──▶ build123d STEP ──▶ CalculiX ──▶ normalization ──▶ SysON evaluation
       └──────────────── extracted constraints ────────────────────────────┘
```

The runner supplies `cad_step_path` and `cad_step_sha256` from the exact
content-attested DripTray export it just generated. It accepts only CalculiX
`static-solve` structured content schema `2.0`, whose required `inputArtifact` records
the consumed bytes. CalculiX accepts `expected_step_sha256`, recomputes
`inputArtifact.sha256`, and rejects a mismatch before solving. Material, meshing,
support boxes, load boxes, and force components are required workflow inputs with no
defaults.

Constraint extraction may honestly return an empty array. The generic workflow preserves
that state: an empty evaluation is not a pass. The CM-01 product runner adds a stricter
preflight around this DAG. It accepts only the exact human-approved DripTray proposal;
when the tracked r5 model has no mechanical constraints, it inserts the proposal-derived
`1 mm` displacement and `20 MPa` von Mises limits, re-extracts them, and refuses to
continue unless the exact pair is present.

The product boundaries are:

- no public BFF endpoint triggers the executor; the explicit CLI runner persists a
  capture and the separate attach task persists its resulting `ThreadSnapshot`;
- the native Workbench reads an immutable persisted `ThreadSnapshot` through passive
  GET/SSE paths and exposes no workflow command;
- the tracked r5 inventory has two `RequirementUsage` elements but zero mechanical
  `ConstraintUsage` elements; the approved runner's bounded SysON mutation is later
  evidence, not a rewrite of that baseline;
- the published r6 result covers one isolated DripTray concept only. No reviewed
  whole-machine material/support/load declaration or certification case exists;
- project lifecycle is separate: an agent enters `publishing`, the attach task saves and
  reads back canonical evidence, and only then may the agent complete against the exact
  returned references.

The completed reference run published the exact CalculiX-consumed STEP and both passing
SysON evaluations in
`coffee-machine-cm01:r6:coffee-machine-mechanical-run:erwan-authorize-cm01-mechanical-run-v1-extension`.
Active project revision 10 records the bound run and verification work item as
`completed`.

## Presentation separation

`config/thread-workflows/*.yaml` describes data dependencies and explicit engineering
operations. It has no areas, columns, component keys, CSS, or live UI state. A product
UI reads a persisted snapshot; it does not execute this YAML merely because a page
opened.
