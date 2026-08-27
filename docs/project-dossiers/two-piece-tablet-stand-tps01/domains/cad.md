# TPS01 — CAD and canonical assembly

Audience: both · Diátaxis: explanation · Kind: dated execution trace

Each child uses a two-file Build123d workspace: a scalar-dimensions leaf and a root
module, joined by one direct edge. Both bounded closures were captured, reread, admitted
and reopened by the canonical geometry path. This demonstrates the bounded deterministic
workspace lowering in the [closure-lowering reference](../../../reference/domains/cad/build123d-workspace-closure-lowering-v1.md);
it is not a claim of semantic compilation of general Python imports.

| Child | Admission | Canonical Thread | Result |
| --- | --- | --- | --- |
| `StandBase` | `technical-compilation-admission-17995d4e3360c974b766683b956618034b9dae52dccebcde83d842a2f75c47ce` | r6 | STEP 15,431 B; GLB 3,292 B |
| `StandBackrest` | `technical-compilation-admission-447d133ad60ec8f9d6cd5853f005349a46e7c8b739f52d56b9bad58e465e83be` | r7 | STEP 15,435 B; GLB 3,292 B |

At r8, exact placement capture covered the two immediate PartUsages without missing,
extra or ambiguous occurrences. The initial one-file placement closure set the base to
`[0, 0, 0]` mm and backrest to `[0, 72, 8]` mm. They are authorized demo inputs only.

At r9, `design.write-geometry@1` sealed an immediate module with both child STEP inputs
reopened on their admitted basis and both placements recrossed exactly. The output is
one canonical assembly STEP (32,726 B) and one GLB (6,348 B); exact digests are in
[runtime evidence](../runtime-evidence.md). L3 r10 then observed two valid solids, a
28 mm gap and zero intersection volume. L4 r11 passed all five static criteria; L5 r12
accepted only that bounded static result.

The same placement file advanced from r1 to r2 and changed only the backrest translation
to `[0, 44, 8]` mm. Its exact recross produced canonical successor
`geometry-dd094bfa79124b220ced4d728c03c21628c9618d1abb321b9d056b77e0b029e9` at r13.
The successor STEP and GLB digests are recorded in [runtime evidence](../runtime-evidence.md).

L3 r14 reread two valid solids and exact placements, with contact, 0 mm minimum distance
and 0 mm³ intersection volume. L4 r15 passed all five static criteria, and L5 r16
accepted that result. Neither sequence proves a physical joint, a clearance envelope,
motion, loads, safety, manufacturability or fabricability, certification, or product
fitness.
