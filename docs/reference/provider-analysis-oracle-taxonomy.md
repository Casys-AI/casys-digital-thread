# Engines, analyses, evidence and evaluations

Casys must be able to add engineering engines without treating every engine as an oracle
or every provider response as a verdict. The canonical vocabulary is the ordered chain
below. “Oracle” remains an informal role for a reviewed evaluation method; it is not a
provider family, a server kind or a new `Oracle*` domain type.

| Canonical term           | Responsibility                                                                               | Examples                                                                                     | Authority boundary                                                             |
| ------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Moteur**               | Execute one bounded technical capability                                                     | SysON, build123d, OpenModelica, CalculiX, ngspice, PrusaSlicer, ERP connector                | Returns provider facts; never creates an unreviewed verdict                    |
| **Famille**              | Name the engineering question independently of one implementation                            | System structure, CAD, FEA, dynamic-system simulation, circuit simulation, slicing, DFM      | Contains no endpoint, credential or provider wire schema                       |
| **Méthode qualifiée**    | Pin the reviewed engine capability, model/profile, units, assumptions and limits             | Modelica kit/scenario contract, FEA mesh/material/selection policy, slicer process profile   | Is server-owned and versioned; agent input cannot replace its method semantics |
| **Cas résolu**           | Bind one reviewed request and exact source identities to one qualified method                | Sealed simulation case, sealed mechanical proof case, admitted print-estimate case           | Contains semantic inputs, not a caller-authored MCP envelope                   |
| **Capture**              | Retain and reread the exact dispatched/returned record and content fingerprints              | Solver-result CAS record, Modelica run record, execution receipt                             | Is immutable evidence; provider acknowledgement alone is not durable capture   |
| **Observation**          | Normalize a captured fact with unit, provenance, scope and limitations                       | Stress, displacement, voltage, energy, print time, material mass, stock, cost                | Cannot invent a missing value or silently reinterpret a unit                   |
| **Méthode d’évaluation** | Compare exact observations with reviewed criteria using one versioned, explainable algorithm | Threshold comparison, constraint solver, deterministic DFM rule, cost or availability policy | Cannot drive or mutate the engine, source or observations                      |
| **Évaluation**           | Record the outcome of one method over exact criterion and observation fingerprints           | Pass, fail, unresolved or error, with a margin only when the method defines one              | Is not a human decision and cannot be inferred from successful execution       |
| **Décision**             | Admit, reject or supersede the engineering action at the human authority boundary            | MRTR approval/rejection, reviewed successor correction                                       | Cannot be manufactured by a provider, parser, graph edge or evaluator          |

Native source precedes this chain: brief JSON, SysML, Python CAD, Modelica, a SPICE
netlist, a CalculiX input deck or a slicer profile expresses the work. A semantic
resolver may bind stable identities across representations, but only from reviewed,
evidenced mappings; it must never join by display label alone.

## Concrete examples

- CalculiX is an execution engine. FEA is the analysis family. Maximum stress and
  displacement are observations. A reviewed stress limit plus a versioned evaluation
  method produces the evaluation.
- PrusaSlicer is an execution engine. Slicing and some DFM checks are analysis
  capabilities. Print time, filament usage and detected geometry conditions are
  observations. A process-specific DFM evaluation method may later compare them with
  reviewed manufacturing rules.
- SPICE is an execution-engine ecosystem for circuit simulation. Voltages, currents,
  operating points and frequency responses can become evidence. Electrical requirements
  remain separate inputs to an evaluation method. The SPICE MCP is currently present in
  the local fleet, but no Project Control case, executor, capture or analysis graph uses
  it yet.
- Modelica is both a modelling language and an execution ecosystem. A Modelica run
  produces observations; it does not satisfy a product requirement merely by completing.
- An ERP connector supplies enterprise facts such as BOM rows, stock, supplier lead time
  and recorded price. Cost, availability or sourcing policies may consume those facts,
  but the ERP is not itself the policy authority.
- DFM is a family of manufacturing analyses, not one universal tool or verdict. FDM, CNC
  machining, sheet metal and injection moulding need different evidence and reviewed
  criteria even when they share the same canonical graph.

## Capability-first ports

The operation registry, executors, CAS and source frontend registry keep the application
independent from provider MCP vocabulary. The implemented capability ports are:

1. `SourceAnalysisFrontend` analyses one exact native source capture. It emits qualified
   local facts and unresolved constructs, never authority.
2. `SimulationMethodCatalog` checks that a reviewed dynamic-system method remains
   available before a new dispatch.
