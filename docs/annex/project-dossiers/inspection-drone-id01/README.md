# ID01 — Drone observation et inspection

Audience: both · Diátaxis: none · Kind: dated project tracking note

Dated project tracking. Primary atelier, **local**. This page is documentary and
non-authoritative: it does not replace project state, Thread evidence, or signed human
decisions. The **2026-09-12** block below is a saved-state reread of persisted latest
`0000000882.json`. It is not a server restart or live `GET` today.

## Current project truth

Saved-state reread **2026-09-12**, original atelier file
`state/local/engineering-projects/inspection-drone-id01/0000000882.json`, persisted
latest `inspection-drone-id01:project:r882:2de1e90b38a35b6b`. Thread last revision 118,
`project:inspection-drone-id01:r118:industrialize-run-dfm-checks-run:id01-queue-dfm-run-board-r1-f52c-20260912`.
Canonical brief remains r7, `inspection-drone-id01:brief:r7:22fb5d1b598dbd41`. Proposed
brief r8 `inspection-drone-id01:brief:r8:fb658801b1b1c693` is still unconfirmed (F22).
Mission shape A stays documentary **HOLD** screening: preferred lead F1404+GF3016 is
recorded, SKU not selected. Source provenance and the 1 mm nominal spacer / attachment
gaps remain unmodeled limitations. Numeric mission cells stay `unresolved`.

Recorded DFM capture
`dfm-check-a023abdcedb3bc50920af6c2d6d4e89600c0b971f0b6c55128c076a45d9b16d6` from
completed run `run:id01-queue-dfm-run-board-r1-f52c-20260912` (project r882 / Thread
r118). Three recorded checks `pass`: envelope 25 × 24 × 11.5 mm; sampled minimum
thickness 0.9149495583883871 mm against 0.8 mm (500 samples); overhang bed-contact
centroids at z = 0 excluded by the declared 0.2 mm Z-min filter, 0 remaining. Mesh 1 mm
is DFM sampling. The printer is a sourced screening envelope, not a selected machine.
This is not flight, strength or manufacturing authorization. The previous failed attempt
`run:id01-queue-dfm-run-board-r1-f52-20260912` remains history. The recorded capture is
readable; it is not upgraded to a valid exact-basis approval (F52).

Sensitivity artefact at Thread r117 is a **case**,
`sensitivity-case-a737046b21c7f6e61fa479c13e60511aa1cd78e765ce0349f052cd6249e3d9ee`
against admission `b0e5ba4d…`. It is not a new study execution, reuse or speedup.
Leftover work item `wi-proof-seal-id01-camera-bracket-bench-r2` remains `ready` (F45)
until a separate human `project_work_item_abandon`. The F45 abandon **source** path
exists; that orphan was not abandoned.

Read-only historical projection on this saved Thread (42 typed tests plus UI type check;
original bytes unchanged). Both current bench rows stay `pass` on project r882 / Thread
r118:
`requirement-4488a613ba6ffd5baea9626302a7e97ff8d37061bfb63892f91a41ad69dd5df9-camera_bracket_bench_max_von_mises_pa`
(complete 2 hops / 2 historical `PASS`) and
`requirement-7f206ff76ab6ab232cb7293a2b8df6cccbb0c241e5bc3e1dac09df09e8e3f6db-radial_arm_bench_max_displacement_mm`
(complete 1 hop / 2 historical `PASS`), including measured study
`sensitivity-study-72093069ff760744dc7726bef90005c18de2977790fc8e2e026b49699928d8a9` and
base evaluation
`sensitivity-base-evaluation-9bf8e4d4cd0f2993297902226bdfeba70e854d68e08dfa21c6ce40812b0514da`.
The collection is plural `historicalEvaluations`; observation provenance is plural
`sourceArtifacts[]`. A first hop with zero evaluations stays an explicit partial
diagnostic. The projection preserves every current `pass` / `fail` / `unresolved` /
observation id. Historical evaluations stay separate: they do not cause or authorize
those current `PASS` rows. The 2026-09-11 F49 `unresolved` incident is history, not a
claim about r882. F27 reuse **source** (factory, coordinator, 47 tests, orphan Docker
coordinator removed) does not claim live interproject reuse or saved solver time. See
the [friction journal](frictions.md).

