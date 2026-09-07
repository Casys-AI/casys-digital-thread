# ID01 root placement - bounded nested-module canary

Astra proposal, 2026-09-06 UTC / 2026-09-07 Asia/Taipei. The operator explicitly
authorized establishing and executing the bounded nested-module qualification route in
the paired chat. This is a static integration layout proposal, not a physically fastened
or flight-ready drone. It supersedes the unexecuted initial root sketch in
`placement-provenance.md` without rewriting that historical source.

The six immediate usage/definition pairs were reread through `project_product_explore`
at Thread r65 and architecture
`architecture-034ecfca0553b1c1baadcfd92572ce111310fe8ac0511cfb1a8561b7db50dbba`. The
server, not this source, resolves their six current canonical module captures. The root
placement file contains only the exact usage/definition IDs and captured transforms.
Each module retains its own leaf geometry and placement lineage.

## Original reversible layout

Units are mm. The captured convention is `right-handed-mm-extrinsic-xyz-degrees`; the
registered observer recrosses translation after `Rx * Ry * Rz`. The two 180-degree
camera rotations commute in this specific case and yield `diag(-1,+1,-1)`. Front is -Y,
right is +X. All numbers below are original packaging hypotheses or algebraic
consequences of previously captured source dimensions, not measured facts.

| Module           | Translation | Rotation XYZ degrees | Intended contact and remaining gap                                                                                          |
| ---------------- | ----------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Airframe         | (0,0,50)    | (0,0,45)             | Deck underside z50, top z53; arm tops z58. Existing nominal arm/deck hole alignment remains; no fasteners or strength proof |
| PropulsionSystem | (0,0,58)    | (0,0,45)             | Motor envelopes begin at arm-top height. Real motor mounting face, bolts, shaft and propeller interface are not represented |
| FlightAvionics   | (0,0,58)    | (0,0,0)              | Carrier bottom meets arm tops. Carrier holes, board fastening, vibration isolation and cable access remain absent           |
| ElectricalPower  | (0,10,15)   | (0,0,0)              | Tray wall tops meet deck underside at z50; attachment flanges, retention and real battery choice remain absent              |
| LandingGear      | (0,0,6)     | (0,0,0)              | Existing legs top out at z50; no deck/leg holes or fasteners yet                                                            |
| CameraPayload    | (0,-36,50)  | (180,0,180)          | Bracket base lies below deck at z47..50; no matching deck holes or fastening yet                                            |

Unlike the rejected initial camera location, the bracket base is now on the intended
deck mounting face. Its root-frame footprint is x[-17.5,17.5], y[-51,-21]. The rotated
100 mm square deck satisfies `abs(x)+abs(y) <= 50*sqrt(2)`; the footprint maximum is
68.5 mm, below approximately 70.711 mm. The two bracket base-hole axes are root
(+/-10,-43.5); future deck-local counterparts are approximately (-23.688,-37.830) and
(-37.830,-23.688), obtained by inverse 45-degree rotation, not by label matching. The
existing deck has neither of those holes.

The bracket bottom is z15, compared with the skid lower plane z6: 9 mm nominal geometric
separation, not a ground-clearance requirement or landing result. The camera envelope
spans y[-36.5,-25], z[18,42]; the bracket upright spans y[-24,-21], z[15,50]. Their
existing 1 mm nominal separation remains an unmodeled spacer/attachment gap. The power
tray footprint spans x[-22,22], y[-10,30], leaving 11 mm nominal Y separation from the
camera bracket footprint. Cables and installed connectors are not included.

## Evidence boundary and next integration work

This canary is intended to test nested canonical STEP consumption, exact occurrence
placement, neutral receipt lineage and canonical sealing through existing operations.
Actual run/capture identities belong in the subsequent runtime ledger, not in this
proposal. Source tests cover transitive archival separately; no automatic rebuild is
claimed. Coverage remains unpromoted until the complete qualification route passes.

Next physical-interface work must explicitly represent matching holes, contact features
or connectors before claiming them. The camera/deck, tray/deck, carrier/frame,
landing/deck, motor/arm and electronics attachments remain review items. No contact in
this table proves a joint, preload, tolerance, load transfer or retention. Purchased
parts remain candidate envelopes; the battery remains a reserved volume; the propeller
remains a non-aerodynamic static proxy. The earlier ideal-clamp bracket FEA does not
validate this mounting orientation or its load path. No make/buy, material selection for
fabrication, flight or certification decision is made here.
