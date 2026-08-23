# HS01 — electrical

Circuit-only `spice-circuit-closed-subset-v1`. Not mcp-spice, not the
LED-driver fiche.

## Worked

- Source [hs01-heater.cir](../sources/hs01-heater.cir) = CAS `e7893fe3…ce965`:
  `V1 SUPPLY 0 DC 5`, `RHEATER SUPPLY 0 5`.
- Admission r10 `technical-compilation-admission-bfca43fd…d924`.
- L3 r11 `simulate.run-admitted-spice@1` run `hs01-queue-spice-run-r76`.
  ngspice 42 operating point, native sign convention:
  `@rheater[i] = 1 A`, `i(v1) = -1 A`, `v(supply) = 5 V`.
  Evidence `17cba453…bdd9`; result `ef18e9af…519e`. Limitations include
  `not-l4` and `not-safety-claim`.

`5 ohm` is the brief V/I concept, not a vendor tolerance model.

## Evaluation and closeout

The resource-backed [hs01-electrical-observation-method-sheet.json](../sources/hs01-electrical-observation-method-sheet.json)
was sealed at r18. The r19 L4 evaluated the exact delivered current at `1 A`
against `<= 1 A` and derived electrical power at `5 W` against `<= 5 W`.
Both literal criteria passed; the electrical closeout was accepted at r20.
This L5 is limited to the sealed circuit-only observation method.

## Friction

Native `-1 A` at `i(v1)` is ngspice source-branch convention; L4 used the
reviewed sheet rather than a hand-flipped magnitude. Safety/EMC/protection
remain brief exclusions. The source and method sheet used generic resource ingress.
