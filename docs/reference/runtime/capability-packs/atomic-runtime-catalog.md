# Reference: atomic runtime catalogue

Audience: both · Diátaxis: reference · Kind: contract

`capability-runtime-catalog/1.0` is the trusted server-side catalogue used to turn a
provider-neutral brief intent or `project-capability-demand/2.0` ceiling into a
concrete, inspectable host plan. It is not an MCP tool, a provider registry, a package
marketplace, or an engineering verdict. The current first-party catalogue is explicitly
`productionEligible: false`: it records local developer composition, not redistribution
clearance or production qualification.

The planner is pure: it receives a demand, trusted catalogue, local admin policy, host
observation, and local admin lock. Its only asynchronous work is the local SHA-256
recalculation of atomic manifest bodies. It cannot pull, install, start, stop, dispatch,
change a project, or write the lock.

```text
ProjectCapabilityIntent (pending brief) or ProjectCapabilityDemand (published plan)
  + trusted binding catalogue
  + local policy + observed host + exact lock
  -> ProjectCapabilityPlan (read-only, concrete)
```

The initial route is documented in
[project capability intent](project-capability-intent.md). The exact binding map is
documented separately in [qualified binding catalogue](qualified-binding-catalog.md);
neither page is a caller-selectable provider surface.

## Identities that stay separate

| Identity            | Example                               | Meaning                             |
| ------------------- | ------------------------------------- | ----------------------------------- |
| Semantic capability | `mechanics.solve-static-structural@1` | What a registered operation needs   |
| Binding             | `calculix-static-structural@1`        | Server-owned qualified mapping      |
| Atomic unit         | `casys.calculix-worker@1.0.0`         | Concrete installable local material |
| Material            | CalculiX worker OCI digest            | Exact image/service lifecycle       |

The demand contains none of the last three identities. The agent cannot name a binding,
unit, image, endpoint, provider tool, profile, or arguments.

`Behave Foundation` is consequently a derived recipe/census, never an atomic unit. Names
such as `canonical`, `static` and `admitted` describe a method or operation use, not an
installable package identity.

## First-party units in this lot

The catalogue declares the known local units below. Their qualification remains literal;
download and storage estimates are all literal `null` until a source establishes them,
and the planner must never estimate bytes. Equal OCI digests are reused exactly once for
byte accounting, but retain separate services and lifecycle records.

Published loopback numbers are the current server-owned HTTP publications for those
persistent services. They are not a reserved-port census: a semantic capability does not
own a port; several materials share one launch group and one MCP port; microVM workers
publish none. See [capability runtime connection](capability-runtime-connection.md).

| Unit                                     | Concrete scope                          | Current HTTP loopback | Notes                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `casys.syson-stack`                      | Postgres, SysON app, SysON MCP          | 3009                  | `casys-syson@1.0.1` technically indivisible local stack                                                                                                                                                                                                                                                |
| `casys.mcp-build123d-sandbox`            | Private Build123d Compose service       | 3024                  | Separate private export volume                                                                                                                                                                                                                                                                         |
| `casys.mcp-build123d-observation`        | Regular Build123d/OCCT observer service | 3014                  | Optional assembly-integrity path                                                                                                                                                                                                                                                                       |
| `casys.build123d-isolated-worker`        | Admitted source microVM                 | —                     | Different lifecycle from either HTTP service                                                                                                                                                                                                                                                           |
| `casys.geometry-module-assembler-worker` | One-level STEP compound runtime microVM | —                     | One exact runtime material only. Its trusted Dockerfile is internal bootstrap metadata; catalogue: `linux/arm64`, qualified binding; exact native platform uses its code-owned qualification without attestation; emulation and upgrading unqualified/revoked bindings require exact local attestation |
| `casys.calculix-worker`                  | Product isolated static-proof worker    | —                     | Not HTTP `mcp-calculix`                                                                                                                                                                                                                                                                                |
| `casys.mcp-calculix`                     | CalculiX HTTP sensitivity service       | 3015                  | Separate unqualified S1 binding                                                                                                                                                                                                                                                                        |
| `casys.modelica-worker`                  | One physical Modelica microVM           | —                     | Host/security reviewed for the shared image bytes. Two bindings/profiles: `openmodelica-qualified-kit` (qualified, pinned LinearThermalRamp kit only) and `openmodelica-admitted-modelica` (literally unqualified). Sharing the image does not qualify the admitted method.                            |
| `casys.spice-worker`                     | Admitted ngspice runtime microVM        | —                     | One exact runtime material only. Its trusted Dockerfile source is internal bootstrap metadata, not a project-plan or JIT prerequisite; not HTTP `mcp-spice`                                                                                                                                            |
| `casys.mcp-chrono`                       | mcp-chrono 0.3.2 persistent MCP service | 3025                  | Linux/amd64 only; catalogue baseline `unqualified`. Effective host mode is the attestation overlay, not this table                                                                                                                                                                                     |

