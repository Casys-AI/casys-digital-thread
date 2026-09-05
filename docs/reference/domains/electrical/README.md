# Electrical domain reference

Audience: both · Diátaxis: reference · Kind: index

The electrical bounded context owns two non-substitutable surfaces plus a later
evaluation chain on admitted SPICE observations:

- the provider-free LED-driver human fiche (`led-driver-human-source/1.0`), which is not
  a netlist, D1 representation, ngspice payload, or Thread result
- the generic circuit-only SPICE closed subset (`spice-circuit-closed-subset-v1`), which
  enters the technical-source capture → compilation preview → `compile.seal-admission@3`
  spine
- after admitted L3, a sealed `electrical-observation-method-sheet/1.0`,
  `verify.evaluate-admitted-spice-observations@1` (L4), and human
  `decide.accept-admitted-spice-evaluation@1` /
  `decide.reject-admitted-spice-evaluation@1` (L5)

- [Circuit-only SPICE closed subset v1](spice-circuit-closed-subset-v1.md) — admitted
  netlist grammar and `simulate.run-admitted-spice@1`. Not mcp-spice, not the LED-driver
  fiche, not a verdict. How-to:
  [run admitted SPICE](../../../how-to/run/run-admitted-spice.md).
- [Boundedness inventory](boundedness.md) — H01 source bytes and unknowns.
- [mcp-spice provider surface](../../providers/spice/README.md) — engine preflight only;
  integration stays `unresolved`.

LED-driver unknowns stay `unresolved`. Capture and review of the fiche grant no seal,
run, or ngspice authority. Circuit-only SPICE admits through `compile.seal-admission@3`
then, when the approved capability-runtime supervisor composes its exact atomic unit,
`simulate.run-admitted-spice@1`. That run is
documentary L3 evidence. It is not mcp-spice. L4 derives named criteria from a reviewed
method sheet with a server-owned comparator; ngspice is not the oracle. An L4 `pass` is
never L5. Safety, EMC, optical output, lifetime, and vendor validity stay `unavailable`.

Circuit-only SPICE `.cir` and LED-driver JSON enter through `project_resource_capture`
then `resourceRef` (`project_technical_source_capture` /
`project_led_driver_source_capture`). `project_resource_capture` may also interpret a
reviewed `electrical-observation-method-sheet/1.0` through the existing typed store.
Admitted SPICE execution still starts from `compile.seal-admission@3`.

A local AL01 walk of that chain is tracking evidence, not this contract:
[AL01 runtime evidence](../../../project-dossiers/articulated-led-desk-lamp/runtime-evidence.md).
