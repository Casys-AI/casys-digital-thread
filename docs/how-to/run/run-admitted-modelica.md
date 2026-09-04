# How-to: run admitted Modelica

Audience: both · Diátaxis: how-to · Kind: how-to

Walk product Modelica as closed-subset source: capture → compile seal → reopen the exact
bytes in the local microVM. The current and only admitted-source profile is
`modelica-closed-subset-v2`, version `2.0.0`.

Do **not** call `simulate.run-qualified-modelica-kit@1` for project `.mo` source. Do
**not** call historical `simulate.run-modelica-scenario@1` or `@2`. Do **not** pass
`modelicaText` to the admitted review or operation.

Contract:
[admitted source isolated execution](../../reference/pipeline/admitted-source-isolated-execution.md).
Lookalikes: [lookalike traps](../../reference/agent/lookalike-traps.md). Domain limits:
[language](../../reference/domains/modelica/language.md) and
[execution](../../reference/domains/modelica/execution.md).

## 0. Surfaces

Ordinary start is cold Deno. Do not start the root Compose provider stack: H1 activates
enrolled groups JIT under a lease when covered work needs them, and those groups collide
with root Compose on the same loopback ports. A root `docker compose up` remains a
manual maintainer probe only and must not run concurrently with H1-managed groups.

```bash
deno task start:yolo    # YOLO approval only; it does not activate Modelica
```

ERPNext is an optional sibling integration; start it separately only when its checkout
and environment file are available.

Connect the agent to `http://127.0.0.1:3020/mcp`. The Workbench is read-only. Covered
SysON starts JIT after operational authorization. The catalogue binding
`openmodelica-admitted-modelica` remains `unqualified`, so the registered executor stays
literal `unavailable` until a matching host qualification overlay exists. That is a
qualification gap, not a missing supervisor.

## 1. Capture

Call `project_resource_capture` with the `.mo` UTF-8, put that resource as a workspace
file, attach it, then `project_technical_source_capture` with only `projectId`,
`workspaceRevision`, `attachmentId` and `attachmentRevision`. The source must satisfy
the v2 grammar, including its exact `annotation(experiment(...))` scenario. There is no
inline `sourceText`, `profileId`, `sourceId` or `resourceRef`.

Read the result fields separately:

- `parser.status` reports the shared v2 executable-language authority. It is not
  admission.
- `levers.status` is `not-applicable`: that diagnostic is CAD-only.
- Pass `result.reference` only. Never copy the source text into the next tool.

A rejected source is a closed-language refusal. There is no v1 analyzer or worker
fallback.

## 2. Compile and seal

Call `project_technical_compilation_preview` with exactly
`{ projectId, sourceRefs: [capture.result.reference] }`. When more than one capture is
compiled, every locator in `sourceRefs` must resolve to one shared
ProjectSourceWorkspace basis. The server joins the current Thread tip, the unique
`modelica-closed-subset-v2` /
`2.0.0` profile, and the unique SysML `parameterizes` bindings for every Modelica
parameter symbol. The root model artifact does not need `represents`; that relation is
CAD geometry identity.

Unresolved previews hoist `gaps`. A missing or ambiguous parameter bind is
`binding.missing`. Declare required AttributeUsages through `model.write-architecture@1`
with `attribute.<slug>.name` and `attribute.<slug>.parent`; do not invent a bind inside
the compiler request.

Obtain human MRTR, queue, then execute `compile.seal-admission@3`.

## 3. Review and run

Call `project_admitted_modelica_run_review` with `projectId` only. Do not derive or pass
a Thread basis, admission id, fingerprint, provider, solver or runtime. The server
reopens the current Thread tip and selects exactly one fresh, non-archived canonical
`document` produced by `digital-thread` / `compile.seal-admission@3` whose compilation
target and source are Modelica. A concurrent CAD admission is not a candidate.

Zero Modelica candidates — including stale, archived, malformed, foreign-producer
lookalikes, or CAD-only admissions — fail closed. Several Modelica candidates are
ambiguous and also fail closed. The exact admission validator rereads the
server-selected bytes and returns the fixed parameters and registered
`simulate.run-admitted-modelica@1` operation. Reuse that `operation` verbatim on the
later work item: `compilationAdmission` names the selected admission on the current
review Thread basis. Do not copy a historical `compile.seal-admission@3` creation
snapshot.