DFM recorded viewer **source** is unpublished: `io.casys.mcp-dfm.results`
`0.3.0-local.viewer.1`, `ui://mcp-dfm/results-viewer`, `text/html;profile=mcp-app`,
`viewer.session.apply`. Provider commit `e763d96c2c58274048d6bf35f1cfb15148cba0f0`
(parent `85a62804…`); bundle `src/ui/dist/results-viewer/index.html` 780178 bytes,
SHA-256 `2fd82bf83bbba5c01cf2848d43da968597047a6fb99b52914825c50e41c74bd1`. Independent
`release:check`: 52 server tests, 5 model tests (native Gmsh ignored). Fake-host browser
proof (light/dark/480, all states) is a **synthetic** fixture, not the saved ID01
capture. DT binding: 15 targeted tests plus a pure provider-parser recross (exact
available / historical cross-revision `unavailable`). Hulls: 53 UI tests plus 1 typed
server membership test; family `dfm` keeps compact case/result/five observation rows,
three requirements and three evaluations in their lanes; STEP stays Geometry. A single
exact capture App is reachable through identity aliases; ambiguous or cross-context
sessions are refused. Production solver pin remains `0.1.0` while provider source is
`0.3.0`. Legacy `0.1` captures do not invent quality fields. F52 recorded `pass` values
are evidence; the r115 approval / r117 run remains authority-`unavailable`. No viewer
install, publication or runtime adoption.

Workbench discovery **source candidate** defines `GET /api/project-discovery` with
`native-workbench-project-discovery/2.0`. An offline read by the candidate reader over
the original persisted heads returned `partial` (10 candidates): available ID01 r882,
msm01 r97, tps01 r111, tps02 r128, tps03 r135; unavailable `validation-failure` ps01,
mcs01, mcs02, hs01, sl01. Legacy `GET /api/projects`
(`native-workbench-project-catalog/1.0`) stays all-or-nothing HTTP 503 on that storage.
The candidate route has not been runtime-adopted. There is no `GET /projects/<id>` and
no `projectId` query selector. Ask the paired assistant to choose the project;
`cockpit_focus_set` remains the MCP routing authority. Workbench stays `GET` + SSE
read-only.

French entry points (plain speech; the assistant maps them — do not author envelopes or
self-approve):

- « Guide-moi pour vérifier un nouveau design. » — the existing
  [Behave from-scratch guide](../../../how-to/verify-design/verify-a-new-design-from-scratch.md);
  do not open Make/Buy from that loop.
- « Prépare la revue des contrôles de fabrication de cette pièce. » / « Montre les
  preuves DFM enregistrées. » — measured DFM reviews then
  `industrialize.run-dfm-checks@1`, and the recorded DFM App, not a live solver UI.
- « Prépare la capture des coûts de cette configuration. » / « Montre les preuves de
  coût enregistrées. » —
  [Buy configuration and dated cost](../../../reference/domains/buy/README.md).

The 2026-09-11 block (Thread r98 / project r714–r715) and the 2026-09-08 resumption
(project r675 / Thread r93) below are **historical**. They are not the current tip.

### Historical 2026-09-11 (Thread r98 / project r714–r715)

Live reread **2026-09-11**: Thread r98
`project:inspection-drone-id01:r98:model-write-architecture-1782bbb8e7e3a3fdf97ccec9613d243214a946b525d83e6714e95c2b68d8cdd9`
(CameraBoardEnvelope hole handles). Last Thread-writing project snapshot r714; project
r715 has **pending unconfirmed** brief r8 (F22 refusal). Canonical brief remains r7.
Workspace r128: `id01-camera-board-envelope@2`. Mission shape A is recorded; numeric
cells stay `unresolved`. F36 closed-in-live; leftover r2 is F45; compilation preview
after r98 is F46. The 2026-09-08 resumption below (r675 / Thread r93, pending brief r5)
is historical.

### Historical 2026-09-08 resumption (project r675 / Thread r93)

