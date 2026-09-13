# ID01 camera-board hole counterpart proposal

Astra original, reversible geometry proposal, 2026-09-11. This closes one missing
geometric counterpart on `CameraBoardEnvelope`: the four Module 3 mounting-hole axes
already encoded on `CameraMountBracket`. It is not a fastener, spacer, cable, PCB, or
flight claim.

## Inputs already on the Thread

- Envelope 25 × 24 × 11.5 mm from the Raspberry Pi Camera Module 3 Standard product
  specification, already the `id01-camera-board-envelope` box. 11.5 mm is the full
  package, not a PCB substrate.
- Hole pattern already on `CameraMountBracket`: `camera_hole_radius = 1.1` mm (half of
  drawing Ø 2.2), `camera_pitch_x = 21` mm (`25 − 2 − 2`), `camera_pitch_z = 12.5` mm
  (`14.5 − 2`), lower-row datum 2 mm from the 24 mm edge. Brief item
  `camera-bracket-concept` cites the official mechanical drawing.
- `cameraPayload-placements.json` places `cameraBoard` at `(0, 11, 20)` mm with
  `Rx = 90°` and the bracket at the CameraPayload identity. After that rotation the
  board-local hole axes land at CameraPayload `(x, z) = (±10.5, 10.0)` and
  `(±10.5, 22.5)` mm, the same pair as the bracket. The 1 mm face gap is unchanged and
  remains an unmodeled spacer.

## Proposed source successor

Keep stable file identity `id01-camera-board-envelope` and add a revision. Bind the
existing unused `camera_board_thickness` handle to 11.5 mm (package). Add four bare
handles on `CameraBoardEnvelope`:

- `camera_board_hole_radius = 1.1` mm
- `camera_board_pitch_x = 21.0` mm
- `camera_board_pitch_z = 12.5` mm
- `camera_board_hole_inset = 2.0` mm

Do not assign `camera_lens_radius` or `camera_lens_depth`. The source uses
`Box` / `Cylinder` / `Pos` / `−` only. Derived hole-row coordinates are inlined in
the `Pos` calls (`id01-camera-board-envelope@3`); they are not extra AttributeUsage
handles.

## Limits

Coincident hole axes are geometric design evidence only. Fastener, torque, the 1 mm
gap, Zero camera cable, and image quality stay `unresolved`. Rebuild CameraPayload and
the explicit InspectionDrone root after canonical export; do not rebuild Airframe.
Historical envelope STEP remains readable.
