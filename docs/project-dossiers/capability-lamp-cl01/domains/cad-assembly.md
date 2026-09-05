# CL01 — CAD and static assembly

Audience: both · Diátaxis: explanation · Kind: dated evidence boundary

## Canonical geometry

Thread r13 records canonical geometry for `Base`, `ArticulatedArm`, `LampHead` and
`DriverCircuit`, followed by the immediate `ArticulatedDeskLamp` module assembly. The
exact authoritative assembly STEP has SHA-256
`35daf99164323b79bcef1cc840182743da18746f2ca8269d007bfe8a5fa20ac5`.

The r13 module asset is an exact assembly capture, not an inference from the four
child labels and not a CAD quality, design-quality or manufacturability verdict.

## Static integrity chain

| Layer | Thread revision | Recorded fact |
| --- | --- | --- |
| L3 observation | r14 | 4 solids, 6 pairwise checks and 0 positive intersections |
| L4 evaluation | r15 | All 5 named static-integrity criteria are literal `pass` |
| L5 closeout | r16 | Human acceptance of that exact evaluated static scope |

The L3 observation is
`assembly-integrity-observation-170849979c496c77f97d5e35e254c8ab60e6543e0d7567f01ccb0f0631362279`;
the r15 evaluation is
`assembly-integrity-evaluation-6be22b92467a45e6ab12993b7201486416eeed8e3feed60a2ef0a7048da43a7f`.

This proves no joint semantics, clearances or tolerance envelope, collision-free
motion, contact behavior, load capacity, strength, safety, fabrication or assembly
procedure. See [assembly integrity](../../../reference/domains/cad/assembly-integrity.md)
and [module assembly](../../../reference/domains/cad/module-assembly.md).