Latest 2026-09-08 resumption: project r675 / Thread r93. Project r672 proposed the
bounded propulsion/energy priority question, r673 recorded the human-sourced
`presize-before-simulations` answer, r674 proposed brief r5, and r675 proposed the one
unanswered mission-shape question `mission-sizing-scenario-shape-r1`. That brief was
still pending at that resumption; no human answer, new Thread evidence or capability was
authorized then. The fresh Airframe `RadialArm` ↔ `CentralDeck` assembly-integrity chain
published L3 observation
`assembly-integrity-observation-958ef913155ff5f8a6ab115003b00ff996f382b95becb408833fe68ce9a78704`
at r91, L4 `pass` evaluation
`assembly-integrity-evaluation-83f3d7926589703b5a34856240821c5906176f13ec69d02a8244057f66b86b8e`
at r92, and accepted L5 closeout
`assembly-integrity-evaluation-closeout-b703164a1fb910798cfedc98179d709539f9b135b96f5f42ae504adab8fb4866`
at r93. It records only the five registered static geometric criteria for that exact
Airframe basis; it establishes no physical joint, fastening, strength, load, flight or
certification claim. The [RadialArm bench ledger](radial-arm-bench-result-20260908.md)
records the preceding single-part compliance branch: native requirement r87, proof seal
r88, isolated CalculiX/SysON `pass` r89 and bounded L5 accept r90. The earlier
[revision 3 bench revalidation ledger](bench-revalidation-r3-20260907.md) supersedes the
historical F10 status below. The new proof sealed at r84; the exact FEA branch and L4
`pass` published at r85 after a bounded repeated-artifact identity correction; the
bounded human-origin L5 acceptance published at r86. Both runs are `completed`. The
collision at project r603 remains documented as F11 rather than erased.

- Project: `inspection-drone-id01`.
- Observed project revision at that 2026-09-08 resumption: r675,
  `inspection-drone-id01:project:r675:8b9a15b705ec6c99`. Thread was r93,
  `project:inspection-drone-id01:r93:decide-accept-assembly-integrity-evaluation-run:queue-assembly-integrity-accept-83f3d7926589703b-r92-r667`.
  Those identities are historical; saved-state 2026-09-12 tip is project r882 / Thread
  r118.
- The first provider-free requirements-to-brief claim at project r591 / Thread r83
  remains historical evidence; it did not execute an FEA solver or a native requirements
  writer. The subsequent bench branch preserved that documentary basis.
- Human-sourced intent: an unarmed observation/inspection pilot developed through the
  paired chat, with traceable multi-subsystem design and bounded real verification.
  Weapons, targeting, and attack support are excluded.
- Canonical living brief r4, `inspection-drone-id01:brief:r4:8366ffe2fb53e984`, was
  approved at project r620 on 2026-09-08 at 01:49:53 UTC through the explicitly
  requested local YOLO mode. It preserves the 30 prior items and adds the bounded
  RadialArm compliance screen, its component identity and displacement criterion. Its
  origin is `local-yolo:startup-opt-in`, not an invented interactive signature.
- The current operational envelope was reported `authorized`; the registered operations
  still check exact source, basis, admission and runtime identities.
- Mission selected by the human: visual inspection of civil buildings and infrastructure
  with a camera. Answer `mission-primary-confirmed` was recorded at project r3 on
  2026-09-06 at 15:39:44 UTC. It selects the mission, not a complete brief or a flight
  authorization.
- Exterior facade/roof inspection was selected in the answer recorded at project r5. The
  user also explicitly asked to continue locally in YOLO mode without repeated
  confirmation questions.
- Architecture was created in SysON and reread: `InspectionDrone` contains Airframe,
  PropulsionSystem, CameraPayload, ElectricalPower, FlightAvionics and LandingGear. A
  monotone enrichment added `CameraMountBracket` under CameraPayload and eleven bare
  parameter handles at Thread r4.
- Our original [bracket source](sources/camera-mount-bracket.py), file
  `id01-camera-mount-bracket@2`, was admitted at Thread r5. Its exact SHA-256 is
  `4d9911a907584f50c7f7164f6d062ca2ebd4e934073ca5d2d49846723863483f`.
  [Provenance and assumptions](sources/camera-mount-bracket-provenance.md) are also
  captured and attached. Source workspace r7 has two modules, two active files and two
  active attachments; the original commented source revision remains readable.
