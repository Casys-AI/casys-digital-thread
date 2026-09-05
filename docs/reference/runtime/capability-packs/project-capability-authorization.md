# Reference: project capability authorization

Audience: both · Diátaxis: reference · Kind: contract

`project-capability-proposal/1.0` is the server-derived, host-operational ceiling
reviewed with a project brief. It is separate from the project Thread, an engineering
MRTR and every L3/L4/L5 result. It authorizes only the exact concrete runtime material
that the server has selected from its trusted catalogue and local policy.

The caller never sends a capability, provider, image, endpoint, tool or argument. The
proposal contains the semantic needs derived from the pending brief, one policy-selected
binding candidate per resolved need, atomic unit versions/manifest identities, OCI
digests, current runtime availability, storage estimates and declared host effects.
Secret slot names may be shown; secret values never are. A qualification or platform
blocker remains literal while its exact candidate stays visible for one approval
decision.

## Brief confirmation

`project_brief_propose` returns a `capabilityProposal` beside the pending framing. Its
`capabilityProposalFingerprint` is the only capability value that
`project_brief_confirm` may echo. The server prepares a local ledger event before it
approves the brief, then finalizes the authorization only against the exact approved
brief receipt. A retry after an interruption is idempotent only when that prepared
proposal and receipt match exactly. A prepared record alone is not authority.

The full proposal fingerprint also binds the exact brief basis, so it is the value used
to confirm that particular brief revision. Separately, the server derives an internal
ceiling equivalence fingerprint. It retains the intent fingerprint, requirements, exact
candidate binding/adapter/profile, unit manifests/digests, effects, licences and byte
estimates. It deliberately excludes current availability, candidate qualification,
runtime mode, activation and blockers: those are local observations, not a new human
choice. Thus an approved unqualified candidate may later become exactly qualified on the
same host without another amendment; changing its binding, profile, manifest, digest or
host effect still requires one. An editorial brief revision can reuse an
already-authorized ceiling only when that exact equivalence holds and the new brief has
its own exact approval receipt. Cache presence and the runtime administration lock are
excluded from both fingerprints.

## Ledger and later change

The local `project-capability-ledger/1.0` is append-only. Every revision carries the
complete prior event prefix, a previous-revision fingerprint and individual event
fingerprints. On read, the effective envelope is reconstructed from that history and
must match the stored projection. The write protocol publishes one synced,
same-directory temporary pending body through an exclusive hard link before an empty
`createNew` claim whose filename carries the exact ledger digest. Temporary files are
inert after interruption; a visible pending or claim is therefore never a partial
authority artifact. A matching claim plus pending revision is recovered idempotently; an
unclaimed pending revision may be completed only by the exact logical preparation that
created it. A foreign or mismatched pending/claim fails closed.

On supported local macOS and Linux filesystems, the server also synchronizes the parent
directory after every authority-visible metadata transition: temporary creation and
cleanup, pending publication, claim creation, pending-to-revision publication, and
stale-pending cleanup. It does not silently downgrade this guarantee: unavailable or
failing directory synchronization leaves the append failed and grants no runtime
authority. Other host platforms require an explicit durable-filesystem implementation
before they can use this local ledger.

`project_capability_inspect` is read-only. After a plan is published,
`project_capability_change_review` derives its exact demand again. A strict subset of
the approved envelope needs no prompt and does not shrink the ceiling: the review unions
current demand with still-authorized brief capacity so a later plan extension cannot
silently drop unused authority. A widening, binding/profile/digest change or new host
effect produces an amendment review with a structured delta: requirements, bindings,
units, materials, host effects and known-or-unknown byte change. An amendment stores
that delta rather than a duplicate successor envelope and must reconstruct its exact
server-derived successor fingerprint. A binding, profile or digest change is never
silent. When an already-proven project's method meaning changes, the change follows the
existing transition/MRTR boundary.

`withdrawUnused: true` is a separate server-derived withdrawal of that unused surplus.
The caller still names only the project. The server plans the exact current
`plannedCeiling.capabilityRequirements` with the same catalogue, policy, host and lock.
It may be offered only when the authorized envelope already covers that subset and the
delta is strictly subtractive: at least one removed requirement, no added requirement,
no requirement replacement, no remaining binding/digest/profile/unit/material change,
and no added host effect. Removing the unused unit that made aggregate security or byte
estimates unknown may improve `security` from `unknown` to `reviewed` and aggregate
`downloadBytes`/`storageBytes` from `null` to a known exact remainder; those reductions
are not new host authority. `reviewed` becoming `unknown`, a known aggregate becoming
`null`, or a larger known estimate remains a widening. Removed units, materials and
effects are allowed. The signed retry reuses the append-only `amendment-authorized`
event. The confirmation removes unused operational authority only; it does not delete
images, cache, data or evidence, and does not approve or reinterpret engineering methods
or results. Administrative cache-image removal is a separate local-operator CLI; see
[local runtime administration](local-runtime-administration.md). A no-op withdrawal
returns `no-change`. If current demand is not covered, the existing amendment or
method-transition path remains required.

Operational authorization is not a fourth generic approval layer and does not replace
MRTR admission of method, inputs and criteria.

An unchanged blocked candidate already present in the approved ceiling remains visible
without blocking an otherwise resolved comparison. For example, a previously approved
but still-unqualified Chrono binding does not prevent review of a later exact SysON-only
delta. This exception is identity-closed: a new unresolved operation, a new blocked
requirement, or any change to the retained candidate, adapter/profile, unit manifest,
material digest or declared material effects keeps the whole review `unresolved`.

The review returns an explicit `revoked` state when the effective envelope was revoked;
such an envelope can neither cover a plan nor be amended. The amendment elicitation
returns the exact opaque proposal fingerprint in structured content, and a signed retry
must echo it unchanged.

V1 revocation is deliberately `full-envelope` only. It records no destructive host
action and never removes Thread, CAS, WAL or retained volumes. Partial revocation is
still not this contract. Acquire, JIT activate, stop and bounded material removal live
on [host runtime supervision](host-runtime-supervision.md) and
[local runtime administration](local-runtime-administration.md). An approved envelope
does not authorize acquisition before that approval, silent provider switching for
existing evidence, cache pruning, or evidence deletion.

Semantic subset and host-effect subset are separate checks. Reusing an already present
image may reduce disk effects without changing semantic demand; changing a digest or
exposure may widen host effects while capability ids stay equal. The approval view
projects declared catalogue host effects: download and incremental disk bytes,
persistence class, networks, published loopback ports, volumes, privilege and exposure,
secret-slot names (never values), licences and notices. CPU and memory class stay
literal `unknown` until a material declares them. The planner never invents estimates to
make an approval look complete.

## Authority boundary

Operational authorization says that a named local runtime may be acquired or used on
this host. An MRTR separately admits a method, inputs and criteria. L3 observations, L4
deterministic evaluation and L5 human judgement remain domain results. Neither a
candidate, health status, installation nor completed runtime operation is a scientific
or product verdict.
