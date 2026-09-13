# ID01 camera mount bracket — source provenance

Authored by Astra on 2026-09-06 UTC for the user's civil inspection concept.
This is original parametric design, not a translation of devFrame geometry.
The corresponding approved living brief is
`inspection-drone-id01:brief:r2:d16ef395a0bde640`, item
`camera-bracket-concept`, confirmed by the explicitly requested local YOLO mode.

## Initial design parameters

All source parameters are geometric lengths in millimetres. The source defines
one monolithic L bracket: a base and upright with a positive-volume overlap.
Its six openings are simple through-holes, not modelled threads or joints.

| Parameter | Value | Provenance and status |
| --- | ---: | --- |
| `bracket_width` | 35 | ID01 provisional design choice: margin around a nominal 25 mm PCB |
| `base_depth` | 30 | ID01 provisional packaging choice |
| `bracket_height` | 35 | ID01 provisional packaging choice |
| `thickness` | 3 | Initial design lever; not justified by a strength calculation yet |
| `camera_pitch_x` | 21 | Derived as 25 - 2 - 2 from the drawing, with left/right symmetry assumed; exact interface recross outstanding |
| `camera_pitch_z` | 12.5 | Derived as 14.5 - 2 from the drawing's bottom-edge datums |
| `camera_hole_radius` | 1.1 | Half the drawing's 2.2 mm mounting-hole diameter; not an approved tolerance fit |
| `camera_lower_z` | 10 | ID01 choice locating the lower camera mounting row above the base |
| `base_pitch_x` | 20 | ID01 provisional chassis-interface choice |
| `base_offset_y` | -7.5 | ID01 provisional chassis-interface choice, toward the front of the base |
| `base_hole_radius` | 1.6 | ID01 nominal clearance concept; fastener and manufacturing tolerance unresolved |

The source's 0, division by 2, cutter factor 3 and 90-degree rotation express
coordinate construction, centring, through-cut overrun and orthogonal orientation.
They are not measured component properties or physical safety factors.
X spans the bracket, Y points toward its back, and Z points upward. The two boxes
overlap intentionally; no physical bend, bond or joint is implied.

## Source revision and observed admission refusal

The initial authored source included six standalone provenance comments. Its exact
SHA-256 was `7ba29fdfb752d7e00d7322efcc87fdee04669b3c1e4c6162d762a1fa8370f075`.
It remains immutable as workspace file revision 1 and captured resource bytes.
Capture reported parser `passed` and eleven levers, but compilation fingerprint
`a8122b403df1eef4a5f380947aaa99f0fade7892088b0c6d89646b5aca24ed24` was `unresolved`:
six `python-comment` constructs were not qualified. All twelve SysML bindings were
present. No admission or geometry was produced from that revision.

The successor removes those comments only, keeping the exact same executable
statements and numerical choices. Their provenance and explanations are retained
in this document and the approved brief. This is an explicit source revision under
the current language boundary, not a change to the analyzer or historical evidence.

## External evidence

Inspected 2026-09-06 UTC / 2026-09-07 Asia/Taipei:

- [Raspberry Pi Camera Module 3 product page](https://www.raspberrypi.com/products/camera-module-3/):
  Standard envelope 25 x 24 x 11.5 mm. This candidate is not an authorized purchase.
- [Official camera hardware table](https://www.raspberrypi.com/documentation/accessories/camera.html#hardware-specifications):
  Camera Module 3 mass 4 g; inclusion of cable not established here. This is not the
  mass of the bracket, its fasteners or the complete payload.
- [Standard mechanical drawing](https://pip-assets.raspberrypi.com/categories/1207-design-files/documents/RP-008153-DS-1-camera-module-3-standard-mechanical-drawing.pdf):
  visually inspected the complete page. It shows width 25, PCB extent 23.862,
  hole diameter 2.2, bottom-row datum 2 and upper-row datum 14.5 mm.
  The horizontal pattern uses the explicitly recorded symmetry assumption.
  Drawing depth 11.3 and product envelope 11.5 mm remain distinct source values.

## Remaining engineering work

Source authoring alone is neither admission nor canonical geometry. The exact source
must be captured, attached, compiled, admitted and exported through registered
Digital Thread operations before its resulting STEP can support a later proof.

Recheck the exact camera interface, cable path, rear-component clearance, spacers,
fasteners, chassis attachment and manufacturing tolerances. The camera is intended
on the front side of the upright with suitable spacing, which is not modelled here.
No camera solid or assembly placement is claimed by this one-part source.

Material, load case and acceptance thresholds remain unresolved. No FEA, assembly
integrity, weather resistance, image quality, vibration or flight result is asserted.
This support is the first source module in the larger ID01 system, not the completed
drone or a substitute for its other subsystems.
