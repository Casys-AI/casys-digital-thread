# ID01 camera bracket - proposed theoretical bench proof

Astra proposal, 2026-09-06 UTC / 2026-09-07 Asia/Taipei. This is a bounded numerical
question, not an as-built material claim or an actual bench experiment. It is not
approved or executed merely because this document exists. The source case, requirement
and separate proof/run MRTRs must be recorded before computation.

## Exact geometry and evidence boundary

Target is CameraMountBracket, PartDefinition `e9f1d48b-666d-48ff-af6c-abf74646b68e`.
Its original source is 35 x 30 x 35 mm with 3 mm walls; the canonical STEP is
`b821e5598b75449636eb57d0ea7db48ea560260ce56a6872ebeaec0f7691d201`, 48,786 bytes.
The source and STEP text agree on X limits +/-17.5, Y limits +/-15, base Z 0..3,
upright Y 12..15 and height 35. The STEP declares millimetres and radius-1.1 mm
camera holes. This static source/STEP cross-check is not a mesh or numerical result.

The proposed question is: under a camera-only external weight load, does this exact
single bracket, idealized as homogeneous 6082-T6 and with its entire bottom face
fully fixed, remain below the published sheet-material yield reference in a
small-displacement linear-static calculation? The fixture is intentionally idealized;
it does NOT represent the currently unresolved bracket-to-drone mounting.

## Sourced inputs

- Raspberry Pi's [camera hardware table](https://www.raspberrypi.com/documentation/accessories/camera.html#hardware-specifications)
  lists Camera Module 3 at 4 g. Cable inclusion is not established; cable, spacers and
  fasteners are excluded from this case.
- [BIPM VIM 2.12](https://jcgm.bipm.org/vim/en/2.12.html) gives conventional standard
  gravity 9.80665 m/s2. It is not a measurement at a project site.
- Derived external weight: 0.004 kg x 9.80665 m/s2 = 0.0392266 N. Four equal declared
  patches receive 0.00980665 N each. Equal sharing is a numerical idealization, not a
  measured joint-force distribution.
- [Euralliage 6082](https://www.euralliage.com/6082.htm), elastic/physical T6 row:
  Young modulus 70,000 MPa and Poisson ratio 0.33. Its rolled-sheet EN 485-2 table
  gives minimum Rp0.2 = 260 MPa for T6/T651/T62, thickness >1.5 through 3 mm.
  Proposed direct comparison limit: 260,000,000 Pa. These are published catalogue
  values, not a batch certificate. The sharp conceptual corner does not establish a
  qualified forming/machining process or preservation of temper after fabrication.

These sources were checked on 2026-09-06 UTC. No density is supplied to the proof:
the current capability has no self-weight/body-force input. No factor of safety,
plasticity or displacement criterion is invented.

## Proposed numerical assumptions in local CAD coordinates

Owner: Astra proposer. Review triggers: real fixture/interface, selected material and
condition, component mass scope, a nonempty-node selection failure, mesh sensitivity,
or any intended physical use.

- Fully fixed support: bottom face Z = 0, selected by the closed box
  min (-18,-15.5,-0.1), max (18,15.5,0.1) mm. The 0.1 mm half-band is an explicit
  geometric selection aid, not a manufacturing tolerance. This represents an ideal
  rigid face clamp and may overstate stiffness relative to real bolts.
- Bench orientation: gravity points along local -Y. This is an out-of-plane bending
  screen of the upright in a declared bench orientation, not the proposed vehicle
  flight orientation. Each force vector is (0,-0.00980665,0) N.
- Four loading boxes surround the four camera holes at X = +/-10.5 mm and
  Z = 10 / 22.5 mm. Each has X and Z half-width 1.8 mm, and Y range [11.9,15.1] mm.
  The region is a coarse collar idealization around a radius-1.1 hole, not bolt
  bearing/contact mechanics. The registered worker distributes each total force over
  the selected nodes. All four boxes are disjoint from the fixed-support box.
- Tetrahedral target mesh size: 1 mm, a provisional first resolution relative to
  the 3 mm wall and 2.2 mm hole diameter. This is not a convergence proof. The server
  selects element order and timeout. Selected-node counts and mesh diagnostics must
  be read from the real output before accepting any conclusion.
- Sole named criterion: maximum von Mises stress <= 260,000,000 Pa. This is a
  theoretical elastic screening comparison with published Rp0.2, not simulated yield,
  a joint-strength result, fatigue life, ultimate load or safety factor.

Exclusions: bracket self-weight, the camera's centre-of-mass moment, cable and hardware
loads, realistic bolt/contact stiffness, tolerances, nonlinearity, vibration, landing
or flight loads, weather, whole-vehicle safety, manufacture and certification. A pass
would answer only this idealized, camera-weight-only question. It would not repair the
unresolved camera-to-airframe attachment or complete the drone project.
