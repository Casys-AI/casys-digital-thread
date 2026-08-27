# Explanation: oracle coverage, driven by what people actually build

Audience: both · Diátaxis: explanation · Kind: contract

> Provenance: market-coverage study of 2026-08-05 (web research over Printables category
> volumes, maker/engineering forums, simulation-service tiers and upload-check
> offerings). Figures are estimates over a typology of ~10 project families; sources and
> the full matrix are preserved verbatim in
> [oracle-market-study-2026-08-05](verification-market-study-2026-08-05.md). This page records
> the conclusions the roadmap acts on — it is strategy, not evidence.

> **Current product boundary.** The percentages and “nearly-free” native-CalculiX claim
> below are market-study hypotheses, not current capability or decision maturity. The
> current FEA contract is [linear-static only](../../reference/domains/fea/coverage.md);
> a new analysis family needs the complete contract → lowering → worker → evidence →
> oracle → replay path. [Behave decision roadmap](../product/behave-decision-roadmap.md)
> governs the product sequence.

## The demand, measured where it lives

The target segment (advanced makers, small design offices, early hardware startups)
concentrates its structural worries into a few families — brackets and mounts,
electronics enclosures, replacement parts, snap-fit mechanisms, RC/robotics parts,
automotive interior pieces, tooling and jigs. The failure modes people actually ask
about are equally concentrated: layer-shear breakage, PLA creep in warm environments,
vibration on RC and machine parts, snap-fit fatigue, thermal deformation of enclosures
around hot components, and dimensional fit.

## The coverage figure: 30 % → 55 % → 80 %

- **Today's core** (CalculiX linear static + Modelica + analytic mass + z3 + OCCT
  geometry) fully covers roughly **30 %** of the typology.
- **The nearly-free jump to ~55 %** needs zero new engines: CalculiX natively supports
  modal (`*FREQUENCY`), buckling (`*BUCKLE`), creep (`*CREEP`) and coupled
  thermo-mechanics (`*COUPLED TEMPERATURE-DISPLACEMENT`). Each becomes an oracle for the
  price of a reviewed case and a checker on the wrapping that already exists.
- **The honest ceiling near 80 %**: the remaining fifth hits gaps with no mature engine
  — FDM anisotropy (no catalogued Ex/Ez), long-term polymer creep constants beyond PLA,
  stochastic dimensional shrinkage. The product answer is to _declare_ these limits,
  never to estimate them silently.

## The three quick wins, in order

1. **Modal** — unlocks RC/robotics and frames (+12 pts of coverage); the most explicit
   forum demand of all.
2. **Creep** — the #1 uncovered failure mode for brackets and snap-fits (+9 pts); Norton
   parameters for PLA exist in the literature and belong in a reviewed case, not in
   code.
3. **Coupled thermo-mechanics** — unlocks automotive interiors and enclosures with hot
   components (+8 pts).

## What actually differentiates

Static FEA has been free in Fusion/Onshape/SimScale tiers for years. The differentiator
is not the analysis type — it is the chain of proof: a hashed result, bound to a signed
requirement, inside an immutable `ThreadSnapshot`, with declared limits and measured
sensitivities. No competitor in the segment produces that object.
