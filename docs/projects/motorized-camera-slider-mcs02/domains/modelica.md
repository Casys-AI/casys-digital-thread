# MCS-02 — Modelica

The attached `mcs02.slider-motion` source was sealed at r5 as admission
`technical-compilation-admission-29e92d0bbe8e2c920011954af9fa9bd20355c433972df885cb249e4fff1d79dd`.
It is the admitted closed subset, not the qualified kit.

The first queued run used the admission's historical creation snapshot as its
work-item binding. Exact execution correctly refused it before claim/provider dispatch;
the run was cancelled. A successor work revision reused the artifact id at the exact
current r12 basis and OMC/DASSL completed at r13.

The result reported final and maximum absolute carriage position
`399.9999999999999 mm`. A reviewed scalar method sheet was sealed at r14, L4 passed at
r15 against the 400 mm motion criterion within the comparator's numeric tolerance, and
L5 was accepted at r16.

This is a scalar kinematic observation, not motor torque, belt compliance, acceleration,
control stability, multibody dynamics, safety or a whole-slider result. The method-sheet
schema still carries the historical word `thermal`; that naming is platform debt, not a
thermal claim.
