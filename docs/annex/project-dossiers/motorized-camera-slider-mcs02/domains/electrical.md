# MCS-02 — electrical

The attached `mcs02.motor-phase` source was sealed at r6 as admission
`technical-compilation-admission-6998fc3d2ef206176e0156b74cc153c3f15ec559f9e974b4b7ce2aef2ad37039`.
It uses the circuit-only closed subset, not mcp-spice.

ngspice ran the admitted 24 V / 12.5 Ω / 4 mH linear DC equivalent at r17. Native
observations include `@rphase[i] = 1.92 A`, `@lphase[i] = 1.92 A`,
`i(vsup) = -1.92 A` and `v(supply) = 24 V`.

The electrical method sheet sealed at r18; L4 placed `@rphase[i]` inside the reviewed
closed interval `[-2 A, +2 A]` at r19; L5 was accepted at r20. This is not a chopper,
microstepping, transient, torque, heating, protection, EMC or electrical-safety claim.

The sealed source's `.title` still says MCS01. Its registered source identity,
attachment, bytes and admission are MCS-02, so the stale title is cosmetic but recorded
as an AX/content-quality friction rather than rewritten after admission.
