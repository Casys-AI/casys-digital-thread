# Precision heated specimen stage — HS01

Audience: both · Diátaxis: none · Kind: tracking dossier

Live **Behave** pilot. This folder tracks; it does not authorize. Bytes and
approvals live in gitignored `state/local/` (primary atelier, **2026-08-23**,
local).

Current persisted Thread head is r22:
`project:precision-heated-specimen-stage-hs01:r22:analyze-evaluate-cross-domain-impact-run:hs01-queue-impact-evaluation-r151`.
Approved brief fingerprint
`685d576f5c7d36e02e08a89fc97459a01807878a8b706d27149a1ae7b07bd318`.
Canonical CAD, admitted Modelica L3 and admitted SPICE L3 exist. FEA seal/run,
method-sheet seals, L4/L5 and impact are pending. Not a percentage.

## Pages

| Page | Owns |
| ---- | ---- |
| [status.md](status.md) | Five dimensions: source, admission, execution, evaluation, closeout |
| [decisions.md](decisions.md) | Recorded YOLO MRTRs vs pending |
| [closeout.md](closeout.md) | Honestly open; L3 is not L5 |
| [sources/](sources/) | Exact small sources: SysML, CAD, Modelica, SPICE, FEA, both method sheets and the impact manifest |
| [domains/](domains/) | Per-surface worked / pending / friction |
| [platform/frictions.md](platform/frictions.md) | Generic ingress and lifecycle facts observed on this pilot |

## Bounded story

Indoor bench demonstrator: one 6061-T6 plate matching the published heater
envelope, one lumped thermal model, one idealized heater circuit, separate
domain questions. Scope answer `a-hs01-mission-boundary` =
`bounded-behave-demonstrator`. Stay on Behave. Do not open Make or Buy to
“finish”.

Physical links already in the brief (catalogue / datasheet / conversion /
material data — not a prototype measurement):

- [Corning CLS-GL-061-LA](https://www.corning.com/catalog/cls/documents/selection-guides/CLS-GL-061-LA.pdf)
- [Adafruit product 1481](https://www.adafruit.com/product/1481)
- [NIST SI conversion factors](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors)
- [NASA NTRS 19860001085](https://ntrs.nasa.gov/api/citations/19860001085/downloads/19860001085.pdf)

## Explicit exclusions

No assembly-complete CAD, contact, slide retention, thermal uniformity,
convection calibration, coupled thermomechanics, transient control, protection,
electrical or thermal safety, EMC, reliability, compliance, certification, Make
or Buy.

## Initial vertical evidence

The generic resource ingress introduced in `d1bf53d7` has been exercised for
SysML, CAD, Modelica, SPICE, FEA, both typed method sheets and the impact
manifest. This proves capture and reread lineage, not a whole-product verdict.
The initial FEA and electrical branches reached L5; the initial Modelica L4
and initial impact evaluation exposed literal `unresolved`/invalidated states.
Their AX corrective/replay work is in progress, so [status.md](status.md) and
[closeout.md](closeout.md) are intentionally not finalised from r17/r22.

## Hard stops

- Labels stay literal. Isolated engine success is not an oracle and not L5.
- `model.write-architecture@1` (live SysON) is not
  `model.seal-architecture-sysml@1` (documentary closed subset).
- Canonical STEP is `design.write-geometry@1`. Isolated Build123d is not that
  STEP.
- Historical FEA MCP `@1`/`@2` are not registered. Product run is `@3`.
- Circuit path is `simulate.run-admitted-spice@1`, not mcp-spice, not the
  LED-driver fiche.
- A source resource is immutable and content-addressed; typed method sheets
  have their own fingerprint and are not interchangeable with raw bytes.