- Canonical CAD export ran from those admitted bytes. `design.write-geometry@1` sealed
  the target-only `CameraMountBracket` geometry at Thread r6 on 2026-09-06 at 16:28:47
  UTC. Authoritative STEP: 48,786 bytes, SHA-256
  `b821e5598b75449636eb57d0ea7db48ea560260ce56a6872ebeaec0f7691d201`. This is one piece,
  not the drone assembly or a structural proof.
- Thread r7 enriched the same architecture monotonically with a central deck, four
  radial arms, four motor and four static propeller envelopes, a camera envelope,
  battery tray and reserved volume, avionics carrier, autopilot and companion-computer
  envelopes, and two landing skids. Thread r8 captured the exact SysON part structure.
- Source workspace r40 has eight modules, fifteen active files and fifteen active
  attachments. Eleven new original CAD roots are captured, parameter-bound and admitted
  together at Thread r9 as
  `technical-compilation-admission-2c642ab19459ce872453c12f02824960cc4b4b9abaab281dc24b13b541a242c0`.
  This multi-source admission is **not** eleven canonical STEP exports. The canonical
  export contract requires a singular admitted source. Separate unit admissions were
  therefore sealed at Thread r10-r20 and all eleven canonical exports at r21-r31. With
  the earlier bracket, twelve distinct canonical part targets are now present.
- [Integration provenance](sources/integration-provenance.md) and the
  [camera/propeller supplement](sources/camera-and-propeller-envelope-provenance.md)
  distinguish sourced candidate dimensions from provisional original structures,
  reserved volumes and the non-aerodynamic static propeller proxy. They do not select a
  battery, prove electrical compatibility, or predict propulsion performance.
- Six immediate static modules were sealed at Thread r32-r37; all six then received real
  L3 observations and L4 evaluations at r38-r49. Every module passed all five fixed
  geometric criteria. The [exact evidence ledger](geometry-and-integrity-20260907.md)
  records their independent capture identities. This is not a whole-root evaluation.
- Source workspace r86 has eight modules, twenty-two active files and thirty-eight
  active attachments, including six separate placement sources and their provenance.
- F07's implicit gate-claim defect was corrected, independently reviewed, integrated and
  adopted by the local server. Six provider-free L4 recrosses and six immediate L5
  accepts were then completed at r54-r65, reusing the original exact L3 captures. All
  six signed gate-claim sets are empty: no whole-drone assembly gate is satisfied. The
  [closeout ledger](module-closeouts-20260907.md) preserves each exact identity.
- A separate [camera-bracket bench proof](camera-bracket-bench-result-20260907.md)
  created a native requirement at r50, sealed its exact source case at r51, ran real
  isolated FEA with linked L4 `pass` at r52, and recorded a bounded L5 accept at r53.
  Stress was 0.00763815636944611 MPa against the sourced 260 MPa reference. This is
  camera-weight-only screening on an ideal face-clamped bracket, not the drone's
  mounting, flight load or material certificate. No global gate claim was added.
- A separate [RadialArm compliance screen](radial-arm-bench-result-20260908.md) now
  closes one theoretical 5 N single-part branch. Brief r4's declared `0.2 mm` limit was
  written as a native SysON RequirementUsage and canonically represented as exactly
  `200000 nm`. The real isolated result was `0.12925469439628479 mm`, converted by SysON
  to `129254.69439628477 nm`, with a `70745.30560371523 nm` margin and literal L4
  `pass`. The bounded L5 accept preserves the ideal clamp, catalogue material, one-mesh
  and non-flight limits and adds no gate claim. Draft proof r1 was abandoned before
  proposal or execution; only corrected proof r2 belongs to the Thread.
- Workspace r94 has eight modules, twenty-six active files and forty-two active
  attachments, including the exact proof source and result ledger on CameraMountBracket.
- Workspace r98 had eight modules, twenty-eight active files and forty-four active
  attachments, including the module-closeout ledger and remaining integration boundaries
  attached as supporting documents to InspectionDrone.
- The [nested root canary](nested-root-canary-20260907.md) then consumed the six exact
  module STEP files and sealed InspectionDrone at Thread r66. Its independent real
  L3/L4/L5 at r67-r69 passed the five static geometric criteria with zero gate claims.
  Manual two-level module composition is now narrowly qualified by that runtime proof
  plus reviewed source tests for exact child evidence and two-hop retirement; no
  production code, provider image or pin change was needed for this slice.
