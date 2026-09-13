# PS-01 electrical

Audience: both · Diátaxis: reference · Kind: project domain status

`sensor-driver.cir@2` passes `spice-circuit-closed-subset-v1`. It is a provisional
operating-point load circuit used for AX validation, not a selected sensor, driver or
safety design.

Architecture r4 provides the exact `loadResistance` join. The workspace r28 capture
reached admission at Thread r5 and isolated ngspice execution at r6. Fresh documentary
observations are `@rdrive[i]` and `@rreturn[i]` at `0.0004545455 A`, `i(vlogic)` at
`-0.000454545 A`, `v(output)` at `4.545455 V`, and `v(supply)` at `5 V`.

No electrical requirement, method sheet, derived power, L4 evaluation, L5 closeout,
safety claim or product verdict exists.
