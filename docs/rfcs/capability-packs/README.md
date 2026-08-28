# Capability packs and demand-driven provider installation

Audience: both · Diátaxis: none · Kind: RFC

Status: `active`

This brief defines the first capability-pack lot for Casys Digital Thread. The goal is
to let a maintainer install and activate only the engineering capabilities needed for an
atelier, without turning Docker, MCP servers, or pack metadata into product authority.

The current lot is local-runtime-first. It covers the existing mix of selected Compose
services and digest-pinned local microVM worker images. It does not authorize
Kubernetes, Project Chrono, a remote public provider endpoint, automatic image removal,
or a provider marketplace. It also does not rename or generalize engine-specific
operations such as `design.execute-build123d@1`.

## Decision

Introduce four separate objects instead of extending `config/mcp-fleet.json` into a
universal plugin manifest:

1. a **capability requirement**, owned by Digital Thread code;
2. a **provider binding**, selected by server-owned policy;
3. a **runtime pack manifest**, describing installable runtime material;
4. a **local installation lock**, recording the human-selected desired state.

The active fleet manifest remains a derived deployment and drift view. It is never a
source of operations, gates, arguments, evaluations, or verdicts.

```text
registered operation
  -> core-owned capability requirement
  -> exactly one server-selected qualified binding
  -> provider-named adapter
  -> MCP / microVM / API / CLI / remote connector
  -> factual capture
  -> core-owned evaluation and human decision where applicable
```

A pack may satisfy several capabilities, and one capability may have several reviewed
provider bindings. There is no one-gate/one-MCP rule and no universal `runTool` port.

## Existing authority is unchanged

The agent still proposes and executes registered operations only. It cannot name,
install, activate, remove, or select a pack, provider, tool, endpoint, profile, image,
runtime, or argument.

The server still owns:

- the operation-to-capability requirement catalogue;
- provider binding and profile selection;
- exact input reopening and provider lowering;
- WAL, uncertain-outcome recovery, capture and Thread publication;
- evaluation and the boundary to any human MRTR decision.

The Workbench remains a GET/SSE read-only projection. A separate local maintainer CLI or
supervisor owns runtime mutations. The Digital Thread MCP server and browser never
receive a Docker socket.

Pack installation is host-operational state, not Engineering Thread state. Historical
evidence keeps the exact provider, profile, image digest, request and response
identities captured by the operation that actually ran; it is not recomputed from the
current pack lock.

## Project demand and method continuity

Three identities must not be collapsed:

| Identity                    | Meaning                                                                  | Authority                                                            |
| --------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Project capability demand   | Engineering facts the planned work needs                                 | Server compilation of approved brief intent and registered work      |
| Host runtime availability   | Packs and qualified bindings this installation can currently materialize | Human-owned administrative lock                                      |
| Project verification method | Exact method qualification, profile and runtime used for a project proof | Resolved operation plan, human MRTR and immutable execution evidence |

During briefing, the agent may propose verification activities and explain the likely
capability stack in product language. A brief-only forecast is `provisional`: it grants
no install, provider or execution authority. Exact demand can be compiled once planned
work names registered operations. The agent never supplies capability ids, pack ids,
providers or runtime choices as operation arguments.

The implemented read-only contract is documented in
[Project capability demand](../../reference/runtime/capability-packs/project-capability-demand.md).
The accepted boundary for a future, separate host-operational approval and just-in-time
activation is recorded in
[Project capability envelope and lazy activation](project-capability-envelope.md).
Neither record belongs inside `ProjectBriefRevision`, and neither replaces engineering
MRTR.

A read-only project capability plan should let the agent ask with a project identity
only. The server derives:

- capabilities already available;
- missing capabilities and the operations they block;
- optional capabilities suggested by still-provisional brief work;
- an administrative pack plan that a human may inspect separately.

