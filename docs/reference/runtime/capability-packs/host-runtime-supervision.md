# Reference: host runtime supervision

Audience: both · Diátaxis: reference · Kind: boundary

H1 governs server-owned local runtime state. It does not select a provider, admit an
engineering method, or interpret an engineering result. The initial enrolled topology is
the exact `casys-syson@1.0.0` group: Postgres, SysON and `mcp-syson`, with only
`127.0.0.1:3009` published. The historical SysON UI port 8180 is not part of this group.
`casys-chrono@1.0.0` is a separate one-service topology. Its binding remains unavailable
until a separately qualified exact host-mode attestation exists; the topology itself
does not carry a qualification claim. That probe is the private
[local runtime qualification](local-runtime-qualification.md) CLI, not an MCP operation,
Workbench command, or engineering run.

## Durable local read model

The server rebuilds its runtime context for every review/queue decision from the trusted
catalogue, actual local read-only observation, the append-only authorization ledger, and
two strict local administrative files. An absent `admin-policy.json` is the neutral
trusted-catalogue order. An absent `admin-lock.json` is revision 0 with no units: it
requests no desired activation, but does not prevent a brief-approved acquisition. A
malformed, non-canonical, unknown-field, stale-unit or otherwise unreadable file fails
closed; it never silently becomes the neutral default.

Observation is partitioned by code-owned material coverage. The Compose observer owns
only enrolled exact launch-group materials and the Microsandbox observer owns only the
exact CalculiX microVM cache contract. A composite observer never invokes a slice that
has no assigned requested material. Planning and intent review observe only the
catalogue materials that can satisfy the known demand or brief intent; they do not
inspect the rest of the catalogue. Full-catalogue observation remains an explicit
`read()` with no material scope, used by administrative and qualification paths that
need the complete host picture. A duplicate coverage declaration, unexpected material
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

The Workbench still displays three literal axes per planned material: physical material,
physical runtime, and qualification. Its third axis is derived from one exact planned
binding plus the current server catalogue/mode context; ambiguous or missing context is
shown as `unavailable`, never copied from Docker.

`GET /api/project/capabilities` exposes the existing redacted
`project-capability-workbench/1.0` projection through the native Workbench BFF. It has
no POST/SSE counterpart in this lot and contains no Docker argv, image repository,
ports, mounts, credentials, secret-slot names, or mutation control. The visual card is
deliberately deferred; the endpoint is the read-only integration surface.

```text
catalogue material -> exact launch-group reference + fingerprint
                             |
                             v
                  server-only group registry
                             |
                             v
one group intent (all materials) -> closed Compose argv -> terminal outcome -> reread
```

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
so parallel leases cannot rotate one client away from its container.

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
acquire exact persistent material in the background; preload never starts Compose.
Activation happens immediately before the covered run, after a fresh operational-plan
recheck and projection derivation. It requires the exact server-minted start authority
and any declared secret snapshot, and leaves the run/WAL unchanged if it cannot prove
the group active. Preload needs only reviewed topology and never claims a lease, reads a
secret or starts Compose. Stop remains available for an already owned group after a
later revocation, topology-policy degradation or secret loss.

Terminal release rereads the exact current `EngineeringProject` demand before stopping a
group. A missing project, unreadable runtime context, unresolved JIT demand or stale
catalogue link blocks cleanup rather than releasing the final lease or stopping a shared
runtime. An active sibling lease also retains the group.

This is operational authorization only. MRTR still admits the engineering method, inputs
and criteria. L3 observations, L4 evaluation and any L5 human decision remain
domain-specific; a healthy container or successful Docker command is never a verdict.
