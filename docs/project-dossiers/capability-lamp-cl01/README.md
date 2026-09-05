# Capability lamp — CL01

Audience: both · Diátaxis: explanation · Kind: dated canary dossier

Local **Behave** canary observed on **2026-09-05** (Asia/Taipei): project
`capability-lamp-cl01`, project r195, Thread r26 and source workspace r41. This
folder is a compact record of one real run through the capability-runtime path. It
does not replace the EngineeringProject, Thread, CAS, provider captures or human
decisions as authority.

## Purpose

CL01 exercised a multi-file, four-part lamp assembly (`Base`, `ArticulatedArm`,
`LampHead`, `DriverCircuit`) and then used three separate Behave questions:

- static geometry integrity of the exact immediate assembly;
- prescribed rigid-body kinematics of an explicit mechanism case;
- circuit-only admitted SPICE observation of the driver.

It also exercised local, server-selected capability materialization and JIT runtime
activation. It is deliberately a canary: the dimensions and criteria are bounded
demonstrator inputs, not product requirements or a marketable lamp specification.

## Pages

| Page | Owns |
| --- | --- |
| [status](status.md) | Compact, literal state by exercised surface |
| [runtime evidence](runtime-evidence.md) | Exact dated project, Thread, artifact and runtime identities |
| [workspace](domains/workspace.md) | Versioned files, attachments and recross bases |
| [CAD and assembly](domains/cad-assembly.md) | Canonical parts, immediate assembly and static-integrity chain |
| [mechanism](domains/mechanism.md) | Prescribed-kinematics L1–L5 chain and exclusions |
| [electrical](domains/electrical.md) | Admitted SPICE L3–L5 chain and scoped observations |
| [capability runtime](platform/capability-runtime.md) | Local activation evidence and distribution boundary |

## What this does not establish

The assembly chain is a static geometric observation, the mechanism chain is only
prescribed kinematics, and the electrical chain is only the named circuit criteria.
Together they do **not** establish collision-free motion, contact, clearance, forces,
strength, safety, EMC, optical output, reliability, fabricability, certification,
procurement, or a whole-product verdict. Make and Buy remain outside this dossier.

Living contracts remain the [CAD domain](../../reference/domains/cad/README.md),
[mechanism domain](../../reference/domains/mechanism/README.md),
[electrical domain](../../reference/domains/electrical/README.md), and
[capability-pack reference](../../reference/runtime/capability-packs/README.md).
