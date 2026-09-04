# Reference: compilation and isolation

Audience: agent · Diátaxis: reference · Kind: contract

Product admission compiler, reusable isolation spine, and the CAD / Modelica / SPICE /
CalculiX verticals. Capture → MRTR → dispatch spine stays on
[the authority pipeline](analysis-authority-pipeline.md). Recurrent admitted-source
pattern: [admitted source isolated execution](admitted-source-isolated-execution.md).
File census: [compile source map](../codebase/compile.md). Isolated output counts, WAL
generations, and Thread collection cardinality:
[isolation and Thread boundedness](../runtime/isolation-and-thread-boundedness.md).

## Product admission compiler boundary

The approved brief remains a versioned, human-readable statement of intent. It may seed
explicit proposals, but the compiler never parses its prose or treats wording as a
technical binding. Once technical modelling starts, the exact reread SysON identities
from the supported SysML subset are the technical truth. Every technical binding—parts,
RequirementUsages and ConstraintUsages—must therefore cite exact semantic identifiers
and the exact project and thread basis; labels are display data and never join keys.

That basis is deliberately not advertised as a full SysON model AST. Compilation V1
reopens the parser-backed `architecture-capture/4.0` Package (`scopeRoot.id`),
PartDefinitions and PartUsages. It also admits exact RequirementUsage and
ConstraintUsage identities from an active `requirements-capture/3.0` only after the
capture bytes, provider identities, architecture basis and Thread artifact lineage have
all been reread. Each anchor element carries the exact capture artifact fingerprint that
attests it. An active older requirements capture is unsupported and fail-closed; a
container, label or capture id is never expanded into fictional per-requirement anchors.

The compiler consumes only closed, fingerprinted inputs: the reread SysML basis, exact
native source bytes with their analysis, explicit source-symbol-to-SysML bindings and a
server-owned method profile. It is a pure deterministic transformation. It performs no
MCP call, filesystem or network I/O, chooses no provider or tool, accepts no raw
provider arguments and never repairs a missing binding by matching names. Unsupported,
ambiguous or cross-basis input remains explicit as `unresolved` or `rejected`; it cannot
dispatch a provider.

```text
exact reread SysML basis + captured native source + explicit bindings
                              + server-owned method profile
                                      |
                                      v
                         pure compilation draft
                                      |
                                      v
                         human MRTR over exact digest
                                      |
                                      v
                    provider-free sealed compilation
                                      |
                                      v
              separate execution review + human MRTR
                                      |
                                      v
         registered specialized executor, when explicitly composed
                                      |
                                      v
       isolated run -> validated non-canonical output publication
```

The sealed compilation is reviewed engineering input, not a transport envelope. A
specialized, code-owned backend adapter remains responsible for lowering it immediately
before execution and for capturing what the provider actually observed. Build123d,
Modelica, circuit-only SPICE and CalculiX consequently keep distinct method and evidence
contracts even when they consume projections from the same compilation.

### Reusable substrate versus first vertical

The implementation deliberately shares control-plane contracts, not one universal solver
protocol. The boundary is split as follows:

| Boundary               | Reusable contract                                                                                                                                              | First concrete binding                                                                                                                                                                                                                                                                                                                      |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission              | V2 `technical-compilation-input/2.0` / `technical-compilation/2.0`, exact-basis/source readers, content-addressed review draft and provider-free admission seal | The current registered Build123d profile is 3.0.0 over the qualified closed subset with direct scalar-leaf workspace-closure lowering; it additionally requires a finite module-level numeric parameter, unique `parameterizes` binding and causal reachability to `result`. Dead or constructor-only dimensions are unresolved. There is no legacy-profile reader or compatibility path |
| Isolated execution     | Public `IsolatedCodeRunner`, fail-closed broker and technology-neutral `EphemeralExecutionBackend`; opaque backend lease/output handles stay inside the broker | Microsandbox local 0.6.8 implements the single active backend for one fixed Python wrapper in a digest-pinned OCI microVM                                                                                                                                                                                                                   |
| Declared outputs       | Code-owned output manifest, injected format validator, external byte count/hash and publication-gated output CAS                                               | `geometry.step`, AP214, `OcctStepOutputValidator` and `FileIsolatedOutputCas`                                                                                                                                                                                                                                                               |
| Recovery               | Generic run-scoped destruction and tri-state CAS-publication reconciliation                                                                                    | The durable attempt state machine and evidence schemas are Build123d-specific; there is no universal cross-solver WAL                                                                                                                                                                                                                       |
| Evidence and promotion | An isolation receipt proves only the execution boundary; canonical promotion is a separate reviewed authority transition                                       | Build123d currently publishes a documentary execution capture and noncanonical draft only; its canonical promotion operation does not yet exist                                                                                                                                                                                             |