The stack may evolve throughout the project. Installing another qualified binding makes
it a candidate; it does not replace the method basis of existing evidence. The exact
resolved operation plan already binds human MRTR and method qualification, while local
runner profiles bind their exact profile fingerprint and runtime digest. Capability-pack
resolution must preserve that boundary.

After a project has current verification evidence, a different provider binding, method
qualification, profile fingerprint or runtime digest is a method-transition candidate.
Before the next consequential run, the server must prepare an exact old/new comparison,
name the evidence and gate claims whose carry-forward is no longer proven, and include
that transition in the new run's closed MRTR. A reinstall or restart of the same exact
binding and digest is only administrative and does not create a method transition.

The transition never edits or deletes historical proof. It creates a successor method
basis and new execution/evaluation evidence causally derived from the reviewed project
inputs. Prior evidence remains true about its exact old method, but cannot be presented
as current evidence for the new method unless an explicit reviewed equivalence record
permits carry-forward. Health, matching units or similar numerical output cannot prove
that equivalence.

Canonical `supersedes` currently records replacement but does not type why a record was
replaced. Therefore a provider switch must not hide method invalidation in rationale
text. Before multiple bindings can switch for an evidenced project, a closed
method-transition contract must record the prior and successor bases, affected claims,
carry-forward decision, recomputation work and exact MRTR identities.

## Vocabulary

### Capability requirement

A versioned, provider-neutral capability needed by a registered operation. It describes
semantic inputs, normalized factual outputs, provenance requirements and the minimum
qualification level. It does not contain an MCP tool name.

Example proposed by the pilot as an internal planning identity, not as a new registered
public operation:

```json
{
  "id": "mechanics.solve-static-structural",
  "version": "1",
  "minimumQualification": "qualified"
}
```

`verify.run-fea-static-proof@3` remains the stable operation. Its executor may later
depend on this capability for the solver portion while retaining its exact proof and
STEP reopen, profile selection, MRTR, WAL, SysON oracle, capture, evaluation and
publication responsibilities. The pack pilot does not require that refactor before it
can describe and select the existing runtime graph.

### Provider binding

A reviewed mapping from one capability version to one provider-named adapter, a closed
profile and one runtime identity. It may lower a semantic request into an MCP call, a
microVM worker request or several provider-native calls. CalculiX input-deck generation,
worker commands and raw-result parsing stay inside the CalculiX runtime boundary; they
never become pack or public-operation arguments.

A binding cannot expand a capability. Missing normalized fields remain literal
`unavailable`; inputs that cannot be established remain `unresolved`. If two active
bindings match and server policy cannot choose exactly one, composition fails closed.

A publisher manifest only _claims_ that a binding is available. The claim becomes a
selectable binding only when a trusted Casys catalogue entry identifies the exact
capability, adapter contract, profile, runtime manifest digest and qualification record.
Publisher metadata cannot self-approve its own profile or qualification.

### Runtime pack manifest

Publisher-supplied, immutable metadata required to plan and materialize a runtime. It is
strictly validated and content-addressed. At minimum it names:

- pack id and semantic version;
- provider bindings claimed, subject to the core catalogue;
- runtime materials, initially `compose-service` and `microvm-image`, later possibly
  `remote-connector`;
- immutable OCI image references with digest and supported architectures for every
  material;
- service identities, internal endpoints and health/discovery requirements;
- CPU, memory and incremental-disk estimates where known;
- volume roles, persistence and access mode;
- secret _slot names_, never secret values;
- network exposure and privilege requirements;
- licence and notice references;
- conformance fixtures and qualification material;
- safe install, upgrade, rollback and removal rules.

The manifest is data, not an arbitrary Compose program. A community pack cannot smuggle
host bind mounts, Docker socket access, `privileged`, host networking, devices,
lifecycle hooks or executable install scripts through undocumented fields. Unknown
fields fail closed in this contract even though the historical fleet parser ignores
them.

### Local installation lock

Human-owned host desired state. Each entry records:

