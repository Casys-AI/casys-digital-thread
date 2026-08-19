# Reference: engines, analyses, evidence and evaluations

Casys can add engineering engines without treating every engine as an oracle or every
provider response as a verdict. “Oracle” is an informal role for a reviewed evaluation
method; it is neither a provider family nor an `Oracle*` domain type.

| Term                  | Responsibility                                                           | Examples                                                                                | Boundary                                                |
| --------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Engine**            | Executes one bounded technical capability                                | SysON, build123d, OpenModelica, CalculiX, ngspice, PrusaSlicer, ERP connector           | Returns provider facts, never an unreviewed verdict     |
| **Analysis family**   | Names the engineering question independently of implementation           | system structure, CAD, FEA, dynamic-system simulation, circuit simulation, slicing, DFM | Contains no endpoint, credential or wire schema         |
| **Qualified method**  | Pins an engine capability, method/profile, units, assumptions and limits | `qualified-modelica-resumable@2.1`, `qualified-static-structural-proof-case@1.0`        | Server-owned and versioned                              |
| **Resolved case**     | Binds reviewed inputs to one qualified method                            | qualified simulation case, mechanical proof case                                        | Semantic inputs, never a caller-authored MCP envelope   |
| **Recorded plan**     | Authorizes exactly one queued registered action                          | `resolved-operation-plan/2.0`                                                           | Server-owned, CAS-sealed, not a workflow language       |
| **Capture**           | Retains and rereads exact dispatched/returned bytes                      | resource ledger, capture manifest, evaluation envelope                                  | Provider acknowledgement alone is not durable evidence  |
| **Observation**       | Normalizes a captured fact with unit and scope                           | stress, displacement, temperature, energy                                               | Cannot invent or silently reinterpret a value           |
| **Evaluation method** | Compares exact observations with reviewed criteria                       | SysON constraint evaluation, threshold rule, DFM rule                                   | Cannot mutate engine, source or observation             |
| **Evaluation**        | Records an outcome over exact criteria/evidence                          | pass, fail, unresolved, error                                                           | Not a human decision; never inferred from completion    |
| **Decision**          | Admits, rejects or supersedes an action                                  | signed MRTR approval/rejection                                                          | Cannot be manufactured by provider, parser or evaluator |

## Why the naming stays capability-first

A slicer, a solver, a simulator and an evaluator can all answer a question, but they do
not carry the same authority. Naming all of them “oracles” would hide that difference.
Ports instead name their narrow capability; the qualified method supplies the broader
engineering meaning.

- `McpCalculixRecordedStaticAdapter` is a CalculiX recorded-static engine adapter, not
  an oracle. The proof method is separately qualified.
- `McpModelicaResumableAdapter` is a resumable dynamic-system engine adapter. The
  qualified kit manifest identifies the method.
- SysON is a model/constraint engine. `syson_constraint_evaluate` is an evaluation
  capability. Digital Thread persists the exact request/structured-response envelope, so
  SysON is not falsely declared producer of a file it did not store.
- A slicer is a manufacturing-analysis engine. A reviewed process profile and DFM rule
  may form a qualified method without needing a universal `SlicerOracle` type.

This lets a new engine add a provider adapter and an explicit method contract, rather
than a new taxonomy branch for every vendor.

## Recorded Modelica and CalculiX verticals

The two `@2` recorded-analysis run operations use one server-created,
`resolved-operation-plan/2.0` per queued run. It binds the exact MRTR approval, method,
thread basis and input artefacts before any provider call. The Modelica `@2` seal is
planless because it creates the qualified case and method artefacts consumed by a later
planned run. `@1` operations remain intact and historical; they are not silently
upgraded.

Modelica is an engine and modelling language. The `@2` seal accepts only a qualified-kit
manifest and captures the exact model, scenario and optional parameter schema using
identity-bound MCP resources. The run captures its resumable request, parameters, model,
scenario, script, diagnostics, evidence, `run.json` and, on success, result CSV. It
publishes observations without requirements, evaluations, violations, actions or a
verdict.

CalculiX is an FEA engine. The `@2` run rereads the proof and exact STEP, stages only
the private input, then captures exactly nine recorded resources: STEP, request JSON,
Gmsh input/log, mesh, CalculiX deck/log/data and result JSON. Digital Thread rereads the
exact proof, requirements and result bytes and derives the bounded constraints/values
request. SysON receives that request and remains the evaluator; its immutable
request/structured-response capture is a Digital Thread artefact. This is a qualified
static proof, not support for arbitrary agent-authored `.inp` decks.

## Ports and folders

The application stays hexagonal by separating storage and recovery from provider wire
vocabulary:

1. `src/domain/analysis/` defines the plan, resource profile, qualified methods and
   validation without I/O.
2. `src/adapters/plans/` resolves and seals the one-action plan at queue time; the same
   CAS-backed reader supports inspection and execution.
3. `src/adapters/mcp/http-mcp-resource-reader.ts` reads one exact provider resource; it
   exposes no discovery authority. `src/adapters/captures/` saves/rereads bytes, ledger
   and manifest.
4. `src/adapters/modelica/recorded/` and `src/adapters/providers/calculix/` own fixed
   MCP tools and envelopes. Executors cannot construct arbitrary provider arguments.
5. `src/adapters/wal/` owns the durable post-dispatch state. `src/adapters/executors/`
   owns the fixed sequence and canonical ThreadSnapshot write. Modelica WAL and
   executors live under `src/adapters/modelica/`.

Before non-idempotent dispatch, the WAL records intent. A known Modelica request or
CalculiX run is read back, never submitted or solved again. Once solver resources,
ledger and manifest are captured, solver recovery is CAS-only. The later SysON
evaluation has its own pre-call WAL state and may be dispatched once if that intent does
not yet exist; after its capture, recovery is CAS-only. An unknown evaluator outcome is
not called twice.

## Evaluation-method invariants

An admitted evaluation must make explicit: method id/version, reviewed requirement and
comparison semantics, exact observation/evidence fingerprints, unit policy,
applicability/limitations, deterministic or captured nondeterministic outcome, and each
`pass`/`fail`/`unresolved`/`error` state. A failed evaluation names a violation. An
evaluation never repairs, reruns or mutates its inputs; a correction crosses the normal
human decision boundary again.

The vertical is not yet a generic evaluation-method registry. Nor does it authorize
agent-authored native Modelica source or CalculiX decks. Future engines must preserve
the same evidence boundary: identity-bound read, media type, byte count and
independently verified SHA-256; resource lookup is acquisition, never authority.
