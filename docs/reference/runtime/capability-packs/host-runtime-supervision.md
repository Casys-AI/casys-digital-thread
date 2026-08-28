# Reference: host runtime supervision

Audience: both · Diátaxis: reference · Kind: boundary

H1 supplies generic, local host-runtime mechanics. It does not enroll a real provider,
publish an OCI image, compose the MCP server, or make a registered engineering operation
available. The first-party capability catalogue therefore keeps each current
`launchProfile` literally `null` until a separately reviewed profile and server
composition exist.

```text
catalogue material -> exact profile reference + fingerprint
                         |
                         v
                  server-only exact registry
                         |
                         v
       journal intent -> closed Compose argv -> terminal outcome -> reread
```

The immutable `capability-runtime-launch-profile/1.0` body names one exact material, its
pinned image digest, closed Compose project/service coordinates, exact ownership labels,
retention, secret-slot names, activation policy and a sealed Compose descriptor. The
descriptor is fingerprinted over its exact UTF-8 bytes and included in the profile
fingerprint. Its H1 form is canonical JSON (a YAML subset) with exactly one service, its
pinned image and its exact ownership labels; interpolation, `env_file`, `include`,
`extends`, build contexts, configs, secrets and every other file indirection are
refused. The catalogue carries only the reference/fingerprint; it never becomes a
provider/tool/argument envelope. Secret values are absent from profiles, journals and
argv.

`persistent` profiles can be materialized, started and later stopped. `cache-only`
profiles can be materialized and observed but are rejected by activation in both the
supervisor and public host adapter. Unknown profile security, revoked qualification, or
a missing/unavailable/unknown declared secret slot blocks host mutation. Material,
runtime and qualification remain three independent observed axes.

The Compose adapter has a fixed verb set: image inspect, Compose ps, container inspect,
pull, `up --detach --no-deps --no-build --no-recreate`, and ID-bound container stop. It
never invokes shell parsing, `down`, `rm`, image removal, volume removal or `down -v`.
Compose receives the sealed descriptor directly on stdin as `--file -`; it never opens a
mutable profile YAML path. Its canonical root is only a process root, not a
configuration source. Compose is invoked with `COMPOSE_DISABLE_ENV_FILE=1`,
`--env-file
/dev/null` and a cleared environment except a server-owned Docker connection
allowlist, so host `.env` or process interpolation cannot alter the descriptor. Under
the adapter mutation lock, stop rereads exact ownership and invokes
`docker container stop` with that exact revalidated ID — never `compose stop service`. A
start/stop binds the container's image inspect `RepoDigests` to the exact pinned image
reference. Only an owned inactive container may be restarted JIT; an unowned or
ambiguous container is not touched. Exit status zero becomes `succeeded` only after the
fresh observation satisfies the action's intended state. All profiles require
`stop-only` containers and preserved images/volumes.

The host journal writes a create-new intent before a mutation and one create-new
terminal outcome afterwards. The terminal timestamp is taken after the
command/observation, never reused from the planned intent. After a crash, missing,
failed or uncertain outcomes are surfaced as `degraded` from a fresh observation;
recovery never replays a command. Leases are shared, expiring local claims and bind the
exact project, material and immutable profile reference. Release rereads and attests
that claim before deletion or a possible stop; activation rejects a lease expired at
request time. A persistent runtime can stop only when no active lease protects its
material and the server-derived JIT demand is false. These stores are outside
EngineeringProject, Thread, CAS and engineering WAL and cannot create project evidence.
The raw Docker implementation is private to its module; the exported adapter checks that
the exact intent already exists in the durable journal and that every declared secret
slot is available, even if invoked outside the supervisor. After an intent is durable,
the lifecycle coordinator mints a one-use authorization only if it is the unique pending
entry with no outcome. The adapter consumes that authorization before Docker. Before any
new action for the same material and profile, the host supervisor reconstructs recovery
and blocks an unreconciled pending/failed/uncertain intent rather than allocating
another journal ID.

The mutation lock serializes only cooperative callers of this adapter. A separate actor
with direct Docker-daemon authority can still race it; the adapter therefore never
claims absolute isolation and uses exact labels, image digest and container-ID rechecks
to fail closed on what it observes.