“Interchangeable” therefore applies at explicit seams. A new sandbox backend implements
`EphemeralExecutionBackend`; a new output format supplies a code-owned manifest and
validator; and a new engineering vertical supplies its own qualified compilation and
execution profiles, WAL, evidence schema and promotion operation. None can be selected
or registered by caller input. The generic broker suite proves this seam with a second
registered `equation-language-fixture` profile and a JSON output, without pretending
that fixture is a production engineering profile. The deployed composition registers one
local backend, not a runtime menu: interchangeability is an inward port property, not a
caller or agent capability.

The compiler also does not execute agent-authored code. Such execution crosses a
separate isolated-runner port with a server-owned policy and a declared-output broker.
The port, broker and evidence contracts do not name a sandbox technology. The sole
registered isolation-backend technology is local Microsandbox 0.6.8 with an attached,
digest-pinned OCI microVM lifecycle; all three isolated product profiles bind through
that backend. This route uses neither Deno Deploy nor `@deno/sandbox`; it has no remote
control plane, sandbox credential or remote snapshot. A conforming deployment gives the
microVM neither repository access, secrets, Docker socket nor canonical evidence
volumes.

The adapter accepts only the exact OCI reference and digest owned by the reviewed
profile, uses pull policy `Never`, and checks the observed manifest, architecture, OS,
image user, entrypoint, command and environment before execution. Native runtime binary
overrides are rejected before the SDK is loaded; the code-owned empty Microsandbox
configuration, native module, `msb` executable and `libkrunfw` file are resolved inside
the pinned platform package and verified by SHA-256. Unsupported host/architecture
combinations fail closed. The post-create configuration must still match the fixed
policy: restricted security, attached recovery lifecycle, one ephemeral `/tmp` mount,
exact run labels, no patches, and network disabled with deny-all ingress and egress, no
ports, nameservers, secrets or host CA trust.

The agent is not given a shell surface. The adapter directly executes
`/usr/local/bin/python3 -I -B /opt/casys/bin/run-build123d.py`; it writes the admitted
source bytes unchanged only to `/input/source.py`, uses `/work`, and can inventory only
the declared `/out/geometry.step` candidate plus code-owned quiescence and log records.
No path, command, argument, environment variable, volume, socket or backend selection
comes from agent input. Requested resource ceilings are explicit. The runtime attests
wall time and memory, the broker observes log and output byte caps, and CPU time and
process-count ceilings remain explicitly unattested rather than being promoted into
facts.

The sole qualified V1 output is `geometry.step` with media type `model/step` and format
`step-ap214`. Its code-owned validator identity is part of the execution-profile
fingerprint. Outside the sandbox, a bounded Part 21 header check establishes the
declared AP214 family, then `occt-import-js` must parse the complete bytes and expose
referenced, non-degenerate triangulated geometry. A plausible header, another
application protocol, truncated bytes or an empty shape is therefore rejected before
publication. Returned bytes otherwise stay untrusted until the broker validates their
declared identity and size and recomputes their digest outside the isolation boundary.

Only cleanup meeting the code-owned `proven` threshold permits release. The adapter
removes the named microVM, lists by exact run labels and requires zero remaining
sandboxes before emitting its run-scoped destruction proof. This is concrete backend
cleanup evidence, not a claim of cryptographic erasure. After cleanup, the broker stages
and rereads the complete output batch. The filesystem CAS makes the blobs and a complete
byte-free receipt durable before publishing one run-and-producer-generation marker. A
lost commit acknowledgement is resolved from that exact marker under the run lock;
resolution is tri-state: `published`, `not-published` or `outcome-unknown`. An unknown
outcome remains fail-closed and blocks every redispatch. Run-scoped abort refuses a
published or ambiguous generation, durably fences an absent one, then removes only that
generation's staging. Even `not-published` cannot authorize another execution until
run-scoped staging and environment cleanup have also succeeded. Orphaned blobs remain
invisible because reads require both the publication reference and exact receipt
membership. An isolation receipt records the boundary and its assurance; it is neither
MRTR approval nor engineering evidence by itself.