- Thread r70 added only three bare CAD handles on the inherited CentralDeck definition.
  The [camera/deck counterpart source](sources/camera-deck-interface-provenance.md)
  `id01-central-deck@2` was captured; its attachment was recrossed at workspace r109 and
  source analysis passed with eight named levers. Its first compilation preview was
  refused because the valid r50 bracket requirement named the old architecture (F08).
- After explicit operator authorization, the generic `model.recapture-requirements@1`
  route was implemented, reviewed, source-tested and adopted locally. Actual recapture
  at r71 preserved native IDs and the criterion; old requirement/evaluation entities are
  archived and the new requirement has no evaluation. Completed replay returned the same
  capture and Thread revision. The
  [recapture ledger](requirements-recapture-20260907.md) records exact identities and
  separates source tests from real runtime evidence.
- At workspace r116, CentralDeck's unchanged source revision 2 was recrossed through
  attachment revision 5; its preview resolved nine semantic bindings without gaps.
  Separate admission completed at Thread r72. The next export encountered F09: a valid
  unrelated module was rejected by the target-predecessor scanner. Its bounded
  correction is now reviewed, integrated and locally adopted, with 207 focused source
  tests passing. CentralDeck was sealed at r74, retiring the old deck and dependent
  Airframe/root families. Explicit rebuilds then sealed Airframe at r75 and
  InspectionDrone at r79; each received new L3/L4/L5 static checks, ending at r82. The
  [current rebuild ledger](camera-deck-rebuild-20260907.md) records the exact captures,
  preserved siblings and five-criterion limits. See the
  [friction journal](frictions.md).
- Workspace r115 has eight modules, thirty-two active files and fifty-three active
  attachments. The root canary ledger, camera/deck proposal and revised
  remaining-boundary record are captured and attached against r70. They document the
  historical evidence and refusal; those captured bytes are preserved. The newer
  recapture ledger supersedes only their F08 status, not their engineering limitations.
- Workspace r122 has eight modules, thirty-three active files and fifty-four active
  attachments. Bench source revision 2 preserves the original physics and bracket STEP;
  its public seal review selects the recaptured requirement. The queued seal at project
  r583 reached F10's explicit 50-ancestor anti-removal bound. It was cancelled through
  the normal human-YOLO path at project r584 before execution, allowing the later
  documentary append. At that checkpoint F10 was open and the new requirement had no
  current evaluation. The old bench pass remains historical; neither it nor prior
  evidence was rewritten. The existing full-ancestry correction in `5429a854` and the
  later revision 3 live seal close F10 without bypassing the guard.
- Workspace r124 adds the current rebuild ledger as a captured supporting document on
  InspectionDrone: eight modules, thirty-four active files and fifty-five attachments.
- The first real provider-free documentary claim appended at project r591 / Thread r83.
  It links one unchanged schema-4 CameraMountBracket requirement to brief r3's exact
  camera-bracket stress clause without changing native values, prior evidence or the
  original `TRACE GAP`. The exact artifact, claim, public-MCP replay and remaining
  boundaries are in the
  [requirements-to-brief claim ledger](requirements-brief-claim-20260907.md).
- Workspace r126 carries bench proof source revision 3 and its attachment recrossed
  explicitly against Thread r84. The proof sealed at project r598 / Thread r84. Its
  actual CalculiX/SysON branch published at project r605 / Thread r85 with one L4
  `pass`; the exact L5 closeout then completed at project r612 / Thread r86. The
  [revision 3 ledger](bench-revalidation-r3-20260907.md) records the identities,
  collision recovery and unchanged proof limits.

Jurisdiction, operational performance criteria, as-built materials, operational loads,
energy storage, propulsion and flight-safety provisions remain unresolved. Initial
bracket dimensions are explicit **provisional design choices**, not measured
performance. The bounded FEA result and six static-integrity results above do not
establish physical interfaces, strength, flight-readiness or certification.

## Initial capability inventory

This is a code/documentation inventory, not evidence that these methods have run for
ID01. Every eventual operation remains conditional on admission, exact inputs, runtime
qualification, and required human authority.

