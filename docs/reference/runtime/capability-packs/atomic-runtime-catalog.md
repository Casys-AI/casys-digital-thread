# Reference: atomic runtime catalogue

Audience: both · Diátaxis: reference · Kind: contract

`capability-runtime-catalog/1.0` is the trusted server-side catalogue used to turn the
provider-neutral `project-capability-demand/2.0` ceiling into a concrete, inspectable
host plan. It is not an MCP tool, a provider registry, a package marketplace, or an
engineering verdict. The current first-party catalogue is explicitly
`productionEligible: false`: it records local developer composition, not redistribution
clearance or production qualification.

The planner is pure: it receives a demand, trusted catalogue, local admin policy, host
observation, and local admin lock. Its only asynchronous work is the local SHA-256
recalculation of atomic manifest bodies. It cannot pull, install, start, stop, dispatch,
change a project, or write the lock.

```text
ProjectCapabilityDemand (semantic only)
  + trusted binding catalogue
  + local policy + observed host + exact lock
  -> ProjectCapabilityPlan (read-only, concrete)
```

## Identities that stay separate

| Identity            | Example                               | Meaning                             |
| ------------------- | ------------------------------------- | ----------------------------------- |
| Semantic capability | `mechanics.solve-static-structural@1` | What a registered operation needs   |
| Binding             | `calculix-static-structural@1`        | Server-owned qualified mapping      |
| Atomic unit         | `casys.calculix-worker@1.0.0`         | Concrete installable local material |
| Material            | CalculiX worker OCI digest            | Exact image/service lifecycle       |

The demand contains none of the last three identities. The agent cannot name a binding,
unit, image, endpoint, provider tool, profile, or arguments.

`Behave Foundation` is consequently a derived recipe/census, never an atomic unit.

## First-party units in this lot

The catalogue declares the known local units below. Their qualification remains literal;
download and storage estimates are all literal `null` until a source establishes them,
and the planner must never estimate bytes. Equal OCI digests are reused exactly once for
byte accounting, but retain separate services and lifecycle records.

| Unit                                     | Concrete scope                                 | Loopback port | Notes                                                                |
| ---------------------------------------- | ---------------------------------------------- | ------------- | -------------------------------------------------------------------- |
| `casys.syson-stack`                      | Postgres, SysON app, SysON MCP                 | 3009          | `casys-syson@1.0.0` technically indivisible local stack              |
| `casys.mcp-build123d-sandbox`            | Private Build123d Compose service              | 3024          | Separate private export volume                                       |
| `casys.mcp-build123d-observation`        | Regular Build123d/OCCT observer service        | 3014          | Optional assembly-integrity path                                     |
| `casys.build123d-isolated-worker`        | Admitted source microVM                        | —             | Different lifecycle from either HTTP service                         |
| `casys.geometry-module-assembler-worker` | One-level STEP compound microVM                | —             | Platform/qualification remains literal unknown                       |
| `casys.calculix-worker`                  | Product isolated static-proof worker           | —             | Not HTTP `mcp-calculix`                                              |
| `casys.mcp-calculix`                     | CalculiX HTTP sensitivity service              | 3015          | Separate unqualified S1 binding                                      |
| `casys.modelica-qualified-worker`        | Narrow qualified-kit microVM                   | —             | Not arbitrary admitted Modelica                                      |
| `casys.modelica-worker`                  | Admitted Modelica microVM                      | —             | Currently unqualified/unavailable in this catalogue                  |
| `casys.spice-worker`                     | OCI source cache plus distinct microVM runtime | —             | The source image is not a microVM or HTTP `mcp-spice`                |
| `casys.mcp-chrono`                       | mcp-chrono 0.3.1 persistent MCP service        | 3025          | Linux/amd64 only; unqualified until explicit emulation qualification |

Every material records persistence, service/volume, network, bind-mount, privileged
container, socket, device, secret-slot, licence and security effects. No material has a
privileged container, Docker socket or device grant. Volumes marked `preserve` are
retained by future runtime removal; this contract does not permit
`docker compose down -v`. Bind mounts and devices remain structured contract fields: a
later reviewed material can declare them explicitly; this first-party catalogue simply
declares none.

Each material carries either a literal `null` launch group or an exact launch-group
id/version/fingerprint reference. The three `casys.syson-stack` materials share the
same `casys-syson@1.0.0` group reference, and `casys.mcp-calculix@0.8.2` names the
separate single-service `casys-mcp-calculix@0.8.2` group. The immutable ordered Compose
body remains in the server-only H1 registry. Catalogue/project data cannot carry Compose
commands, provider endpoints, tools, arguments or secret values. Other current
first-party persistent materials remain literal `null`: an image alone never enrolls a
topology.

The semantic capability `mechanics.observe-static-structural-sensitivity@1` names only
two static-structural sensitivity observations, never a verdict. Its concrete
`calculix-http-static-sensitivity@1` binding points to `casys.mcp-calculix@0.8.2` and
its sealed `casys-mcp-calculix@0.8.2` group, but remains deliberately `unqualified` and
non-activable. The group declares only the published `http` command, loopback 3015 and
retained private `calculix-inputs`/`calculix-runs` volumes; its image supports reviewed
`linux/arm64` and `linux/amd64` platforms, with no forced platform or invented health
endpoint. The catalogue and planner therefore report the binding as `unavailable`: they
cannot pull, start or call the HTTP service until a separate live qualification is
recorded. The recorded solve/readback implementation is observation-only and is not
that qualification. `mechanics.solve-static-structural@1` remains separately bound to
`casys.calculix-worker` for isolated product static proof.

## Closed planning states

Binding selection is deterministic only when policy identifies one qualified active
binding. The plan preserves literal outcomes: `unavailable`, `ambiguous`, `disabled`,
`revoked`, and `incompatible`. A material mode is independently `native`, `emulated`, or
`unavailable`; no platform claim is rendered as `unavailable`, never guessed.

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

## Local administration boundary

`capability-runtime-admin-policy/1.0` can only disable or rank trusted binding ids.
`capability-runtime-admin-lock/1.0` records exact unit id/version/manifest fingerprint
and desired `inactive` or `active` state. Neither belongs in project or Thread state.

The next supervisor lot may consume this plan. It must journal before host mutation,
observe recovery after interruption, use leases for JIT activation, preserve Thread/CAS/
WAL/volumes, and keep Docker credentials outside the Digital Thread MCP and Workbench.