3. `SimulationPlanResolver` deterministically lowers a sealed simulation case into the
   exact opaque execution plan used for the plan digest.
4. `DynamicSystemSimulator` executes that already-resolved plan through the
   non-idempotent capability.
5. `SimulationRunReader` validates durable run records and exact dispatch/readback
   agreement.
6. `StaticStructuralSolver` resolves and executes a sealed static-structural proof.

The Modelica executor receives the catalogue, plan-resolver, simulator and run-reader
ports as four separate dependencies; one private adapter may implement all four at
composition time without merging those dependencies. The FEA executor receives only
`StaticStructuralSolver`. Concrete adapter modules under
`src/adapters/providers/modelica/` and `src/adapters/providers/calculix/` own provider
names, tool names and MCP envelopes. Executors retain opaque exact records only for WAL,
CAS, plan-digest and receipt attestation; they cannot construct raw provider arguments.

`StaticStructuralSolver` returns a provider-neutral result: exact input fingerprint and
byte count, normalized supports and force loads, mesh node/element counts, displacement
and von Mises observations. CalculiX paths, constraint echoes, `nodesPerSelection` and
provider-local node/element identifiers stay in the strict adapter/capture DTO. An
opaque in-process capture token lets the executor persist the already validated exact
response without adding that wire shape to the domain. The persisted solver capture and
verdict bytes remain the existing `1.0` contracts.

The Modelica dispatch is reserved by its WAL before the non-idempotent call. A transport
error after that reservation is terminal `outcome-unknown`; a returned but malformed
response proves acknowledgement and enters quarantine. Neither case is downgraded to an
ordinary pre-dispatch failure or transitions the project run to `failed`: its
`running`/`publishing` context is preserved for exact retry or operator reconciliation.
A retry of a quarantined or merely `dispatched` WAL never redispatches. The
`provider-run-known` path recomputes only its deterministic plan digest, then invokes
`SimulationRunReader`; it never invokes the catalogue or simulator.

A later evidence-normalization or semantic-resolution seam should likewise remain small
and versioned. A later evaluation seam must be a versioned evaluation-method contract
over exact requirements and observations; it must not introduce an `Oracle*` type for an
execution engine. The admitted publisher, not the method implementation, materializes
canonical evaluations and named violations.

The admitted orchestration validates port outputs and publishes them into the relevant
`ThreadSnapshot` records and, where a qualified relation exists, `AnalysisGraph`. The
ports do not own canonical thread writes, they do not all feed a graph today, and they
do not share a universal AST. Each language frontend may keep its native parser and AST
behind the frontend port.

## Evaluation-method invariants

Before a new canonical evaluation publisher is admitted, a successor contract and its
validator must make all of the following explicit and enforce their coherence:

- exact evaluation-method id and version;
- reviewed requirement and comparison semantics;
- exact observation and evidence fingerprints;
- unit conversion policy and normalized unit;
- applicability scope, limitations and uncertainty;
- deterministic result or an explicitly captured nondeterministic result;
- `pass`, `fail`, `unresolved` or `error` represented without coercion;
- a named violation for every failed evaluation.

An evaluation method never repairs, reruns or mutates its inputs. A proposed correction
is a later decision proposal and must cross the normal authority boundary again. The
current `ThreadSnapshot` evaluation shape does not yet enforce all of these invariants
by itself; existing trusted executors therefore cannot be treated as a generic oracle
registry or as one universal evaluation method.

## Onboarding order

For a new engine capability or evaluation method, once the relevant contracts above
exist:

1. register the reviewed operation grammar and capability identity;
2. capture and reread exact source, case and basis inputs;
3. execute through the private provider adapter and its WAL policy;
4. capture and reread the exact provider result;
5. normalize facts without a verdict;
6. optionally invoke a separately registered evaluation method over reviewed
   requirements;
7. append evidence, qualified analysis relations and evaluations to the thread;
8. project the canonical records to Graphology and the Workbench.

The current operation registry and `ThreadSnapshot` evaluation model already provide
part of this separation. A generic evidence-normalization seam and exact-version
evaluation-method registry remain deliberate next contracts; they must not be simulated
with provider flags or a catch-all DSL. Provider evolution should expose native sources
and runtime artifacts only through read-only, identity-bound MCP resources (or equally
read-only tools): each read names the exact model, scenario or run identity and returns
media type, byte count and independently verified SHA-256. A resource lookup is evidence
acquisition, never authority.