- exact pack id, version and manifest digest;
- desired activation (`inactive` or `active`);
- the explicitly accepted trust/qualification policy;
- administrator binding policy when more than one reviewed binding is installed;
- resolved secret-slot identifiers, never values;
- runtime-assigned loopback routes or ports;
- previous lock identity for rollback.

The lock is written atomically by the maintainer CLI. It is not written by an agent run,
the Workbench, a provider, or a health probe.

Administrator binding policy constrains the candidates available to the server. It may
provide a default for a new project, but changing that default never rewrites or
silently reroutes an existing project's verification method.

Capability version, provider-binding version, runtime-pack version, manifest digest and
qualification revision are distinct identities. Updating one never silently relabels the
others.

## Three state axes stay separate

Do not collapse desired state, live runtime and qualification into one lifecycle enum.

| Axis                 | States in the first contract                                                    | Authority                                |
| -------------------- | ------------------------------------------------------------------------------- | ---------------------------------------- |
| Desired installation | `absent`, `inactive`, `active`                                                  | Human-approved local lock                |
| Runtime observation  | `missing`, `stopped`, `starting`, `ready`, `healthy`, `degraded`, `unavailable` | Fresh provider and local-runner probes   |
| Qualification        | `unverified`, `compatible`, `qualified`, `expired`, `revoked`                   | Reviewed qualification record and policy |

Download and migration progress such as `pulling` or `rolling-back` is transient CLI job
state, not a durable engineering status.

Consequences:

- an inactive installed pack does not degrade the active fleet;
- a healthy MCP is not automatically compatible or qualified;
- a qualified persistent provider that is not running is `qualified` and `unavailable`,
  not healthy;
- a selected microVM image may be `ready` without a persistent process; readiness does
  not imply a successful engineering run;
- a different observed image digest is drift and cannot inherit qualification;
- consequential operations compose only when their minimum qualification is met.

The historical global `required` boolean is therefore insufficient. Requirement is
relative to an active pack and to the registered operation being composed.

## Pack resolution and derived fleet

The durable resolution order is:

```text
approved registered project work
  -> core capability requirement catalogue
  + trusted pack catalogue
  + human local installation lock
  + local runtime policy
  + existing project method basis, when any
  -> exact binding or method-transition-required
  -> resolved active capability graph
  -> derived desired MCP fleet for HTTP providers
  -> selected local-runner catalogue for microVM workers
  -> fresh runtime observations
```

The current `config/mcp-fleet.json` remains the compatibility desired-fleet input for
MCP HTTP providers during migration. The first implementation must compare generated MCP
entries with the existing ones and fail on any difference in server id, service name,
image digest, endpoint, expected tools, volumes, exposure or trust. Local microVM
workers do not get fake fleet entries or fake MCP endpoints; their exact profiles and
image digests belong to the selected local-runner catalogue.

Only after parity tests cover the complete fleet may the resolved active fleet become
the generated input consumed by `createConsoleServer`. There must never be two editable
sources of truth for the same active server.

The control plane should eventually expose two read models:

- the installed pack catalogue, including inactive and unavailable packs;
- the active runtime graph, with the MCP fleet as one projection and local microVM
  readiness as another.

Neither read model authorizes installation or provider dispatch.

## Local runtime backends

The first pack contract must model both runtime forms already used by Behave:

- selected services from the first-party Compose topology for persistent HTTP providers
  such as SysON and the private Build123d export surface;
- digest-pinned, deny-all microVM worker images started per run by the local
  Microsandbox backend, such as the product CalculiX `@3` worker.

Compose remains the first persistent-service backend because the current atelier already
owns a single topology, provider images, shared exchange volumes and local Docker
observation. It is not the universal runtime abstraction.

The Compose backend must:

1. resolve a normalized pack manifest into an allowlisted Compose service set;
2. pull only exact selected digests;
3. preserve loopback-only publication when the backend runs on the host;
4. create only declared networks and volumes;
5. start explicit services or first-party profiles, not the whole fleet;
6. probe health, MCP discovery and exact tool/resource contracts;
7. run the capability conformance fixture before activation;
8. write the new lock only after the desired state is durable;
9. retain the previous immutable lock for rollback;
10. never use `docker compose down -v` as a pack removal primitive.

The microVM-image backend must:

1. resolve only a code-reviewed local-runner profile and exact OCI digest;
2. prove architecture compatibility and local image availability without starting a
   persistent provider service;
3. verify the required Microsandbox backend and policy identity;
4. preserve `pullPolicy: never` during engineering dispatch;
5. run the existing worker qualification fixture before activation;
6. report image-cache bytes separately from persistent-service disk;
7. leave actual execution, destruction proof, WAL and recovery with the existing
   server-owned runner.

`install` and `activate` are separate transactions. Installation may pull and validate
an exact pack, then atomically record it as `inactive`. Activation requires a quiescent
capability (no dependent run in dispatch, publishing or uncertain recovery), starts and
qualifies persistent services, verifies ephemeral-runner readiness, then atomically
records the active binding. The first version may require a controlled Digital Thread
restart after a lock change; it must not pretend to support hot binding reload.

If a process dies after runtime material is prepared but before the active lock is
committed, `doctor` reports unowned runtime material and no operation composes from it.
Rollback uses the previous lock and exact image digests; it never guesses from tags or
currently running containers.

Compose `include` and profiles may organize first-party files, but untrusted pack input
must be normalized and rendered by Casys rather than executed as arbitrary remote
Compose YAML.

Provider ports are runtime details. The first backend may assign generated loopback
ports because the current server runs on the host. The human-facing CLI and pack id must
not use those port numbers as identity. A later local gateway or co-located
control-plane container may remove individual host mappings without changing the pack
contract.

## Maintainer UX

The proposed CLI surface is administrative and intentionally separate from MCP tools:

```text
casys capability list
casys capability plan <pack>@<version>
casys capability install <pack>@<version>
casys capability activate <pack>
casys capability deactivate <pack>
casys capability doctor <pack>
casys capability rollback <pack>
casys capability remove <pack>
```

`plan` is mandatory before a mutating command. It reports at least:

- added and reusable image bytes when the runtime can establish them;
- services, networks, volumes, ports, microVM images and privileges;
- secret slots and licence acceptance;
- capabilities claimed and qualification level available;
- operations that remain unavailable;
- exact material that removal would preserve or delete.

Evidence preservation is unconditional. A later, separately named cache-pruning command
may delete non-authoritative runtime material after an explicit plan, but `remove` never
offers an evidence-deleting mode.

An operation whose capability is absent returns literal `unavailable` with a stable
capability id and recovery text. It does not install anything automatically. A UI may
render the plan and hand the human to the local supervisor, but the Workbench remains
read-only.

## Qualification ladder

Runtime protocol success and engineering qualification are different gates:

1. **discovered**: an MCP endpoint or exact local-runner material can be observed;
2. **compatible**: expected MCP tools/resources or local worker contracts pass
   conformance;
3. **qualified**: the exact provider/profile/runtime digest passes reviewed engineering
   fixtures and limitations are recorded;
4. **supported**: optional commercial status for maintained updates and support. This is
   not a stronger engineering verdict than `qualified`.

`supported` belongs to catalogue/commercial metadata and must not enter Thread verdicts.
Revocation prevents new dispatch but does not rewrite historical captures.

## First end-to-end pilot: Behave from zero

The pilot is the current Behave path, not Make/DFM, Buy/ERP or Chrono. Its human-facing
installation bundle is provisionally `casys.behave-foundation`; that pack name is
operational UX, not a new product judgement or operation.

The pilot begins with an exact dependency census from the current server composition and
the live Behave how-to. It must not blindly encode the historical all-services Compose
command or the all-or-nothing `--local-execution` switch. The expected minimum graph is:

- SysON database, application and MCP for architecture, requirements and the exact FEA
  oracle;
- the private Build123d export service required by admitted canonical geometry;
- the digest-pinned CalculiX microVM worker required by `verify.run-fea-static-proof@3`;
- the local Digital Thread process and Microsandbox prerequisite, which are observed but
  not installed as arbitrary publisher scripts.

The census decides the exact graph. In particular, the regular `mcp-build123d` assembly
observer, the HTTP `mcp-calculix` service used by sensitivity, the Build123d isolated
draft worker and geometry-module assembler must not enter the foundation pack merely
because they currently share a startup flag or image. Each is included only when an
operation in the selected Behave walk really requires it.

The first read-only repository census is available as
`deno task capability:behave:inspect`. It composes the provider-neutral operation
requirements with the current fleet, the transitive Compose service graph and the exact
server-owned CalculiX profile. It never calls Docker, a registry or a provider and
reports `mutatesRuntime: false`.

The current result selects exactly `syson-db`, `syson-app`, `mcp-syson`,
`mcp-build123d-sandbox` and the CalculiX microVM worker. Exact image identities, ARM64
platform claims and fingerprinted licence, volume and security review inputs now render
a strict local-developer candidate on current `main`. The report remains
`productionEligible: false`: source publication is not runtime redistribution clearance
or production qualification.

`deno task capability:behave:doctor` joins that candidate to fresh Docker Compose and
Microsandbox cache observations without pulling, importing, starting or dispatching.
Missing material is `changes-required`; a stale review, unsupported platform or missing
host prerequisite is `blocked`. The live `start:local` switch still makes several local
profiles available; selective server composition belongs to Lot B, not this Lot A
diagnostic.

The first optional extensions are then independently selectable:

- `casys.behave-assembly-integrity` for the regular Build123d/OCCT observer;
- `casys.behave-sensitivity` for isolated Build123d plus the HTTP CalculiX sensitivity
  path;
- `casys.behave-modelica` for admitted Modelica execution;
- `casys.behave-spice` for admitted circuit-only SPICE execution.

A pack may share an already installed image digest without duplicating bytes. Pack
dependencies describe runtime materials or capability requirements; they never authorize
one provider to invoke another. DFM remains a later `casys.make-*` family and is not
used to validate this design.

Pack readiness also cannot promote unsupported source semantics. A captured non-trivial
Build123d, Modelica or SPICE dependency closure remains literal
`unresolved / source.dependency-lowering-unavailable` until its language-specific
lowering exists, even when every related runtime material is installed and healthy.

### Pilot acceptance

1. A clean core can start without Make, Buy, Modelica, SPICE, sensitivity or
   assembly-integrity runtimes.
2. The Behave operations remain registered and report literal `unavailable` when their
   exact qualified runtime requirements are not active.
3. `plan casys.behave-foundation` is read-only and names exact image-cache, disk,
   privilege, volume and licence effects across Compose and microVM materials.
4. Installing the foundation pack materializes only the dependencies proven necessary
   for the from-zero Behave walk.
5. Activation makes the current canonical-geometry and isolated CalculiX `@3` path
   composable without enabling unrelated local runners.
6. Inactive optional packs do not degrade active fleet or runner readiness.
7. A wrong image digest, missing tool, missing runner policy, extra forbidden privilege,
   unknown field or failed fixture prevents activation.
8. Existing successful, failed, unresolved and unavailable Behave evidence remains
   semantically unchanged.
9. Removing or rolling back a pack never removes Thread, CAS, WAL, canonical geometry or
   provider-call captures.
10. No public tool accepts pack, provider, endpoint, profile, image or MCP tool
    selection.
11. Unsupported multi-file dependency lowering remains literal `unresolved`; pack health
    cannot turn it into admission.