| Surface                                                                 | Documented bounded coverage                                                                   | Limit for this project                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [SysML](../../../reference/domains/sysml/coverage.md)                      | Generic part architecture, typed occurrences, named parameter handles and scalar requirements | No demonstrated physical-interface or whole-vehicle behavioural model |
| [CAD](../../../reference/domains/cad/coverage.md)                          | Admitted bounded Build123d source, canonical part STEP and immediate-module export            | A successful isolated execution alone is not canonical geometry       |
| [Assembly integrity](../../../reference/domains/cad/assembly-integrity.md) | Imported geometry, placement, topology and intersection observations                          | Does not prove joints, mechanical strength, motion or vehicle safety  |
| [Static FEA](../../../reference/domains/fea/coverage.md)                   | Registered `verify.run-fea-static-proof@3`, bounded single-part linear-static proof           | No whole-assembly, modal, vibration, fatigue or flight-dynamics proof |
| [Electrical](../../../reference/domains/electrical/README.md)              | Admitted circuit-only SPICE operating-point observation                                       | No battery-system dynamics, endurance or electrical-safety proof      |
| [Modelica](../../../reference/domains/modelica/coverage.md)                | Admitted closed-subset scalar equations                                                       | Not a demonstrated aircraft, autopilot or aerodynamic model           |
| [Prescribed kinematics](../../../reference/domains/mechanism/coverage.md)  | Bounded rigid-body placement and prescribed revolute motion                                   | No force-driven flight dynamics or stabilization proof                |

These limits identify questions to resolve, not automatic implementation orders. The
bounded manual two-level CAD-module qualification is now complete. One demonstrated
server composition defect in the trusted SysON inspection connection was corrected and
verified through the real part-structure capture (F05 in the friction journal). Provider
changes, if justified later, require their own bounded contract, tests and separate
publication/runtime-adoption evidence.

## Next engineering boundary

The larger goal remains ID01, not either isolated bench case. The six subsystems and
updated nested root have exact executed static checks. The camera/deck source successor
is canonical, with explicit Airframe/root rebuilds and fresh L3/L4/L5. The requirement-
linked bench r3 branch is now also sealed, executed, evaluated and accepted within its
camera-weight-only limits; F10 and F11 are closed. The RadialArm r2 branch is likewise
sealed, executed, evaluated and accepted within its ideal 5 N compliance limits. It does
not prove either adjacent joint. The nominal `RadialArm` ↔ `CentralDeck` arrangement has
now received its own fresh Airframe L3/L4/L5 chain. That chain establishes only import,
occurrence coverage, placement recross, BRep validity and zero pairwise intersection
volume for the exact static Airframe basis. It does not define or verify bolts, preload,
anti-rotation, tolerances, clearance, strength, loads, motion or flight. Any root-level
refresh or physical-joint/fastener branch therefore remains a separately scoped future
decision. The motor-to-`RadialArm` interface must remain later: its exact four-hole
topology is not proven by the current primary evidence. A question proposed too
precisely at project r613 was immediately answered `unknown` at r614; it records no
human choice and authorizes no motor geometry. A manufacturer-confirmed mechanical
drawing or supplier clarification is required before framing that consequential datum
decision. The [remaining-boundary record](remaining-integration-boundaries.md) stays a
preserved r70 capture. Its F08 blocker is closed and the deck holes are canonical, but
its unmodeled physical interfaces remain unresolved. Electrical, aerodynamic and
flight-safety evidence remains outside these proof meanings; the pilot is not declared
complete.

