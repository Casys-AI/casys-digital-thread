Audience: agent · Diátaxis: none · Kind: RFC Status: active

# RFC 05 — ngspice LED-driver vertical

This folder is one electrical vertical split into short execution briefs. It is core to
the articulated-lamp demo, but it does not claim that the current repository already has
a registered SPICE operation.

Read in order:

1. [Product boundary, authority and human gates](01-product-authority-and-gates.md)
2. [Closed contracts and source-to-seal lots E01–E07](02-contracts-and-source-seal.md)
3. [Provider, WAL, evidence, evaluation and decision lots E08–E15](03-runtime-evidence-and-decision.md)
4. [Hexagonal placement, acceptance levels and stop rules](04-placement-acceptance-and-stops.md)

The lots are atomic dependency units, not human-day estimates. Grok may continue
automatically from one green lot to the next, but it must stop at D1, D2, D3, every
MRTR/L5 decision, an unavailable provider contract, or any missing physical source. No
component, value, unit, criterion, netlist or ngspice argument may be invented to keep
the queue moving.

The complete vertical is:

```text
reviewed circuit source and method
  -> closed electrical proof case
  -> separate seal and run MRTRs
  -> server-owned ngspice lowering and dispatch
  -> captured V / A / W / s observations
  -> separate qualified L4 evaluation
  -> explicit human L5 decision
  -> completed replay without redispatch
```

Return to the [demo queue](../README.md) after E15.
