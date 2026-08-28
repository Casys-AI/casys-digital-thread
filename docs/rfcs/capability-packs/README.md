# Atomic capability runtime and demand-driven activation

Audience: both · Diátaxis: none · Kind: RFC

Status: `accepted boundary; implementation in progress`

This RFC records the capability-runtime boundary for Casys Digital Thread. The former
monolithic Behave Foundation candidate, its install/doctor commands and the global
`--local-execution` switch are retired. `Behave Foundation` may describe a derived
recipe for a product walk, but it is not a pack, manifest, CLI target or authority.

## Decision

The server retains four distinct records:

1. a provider-neutral semantic capability requirement on each registered operation;
2. a qualified server-owned binding from capability to a concrete adapter/profile;
3. an atomic runtime unit for an installable image, service lifecycle or technically
   indivisible cluster;
4. an administrative lock with the exact unit id, version and manifest fingerprint.

```text
registered operation runtimeDemand
  -> project capability demand (semantic ceiling)
  -> trusted binding catalogue + local policy
  -> atomic runtime units + host observation + exact lock
  -> read-only project capability plan
  -> future local supervisor only
```

No agent or Workbench input selects a provider, package, image, endpoint, profile,
tool, argument, port, secret or Docker action. The Workbench stays a GET/SSE projection.
Project authority, MRTR method admission and L3/L4/L5 result semantics stay separate.

The current contracts are:

- [project capability demand](../../reference/runtime/capability-packs/project-capability-demand.md);
- [atomic runtime catalogue](../../reference/runtime/capability-packs/atomic-runtime-catalog.md);
- [atomic runtime boundaries](../../reference/runtime/capability-packs/atomic-runtime-boundaries.md);
- [project capability envelope](project-capability-envelope.md).

## Atomic units, not a foundation bundle

An atom is a material lifecycle, not a business verdict. Current first-party examples
include `casys.syson-stack`, `casys.mcp-build123d-sandbox`,
`casys.mcp-build123d-observation`, `casys.build123d-isolated-worker`,
`casys.geometry-module-assembler-worker`, `casys.calculix-worker`,
`casys.modelica-qualified-worker`, `casys.modelica-worker` and
`casys.spice-worker`. Names such as `canonical`, `static` and `admitted` describe a
method or operation use, not an installable package identity.

The concrete catalogue identifies exact OCI digests, declared platforms, local mode,
services, volumes, network exposure, privilege, devices, secret slots, licences and
security review. Equal raw image digests may share byte accounting but never silently
merge their service/lifecycle facts. Conflicting host effects block a plan. Unknown
security blocks activation; unknown byte estimates remain literal `null`.

## Lifecycle and authority

The current planner is pure and read-only. It neither pulls, starts, stops, activates,
dispatches, qualifies, writes a lock nor changes a project. `ready` only says observed
material and exact administrative lock align with a plan; it does not say healthy,
reachable, qualified at dispatch, or passed.

The future `CapabilityRuntimeSupervisor` is outside the MCP/BFF/UI supervisor. It must
write a journal before host mutation, keep independent material/runtime/qualification
states, recover through actual observation, use shared JIT leases and preserve Thread,
CAS, WAL and retained volumes. It must not use `docker compose down -v`, delete evidence
or remove foreign images.

Until that supervisor exists, operations that require a local runtime stay registered
and literally `unavailable`. `deno task start:yolo` changes only loopback human approval;
it cannot activate an engineering runtime.

## Project approval and method continuity

The capability intent will be proposed and approved with the project brief, derived by
the server rather than authored by agent or human. It is a ceiling: exact project plans
inside it need no repeated host prompt. A later widening creates an append-only
capability amendment containing only the delta. Editorial brief changes that leave the
semantic capability intent unchanged do not invalidate the approval.

Operational approval permits use of an exact binding and its host effects. It never
replaces MRTR admission of method, inputs and criteria. A different binding/profile/
digest for a project with proof is visible, requires an amendment and, when method
meaning changes, follows the existing transition/MRTR boundary. Provider success or
runtime health never becomes a verdict.

## Delivery lots

1. **Demand and atomic catalogue** — explicit registry demands, exact demand history,
   trusted bindings, atomic units, local policy/lock and pure planning. This is the
   current implementation boundary.
2. **Brief authorization and amendments** — initial capability intent fingerprint,
   append-only authorization ledger, delta review and read-only inspection/Workbench
   projection.
3. **Local supervisor** — material acquisition, JIT activation, leases, recovery and
   evidence-preserving deactivate/remove.
4. **Chrono vertical** — optional emulated AMD64 unit, explicit mechanism JSON-to-SysML
   mappings, seal/run/readback/method/L4/L5 chain. Collision, contact, clearance,
   forces, resistance, safety and fabricability remain outside its prescribed-kinematics
   coverage.

Remote connectors, VPS/Kubernetes deployment, proprietary workstation adapters and
marketplace/catalogue publication are separate work. The local Mac plus Corsair SSD
remains the target for these lots.