The
[propulsion and energy pre-sizing basis](propulsion-energy-presizing-basis-20260908.md)
now records two source-backed propulsion leads. F1404 KV4600 + `GF3016` retains a full
exact-row arithmetic screen but unresolved propeller identity and an internal
table-versus-drawing shaft conflict. The
[propulsion source-control packet](propulsion-source-control-packet-20260908.md) now
fingerprints the official drawings and T3140 specification. F1507 KV3800 + T3140 has a
stronger exact-name bench link, a full eleven-row exact-source table, sourced 3.1-inch
geometry, 2 g catalogue mass and a coherent nominal M5 retention chain, but its
revision/tolerances remain open, its 100% bench endpoint exceeds the same page's
60-second motor ratings, and both motor and propeller exceed the current CAD proxies.
Its matching guide names Mini F45A and F7 35A AIO leads, but neither is identified as
the ESC used for the T3140 table. Neither propulsion lead is selected. Six official 4S
battery candidates remain screened: five fail orthogonal containment in the current 38 ×
34 × 25 mm reserve; the sixth fits geometrically but fails even the first retained F1404
label-current row. This bounded search found no candidate that passes both screens, not
proof that no 4S pack can do so. A later official-catalogue extension added no passing
card: the shortest exact products found that clear the current arithmetic are still
`49 mm` long, `11 mm` beyond the reserve maximum. A parallel exact-pair search also
added no 3-inch propulsion card; its closest better-joined iFlight chain is 2.5-inch and
therefore remains an out-of-class search boundary. Neither result changes CAD or selects
hardware. The retained pack pages also do not provide the exact current, cutoff,
temperature and age evidence needed for usable energy. F20 keeps that external-or-bench
gap explicit; nameplate Wh and C-rate are not endurance evidence.

The [mission sizing decision sheet](mission-sizing-decision-sheet-20260908.md) keeps
three reversible workflow shapes separate from human decisions and deliberately leaves
every numeric mission cell blank. Historical **2026-09-08**: project r675 presented
those shapes as one durable A/B/C framing question, recommended the smallest local
façade pass only as a reversible first screen, and recorded no answer. Shape A was later
recorded and brief r7 canonizes `mission-sizing-screen`; B and C are not retained.
Numeric cells and the configuration-matrix **HOLD** remain. A separate
[camera-to-target geometry basis](camera-mission-geometry-basis-20260908.md) uses the
official Camera Module 3 Standard `66° × 41°` full-resolution field angles to publish a
unit-distance footprint and nominal object-plane sampling lookup. It selects no
stand-off, capture mode, target feature or image criterion and is not evidence of defect
detectability, installed image quality or sensitivity. The
[battery packaging sensitivity](battery-packaging-sensitivity-20260908.md) recomputes
all six orthogonal orientations at nominal and published maximum dimensions and keeps
the CAD unchanged pending a viable pack. The
[electrical power architecture basis](electrical-power-architecture-basis-20260908.md)
now distinguishes PM02 + PDB + individual ESCs, PM02 + four-in-one ESC and PM06 +
individual ESCs instead of multiplying their overlapping distribution roles. It also
records a 6.7 g UBEC companion-rail candidate, mutually alternative standard/Micro M10
GNSS cards and one airborne SiK telemetry lead. None is selected; the RC command link,
main isolation/protection, exact wiring and simultaneous installed power remain
unresolved. A partial source-backed COTS mass ledger and separate
[mass/position closure worksheet](mass-and-position-closure-worksheet-20260908.md) now
separates the exact 22-leaf canonical geometry census into ten structural solids and
twelve envelopes/proxies, then keeps the absent installed items, structural masses and
positions explicit. It now includes a visibly excluded 6082 density-consistency screen:
`103.235905636 g` for the four arms plus camera bracket under their theoretical FEA
material label, and `347.349252240 g` only if that same density were hypothetically
extended to all ten solids. Neither value enters the vehicle sum or selects a material.
The avionics candidates likewise remain outside every vehicle sum until their exact
variant, installed cable/mount scope and position are frozen. Total vehicle mass and CG
remain unresolved. The documents preserve the calculation contract and still-missing
input packets. They began as documentary drafts against pending brief r5. Brief r7 is
now canonical; proposed r8 remains unconfirmed (F22). They are still not a component
selection or a new proof.

The [configuration pre-selection matrix](configuration-preselection-matrix-20260908.md)
now groups propulsion, ESC/control, battery/tray, power and avionics cards by mutually
exclusive slot. It makes the PDB/four-in-one/PM06 overlaps and the distinction between
telemetry and RC command explicit, without multiplying them into false vehicle
configurations. Its verdict remains `HOLD`: no column closes identity, mass, usable
energy, packaging and interfaces together.

