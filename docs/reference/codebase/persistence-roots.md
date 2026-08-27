# Reference: source map — persistence roots

Audience: agent · Diátaxis: reference · Kind: contract

Census of `state/fixtures/` and gitignored `state/local/` roots. These directories are
storage, not product proof.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`state/fixtures/`](../../../state/fixtures)

Explicitly labelled demo evidence

#### `state/local/engineering-projects/`

Ignored immutable active project revisions and CAS claims

#### `state/local/project-source-workspaces/`

Ignored append-only project source workspace events (`NNNNNNNNNN.claim` then `.json`).
Rebuildable in-memory index. Not Thread evidence and not a per-mutation snapshot dump

#### `state/local/engineering-project-run-leases/`

Empty local OS lock targets for executor-owned scopes; generic Thread writers share an
exact-basis scope; not evidence

#### `state/local/recorded-analysis/`

Closed analysis persistence root: technical-compilation source/analysis/draft/seal CAS;
Build123d `{outputs,attempts,drafts,captures}`; admitted Modelica
`{outputs,attempts,captures}`; isolated CalculiX `{outputs,attempts,evidence,leases}`;
resolved operation plans; agent-authored architecture SysML `{sources,analyses,seals}`
under `architecture-sysml/`; LED-driver human-source bytes under
`electrical/led-driver-source/`; and CAD placement `cad/placement/{sources,analyses}`.
CAS children use fixed namespaces

#### `state/local/recorded-analysis/cad/placement/{sources,analyses}/`

Canonical `cad-immediate-placement-source/1.0` bytes and opaque
`cad-placement-analysis-capture/1.0` documents. Not a workspace aggregate, not Thread
evidence, and not a module export

#### `state/local/recorded-analysis/electrical/led-driver-source/`

Exact UTF-8 `led-driver-human-source/1.0` bytes for `led-driver-source-capture/1.0`. Not
a netlist, IR, ngspice payload or Thread result

#### `state/local/recorded-analysis/modelica/admitted/{outputs,attempts,captures}/`

Publication-gated output CAS, durable execution WAL and documentary capture store for
`simulate.run-admitted-modelica@1`. A pre-WAL historical run is not adopted or
redispatched

#### `state/local/recorded-analysis/calculix/isolated-execution/{outputs,attempts,evidence,leases}/`

Publication-gated nine-file output CAS, durable WAL, isolated-execution evidence, and
local leases for `verify.run-fea-static-proof@3`. Not fleet `mcp-calculix`.

#### `state/local/recorded-analysis/calculix/evaluation-closeout-captures/`

Content-addressed provider-free `evaluation-closeout-capture/1.0` records for the
generic static-mechanical L5 accept/reject. The exact human MRTR is required; a captured
L4 `pass` is never an implicit L5 or a correction/CAD/FEA grant.

#### `state/local/recorded-analysis/impact/mechanical-preservations/`

Content-addressed provider-free
`cross-domain-impact-mechanical-preservation-capture/2.0` records for
`analyze.evaluate-mechanical-preservation@2`. Reopens existing FEA proof/closeout
identities; never calls CalculiX and never creates an X10 work item.

#### `state/local/recorded-analysis/architecture-sysml/`

Agent-authored closed-subset SysML CAS: UTF-8 sources, `source-analysis/1.0` analyses,
and `architecture-sysml-seal-capture/1.0` seals. Distinct from
`state/local/sysml-source-captures/` renderer envelopes

#### `state/local/modelica-microsandbox-qualification/`

Separate local-runtime qualification root for publication-gated outputs and
content-addressed captures; the authority reopens one pinned capture and exact receipt
rather than treating the directory or latest entry as activation

#### `state/local/syson-model-seed-captures/`

Content-addressed normalized r2 container captures

#### `state/local/syson-model-seed-attempts/`

Recovery control state for uncertain SysON writes; not evidence

#### `state/local/architecture-captures/`