Obtain human MRTR, queue, then execute `simulate.run-admitted-modelica@1`. The catalogue
binding remains `unqualified`; a successful review does not make the executor available.

## 4. Read success correctly

A success contains an execution capture, `evidence.json`, `result.csv`, and two
observations per declared output: `final` and `max_abs`, both in that output's declared
unit.

The v2 worker calls OMC directly inside the microVM with DASSL. The source annotation,
not the caller, supplies the scenario. The published branch remains `documentary`: it
contains no requirement evaluation, violation or verdict. Replay must reopen durable
evidence without dispatching OMC again.

## 5. L4 observation evaluation (generic capability)

This section is the generic walk. Exact AL01 identities live on
[AL01 runtime evidence](../../project-dossiers/articulated-led-desk-lamp/runtime-evidence.md);
this page does not substitute for them. It still requires a human G4 method sheet and a
real admitted `.mo` plus its published observations.

Call `project_admitted_modelica_evaluation_review` with `projectId` only. Do not pass
values, units, output names, feature, limit, provider, SysON tool or args. The server
reopens the unique current Thread tip, the unique sealed thermal method sheet, and the
unique admitted Modelica evidence. Each sheet output and output-requirement binding
signs `requirementElementId` plus `requirementMetric`; L4 requires exactly one current
Thread requirement for that pair before it creates evidence, calls SysON or prepares
MRTR.

Obtain a new human MRTR, queue, then execute
`verify.evaluate-admitted-modelica-observations@1`. SysON remains the comparator. A
unit-identity mismatch stays `unresolved`. Published statuses stay literal `pass`,
`fail`, `unresolved` or `error`. An L4 `pass` is not a product verdict.

## 6. L5 human closeout (generic capability)

This section is the generic walk, not a substitute for persisted AL01 identities. It
still requires human G4 and a real `.mo` / L4 capture.

Call `project_admitted_modelica_evaluation_closeout_review` with `projectId` only. Do
not pass a snapshot, sheet, capture, status, value, unit, Modelica text, provider, tool,
args, SysON envelope, consequence or approval. The server selects the unique current
Thread tip with `selectCurrentThreadTip` and the unique fresh, non-archived L4 document
produced by `verify.evaluate-admitted-modelica-observations@1` on that exact tip. Zero,
multiple, stale, archived, foreign, malformed or inexact captures fail closed as
`unavailable` or `unresolved`.

The review returns a bounded read of the exact L4 identities and statuses plus **both**
accept and reject `decisionParameters`. They bind the same project, subject, basis,
sheet, capture and `(requirementElementId, requirementMetric)` pair, and differ only in
consequence. L4 `pass`/`fail`/`unresolved`/`error` are preserved literally. The human
decides on the exact L4 and its scope; L4 pass is never implicit L5. There is no
mechanical all-pass acceptance rule.

Obtain human G4 MRTR, queue, then execute exactly one of
`decide.accept-admitted-modelica-evaluation@1` or
`decide.reject-admitted-modelica-evaluation@1`. The executor recrosses the same shared
L4 evidence at execution time. Neither operation calls OMC or SysON.

## Refusals

| Unharnessed move                                 | Harness                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| v1 admitted profile or worker                    | No compatibility path; author and capture exact v2 source                |
| Kit `@1` for product `.mo`                       | Kit source is image-owned; product source uses admitted `@1`             |
| Recorded provider `@1` or `@2`                   | Historical identities are not registered                                 |
| Extra `modelicaText` binding                     | Registry refuses it                                                      |
| Caller Thread/admission identity                 | Review accepts `projectId` only; server selects the exact current join   |
| Stale or wrong-producer admission                | Not a fresh `digital-thread` `compile.seal-admission@3` candidate        |
| Two fresh Modelica admissions on the current tip | Ambiguous; a concurrent CAD admission is not a candidate                 |
| Caller solver, scenario or image                 | Sealed source plus server-owned OMC/DASSL worker and digest              |
| Modelica success used as the FEA verdict         | Documentary observations and static FEA evaluations stay distinct        |
| L4 `pass` treated as L5                          | Human closeout of the exact L4; review always offers accept and reject   |
| Caller consequence, capture or sheet             | Closeout review accepts `projectId` only; server recrosses the unique L4 |
