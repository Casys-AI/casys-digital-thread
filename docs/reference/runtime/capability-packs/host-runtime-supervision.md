# Reference: host runtime supervision

Audience: both · Diátaxis: reference · Kind: boundary

H1 governs server-owned local runtime state. It does not select a provider, admit an
engineering method, or interpret an engineering result. The first-party launch-group
registry enrolls five persistent topologies: `casys-syson@1.0.1` (Postgres, SysON and
`mcp-syson`, with only `127.0.0.1:3009` published), `casys-build123d-sandbox@1.0.0`,
`casys-build123d-observation@1.0.0`, `casys-chrono@1.0.0`, and
`casys-mcp-calculix@0.8.2`. Enrollment is candidacy. It does not start a service. The
historical SysON UI port 8180 is not part of `casys-syson`.

`casys-chrono@1.0.0` is a one-service topology. The topology itself does not carry a
qualification claim. The immutable catalogue baseline for `casys.mcp-chrono@0.3.2`
remains `unqualified`; effective host qualification is the matching attestation overlay
on [local runtime and ports](../local-runtime-and-ports.md). The probe that appends that
overlay is the private [local runtime qualification](local-runtime-qualification.md)
CLI, not an MCP operation, Workbench command, or engineering run. HTTP
`casys.mcp-calculix@0.8.2` remains catalogue-`unqualified` and non-activable.

## Durable local read model

The server rebuilds its runtime context for every review/queue decision from the trusted
catalogue, actual local read-only observation, the append-only authorization ledger, and
two strict local administrative files. An absent `admin-policy.json` is the neutral
trusted-catalogue order. An absent `admin-lock.json` is revision 0 with no units: it
requests no desired activation, but does not prevent a brief-approved acquisition. A
malformed, non-canonical, unknown-field or otherwise unreadable administrative file
fails closed; it never silently becomes the neutral default. Immutable lock history is
read by schema, canonical JSON, predecessor-hash chain and head fingerprint only. A
catalogue-stale head stays readable so `status` and `lock-review` can display and
reconverge it; it does not authorize activation, preload, JIT or qualification. Those
remain exact current-catalogue id+version+manifest matches.

Observation is partitioned by code-owned material coverage. The Compose observer owns
only enrolled exact launch-group materials and the Microsandbox observer derives every
catalogued first-party microVM expectation from the atomic catalogue. An optional
execution profile may only overlay its fingerprint after it recrosses that exact target;
it never creates coverage or selects an image. A composite observer never invokes a
slice that has no assigned requested material. Planning and intent review observe only
the catalogue materials that can satisfy the known demand or brief intent; they do not
inspect the rest of the catalogue. Full-catalogue observation remains an explicit
`read()` with no material scope, used by administrative and qualification paths that need
the complete host picture. A duplicate coverage declaration, unexpected material
response, or missing response for an owned requested material is rejected. A material
which was not observed, or which no local observer owns, remains literally `unavailable`
in the Workbench rather than being guessed present or absent.

The factual host observation contains only the Docker daemon's exact reported platform,
installed exact images, runtime state and an opaque stable local-host identity
fingerprint. It never reports a qualification. It does not infer a platform from the
Deno controller process and it does not declare global emulation. An unreadable or
unsupported daemon platform fails closed: it is not guessed from the Mac architecture.
The same local read composition overlays the immutable catalogue with the append-only
qualification-attestation store at
`state/local/capability-runtime-host/qualification-attestations/`. Queue, session and
Workbench contexts therefore see the same effective per-material modes. An attestation
must match the current binding, unit manifest, digest, profile, contract, launch group
and host identity exactly; an absent or mismatched mode blocks resolution before any
host mutation.

The Workbench projection exposes three literal axes per planned material: physical
material (`absent`, `acquiring`, `installed`, `failed`, or `unavailable`), physical
runtime (`inactive`, `starting`, `active`, `stopping`, `degraded`, or `unavailable`),
and qualification (`compatible`, `qualified`, or `unavailable`). Its third axis is
derived from one exact planned binding plus the current server catalogue/mode context;
ambiguous or missing context is `unavailable`, never copied from Docker. `unqualified`,
`revoked`, and `incompatible` remain binding/plan conditions, rather than invented
material-axis qualification states.

`GET /api/project/capabilities` exposes the existing redacted
`project-capability-workbench/1.0` projection through the native Workbench BFF. It has
no POST/SSE counterpart in this lot and contains no Docker argv, image repository,
ports, mounts, credentials, secret-slot names, or mutation control. The visual card is
deliberately deferred; the Desktop proxy does not expose this helper. The endpoint is
the read-only native integration surface, not a claimed Workbench UI feature.

```text
catalogue material -> exact launch-group reference + fingerprint
                             |
                             v
                  server-only group registry
                             |
                             v
one group intent (all materials) -> closed Compose argv -> terminal outcome -> reread
```

Non-persistent Docker-cache and Microsandbox-cache images are a sibling administrative
removal journal (`capability-runtime-nonpersistent-removal-plan/1.0`). That path never
uses the Compose `material-remove` intent, never makes `launchGroup` nullable, and never
uninstalls Microsandbox.

## Closed launch-group contract

