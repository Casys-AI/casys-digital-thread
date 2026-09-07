# ID01 integration sources - provisional geometric design basis

Authored by Astra for the unarmed civil inspection pilot on 2026-09-06 UTC
(2026-09-07 Asia/Taipei). Original parameterized sources, not downloaded CAD or a
translation of a commercial airframe. The approved living brief r2 permits reversible
geometric hypotheses; it does not authorize invented material properties or performance.
Architecture enrichment was approved through the operator-enabled local YOLO mode and
materialized at Thread r7. These files are still draft until their exact capture,
attachment, admission and canonical export have been recorded.

## Meaning and limits

All named source values below are geometric lengths in mm. Bottom Z is zero; local X
is the first length and local Y is the second. Constants 0, 2 and 3 express centering,
symmetry and cutter overrun, not physical properties or safety factors. Repeated arms,
motors and skids share one PartDefinition source, but retain separate typed occurrences.
No material, mass, strength, aircraft stability, endurance or certification is inferred
from the source solids. Envelope volumes are NOT component material volumes or masses.

The battery solid is a reserved space, not a selected battery. The autopilot and motor
solids are coarse external envelopes of named candidates. The companion-computer solid
combines a sourced PCB footprint with an explicit provisional vertical reserve. None
includes a connector/cable keep-out or demonstrates a compatible mounting interface.

## Original structural and packaging hypotheses

Owner for each assumption: Astra as proposer; approval remains the exact project MRTR
path under the operator's local YOLO opt-in. These are initial design choices, not
optimized dimensions or fabrication instructions.

| Source / target | Named values in mm | Rationale | Review trigger |
| --- | --- | --- | --- |
| `central-deck.py` / CentralDeck | length 100; width 100; thickness 3; mount pitch 80; hole radius 1.6 | Square integration platform, eight radial openings at 20 and 40 mm from the origin; nominal openings are not threaded joints | Exact arm, avionics, tray and camera attachment scheme; structural proof; manufacturing tolerances |
| `radial-arm.py` / RadialArm | length 100; width 16; height 5; mount pitch 20; hole radius 1.6 | Straight replaceable beam concept with two root-side openings | Root clamp/anti-rotation design, motor bolt-circle interface, actual loads and structural proof |
| `battery-tray.py` / BatteryTray | length 44; width 40; base 3; wall 2; wall height 32 | Compact central reserved-space carrier, deliberately no energy requirement encoded | Real energy-storage choice, retention, thermal/electrical safety, attachment and proof |
| `battery-reserved-volume.py` / BatteryReservedVolume | length 38; width 34; height 25 | Reversible keep-in placeholder inside the tray; no chemistry/capacity/mass selected | Mission energy calculation and human battery choice; this volume may be wholly replaced |
| `avionics-carrier.py` / AvionicsCarrier | length 80; width 80; thickness 3 | Flat carrier leaving room to study the documented autopilot and computer footprints | Exact fasteners, connector access, vibration isolation, cooling and mass/load evidence |
| `landing-skid.py` / LandingSkid | length 120; width 10; base 4; leg height 40; leg width 10; leg pitch 60 | One continuous U-profile concept; two mirrored occurrences planned | Ground/camera clearance, deck interface, landing-load case, material and manufacturing review |

The proposed radial arm center is 60 mm from the deck origin, with local X pointing
outward. Its two hole centers, local X = -40 and -20 mm, then coincide nominally with
the deck's radial 20 and 40 mm hole centers. The four arms lie at cardinal directions;
their local inner ends are 10 mm from the center while the half-width is 8 mm, leaving
a nominal 2 mm gap to an adjacent arm's footprint. These are algebraic layout checks,
not an executed assembly or a tolerance/strength proof. Bolt/thread definition, preload,
anti-rotation performance and the motor interface remain unresolved. Geometric placement
or an intersection result cannot close those questions.

## Sourced candidate envelopes

Sources inspected on 2026-09-06 UTC. The facts are dimensional references only; no
purchase, supplier qualification or electrical/aerodynamic compatibility is implied.

| Target | Encoded dimensions in mm | Source and interpretation | Still unresolved |
| --- | --- | --- | --- |
| AutopilotEnvelope | 54.3 x 39 x 17.5 | Holybro Pixhawk 6C Mini **Model A Current**, [manufacturer technical specification](https://docs.holybro.com/autopilot/pixhawk-6c-mini/technical-specification). Not Model A Legacy or Model B. Original box envelope, not copied internal CAD | Mounting-hole interface, connector/cable keep-outs, attachment, installed orientation, vibration isolation |
| CompanionComputerEnvelope | 65 x 30 footprint; 10 vertical reserve | Raspberry Pi Zero 2 W [official mechanical drawing](https://datasheets.raspberrypi.com/rpizero2/raspberry-pi-zero-2-w-mechanical-drawing.pdf) gives 65 x 30. **10 mm is an Astra packaging hypothesis, NOT manufacturer board/connector height** | Actual assembled height, mounting-hole diameter, cable and cooling reserves |
| MotorEnvelope | radius 8.95; total height 16.6 | T-HOBBY F1404, [LIGPOWER manufacturer storefront](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html), mechanical dimensions diameter 17.9 x 16.6. Radius is diameter / 2. The cylinder bounds the full reported extent, without separate shaft geometry | Variant selection, mounting integration, propeller interface, ESC, voltage/current/thrust/thermal operation and suitability for this airframe |

The manufacturer page confirms only the overall motor dimensions in the accessible
text. Its drawing is image-only here, and the available descriptions do not establish
whether the four M2 positions form a diameter-9 bolt circle or a 9 x 9 Cartesian
pattern. The mounting topology, phase, tolerances and hole treatment therefore remain
`unresolved` and are not incorporated into the arm source. The current motor envelope
does not assert a hole or shaft-interface proof. No motor thrust table is used here.
StaticPropellerEnvelope remains unmodeled pending its own explicit source or provisional
geometric proposal; an envelope is never an aerodynamic blade design.
CameraMountBracket keeps its separately recorded source and limitations; the camera
envelope and its exact placement still need to be recorded.

## Required path from this draft

1. Capture each source and this provenance document in the ProjectSourceWorkspace.
2. Attach each source to its exact current PartDefinition and compile against the
   registered named parameter handles. Preserve literal gaps/refusals.
3. Admit exact reviewed bytes and produce canonical part STEP through the registered
   path; a file or preview is not canonical geometry.
4. Resolve actual placement and interface questions. Capture every immediate module
   structure and placement scope before exporting any module.
5. Qualify nested module consumption and reverse-impact behavior before treating the
   six-module root as covered. Current published coverage remains `unavailable`.
6. Execute separate assembly-integrity and bounded single-part mechanical evidence
   with named requirements and honest limits. No flight or certification claim.
