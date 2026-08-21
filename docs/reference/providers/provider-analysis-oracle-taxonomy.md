# Reference: engines, analyses, evidence and evaluations

Audience: both · Diátaxis: reference · Kind: contract

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

- Isolated CalculiX `@3` is a local microVM engine path, not an oracle. The proof
  method is separately qualified. Historical MCP recorded-static adapters are not
  product.
- Historical recorded Modelica `@1`/`@2` adapters are retired. Current Modelica engines
  are admitted closed-subset L3 and the pinned qualified kit, not a provider-recorded
  scenario island.
- SysON is a model/constraint engine. `syson_constraint_evaluate` is an evaluation
  capability. Digital Thread persists the exact request/structured-response envelope, so
  SysON is not falsely declared producer of a file it did not store.
- A slicer is a manufacturing-analysis engine. A reviewed process profile and DFM rule
  may form a qualified method without needing a universal `SlicerOracle` type.

This lets a new engine add a provider adapter and an explicit method contract, rather
than a new taxonomy branch for every vendor.

## Isolated CalculiX V3

`resolved-operation-plan/2.0` binds the exact MRTR approval, method, thread basis and
input artefacts before `verify.run-fea-static-proof@3`. Historical MCP identities
`verify.run-fea-static-proof@1` and `@2` are rejection identities: they are not
registered, not routes, and not prerequisites. Historical recorded Modelica `@1`/`@2`
are not registered and are not a second ROP arm.

CalculiX is an FEA engine. Isolated V3 rereads the sealed proof and exact canonical
part STEP, runs Gmsh and CalculiX in a digest-pinned local microVM, then publishes
exactly nine closed outputs: STEP, request JSON, Gmsh input/log, mesh, CalculiX
deck/log/data and result JSON. Digital Thread rereads the exact proof, requirements and
result bytes and derives the bounded constraints/values request. SysON receives that
request and remains the evaluator; its immutable request/structured-response capture is
a Digital Thread artefact. This is a qualified static proof, not support for arbitrary
agent-authored `.inp` decks.

Live-FEA sensitivity (`analyze.run-fea-sensitivity@1`) uses fleet `mcp-calculix`. That
capability is not the provenance of product static `@3`.

## Ports and folders

The application stays hexagonal by separating storage and recovery from provider wire
vocabulary:

1. `src/domain/compile/rop/` defines the plan, resource profile, qualified methods and
   validation without I/O.
2. `src/adapters/compile/plans/` resolves and seals the one-action plan at queue time; the same
   CAS-backed reader supports inspection and execution.
3. `src/adapters/shared/mcp/http-mcp-resource-reader.ts` reads one exact provider resource; it
   exposes no discovery authority. `src/adapters/shared/cas/` saves/rereads bytes, ledger
   and manifest.
4. `src/adapters/sensitivity/live-fea/` owns fixed MCP tools and envelopes. Executors
   cannot construct arbitrary provider arguments. The historical
   `src/adapters/modelica/recorded/` island, `ModelicaRunObserver`, and port 3016
   `mcp-modelica` sidecar are retired. Do not restore them.
5. Generic WAL helpers live in `src/adapters/shared/wal/`. Typed WAL and executors live
   next to the authority (`src/adapters/modelica/`, `src/adapters/fea/`, …). Modelica WAL
   and executors live under `src/adapters/modelica/`.

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
