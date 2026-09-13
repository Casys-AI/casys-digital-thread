# ID01 camera and static propeller representations

Original sources authored by Astra on 2026-09-06 UTC / 2026-09-07 Asia/Taipei.
Draft geometry under the same approved ID01 living brief r2. These complete the
geometric source candidates for the already declared PartDefinitions; they do not
establish camera-interface compatibility, propulsion performance or flight safety.

## CameraBoardEnvelope

The source uses the manufacturer-reported **full standard Camera Module 3 external
envelope**, 25 x 24 x 11.5 mm, from the [Raspberry Pi product specification](https://www.raspberrypi.com/products/camera-module-3/)
(inspected 2026-09-06 UTC). The 11.5 mm value is deliberately a fixed constructor
dimension, not an invented PCB substrate thickness or lens measurement. Named handles
`camera_board_width` and `camera_board_height` retain the source footprint. The existing
unused thickness/lens handles in the architecture are not assigned unsupported values.

This box includes the nominal full package extent; it is not a detailed board, lens,
connector, hole pattern, fastener, cable or component model. It starts at local Z=0,
with X/Y centered. A later placement may rotate it upright next to CameraMountBracket.
The full package envelope is not the substrate outline used for hole-datum analysis;
those sources and the bracket's symmetry assumption remain separate.

The manufacturer states that Raspberry Pi Zero boards require the **Zero camera
cable**; the standard supplied camera cable does not fit that smaller connector. The
cable choice, route, length and bend space remain unresolved. This source does not
grant a connectivity or installation claim.

## StaticPropellerEnvelope

This is an **original, provisional static planform proxy**, not the CAD, aerodynamic
design or qualified envelope of a commercial propeller. Its form is a flat rounded
two-ended bar plus a hub; no twist, airfoil, pitch, bore or rotational state is modeled.
It must never feed a thrust, efficiency, stress, balance, clearance-under-motion or
flight-safety claim.

All four named dimensions are in mm: radius 38.1, blade width 8, thickness 2 and hub
radius 5. The nominal 76.2 mm span is a reversible Astra layout hypothesis for a
3-inch class candidate (3 x 25.4 / 2 = 38.1 mm radius), informed only by the F1404
[manufacturer page's nominal 3-inch application class](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html).
This is not a selected or compatible propeller. Width, thickness and hub radius are
explicit provisional layout values, NOT sourced component dimensions. Source constants
0 and 2 express coordinates, centering and diameter/radius conversion.

Assumption owner: Astra as proposer. Review trigger: source an actual propeller and
hub interface after the mission's propulsion/energy trade-off is reviewed; replace this
proxy as needed and recompute dependent modules. Admission, if approved, can only
approve the stated proxy bytes and limited meaning, never promote them to real hardware.

## Status boundary

Each source still needs exact capture, attachment, compilation, admission and canonical
export. Any later assembly-integrity result concerns these exact representations only.
Absent hardware details, tolerances, motion, loads, energy, environmental protection,
image quality and certification remain `not-evaluated` or `unresolved`.
