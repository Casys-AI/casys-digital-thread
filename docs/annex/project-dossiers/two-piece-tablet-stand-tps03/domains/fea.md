# TPS03 — static FEA lifecycle

Audience: both · Diátaxis: explanation · Kind: dated execution trace

TPS03 sealed a static proof case at Thread r15 for the `StandBackrest` requirement
identity. The exact proof capture is
`fea-proof-eca29de10e802b0714bd0739a56625efe5846655ed2b8945b5d9e21a72d65f15`.

The first registered product run, `run:tps03-fea-iso-queue-001`, terminated `failed`
with `isolated_output_validation_failed` before result or evidence publication. Its
work item, decision and run remain immutable.

The server later derived successor work item
`work-fea-isolated-50f81c83c68fcc72-r15-2` from that exact evidence-free failure. The
agent supplied no provider, tool, runtime, solver payload or result. Human YOLO MRTR
approved only the exact server-derived successor. Run
`run:tps03-fea-successor-queue-20260827-001` completed on Thread r16 and published the
registered CalculiX outputs, execution evidence and SysON evaluation.

Consequences remain literal:

- maximum displacement is 0.005445628 mm and its criterion is `pass`;
- maximum von Mises stress is 0.7601906 MPa and its criterion is `pass`;
- human L5 acceptance is recorded on Thread r17 as
  `evaluation-closeout-58dfae2ba93a535460b8c6641b12e20dd4ffd3023858845b26f338504374c697`;
- the failed attempt remains visible and was neither retried nor reinterpreted.

The pass is bounded to the exact isolated 120 × 8 × 100 mm StandBackrest, its sealed
linear-static assumptions, fixed lower end and sourced demonstration load. It proves no
tablet contact distribution, base attachment, joint, assembly load transfer, self-weight,
buckling, fatigue, vibration, thermal stress, safety, manufacturing or certification.
