# How-to: extend the mechanism product surface

Audience: maintainers · Diátaxis: how-to · Kind: runbook

Use this only when the requested joint, frame, axis, topology, scenario or physical
question falls outside
[current mechanism coverage](../../reference/domains/mechanism/coverage.md). A new
project that fits V1 is data, attachments and reviewed decisions; it needs no
project-specific code branch. A native Chrono feature or extra JSON key is not a product
extension.

## 1. Name one bounded engineering question

Decide whether the change widens prescribed kinematics or introduces a distinct family
such as trajectory clearance, contact dynamics or force observation. Give a distinct
family its own capability and evidence meaning; do not overload L3 poses with a verdict
about another question. State units, frames, topology, cardinalities and explicit
non-claims before selecting an engine.

## 2. Version the closed source and method

Introduce a new schema/profile version when accepted source meaning changes. Define
exact canonical bytes, fields, limits, workspace closure and assembly-context recross.
Define which facts L3 may report and which separately reviewed L4 criteria may consume
them. Never accept provider, tool, endpoint, image, solver payload or requested verdict
fields.

## 3. Preserve the authority ladder

Keep L1 case seal, L2 run MRTR/ROP, L3 factual observation, sealed method, deterministic
L4 and human L5 distinct. Register new operation versions and dependencies when evidence
meaning changes. Specify successor behavior; do not relabel historical artifacts as the
new version.

## 4. Extend the provider-neutral port before an adapter

Express the new normalized factual capability in an application port. Then implement a
provider-named lowerer/client that rejects every source it cannot represent exactly.
Provider availability must not widen the domain contract, and an agent still cannot
select provider, endpoint, tool or arguments.

## 5. Bind and qualify the exact runtime

Add or version the trusted binding, adapter profile, atomic unit, immutable material,
launch group and host qualification specification together. Exercise every supported
platform mode explicitly. A tag, local image id, provider healthcheck or successful
smoke is not qualification.

## 6. Rebuild L3 publication and recovery

Lower from the sealed L1 source, persist request identity before dispatch, dispatch at
most once, read every result page, normalize only declared facts and capture exact
provenance. Define same-request recovery and human basis release for unknown outcomes
before enabling the operation.

## 7. Extend L4 and L5 without provider verdicts

Evaluate only signed criteria over normalized L3 facts. Preserve missing observations as
`unresolved` and unsupported quantities as `unavailable` or `not_evaluated`. Provider
success never becomes L4, and L4 `pass` never becomes human L5 automatically.

## 8. Prove and document the common path

Add accepted, boundary and refused contract tests; lowering and receipt fixtures;
normal, uncertain and recovery executor tests; and one fresh MCP project walk. Update
source contract, boundedness, coverage, operations, provider adapter and runbooks only
after that path is demonstrated. Record remaining gaps literally rather than adding a
project-specific exception.
