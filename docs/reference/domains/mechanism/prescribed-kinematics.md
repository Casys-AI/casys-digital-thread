# Reference: prescribed-kinematics coverage

Audience: both · Diátaxis: reference · Kind: coverage and exclusions

`prescribed-kinematics/1.0` is a bounded evidence family for one declared, connected,
immediate rigid-body subassembly. It answers a narrow question: did the exact prescribed
case produce the recorded sampled poses, joint angles, residual vectors, and convergence
state under the exact recorded execution identity?

It does not turn a static STEP or an assembly-integrity result into a mechanism model.
The case must explicitly declare bodies, mappings, frames, revolute joints, limits, axes,
ramp, units, and sampling. See [case and architecture binding](prescribed-kinematics-case-and-architecture-binding.md).

## Evidence levels

The durable chain is deliberately split:

```text
L1 sealed case → L2 signed L3 MRTR and sealed ROP → L3 factual observation
              → signed method → L4 provider-free evaluation → human L5 closeout
```

L3 does not contain a verdict. L4 evaluates only the exact L3 facts against a separately
sealed method. L5 is a human-origin closeout, never an automatic promotion from a provider
reply, L3 observation, runtime attestation, or L4 `pass`. The exact operations and
authority boundaries are in the [evidence lifecycle](prescribed-kinematics-evidence-lifecycle.md).

## Availability boundary

The repository capability catalogue remains `unqualified` by default. A host may have an
exact qualified emulated AMD64 attestation, but it is a host-local runtime fact—not a
catalogue rewrite or product observation. L3 still requires project authorization, the
sealed L2 ROP, a current writable Thread basis, and the server's JIT lease. Otherwise the
registered path is `unavailable`.

The agent cannot choose a provider, image, endpoint, tool, bearer, arguments, or recovery
path. The server owns the lowerer, runtime composition, dispatch identity, and receipt
readback. See the [Chrono provider boundary](../../providers/chrono/README.md) and
[L3 observation recovery](../../pipeline/prescribed-kinematics-observation-recovery.md).

## Explicit exclusions

This family does not establish any of the following:

- collision-free motion, contact behavior, clearance, fit-up, or physical joints;
- loads, forces, torque, dynamics, resistance, strength, fatigue, or thermal behavior;
- manufacturability, fabrication, safety, certification, or product fitness; or
- a CAD correction, provider rerun, SysON mutation, or automatic remedy after L4 or L5.

The literal states `unavailable`, `unresolved`, and `not_evaluated` are evidence
boundaries, not gaps an agent may fill with inference.
