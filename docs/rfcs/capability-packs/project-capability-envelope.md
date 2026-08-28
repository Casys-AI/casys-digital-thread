# Project capability envelope and lazy activation

Audience: both · Diátaxis: none · Kind: RFC

Status: `accepted boundary; supervisor deferred`

This companion records the project-level host-operational approval that will sit between
exact project capability demand and local runtime mutation. The current code implements
only read-only demand compilation, fingerprinting, and subset comparison. It has no
installer or supervisor.

## Decision

Do not add exact capabilities, packs, providers, images, or host effects to
`ProjectBriefRevision`. The brief remains stakeholder and planning truth. A brief-only
runtime forecast remains `provisional`.

After `project_plan_publish`, the server may compile exact provider-neutral
`ProjectCapabilityDemand` from the registered operations. A separate future
`ProjectCapabilityEnvelope` will present two things for one explicit human approval:

1. the exact semantic capability set the project may use;
2. the projected host effects required to materialize that set.

Approval permits the local supervisor to acquire and activate qualified material only
inside that exact envelope. Later work whose exact capability demand and host effects
remain subsets needs no repeated **operational** approval. A new capability, wider host
effect, changed trust boundary, or unresolved estimate requires a new envelope and human
review.

This approval never replaces an engineering MRTR. The MRTR still governs a consequential
operation's exact technical inputs, method, dispatch, and evaluation.

## Host-effect projection

The approval view should eventually distinguish at least:

- estimated download and incremental disk bytes;
- CPU and memory class;
- persistent services and ephemeral microVM workers;
- networks, ports, volumes, and privilege/exposure changes;
- secret slot names, never secret values;
- licence and notice obligations.

The current candidate pack manifest can enforce exact images, supported platforms,
dependencies, and declared network exposure. It also accepts an optional publisher
`estimatedBytes`; the installation plan preserves an unknown size as `null` and names
the affected image. It does **not** yet structure every CPU, memory, volume,
secret-slot, or licence effect needed by this envelope. Missing facts must appear as
explicit `unknown` or an exact review reference. The planner must not invent estimates
to make an approval look complete.

Semantic subset and host-effect subset are separate checks. Reusing an image already
present may reduce disk effects without changing semantic demand; changing an image or
exposure may widen host effects while capability ids stay equal.

## Lifecycle

The future supervisor must keep these transactions distinct:

| Transaction             | Meaning                                                                                    |
| ----------------------- | ------------------------------------------------------------------------------------------ |
| `plan`                  | Read exact demand, candidate bindings, reusable material, and host effects; mutate nothing |
| `install` / `acquire`   | Fetch, validate, and store exact material as inactive                                      |
| `activate`              | Bind, start when persistent, probe, qualify, and make the capability composable            |
| just-in-time activation | Activate approved material when registered work first needs it                             |
| `deactivate`            | Stop or unbind live runtime while preserving installed material and evidence               |
| `rollback`              | Restore a previous exact lock and material identity                                        |
| `remove`                | Remove non-authoritative runtime material under a separate explicit plan                   |

One accepted envelope can authorize just-in-time activation and later deactivation
inside its limits. It does not authorize automatic acquisition before the envelope is
approved, silent provider switching for existing evidence, cache pruning, or evidence
deletion.

## Current stopping point

This lot stops at a deterministic, effect-free project-demand compiler plus an atomic
catalogue/host-plan projection. The retired Behave Foundation `inspect`, `plan`, and
`doctor` candidate surfaces are not compatibility interfaces. No current component
performs project-bound install, activation, just-in-time lifecycle, rollback, or
removal.

Implementing those mutations requires the separately authorized local-supervisor lot,
atomic installation locks, interrupted-job recovery, qualification probes, and exact
host-effect contracts. Until then, missing capability stays literal `unavailable`.