12. `design.execute-build123d@1`, the static-assembly basis and deferred Chrono contract
    remain untouched.
13. Changing an administrator default cannot reroute a project with current evidence; a
    different exact method returns `method-transition-required` until the reviewed
    transition and MRTR exist.

## Implementation lots

### Lot A — contracts and read-only planning

- first add strict `capability-pack-candidate/0.1`, installation-lock candidate and
  effect-free installation-plan contracts; promote them to `capability-pack/1.0` only
  after the real Behave census plus licence, volume and security review;
- add a core capability requirement catalogue with no dynamic registration;
- add a strict local-lock parser and atomic writer abstraction;
- model the three independent state axes;
- implement `list`, `plan` and `doctor` without runtime mutation;
- model a read-only project-demand projection from registered work; brief-only demand
  remains explicitly provisional;
- add one Behave-foundation fixture covering Compose services and microVM images;
- census the actual from-zero composition and add parity checks against server options,
  fleet, Compose and fixed local-runner profiles;
- add rejection tests for aliases, `latest`, unknown fields and unsafe privileges.

The exact `ProjectCapabilityDemand` compiler, deterministic fingerprint, and
version-exact semantic subset policy are the current project-bound stopping point. They
mutate no runtime. CPU, memory, volume, secret-slot, and licence effects remain
unstructured or review-document facts in the candidate manifest and therefore must be
reported as explicit unknowns/references by a future project envelope, never inferred.

### Lot B — selective Behave composition

- replace the blanket local-execution enablement with a server-owned resolved capability
  selection;
- keep every registered operation present while composing only its selected qualified
  runtime;
- distinguish HTTP provider readiness from local microVM runner readiness;
- preserve all current canonical CAD, FEA `@3`, SysON oracle, WAL, capture and
  evaluation semantics;
- defer any neutral static-solver port extraction unless the pack pilot proves it is
  required for a second provider binding.

### Lot C — local activation

- add the local supervisor runtime port outside Digital Thread project authority;
- implement pull/start/probe/qualify/activate across Compose and microVM-image materials
  with an explicit plan identity;
- derive the active fleet and make health activation-aware;
- implement deactivate, rollback and evidence-preserving remove;
- document recovery from interrupted pulls and partial starts.

### Later, separately authorized

- remote private connectors and authenticated asset transport;
- managed VPS installation, backup and observability;
- signed community catalogue and publisher workflow;
- a Kubernetes/K3s runtime renderer;
- Make/DFM and Buy/ERP pack families;
- proprietary workstation connectors such as CATIA;
- any Chrono provider or kinematics capability.

Before any capability exposes a second selectable provider binding for a project with
existing evidence, implement and validate the closed method-transition contract above.

## Open-source and commercial boundary

The pack schema, capability SDK, conformance runner, local Compose and microVM-image
backends, and community catalogue format should be open. Commercial value may sit in
qualified proprietary bindings, supported pack locks, managed hosting, licences/secrets,
updates, rollback, backup, monitoring and support.

Publication in an MCP registry proves distribution metadata, not compatibility with a
Casys capability and not engineering qualification. Those states remain explicit.

## Stops

Stop the lot rather than smoothing over any of these conditions:

- the pack would define or alter an operation, gate, evaluation or verdict;
- an agent or provider could select its own binding;
- a host binding change could silently reroute an evidenced project;
- a method transition could proceed without an exact old/new impact review and human
  MRTR;
- active fleet truth would have two editable authorities;
- install requires raw unreviewed Compose execution or a Docker socket in the product;
- qualification is inferred from health or tool presence;
- a removal path can delete evidence or a shared durable volume;
- selected composition changes existing Behave evidence semantics;
- implementation alters `design.execute-build123d@1`, the static-assembly contracts or
  Chrono.

When Lots A–C are implemented and their enduring contracts live under `docs/reference/`
and `docs/how-to/`, delete this RFC and repair its incoming links.