Current `architecture-capture/4.0` CAS captures for `model.write-architecture@1`, with
exact source-analysis refs, hashed parent-to-usage-to-type graph and causal predecessor.
Older capture schemas are unsupported and are rejected rather than projected.

#### `state/local/dfm-case-captures/`

Content-addressed `dfm-case-capture/1.0` seals for `industrialize.seal-dfm-case@1`.
Distinct from `state/local/printability-case-captures/`

#### `state/local/dfm-check-captures/`

Content-addressed `dfm-check-capture/1.0` measured envelopes (evaluations included).
Distinct from `state/local/printability-observation-captures/`

#### `state/local/dfm-check-attempts/`

WAL for `industrialize.run-dfm-checks@1`; not evidence

#### `state/local/sensitivity-base-evaluation-captures/`

Content-addressed SysON join of study-base observations for
`verify.evaluate-sensitivity-base@1`

#### `state/local/sensitivity-experience/`

Installation-private project-neutral records, server-private origins, reviews/receipts,
append-only admissions/invalidations, deterministic index, and fail-closed pre-dispatch
reuse WAL (ancestor symlinks and cross-tuple transplants rejected); never a Workbench,
team-sharing, marketplace, or caller-selection surface

#### `state/local/dfm-exports/`

Staged STEP bytes for mcp-dfm `/exports`; identity is the sha256, not the path

#### `state/local/part-definitions-captures/`

Content-addressed `part-definitions-capture/1.0` sealed architecture subgraphs for
`model.capture-part-definitions@1`; sibling PartDefinitions added in SysON after the
architecture capture are not observed

#### `state/local/architecture-attempts/`

Recovery control state for uncertain generic SysON architecture writes

#### `state/local/part-definitions-publications/`

Run-scoped publication WAL for `model.capture-part-definitions@1`; a crash after the
SysON read resumes without a second provider query

#### `state/local/brief-source-captures/`

Content-addressed `brief-source-capture/1.0` envelopes holding exact canonical
approved-brief JSON before its local analysis

#### `state/local/sysml-source-captures/`

Content-addressed `sysml-source-capture/1.0` envelopes written and reopened by current
`model.write-architecture@1`; the exact bytes are distinct from the later SysON provider
readback

#### `state/local/requirements-captures/`

Content-addressed `requirements-capture/3.0` records bind the exact target
PartDefinition, native RequirementUsage and bijective ConstraintUsage identities, and
architecture basis; predecessor lineage is carried by the Thread extension.

#### `state/local/requirements-attempts/`

Recovery control and quarantine state for uncertain generic SysON requirements writes

#### `state/local/geometry-source-captures/`

Content-addressed `geometry-source-capture/1.0` envelopes with the unmodified Python
text, exact selector and independent source-byte SHA-256; written and read back before
AST analysis or provider preview

#### `state/local/source-analysis-captures/`

Content-addressed canonical `source-analysis/1.0` bundles; passive source-local facts
only, never an approval or execution authority

#### `state/local/geometry-draft-captures/`

Current analysis-bearing `geometry-draft-capture/1.2` and `2.1`, plus
`geometry-module-draft-capture/1.0`. The module draft binds the exact
`geometry-module-input-bundle/1.0` identity, isolated receipt, reopened child
capture/STEP identities, and produced assembly STEP plus binary GLB. These records never
enter a `ThreadSnapshot`. Older draft schemas are unsupported.

#### `state/local/geometry-draft-assets/<sha256>`

Raw STEP, STL, or binary GLB preview bytes keyed by their recomputed SHA-256; served
read-only by `/api/draft-assets/<digest>`

#### `state/local/geometry-captures/`

Current `geometry-capture/1.2` and `2.1`, plus `geometry-module-capture/1.0`; records
seal verified immediate-child capture plus authoritative STEP identities, predecessor
lineage, input-bundle identity, isolated receipt, and independent assembly STEP plus
binary GLB assets. Older capture schemas are unsupported.
