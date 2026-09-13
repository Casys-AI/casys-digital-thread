# ID01 - immediate static placement assumptions

Astra proposal, 2026-09-06 UTC / 2026-09-07 Asia/Taipei. The exact source identities
and twelve canonical target geometries are present at Thread r31. Each placement
file is an original, reversible layout proposal using exact recorded SysON usage and
definition IDs. Capture is not approval; each resulting canonical module requires its
own exact registered geometry seal and operator-enabled local YOLO confirmation.

## Conventions and design choices

Translations are mm and rotations are extrinsic XYZ degrees, right-handed, as named
by `cad-immediate-placement-source/1.0`. Original CAD roots have bottom Z = 0.
The eventual vehicle convention is front = -Y and right = +X. A proposed later root
rotation of +45 degrees for Airframe and Propulsion maps their local +X to rear-right,
+Y to rear-left, -X to front-left and -Y to front-right. No root assembly is executed
or claimed by these immediate placement files.

| Module | Exact provisional local layout | Rationale and limits |
| --- | --- | --- |
| Airframe | Deck at origin; arms centered 60 mm out at four cardinal directions, pointing outward, bottom Z = 3 | Two arm root-hole centers align nominally with deck radii 20 and 40 mm. Arms touch the deck top. Adjacent arm footprints have 2 mm nominal separation. No bolts, preload, thread, tolerance, stiffness or root-clamp proof |
| ElectricalPower | Tray at origin; reserved volume at (0,0,3) | Reserve touches the tray inner floor, with 1 mm nominal lateral gap inside the 40 x 36 mm inner footprint. Battery choice, retention, connectors, thermal and electrical safety remain unresolved |
| FlightAvionics | Carrier at origin; autopilot at (0,-17,3); computer at (0,22,3) | Candidate envelopes touch the carrier top. Their Y extents are [-36.5,2.5] and [7,37], leaving 4.5 mm nominal gap and staying inside the 80 mm square carrier. No mounting, cooling, vibration or cable proof |
| LandingGear | Skids centered at X = -30 and +30, each rotated +90 degrees about Z | Their bases are parallel to Y. Separation is a reversible packaging choice, not a stability, ground-clearance or landing-load requirement |
| CameraPayload | Bracket at origin; standard Module 3 full bounding box translated (0,11,20), rotated +90 degrees about X | Camera box has X [-12.5,12.5], Y [-0.5,11], Z [8,32]; bracket upright front is Y = 12. The 1 mm nominal gap represents unmodeled mounting separation, not a verified spacer or fastener. Full camera envelope is not PCB thickness. Cable and actual contact distribution remain unresolved |
| PropulsionSystem | Four motor envelopes centered 100 mm out at cardinal positions; corresponding static propeller proxies share XY at Z = 16.6, with radial orientation | Propeller proxy bottom touches motor-envelope top. Both remain static coarse geometry. No shaft/hub fit, blade profile, dynamic swept clearance, thrust, ESC, voltage, motor suitability or aerodynamic proof |

All distances above are algebraic consequences of the captured source dimensions and
these proposed transforms, not measured assembly observations. Owner: Astra proposer.
Review triggers: actual interfaces, tolerances, cable routes, changed components,
observed interference, or any later physical load case. Sealing or static integrity
does not resolve these missing physical interfaces.

## Later root proposal, not yet supported or executed

An initial packaging study places Airframe at Z = 50 with rotation Z = 45 degrees;
Propulsion at Z = 58 with the same rotation; FlightAvionics at Z = 58 without rotation;
ElectricalPower at Z = 15; LandingGear at Z = 6; and CameraPayload at (0,-62,15).
These positions are recorded only to make the design intent reviewable. Nested-module
promotion is outside current published coverage and needs its own maintained authority
route and qualification before a whole-root claim. No implicit flattening or automatic
ancestor rebuild is authorized by this note.

No flight performance, material mass, strength, fabrication readiness or certification
is claimed. No make or buy branch is opened.