The [proportionate verification and test plan](verification-and-test-plan-20260908.md)
now answers the wider engineering boundary explicitly. It keeps the two accepted
single-part CalculiX cases and the geometric assembly closeout disjoint, then gates
propulsion benches, physical interfaces, electrical/thermal work, an external calibrated
6-DoF plant, SIL/HIL, vibration/EMI checks and progressively authorized physical tests.
Current admitted Modelica may later carry only a sourced scalar question that fits its
closed grammar; current prescribed Chrono may later carry an explicit revolute
mechanism, not rotor or flight dynamics. The plan queues none of those activities and
invents no criterion. If physical evidence is later authorized, it remains tied to its
article and protocol; it is not automatically persisted as sensitivity. Its new G0.8
gate keeps source-backed optical geometry separate from a human-owned inspection
criterion and later measured image quality.

Historical **2026-09-08** Workbench observation: the freshly restarted read-only BFF
then projected project r675 / Thread r93 under `engineering-workbench/0.6` and
`engineering-cases/1.1`. The accepted assembly-integrity closeout was projected as a
fresh artifact, and the RadialArm r2 case and project activity join remained present
without the stale pre-`nm` `capture-invalid` symptom. That was projection adoption at
that tip, not a new visual UX audit, and it is not the 2026-09-12 saved tip. Revision
r675 changed the Project snapshot and exposed the unanswered question on the planning
surface, but it could not create a whiteboard graph node while Thread remained r93. The
operation registry still has no pre-sizing-worksheet publication contract;
[F21](frictions.md#f21--pre-sizing-worksheets-have-no-registered-thread-publication-path-open-deferred)
records that deferred product boundary. The latest separate-profile browser interaction
audit remains project r591 / Thread r83; no later visual audit is claimed here. The
earlier project r583 / Thread r82 presentation established seven exact whole-App
bindings for the six modules and updated root while preserving all twenty-five prior
bindings; the registry contains thirty-two entries. Fresh root and Airframe App checks
verified their exact GLB digests, rendered canvases and passed Fit/zoom and read-only
network checks. Both canvases were visually inspected. The scripts, screenshots, hashes
and presentation-only limits are in the current rebuild ledger. Chromium's existing
unsupported `webrtc` CSP-directive warning remains. The Product tab remains removed as
requested; 3D stays on Project. The older r69 presentation ledger remains historical.
Source attachments may be `different-basis`; preserved captures and historical
admissions are not silently rewritten. Recross only through a registered surface when a
current authoring capture or closure requires it. That BFF declared the available v1
requirements-to-brief claim while retaining the original `TRACE GAP` separately. A fresh
separate-profile headless browser audit of project r591 / Thread r83 selected the native
camera-bracket requirement with no page errors and no non-GET API requests. It found the
exact brief-r3 `camera-bracket-bench-stress` source node in the Brief hull, its one
direct cable to the sole requirement, and no stand-alone retrospective-document wrapper
node on that hero surface. Requirement-to-source and source-to-requirement navigation
both worked; the source note stayed readable above restored viewers, and a planned-only
detached `PENDING` legend was absent without hiding the actual planned activity. This is
presentation QA only: it does not prove claim semantics, native-writer qualification,
requirement satisfaction, FEA, or provider runtime. The older literal `TRACE GAP`
remains separate historical provenance.

Current continuation split: Codex owns architecture, source checking, acceptance and
proportionate validation; native Grok handles bounded investigation or implementation;
Terra is used only for targeted cross-checks or a Grok blockage; Astra is reserved for
exceptional consultation and was not used in the current pre-sizing pass. Earlier
Astra-led work remains historical rather than being rewritten. The devFrame
reconstruction worker was stopped after the user clarified original design intent; its
downloaded reference files were preserved, never admitted as ID01 geometry. Grok had
completed the read-only diagnosis of the comment-qualification friction, then
implemented the bounded Product-navigation removal under Astra's historical review. No
engineering provider or admission behavior was changed. A later bounded
server-composition correction separated trusted SysON author and inspector connections,
with 34 targeted tests, type checking and a successful real
`model.capture-part-definitions@1` after controlled server adoption. No provider image
changed. Source publication is tracked separately from these local engineering and
presentation observations.

See the [observed friction journal](frictions.md); observations and potential
improvements are not automatically classified as product defects.
