# Precision heated specimen stage — HS01

Audience: both · Diátaxis: none · Kind: tracking dossier

Live **Behave** pilot. This folder tracks; it does not authorize. Bytes and
approvals live in gitignored `state/local/` (primary atelier, **2026-08-24**
Asia/Taipei, local).

Current persisted Thread head is r32:
`project:precision-heated-specimen-stage-hs01:r32:analyze-evaluate-mechanical-preservation-run:hs01-queue-mechanical-preservation-r31-r219`.
Project snapshot r223
`precision-heated-specimen-stage-hs01:project:r223:c0274b72781951e1`.
Approved brief fingerprint
`685d576f5c7d36e02e08a89fc97459a01807878a8b706d27149a1ae7b07bd318`.
Canonical CAD, admitted Modelica L3/L4/L5, admitted SPICE L3/L4/L5, FEA
seal/run/L5, the r2 thermal method sheet, and the r2 impact walk through X09
and X11 exist. X10 remains `unavailable`. There is no whole-product verdict.
Not a percentage.

## Pages

| Page | Owns |
| ---- | ---- |
| [status.md](status.md) | Five dimensions: source, admission, execution, evaluation, closeout |
| [decisions.md](decisions.md) | Recorded YOLO MRTRs vs pending |
| [closeout.md](closeout.md) | Honestly open; branch L5 is not a whole-stage verdict |
| [sources/](sources/) | Exact small sources: SysML, CAD, Modelica, SPICE, FEA, both method sheets and the impact manifest |
| [domains/](domains/) | Per-surface worked / pending / friction |
| [platform/frictions.md](platform/frictions.md) | Generic ingress and lifecycle facts observed on this pilot |

Files under `sources/` preserve their reviewed bytes. Embedded repository paths record
their location at review time and are not rewritten by this documentation move.

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

## Vertical evidence

The generic resource ingress introduced in `d1bf53d7` has been exercised for
SysML, CAD, Modelica, SPICE, FEA, both typed method sheets and the impact
manifest. This proves capture and reread lineage, not a whole-product verdict.

The initial FEA and electrical branches reached L5. The initial Modelica L4
(r17) was `unresolved` and the initial impact evaluation (r22) was not a
decision; those captures were archived at r23, not rewritten. The thermal AX
successor sealed the r2 method at r24, passed L4 at r25, and accepted L5 at
r26. The r2 impact manifest sealed at r27; X08/X09/X11 then ran on that unarchived
seal. See [status.md](status.md) and [closeout.md](closeout.md).

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
- X10 remains `unavailable`. Independent Modelica or SPICE walks are not X10.
- There is no whole-product verdict. Branch L5 and impact statuses do not
  cross.
