# How-to: run admitted Modelica

Audience: both · Diátaxis: how-to · Kind: how-to

Walk product Modelica as CAD-like closed-subset source: capture → compile seal →
reopen those bytes in the local microVM. Do **not** call
`simulate.run-qualified-modelica-kit@1` (pinned kit, no caller `.mo`). Do **not** call
`simulate.run-modelica-scenario@2` (recorded provider). Do **not** pass `modelicaText`.

Contract: [admitted source isolated execution](../../reference/pipeline/admitted-source-isolated-execution.md).
Lookalikes: [lookalike traps](../../reference/agent/lookalike-traps.md).
Domain limits: [Modelica closed subset v1](../../reference/domains/modelica/closed-subset-v1.md)
and [execution profiles](../../reference/domains/modelica/execution-profiles.md).

Do not walk this on a behave vehicle that already has a joined `pass` (including
`wall-hook-wh01` after FEA `@2` pass). Start a **new** thermal project.

## 0. Surfaces

```bash
docker compose up -d
deno task start:yolo    # or start:local; review/executor need --local-execution
```

Connect the agent to `http://127.0.0.1:3020/mcp`. The Workbench is read-only.

## 1. Capture

`project_technical_source_capture` with LinearThermalRamp-form Modelica. Read three
facts apart:

- `parser.status` is the closed-subset parser. It is not admission.
- `levers.status` is a reachable named numeric literal.
- Pass `result.reference` only. Never the source text.

A constructor photo is `levers.unresolved`. That is not a bind gap.

## 2. Compile

`project_technical_compilation_preview` with `projectId` + `result.reference` only. The
server joins the current Thread tip (not `latest`), the unique `modelica-closed-subset-v1`
profile, and unique SysML `parameterizes` binds.

Unresolved previews hoist `gaps`. A reachable literal without `parameterizes` is
`binding.missing`, not `source.no-named-numeric-lever`. Declare Modelica handles on
`model.write-architecture@1` with `attribute.<slug>.name` and `attribute.<slug>.parent`.

Human MRTR. Queue. Execute `compile.seal-admission@1`.

## 3. Review and run

Call `project_admitted_modelica_run_review` with `projectId` only. Do not derive or pass
a Thread basis, admission id, or fingerprint. The server reopens the unique current
Thread tip, then selects exactly one fresh, non-archived canonical `document` produced
by `digital-thread` / `compile.seal-admission@1`. Zero candidates — including stale,
archived, malformed, or foreign-producer lookalikes — and several candidates fail
closed. The exact admission validator reopens those server-selected bytes and returns
parameters for
`simulate.run-admitted-modelica@1`. There is no `modelicaText` field.

Human MRTR. Queue. Execute `simulate.run-admitted-modelica@1`.

A success is documentary: execution capture, `evidence.json`, `result.csv`. It is not a
requirement verdict. Replay must not dispatch the solver again.

## Refusals

| Unharnessed move                        | Harness                                                              |
| --------------------------------------- | -------------------------------------------------------------------- |
| Kit `@1` for product `.mo`              | Kit worker pins image source. Product path is admitted `@1`          |
| Recorded `@2` for local closed-subset   | Different authority (ROP / provider)                                 |
| Extra `modelicaText` binding            | Registry refuses it                                                  |
| Caller Thread/admission identity        | Tool accepts `projectId` only; server selects the current exact join |
| Stale or wrong-producer admission       | Not a fresh `digital-thread` `compile.seal-admission@1` candidate    |
| Two fresh admissions on the current tip | Ambiguous; server refuses to choose                                  |
| Second Modelica image name              | One family: `casys/modelica-microsandbox-worker`                     |
| Walk on WH01 after FEA `pass`           | New thermal vehicle                                                  |