Every material records persistence, service/volume, network, bind-mount, privileged
container, socket, device, secret-slot, licence and security effects. No material has a
privileged container, Docker socket or device grant. Volumes marked `preserve` are
retained by current administrative removal: that action preserves Thread, CAS, WAL and
project evidence, targets only an explicitly planned first-party launch group, and never
removes foreign images or runs `docker compose down -v`. Bind mounts and devices remain
structured contract fields: a later reviewed material can declare them explicitly; this
first-party catalogue simply declares none.

Each material carries either a literal `null` launch group or an exact launch-group
id/version/fingerprint reference. The three `casys.syson-stack` materials share the same
`casys-syson@1.0.1` group reference. Build123d has two separate immutable one-service
groups: `casys-build123d-sandbox@1.0.0` (`mcp-build123d-sandbox`, 3024 → 3014,
`build123d-sandbox-exports:/exports`) and `casys-build123d-observation@1.0.0`
(`mcp-build123d`, 3014 → 3014, `exports:/exports`). Both pin Build123d 0.6.1 digest
`sha256:765d73ca6a15b6112d3693a298514ae4ff1a8ce85485cf5cf4074b41c218142d`, have no
shared named network or invented healthcheck, and retain their volumes.
Catalogue/project data cannot carry Compose commands, provider endpoints, tools,
arguments or secret values. `casys.mcp-chrono@0.3.2` names the separate single-service
`casys-chrono@1.0.0` group. `casys.mcp-calculix@0.8.2` names the separate single-service
`casys-mcp-calculix@0.8.2` group. Its immutable Compose body remains in the server-only
H1 registry, has no invented healthcheck, and retains its private inputs and run-ledger
volumes. Every current microVM material, and any future cache-only material, keeps
`launchGroup: null`: an image alone never enrolls a topology. Registry enrollment is
candidacy; it does not start a service.

The material set is the runtime and attestation set. A first-party Dockerfile, its build
context, and an acquisition-source digest live only in a server-owned bootstrap
descriptor. They are not catalogued materials, project-authorized effects, Workbench
data, or JIT prerequisites. A trusted Dockerfile rebuild can produce a candidate that
does not attest to the exact target microVM digest; that leaves the runtime unavailable.
GHCR OCI promotion remains a separate, deferred qualification and distribution step.

The five first-party microVM materials currently map one-to-one onto five physical
worker images. Modelica qualified-kit and admitted-source bindings share the one
`casys.modelica-worker` installable atom and `modelica-worker-image` material. Candidate
GHCR publication of those physical images is infrastructure release metadata only; it
does not rewrite this catalogue or the Microsandbox runtime digest. See
[first-party microVM distribution](first-party-microvm-distribution.md) and
[Publish first-party microVM images](../../../how-to/maintainers/publish-first-party-microvm-images.md).

The semantic capability `mechanics.observe-static-structural-sensitivity@1` names only
two static-structural sensitivity observations, never a verdict. Its concrete
`calculix-http-static-sensitivity@1` binding points to `casys.mcp-calculix@0.8.2` and
its sealed `casys-mcp-calculix@0.8.2` group, but remains deliberately `unqualified` and
non-activable. The group declares only the published `http` command, loopback 3015 and
retained private `calculix-inputs`/`calculix-runs` volumes; its image supports reviewed
`linux/arm64` and `linux/amd64` platforms, with no forced platform or invented health
endpoint. The catalogue and planner therefore report the binding as `unavailable`: they
cannot pull, start or call the HTTP service until a separate live qualification is
recorded. The recorded solve/readback implementation is observation-only and is not that
qualification. `mechanics.solve-static-structural@1` remains separately bound to
`casys.calculix-worker` for isolated product static proof.