`design.execute-build123d@1` is intentionally draft-only. A successful execution is
modelled as one private `build123d-execution-draft/1.0` whose STEP bytes remain behind
the publication-gated output CAS, plus one `build123d-execution-capture/1.0` JSON
artifact of kind `document` in a successor Thread snapshot. The Thread addition records
the reviewed execution and its exact admission consumption; it adds no STEP artifact,
canonical geometry, observation, requirement, evaluation, violation or verdict. The
draft and capture both bind the producer generation and exact receipt/publication, while
the WAL binds the persisted draft reference back to that same receipt and checks the
link again during completed replay. The existing `design.write-geometry@1` cannot
promote this new draft because it seals a different historical sandbox-preview contract.
`design.seal-isolated-geometry@1` is that second, distinct MRTR. It reopens the
execution capture, draft and publication-gated STEP, rehashes the bytes, and writes one
Thread document (`isolated-geometry-seal-capture/1.0`). It does not copy STEP into
`thread-assets`, does not publish a `step` or `cad-model` artifact, and does not grant
Product or FEA authority. Canonical promotion still requires a later, separately
reviewed operation.

The durable execution journal is monotone:
`prepared -> dispatching -> output-published -> draft-persisted -> thread-persisted -> completed`.
After `dispatching`, the executor resolves the publication by its server-derived run id
and current producer generation before considering another call. Only an exact
`not-published` result followed by successful run-scoped CAS and environment cleanup can
authorize one second dispatch. The same logical `executionRunId` is retained, but
producer generation 0 is first fenced durably and an exact canonical `0 -> 1` generation
advance is persisted. Authorization then moves through the durable
`authorized -> consumed` substate within `dispatching`, and only the fresh
`consumed-now` transition can invoke the runner with `dispatchCount: 2` and producer
generation 1. Replaying a consumed authorization cannot invoke the runner again. If
consumed generation 1 resolves `not-published`, the executor proves generation-1 cleanup
and enters terminal quarantine; an unknown outcome also blocks dispatch. Generation 2
does not exist, so a third dispatch is impossible. From `output-published` onward,
recovery is CAS/WAL-only and reopens the same draft, capture and Thread evidence instead
of executing source again.

`deno task verify:generic:core` is the named local gate for the closed compiler/proposal
contracts, generic isolated-execution domain, broker, filesystem output CAS,
non-Build123d profile fixture and production import boundaries. It does not exercise a
real local microVM or engineering run.

At the Build123d seam, composition has three explicit states. With no
`build123dExecution`, no review tool is exposed and the registered dispatcher reports
the operation `unavailable`. A profile alone exposes the provider-free review tool but
still no executor. A complete profile plus exact empty runtime marker composes the local
Microsandbox backend, broker and
[`file-isolated-output-cas.ts`](../../../src/adapters/shared/cas/file-isolated-output-cas.ts),
then connects the WAL, evidence stores and executor to the registered-run dispatcher.
Composition itself performs no network or microVM I/O; only a subsequently reviewed run
can reach execution. Bounded attempt state lives under
`${recordedAnalysisDirectory}/build123d/{outputs,attempts,drafts,captures}`. The output
CAS owns the run-and-producer-generation tri-state publication marker and exposes no
digest-only reader.

The generation-0 real gate passed against
`casys/build123d-microsandbox-worker@sha256:0e19aee61aaab326ec29e50753a0ef56432d255fb44fd21c40988e90ff7601f8`:
producer generation 0, a 15,430-byte AP214 STEP validated with OCCT, proven broker
destruction, publication resolved as `published`, and CAS reread. It performed no
recovery abort after publication. It did not exercise generation-1 recovery, a persisted
project executor, or production.

Native N-API calls are not cancellable once entered; a privileged same-host race remains
possible between native-artifact hashing and import; and guest directory listing is
materialized within the SDK protocol frame rather than paginated by the adapter. These
are explicit host trust/availability limits, not extra agent capabilities.

