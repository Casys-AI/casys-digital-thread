# ID01 camera-to-deck hole counterpart proposal

Astra original, reversible geometry proposal, 2026-09-06 UTC / 2026-09-07 Asia/Taipei.
This closes one missing geometric counterpart, not a physical-joint or flight claim. It
is a planned design addition, not a sensitivity correction of a failed proof. The
existing root canary at Thread r66-r69 passed its five static geometric checks and
remains preserved as history.

## Inputs and derivation

- Existing captured bracket source `id01-camera-mount-bracket@2` has two base holes:
  `base_pitch_x = 20.0 mm`, `base_offset_y = -7.5 mm`, and `base_hole_radius = 1.6 mm`.
  Its base thickness is 3.0 mm. These are original design hypotheses, not measured
  hardware or a specified fastener standard.
- Root placement source `id01-root-placements@1`, SHA-256
  `92610ea558a523d5ca64b83509879db737880c4e6c2674a1158e547a3cb6b0fc`, places
  CameraPayload at `(0,-36,50)` mm with rotations `(180,0,180)` degrees. This specific
  rotation is `diag(-1,+1,-1)`. The base-hole axes therefore lie at world
  `(x,y) = (+/-10,-43.5)` mm.
- The same captured root places Airframe at `(0,0,50)` mm with yaw `45` degrees. The
  central deck's placement within Airframe is the identity. Inverting that yaw maps the
  two world axes to deck-local `(-23.6880771697,-37.8302127935)` and
  `(-37.8302127935,-23.6880771697)` mm (rounded display values only).
- The original deck is a 100 by 100 by 3 mm plate with eight holes of radius 1.6 mm.
  None is at either camera axis. The proposed counterparts reuse that radius and pass
  through the deck. No countersink, thread, bolt, washer, nut, preload, or fit is
  inferred.

## Proposed source successor

Keep the stable `id01-central-deck` file identity and create a new revision through
resource capture and workspace succession. Retain the eight original holes and all five
existing scalar handles. Add three bare SysML handles on the same CentralDeck
definition, then bind the source scalars:

- `deck_camera_hole_world_y = -43.5` mm, from `-36 + (-7.5)`;
- `deck_camera_hole_pitch = 20.0` mm, from the existing bracket base pitch;
- `deck_camera_frame_yaw = -45.0` degrees, the inverse root Airframe yaw.

The new source composes the two hole cutters in the original world XY plane, then
applies the inverse yaw. It uses the existing `deck_thickness` and
`deck_mount_hole_radius`, not rounded local coordinates. The bracket source, its
bench-proof source, and all other component sources remain unchanged.

Expected lineage consequence after canonical deck succession: retire the previous deck
family and its dependent Airframe/root families through the existing dependency graph;
do not rebuild ancestors implicitly. Re-capture the current structure and intended
placements, export and seal the affected modules explicitly, then run fresh exact
assembly checks. Historical evidence remains readable and is not relabelled as current.

## Limits

Coincident hole axes and contacting faces are geometric design evidence only. Fastener
selection, tolerance, bearing/pull-through, access, retention and installed loads are
unresolved. The earlier camera-weight-only ideal-clamp FEA does not verify this joint.
The camera board's separate 1 mm spacer gap and the other subsystem interfaces remain
unmodeled. No make/buy, fabrication, flight-safety or certification decision is made.