An immutable `capability-runtime-launch-group/2.0` names an ordered set of exact
materials and services. It fingerprints a canonical JSON Compose descriptor and records
only topology and security: its project-scoped default network, ownership labels,
retained volumes, secret-slot names and reviewed topology. Qualification is deliberately
absent. A group is physically active only when every exact image is installed and every
expected owned service satisfies its declared readiness check. The server separately
derives a binding's effective qualification and exact runtime mode from the catalogue,
plan and attestation; an observed running container never substitutes for that
authority.

The descriptor admits only pinned images, literal labels/environment, named retained
volumes, loopback ports, ordered `depends_on` health edges, conditional health checks,
command, `cap_drop`, `security_opt` and platform. It rejects interpolation, `build`,
`env_file`, `include`, `extends`, configs, Compose secrets, bind mounts/sockets,
privileged mode, devices and public ports. Top-level named volumes must be empty
declarations and match the service mounts exactly. Health durations use a bounded
literal duration grammar. Secrets never appear in a group, project, journal, descriptor
argv or Workbench view.

`casys-syson` uses pinned DB, application and MCP images in dependency order
`syson-db -> syson-app -> mcp-syson`; it retains `syson-db-data`. The MCP image receives
a closed Deno loopback `/health` check because it has no baked image healthcheck. The
fixed database values are existing internal development topology values, not secret-slot
authority and not caller input.

`casys-chrono` contains exactly the pinned mcp-chrono image on loopback port 3025 and
the retained `chrono-data` named volume. Its descriptor carries only the fixed
`chrono-mcp-bearer-token` slot; the host resolves the bearer value into a short-lived
in-memory Compose overlay and the matching fixed client credential. The descriptor,
group fingerprint, journal, argv, Thread, CAS, WAL, Workbench and error output never
receive the value. A group with a secret slot always performs the sealed `compose up`
reconciliation when a session begins, even if it is already active. A non-secret active
group remains a no-op. The resolver keeps one snapshot generation for a server process,
so parallel leases cannot rotate one client away from its container. When the optional
`CASYS_CHRONO_MCP_BEARER_TOKEN` host override is absent, that resolver mints a CSPRNG
base64url bearer in process memory. An explicitly supplied value must satisfy the safe
Compose grammar; an invalid value remains `unavailable` and is never silently replaced.

## Lease, journal and JIT lifecycle

One execution session derives unique groups from its sealed runtime plan, starts them in
canonical order, and protects all of them with one deterministic lease. The first fresh
group may create that lease; later groups in the same session may reuse only that exact
claim. An external queued claim is rejected. A partial, failed or uncertain group action
retains the lease and blocks a blind retry until recovery observes the group.

Every group action writes one append-only intent covering the complete ordered material
set and its per-material prior observations. Runtime-start additionally persists the
exact server-derived effective launch projection (binding, minimum/effective
qualification, mode and attestation fingerprint) used at intent time; acquire, stop and
administrative removal literally store no projection. The terminal outcome likewise
covers every member. Runtime start performs journalled image acquisition, then executes:

```text
docker compose … up --detach --wait --wait-timeout 300 --pull never --no-build
```

There is no `--no-deps`, implicit pull, `down`, `down -v`, image removal, volume removal
or orphan removal in ordinary preload/JIT lifecycle. The separate private administrative
removal review may remove one complete inactive group only after its exact plan,
inactive lock, lease/JIT/ledger/journal checks and ownership reread. It never removes
retained volumes, runs prune, accepts a tag/alias, or touches a foreign container. The
adapter fresh-inspects image digests, exact Compose ownership and health after every
action. Stop revalidates the exact owned container IDs and stops them in reverse group
order; a same-name foreign or ambiguous container is never touched.

Terminal release evaluates remaining JIT demand per group, stops eligible groups in
reverse canonical order while retaining the shared lease, and removes the lease only
after all release decisions and required stops succeed. Thread, CAS, WAL, project state
and retained volumes are never removed by this boundary.

## Authorization and result boundaries

The capability proposal is derived at brief review and becomes durable only with the
brief confirmation or a later bounded amendment. Only then may the preload scheduler
prepare exact approved material in the background, including a microVM target. Preload
never starts Compose, grants a lease, reads a secret, or turns an internal Docker source
into a project/JIT material. On control-plane startup, the server reconverges the durable
lock and re-schedules the same guarded preloads for authorized envelopes. Activation
happens immediately before the covered run, after a fresh operational-plan recheck and
projection derivation. It requires the exact server-minted start authority and any
declared secret snapshot, and leaves the run/WAL unchanged if it cannot prove the group
active. Stop remains available for an already owned group after a later revocation,
topology-policy degradation or secret loss.

Terminal release rereads the exact current `EngineeringProject` demand before stopping a
group. A missing project, unreadable runtime context, unresolved JIT demand or stale
catalogue link blocks cleanup rather than releasing the final lease or stopping a shared
runtime. An active sibling lease also retains the group.

A successful start proves the group active; it does not itself locate a provider. The
SysON seed and assembly-observation canaries subsequently obtain a process-local handle
bound to that lease and the sealed publication. Other adapters still call the current
server-owned loopback publications. Host ports remain current compatibility
publications; ephemeral ports remain a later, separate migration. See
[capability runtime connection](capability-runtime-connection.md). Root
`docker-compose.yml` is a different Docker project and cannot be adopted; the same host
ports collide if both run.

This is operational authorization only. MRTR still admits the engineering method, inputs
and criteria. L3 observations, L4 evaluation and any L5 human decision remain
domain-specific; a healthy container or successful Docker command is never a verdict.