The current Modelica microVM pin is
`casys/modelica-microsandbox-worker@sha256:834c759291320eb5f35ccb6eba03587445d259dcb38a2814c5def4ac41d5d730`
(`LOCAL_MODELICA_EXECUTION_IMAGE_REFERENCE`). Qualified-kit and admitted workers are two
logical units on that one physical artefact; binding qualifications stay separate
scientific captures, not a second image. A live Microsandbox gate qualified that 834c
runtime for the fixed qualified kit only and persisted capture
`bf85aa1914dddf6fb20aee1c66ef62f3eca3cdcf13b53759ee0c8710bee188db` (OpenModelica 1.27.0
with MSL 4.1.0, exact `temperature_final = 22 degC` conformance, atomic
publication/readback, exit 0, and sandbox destruction). The authority is exact, not
general: it covers only `linear-thermal-ramp-v1@0.1.0` / `linear-ramp-nominal` and
accepts no arbitrary Modelica. The generic admitted-source Modelica worker on the same
image stays unqualified/unknown and does not inherit this scientific claim. The
separate local product operation descriptor and fail-closed dispatcher entry for
`simulate.run-qualified-modelica-kit@1` remain registered independently of
runtime availability. Its read-only review and concrete executor become available only
when the approved capability-runtime supervisor composes the exact profile, runtime and
pinned qualification. The review accepts only the exact project and current Thread
basis; its MRTR has no ROP, provider or caller-selected source. A completed run adds the
execution capture, normalized `evidence.json`, retained `result.csv` and the one
`22 degC` observation, never an implicit requirement verdict, evaluation, violation or
action. Replay reopens the durable claim, inner WAL, evidence and Thread successor
without another solver call.

`simulate.run-admitted-modelica@1` is the CAD analog: it reopens
`compile.seal-admission@3` Modelica v2 closed-subset bytes and executes those bytes. It
is not the pinned qualified-kit V1, not recorded `@2`, and does not accept caller
`modelicaText`. Both CAD execute and admitted Modelica share
`ReopenAdmittedCompilationSource` → `IsolatedCodeRunner`. One physical Modelica image
(`casys/modelica-microsandbox-worker` at the pin above): kit `ENTRYPOINT` pins one
`.mo`; admitted backend args select `modelica-closed-subset-v2/run.ts` on
`/input/source.mo`. Kit binding qualification is that live capture; admitted bindings
stay unqualified/unknown and do not inherit it. Product AX:
[run admitted Modelica](../../how-to/run/run-admitted-modelica.md). Pattern:
[admitted source isolated execution](admitted-source-isolated-execution.md).

CalculiX has also crossed a real generation-0 local microVM gate against
`casys/calculix-microsandbox-worker@sha256:9b3a7468bfbc3f0fe27f7a9ac17c0eb72f1925968173e5a01d985cfa19cbc0a2`.
The bounded gate reopened all nine publication-gated CAS objects, validated a 5,713-node
/ 22,362-element mesh and observed maximum displacement `0.0761 mm <= 5 mm` and maximum
von Mises stress `0.723 MPa <= 90 MPa`; it then replayed the exact evidence, proved
destruction and removed its temporary state. The post-lease rerun also proved one
run-scoped claimant across concurrent calls, with one worker dispatch and identical
evidence replay. This qualifies the worker/profile and its standalone local use case
only. The new product operation descriptor and fail-closed dispatcher entry for
`verify.run-fea-static-proof@3` remain registered independently of runtime availability.
Its concrete executor becomes available only when the approved capability-runtime
supervisor composes the exact local profile/runtime and a SysON oracle is available. It
consumes a newly sealed local
ROP2 that names `@3`; the executor refuses an `@2` plan before either solve or SysON.
Its outer WAL separates local evidence capture from the journaled SysON evaluation,
quarantines an ambiguous oracle outcome without a retry, and on replay reopens both CAS
captures before reconstructing the same Thread successor. That successor contains the
nine local output artifacts, one isolated execution-evidence artifact, one SysON
evaluation capture, observations and evaluations; it never claims `mcp-calculix`
provenance for local execution. CalculiX never accepts an agent-authored `.inp` deck:
the local use case constructs the worker bundle from exact reviewed proof and STEP
bytes, and the fixed wrapper owns mesh/deck lowering and declared outputs.

SysON is deliberately different. Its bounded architecture, requirements and evaluation
operations remain provider MCP calls outside the microVM, with operation-specific WAL,
readback and Thread evidence. Local code isolation neither replaces that provider path
nor grants it execution or decision authority.

This is the reusable product boundary, not a claim that every language frontend or
backend route is already activated. A route without a qualified profile, exact bindings,
review or executor remains non-dispatchable.
