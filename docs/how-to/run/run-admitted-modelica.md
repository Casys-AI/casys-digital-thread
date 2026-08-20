# How-to: run admitted Modelica

Audience: both · Diátaxis: how-to · Kind: how-to

Walk product Modelica as closed-subset source: capture → compile seal → reopen the
exact bytes in the local microVM. The current and only admitted-source profile is
`modelica-closed-subset-v2`, version `2.0.0`.

Do **not** call `simulate.run-qualified-modelica-kit@1` for project `.mo` source. Do
**not** call historical `simulate.run-modelica-scenario@1` or `@2`. Do **not** pass
`modelicaText` to the admitted review or operation.

Contract: [admitted source isolated execution](../../reference/pipeline/admitted-source-isolated-execution.md).
Lookalikes: [lookalike traps](../../reference/agent/lookalike-traps.md).
Domain limits: [language](../../reference/domains/modelica/language.md) and
[execution](../../reference/domains/modelica/execution.md).

## 0. Surfaces

```bash
docker compose up -d
deno task start:yolo    # or start:local; review/executor need --local-execution
```

Connect the agent to `http://127.0.0.1:3020/mcp`. The Workbench is read-only.

## 1. Capture

Call `project_technical_source_capture` with one source satisfying the v2 grammar,
including its exact `annotation(experiment(...))` scenario.

Read the result fields separately:

- `parser.status` reports the shared v2 executable-language authority. It is not
  admission.
- `levers.status` is `not-applicable`: that diagnostic is CAD-only.
- Pass `result.reference` only. Never copy the source text into the next tool.

A rejected source is a closed-language refusal. There is no v1 analyzer or worker
fallback.

## 2. Compile and seal

Call `project_technical_compilation_preview` with `projectId` plus
`result.reference` only. The server joins the current Thread tip, the unique
`modelica-closed-subset-v2` / `2.0.0` profile, and the unique SysML
`parameterizes` bindings for every Modelica parameter symbol.

Unresolved previews hoist `gaps`. A missing or ambiguous parameter bind is
`binding.missing`. Declare required AttributeUsages through
`model.write-architecture@1` with `attribute.<slug>.name` and
`attribute.<slug>.parent`; do not invent a bind inside the compiler request.

Obtain human MRTR, queue, then execute `compile.seal-admission@1`.

## 3. Review and run

Call `project_admitted_modelica_run_review` with `projectId` only. Do not derive or
pass a Thread basis, admission id, fingerprint, provider, solver or runtime. The server
reopens the current Thread tip and selects exactly one fresh, non-archived canonical
`document` produced by `digital-thread` / `compile.seal-admission@1`.

Zero candidates — including stale, archived, malformed or foreign-producer lookalikes
— fail closed. Several candidates are ambiguous and also fail closed. The exact
admission validator reopens the server-selected bytes and returns the fixed parameters
for `simulate.run-admitted-modelica@1`.

Obtain human MRTR, queue, then execute `simulate.run-admitted-modelica@1`.

## 4. Read success correctly

A success contains an execution capture, `evidence.json`, `result.csv`, and two
observations per declared output: `final` and `max_abs`, both in that output's declared
unit.

The v2 worker calls OMC directly inside the microVM with DASSL. The source annotation,
not the caller, supplies the scenario. The published branch remains `documentary`: it
contains no requirement evaluation, violation or verdict. Replay must reopen durable
evidence without dispatching OMC again.

## Refusals

| Unharnessed move                         | Harness                                                               |
| ---------------------------------------- | --------------------------------------------------------------------- |
| v1 admitted profile or worker            | No compatibility path; author and capture exact v2 source             |
| Kit `@1` for product `.mo`               | Kit source is image-owned; product source uses admitted `@1`          |
| Recorded provider `@1` or `@2`           | Historical identities are not registered                              |
| Extra `modelicaText` binding             | Registry refuses it                                                    |
| Caller Thread/admission identity         | Review accepts `projectId` only; server selects the exact current join |
| Stale or wrong-producer admission        | Not a fresh `digital-thread` `compile.seal-admission@1` candidate      |
| Two fresh admissions on the current tip  | Ambiguous; server refuses to choose                                    |
| Caller solver, scenario or image         | Sealed source plus server-owned OMC/DASSL worker and digest             |
| Modelica success used as the FEA verdict | Documentary observations and static FEA evaluations stay distinct       |
