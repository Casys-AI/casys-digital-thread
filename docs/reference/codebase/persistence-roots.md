# Reference: source map — persistence roots

Audience: agent · Diátaxis: reference · Kind: contract

Census of `state/fixtures/` and gitignored `state/local/` roots. These directories are
storage, not product proof.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays on
[engineering domains](../domains/README.md).

## Capture-store trust boundary

`FileCaptureStore` resolves a relative CAS root from the captured working directory and
walks only below that anchored root; an absolute root is instead walked from `/`.
Configured paths are lexical and bounded, then every existing component is checked with
`lstat` and rechecked before use. Symlinked roots, ancestors, and final capture files
are refused, while a component that changes during the walk fails closed.

The final-file check is deliberately open-first: the opened file handle is recrossed
against the current pathname by file identity before any bytes are read. This closes the
`lstat`-then-read substitution race. New captures are written and synced under a
temporary name, published with no-overwrite linking, reread, and treated as an
idempotent success only when the existing bytes are exact. This is a storage-integrity
boundary, not an execution, approval, qualification, or verdict boundary.

## Source map

#### [`state/fixtures/`](../../../state/fixtures)

Explicitly labelled demo evidence

#### `state/local/capability-runtime-host/`

Host-local admin lock, journal, leases, opaque host identity, qualification attempt WAL
and append-only qualification attestations. Non-persistent cache-image removal uses the
sibling append-only journal under
`capability-runtime-host/nonpersistent-material-removal/`. Not Thread, CAS, project
evidence, or a Workbench command surface. The Chrono probe writes
`qualification-attempts/` and `qualification-attestations/` only. This administrative
removal never uninstalls Microsandbox.

#### `state/local/project-capability-ledgers/`

Append-only `project-capability-ledger/1.0` revisions, prepared envelopes, and
recoverable pending/claim material for each brief-bound operational authorization.
Prepared or pending material alone is not authority. This root is distinct from Thread,
CAS, MRTR, engineering result, and Workbench command state.

#### `state/local/first-party-microsandbox-image-candidate-import/`

Local factual records for maintainer-only first-party Microsandbox candidate import.
Each record names the OCI index digest, the linux/arm64 platform-manifest digest, and
the observed Microsandbox digest as three distinct identities, and preserves the exact
source candidate receipt. Parse/bind recalculates that receipt's fingerprint and rebinds
the record to the current distribution matrix. It is not a qualification attestation,
catalogue pin, Thread evidence, or Workbench command.

#### `state/local/first-party-microsandbox-image-candidate-qualification/`

Per-physical-image, per-import-record host/runtime candidate qualification. CAD uses
`build123d-isolated-worker/<import-record fingerprint>/` and
`geometry-module-assembler-worker/<import-record fingerprint>/`. CalculiX uses
`calculix-worker/<import-record fingerprint>/` with isolated WAL, CAS outputs, evidence,
leases and the strict qualification record. Modelica uses
`modelica-microsandbox-worker/<import-record fingerprint>/` with one aggregate
`qualification.json` at that physical root and two profile-distinct subroots under
`targets/openmodelica-qualified-kit/` and `targets/openmodelica-admitted-modelica/`
(WAL, CAS outputs, profile attestations). The Modelica aggregate is a two-proof physical
record; it is not the shared one-execution CAD/CalculiX schema. ngspice uses
`ngspice-worker/<import-record fingerprint>/` with isolated WAL, CAS outputs,
captures/attestations and the shared one-execution qualification record. None of these
paths write `state/local/modelica-microsandbox-qualification`,
`state/local/recorded-analysis/electrical/spice/admitted/`, the active
`capability-runtime-host` qualification store, Thread, or project state. Host
observation is `linux/arm64`. `eligibleForPromotion` stays `false`. This is not L3, L4
or L5 engineering evidence.

#### `state/local/capability-runtime-microvm-preparation/`

Current append-only intent and terminal journal for server-owned first-party microVM
material preparation. Server preload and the local runtime administrator share this
single default through `FileCapabilityRuntimeCachePreparationJournal`. The retired
`state/local/capability-runtime-cache-preparation/` tree is neither read, migrated nor
deleted; its records belong to an earlier recipe model and remain outside current
runtime authority.

#### `state/local/engineering-projects/`

Ignored immutable active project revisions and CAS claims

#### `state/local/project-source-workspaces/`

Ignored append-only project source workspace events (`NNNNNNNNNN.claim` then `.json`).
Rebuildable in-memory index. Not Thread evidence and not a per-mutation snapshot dump

#### `state/local/mechanics/prescribed-kinematics/captures/`

Five immutable CAS lanes for the exact L1 case, factual L3 observation, reviewed method,
provider-free L4 evaluation, and human L5 closeout. They preserve separate evidence
levels; the directory, a provider receipt, and a later artifact never promote an earlier
level or create a verdict by themselves.

#### `state/local/mechanics/prescribed-kinematics/observation-attempts/`

Append-only product L3 attempt WAL and create-new dispatch claims for prescribed
kinematics. After the durable dispatch boundary it permits only same-request readback;
`quarantined` does not authorize a redispatch. This root is distinct from the private
host qualification WAL under `capability-runtime-host/`.

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

#### `state/local/sensitivity-runtime-provenance-captures/`

Content-addressed L3 `sensitivity-runtime-provenance/1.0` records for the actual
server-resolved recorded CalculiX runtime and the base then stepped recorded captures,
including their request, readback, and ordered-resource-capture identities. Separate
from the scientific sensitivity study capture; not a provider qualification, solver
verdict, or evaluation.

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
`geometry-module-input-bundle/1.0` identity, provider-neutral assembly receipt, reopened
child capture/STEP identities, and produced assembly STEP plus binary GLB. These records
never enter a `ThreadSnapshot`. Older draft schemas are unsupported.

#### `state/local/geometry-draft-assets/<sha256>`

Raw STEP, STL, or binary GLB draft bytes keyed by their recomputed SHA-256. They remain
server-internal and are reopened only by the authorized CAD MRTR, execution, and seal
flows; the Workbench exposes no draft-byte route

#### `state/local/thread-viewer-apps/registry.json`

Explicit `thread-viewer-app-registry/1.0` registrations for exact Project/Thread bases,
anchors, App identities, whole-view resources, session schemas and opaque payloads. This
file is written by a trusted registrar outside the Workbench. The Workbench is a
read-only consumer: an absent or invalid registry projects zero App sessions.

#### `state/local/thread-viewer-apps/objects/<sha256>`

Immutable manifest JSON, whole-App HTML and registered read-resource bytes named by
their exact SHA-256. The packaged Desktop and standalone BFF reopen and rehash these
objects before projection or service. The browser never frames the stored HTML route
directly; it verifies MIME, byte count and digest again, applies the staged CSP
transform and frames only the resulting Blob document.

#### `state/local/geometry-captures/`

Current `geometry-capture/1.2` and `2.1`, plus `geometry-module-capture/1.0`; records
seal verified immediate-child capture plus authoritative STEP identities, predecessor
lineage, input-bundle identity, provider-neutral assembly receipt, and independent
assembly STEP plus binary GLB assets. Older capture schemas are unsupported.
