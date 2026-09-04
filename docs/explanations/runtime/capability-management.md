# Explanation: capability management

Audience: both · Diátaxis: explanation · Kind: boundary

Capability management keeps a local runtime fact from being mistaken for an engineering
claim. It answers a chain of deliberately separate questions: what a registered
operation needs, what the server may bind it to, what exact material that entails, what
a project has authorized, when the host may activate it, and what an engineering run
actually proves.

The exact contracts remain in the
[capability-pack reference](../../reference/runtime/capability-packs/README.md). This
page explains why they do not collapse into one "installed capability" state.

## One need, six boundaries

| Boundary | Question it answers | It does not answer |
| --- | --- | --- |
| [Semantic demand](../../reference/runtime/capability-packs/project-capability-demand.md) | Which provider-neutral capability does a registered operation require? | Which provider, image, port, or argument to use |
| [Server binding](../../reference/runtime/capability-packs/atomic-runtime-catalog.md) | Which trusted binding, profile, and material mapping satisfies that need? | Whether a project accepted that mapping |
| Atomic unit | Which exact versioned local material and declared host effects are involved? | Whether it is running or has produced a result |
| [Project authorization](../../reference/runtime/capability-packs/project-capability-authorization.md) | Has the person accepted this brief-bound operational ceiling for this project? | Whether the host has acquired or started it |
| [Host supervision](../../reference/runtime/capability-packs/host-runtime-supervision.md) | May the local supervisor preload material or activate its sealed group under a lease now? | Whether the engineering method, inputs, or result are admissible |
| Engineering MRTR and result | Has a human admitted the method, and what did the recorded run evaluate? | Whether a runtime was merely present, healthy, or active |

The agent can name a registered operation and propose a brief. It cannot choose the
binding, atomic unit, provider, endpoint, tool, or arguments. The server derives those
facts from its trusted registry and catalogue.

## The authorization is a ceiling, not a launch command

When `project_brief_propose` produces a reviewable brief, the server also derives a
`capabilityProposal`. Its opaque `capabilityProposalFingerprint` binds that proposal to
the exact brief review. The human confirmation echoes that exact fingerprint through
`project_brief_confirm`; the resulting append-only local ledger is the project's
operational ceiling.

That confirmation can authorize exact local material while its qualification or platform
state is still `unavailable`. It does not start Docker, a worker, or an engineering run.
If the approved ceiling stays identical, a later local qualification can remove an
operational blocker without a new project amendment. A binding, profile, manifest,
digest, or host-effect change is different: it requires the server-derived delta review.

## Preload, JIT, and evidence are different clocks

After authorization, the local supervisor may preload approved exact material in the
background, including a catalogued microVM runtime image. Preload never starts a Compose
group. It uses only the server-owned bootstrap recipe for that target; the Dockerfile or
source image is not a project material or JIT prerequisite. On control-plane restart,
the server reconverges the durable authorization lock and re-schedules the same guarded
preloads. Immediately before a covered run, the supervisor only rechecks the exact plan
and material state, then activates a sealed launch group under its lease where one is
needed. Later release may stop that group when no protected JIT demand remains.

Those host events are operational facts. A `ready` plan is only alignment of recorded
material and lock; it is not active, healthy, reachable, qualified at dispatch, or an
engineering pass. Conversely, an engineering MRTR still admits method, inputs, and
criteria, and L3 observation, L4 evaluation, and L5 human judgement remain separate
result records.

This separation lets a project be explicit about a missing runtime without turning a
container start into evidence, and lets local maintenance change host state without
rewriting Thread, CAS, or engineering proof history. For the operational lifecycle, see
[host runtime supervision](../../reference/runtime/capability-packs/host-runtime-supervision.md)
and
[local runtime administration](../../reference/runtime/capability-packs/local-runtime-administration.md).