## Closed planning states

Binding selection is deterministic only when policy identifies one qualified active
binding. The plan preserves literal outcomes: `unavailable`, `ambiguous`, `disabled`,
`revoked`, and `incompatible`. A material mode is independently `native`, `emulated`, or
`unavailable`; no platform claim is rendered as `unavailable`, never guessed. The
code-owned catalogue baseline never declares a host runtime mode. An effective mode is
derived only from a matching local qualification attestation for the exact binding,
adapter contract, profile, unit manifest, material digest, target platform, launch-group
reference and opaque host identity. A native historical code-owned qualification may
produce a native mode on the observed matching platform; it can never imply emulation.

The append-only attestation schema is
`capability-runtime-binding-qualification-attestation/1.1`. Its only terminal facts are
`qualified` and `revoked`; it contains fixture/specification/outcome references and
closed identities, never a probe payload, request headers, credential or provider
response. The Chrono emulation probe that appends a matching record is the private
[local runtime qualification](local-runtime-qualification.md) CLI. An exact revocation
is monotone: it makes that material unavailable rather than being sorted away by
timestamps or hashes. A Chrono Linux/amd64 emulation attestation therefore does not
qualify any other AMD64 image, binding, profile or host.

The local attestation ledger is append-only. A concurrent reader ignores only the
private UUID `.tmp` basename emitted by the durable write primitive before its atomic
link; any other unexpected entry remains a literal store-integrity failure.

A MicroVM cache likewise derives its expected guest architecture only from the one
registered code-owned material platform. The controller process architecture is never a
fallback for cache inspection or for a planned runtime mode.

Before selection, the planner recalculates every atomic unit manifest from its id,
version, and complete material body. A stale fingerprint is refused. A lock applies only
when its id, version and manifest fingerprint all match; an unmatched lock is a literal
blocked plan, never an id-only activation request. Unresolved demand or unresolved
planned operation group is likewise a literal `unresolved` plan, including when it has
no semantic capability requirement.

Services, volumes and loopback ports are merged only when their declarations agree.
Conflicts fail closed. Material lifecycles stay separate even where two records refer to
the same OCI digest. Download and storage estimates are deduplicated by the raw `sha256`
digest, not the registry/repository text, and contradictory estimates for that digest
are refused.

Security and size are intentionally different:

- `downloadBytes` and `storageBytes` may be `null` without inventing a number;
- any selected material whose security effects are `unknown` blocks future activation;
- a host image being present is only a cache observation, not a healthy provider or a
  successful engineering result.

The resulting plan therefore remains separate from both MRTR and L3/L4/L5. A qualified
binding allows operational composition only. The existing MRTR still admits method,
inputs and criteria; result semantics remain domain-specific.

`ready` is deliberately narrow: the recorded host materials and exact lock align with
the plan. It does **not** say a runtime is active, healthy, reachable, qualified at
dispatch time, or that any engineering result has passed.

H1 already consumes this plan. The planner itself stays pure and write-free. Host
mutation, journaling, leases, JIT activation and evidence-preserving stop/remove live on
[host runtime supervision](host-runtime-supervision.md) and
[local runtime administration](local-runtime-administration.md). Docker credentials stay
outside the Digital Thread MCP and Workbench.

Remote connectors, VPS/Kubernetes deployment, proprietary workstation adapters and
marketplace publication are outside this catalogue. The first-party local developer
composition remains the current target.

## Local administration boundary

`capability-runtime-admin-policy/1.0` can only disable or rank trusted binding ids.
`capability-runtime-admin-lock/1.0` records exact unit id/version/manifest fingerprint
and desired `inactive` or `active` state. It is append-only history with a durable head;
`active` permits JIT but does not keep a service running. Neither belongs in project or
Thread state. See [local runtime administration](local-runtime-administration.md).
