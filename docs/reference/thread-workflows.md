# Reference: native thread workflow YAML

> **Diátaxis category: reference.** This page documents the reviewed authoring
> format in [`config/thread-workflows/`](../../config/thread-workflows/).

A thread workflow declares a causal engineering DAG. YAML is the human- and
agent-friendly authoring form; the loader validates it and the compiler produces
a typed, deterministically ordered `thread-workflow-dag` before any operation
can run. Loading, validating, or compiling a workflow performs no MCP call.

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

Top-level `inputs` declare the typed runtime values that an explicit execution
request must supply. A workflow cannot read them from dashboard state or
silently invent a SysON identifier. The CoffeeMachine mechanical workflow also
requires reviewed density, elastic constants, and load instead of embedding
example physics as product defaults.

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

Bindings add inferred dependencies. The compiler rejects unknown workflow
inputs, nodes or outputs, invalid paths, cycles, references to non-predecessors,
and conflicting dependency declarations. The executor validates required input
values and output types, including `minItems`, before dependent work continues.
Nodes are topologically sorted with a deterministic lexical tie-break.

## Execution boundary

The executor is backend-only and runs only after an explicit execution request.
It is not connected to page load, snapshot reads, or dashboard selection.

- The browser reads a projection over normal HTTP and receives no MCP endpoint,
  credentials, or generic tool-call authority.
- The Deno backend resolves reviewed server IDs to stateless MCP `tools/call`
  clients.
- It does not automatically retry engineering calls because they may be
  expensive or have durable effects.
- A failed node blocks its descendants. Independent branches may still complete
  and are recorded separately.
- Selected `structuredContent` outputs, arguments, timestamps, durations,
  failures, and blocked dependencies form the execution record.

The in-process `digital-thread` provider currently owns only
`thread_observations_normalize`. It preserves provider-native tool contracts
while normalizing unit-bearing evidence and refusing a producer/consumer hash
mismatch.

## First mechanical slice

[`coffee-machine-mechanical-v1.yaml`](../../config/thread-workflows/coffee-machine-mechanical-v1.yaml)
declares this sequence:

```text
requirements ─────────────────────────────────────┐
                                                  ▼
cad ──▶ mechanical ──▶ observations ──▶ evaluation
```

The CAD/FEA integrity edge has been proven against current local provider
checkouts: build123d returns `files[].sha256`, CalculiX accepts
`expected_step_sha256`, recomputes `inputArtifact.sha256`, and rejects a
mismatch before solving. These provider changes are not yet committed or
published, so this workspace must not advertise them as a released wire
contract.

The end-to-end workflow is not yet a successful live product path. A live run
against the restarted SysON provider on 2026-08-01 proved the intended fail-fast
boundary: `syson_constraint_extract` returned structured `constraints: []` for
`BrewTemperatureRequirement`; the `minItems: 1` contract failed the
`requirements` node, and `cad`, `mechanical`, `observations`, and `evaluation`
were all recorded as blocked. No CAD or solver computation ran without a
model-owned constraint.

The remaining product boundaries are:

- no public BFF endpoint triggers the executor or persists its resulting
  `ThreadSnapshot`;
- the native Workbench reads an immutable persisted `ThreadSnapshot` through a
  read-only BFF; it does not execute this workflow on page load;
- the current live SysON model has two `RequirementUsage` elements but zero
  `ConstraintUsage` elements, so the next model step is to add a real constraint
  under the relevant requirement before the workflow can produce a product
  verdict.

## Presentation separation

`config/thread-workflows/*.yaml` describes data dependencies and explicit
engineering operations. It has no areas, columns, component keys, CSS, or live
UI state. A product UI reads a persisted snapshot; it does not execute this YAML
merely because a page opened.
