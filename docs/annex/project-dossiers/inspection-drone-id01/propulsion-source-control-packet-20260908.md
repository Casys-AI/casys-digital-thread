# ID01 — propulsion source-control packet

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-08**, primary atelier, local. This packet controls the web-source
basis for the two current propulsion leads against project r674 / Thread r93. It does
not approve proposed brief r5, select hardware, change CAD, queue an operation, request
supplier action or establish flight readiness.

## Outcome

Neither propulsion lead is closed enough to select. The source review nevertheless makes
two useful advances:

- the official F1404 drawing now supplies a candidate motor-base topology, but it also
  proves that the `1.5 mm` versus `2 mm` shaft discrepancy exists inside the LIGPOWER
  product packet itself; and
- the official T3140 product card supplies diameter, pitch, blade count, catalogue mass,
  mounting-hole diameter and hub thickness. Together with the F1507 drawing and packing
  list, it exposes a coherent **nominal** M5 propeller-retention chain. Exact bench
  revision, tolerances, inertia, rotation-hand pairing and the conflicting 100%
  operating limit remain unresolved; and
- the F1507 matching guide names Mini F45A 4-in-1 and F7 35A AIO controller leads, but
  the eleven-row bench table identifies neither as its tested ESC. These are controlled
  catalogue leads, not a reconstructed bench configuration.

The resulting disposition is:

| Candidate               | Documentary state                           | What is now usable                                                                                                            | What still prevents selection                                                                                                                         |
| ----------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1404 KV4600 + `GF3016` | **HOLD — external source closure**          | motor envelope; cable-inclusive catalogue mass; exact bench rows; candidate base drawing                                      | `GF3016` maker/SKU/revision and mounting variant; contradictory shaft diameter; comparable installed map                                              |
| F1507 KV3800 + T3140    | **HOLD — narrower external source closure** | motor and propeller catalogue geometry/masses; exact-name bench rows; nominal M5 retention chain; two named ESC/control leads | controlled bench-to-product revision; fit/tolerance and rotation pairing; inertia; 100% row versus 60-second ratings; exact bench ESC/settings/supply |

`P-F1507` is therefore the better documented supplier-follow-up lead. That ordering is
not a hardware recommendation or selection.

## Source register

All pages and linked assets below were read on 2026-09-08. Direct-image SHA-256 values
fingerprint the bytes inspected by Codex; they are not a claim that the mutable web
pages will remain unchanged. No supplier image is copied into the repository.

| Source layer                         | Official URL                                                                          | Controlled observation                                                                     |
| ------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| F1404 product and KV4600 bench       | [LIGPOWER F1404 KV4600](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html) | variant table, cable-inclusive mass, electrical ratings and rows labelled `GF3016`         |
| F1404 mechanical drawing             | [official image](https://www.ligpower.com/images/202408/091723192759157166.jpg)       | SHA-256 `a5302d0a54590f249c1950563fe6a4454a69940795e1da37a723c2760c6b6820`                 |
| F1404 official-store cross-check     | [T-Hobby F1404](https://www.t-hobby.com/products/micro-fpv-drones-brushless-motor)    | same named family; text says `1.5 mm` shaft while a linked specification image says `2 mm` |
| Separate 3016 candidate, not joined  | [Gemfan Hurricane 3016](https://www.gemfanhobby.com/3016-hurricane-pc-3-blade.html)   | product facts only; no controlled `GF3016` ↔ Gemfan cross-reference                        |
| F1507 product and KV3800/T3140 bench | [LIGPOWER F1507 KV3800](https://www.ligpower.com/product/f1507-kv3800-fpv-motor.html) | motor table, packing list, electrical ratings and exact-name T3140 rows                    |
| F1507 mechanical drawing             | [official image](https://www.ligpower.com/images/202408/091723192900674709.jpg)       | SHA-256 `307f3ad9f9d2e7fe88c3cabd1316e2163c9ca3b84c8ce5d2bcd69f0f830b60cf`                 |
| T3140 product                        | [LIGPOWER T3140](https://www.ligpower.com/product/t3140-fpv-propeller.html)           | exact product name and linked specification image                                          |
| T3140 specification image            | [official image](https://www.ligpower.com/images/202506/T3140_en_4.jpg)               | SHA-256 `7cafd46e578e5d0dad20b553afffca0f9c072225b5f9b1d2807103f5015bf75e`                 |
| T3140 catalogue row                  | [LIGPOWER propeller catalogue](https://www.ligpower.com/categorys/drone-propellers)   | `3.1 in`, `4 in`, polymer, three blades and `2 g` in the Racing Series table               |
| T3140 official-store cross-check     | [T-Hobby T3140](https://www.t-hobby.com/products/t3140)                               | tri-blade, `5 mm center hub`, four-piece pack naming and colour variants                   |
| F1507 Mini F45A guide lead           | [LIGPOWER Mini F45A](https://www.ligpower.com/product/mini-f45a-4in1-fpv-esc.html)    | matching-guide identity; product text says AM32 and named control protocols                |
| Mini F45A official catalogue         | [LIGPOWER FPV ESC catalogue](https://www.ligpower.com/categorys/fpv-esc)              | 45 A, 3–6S, `9.2 g` and BLHeli_32; firmware conflicts with its product-page text           |
| F1507 F7 35A AIO guide lead          | [LIGPOWER F7 35A AIO](https://www.ligpower.com/product/f7-35a-aio-stack.html)         | matching-guide identity; combined flight-controller/four-channel-ESC architecture lead     |
| F7 35A AIO official catalogue        | [LIGPOWER FPV parts catalogue](https://www.ligpower.com/categorys/fpv-drone-parts)    | 35/40 A, 3–6S and 25.5 × 25.5 mounting; burst duration is not stated                       |

## F1404 KV4600 interface state

The product table reports a `17.9 × 16.6 mm` motor, `9.34 g` including its 150 mm 24 AWG
cable, and a `2 mm` shaft for KV4600. The official drawing shows the same outer envelope
and, on the candidate motor base, four M2 holes on a diameter-9 construction circle.
Pitch, tolerance and usable thread depth are not stated.

The drawing labels the projecting shaft `Ø1.5`, not `Ø2`. The T-Hobby page also mixes
those two values between its text and linked specification image. The source conflict
therefore cannot be resolved by choosing the storefront that gives the preferred number.
The drawing can narrow the **motor-to-arm** topology, but it cannot authorize a source
or CAD successor while the candidate is unselected and its thread engagement is unknown.

The bench column remains labelled only `GF3016`. No inspected LIGPOWER, T-Hobby or
Gemfan page provides a controlled maker/SKU/revision join for that label. The live
Gemfan 3016 page and its catalogue also expose more than one hole/pitch presentation.
Those facts are useful supplier-search leads only: they do not identify the LIGPOWER
bench specimen. F1404 propeller identity and the complete motor–propeller mating
interface remain `unresolved`.

## F1507 KV3800 + T3140 interface state

### Motor and bench facts

For KV3800, the official F1507 page reports `18.9 × 29.7 mm`, `15 g` including its 100
mm cable, `2 mm` shaft, 3–4S LiPo, `23 A` peak for 60 seconds and `372 W` maximum for 60
seconds. Its table literally pairs that variant with `T3140 Tri-Blade`.

The official drawing adds:

- four `M2 × 0.4` motor-base holes on a `Ø12 mm` pitch circle;
- a front propeller adapter labelled `M5 × 0.8` and `Ø5 mm`;
- a rear/internal shaft labelled `Ø2 mm`; and
- `18.9 mm` body diameter and `29.7 mm` overall axial extent.

The packing list includes an M5 self-locking nut. This distinguishes the `2 mm` motor
shaft from the M5 propeller-retention interface; they must not be treated as competing
diameters for the same mating surface.

### Propeller facts

The official T3140 specification image and catalogue row report:

| Field                | Source value        | Documentary treatment                                                                        |
| -------------------- | ------------------- | -------------------------------------------------------------------------------------------- |
| Product class/title  | `3-inch`            | class label only                                                                             |
| Diameter/size        | `3.1 in = 78.74 mm` | dimensional candidate datum                                                                  |
| Pitch                | `4.0 in`            | catalogue candidate datum, not an aerodynamic model                                          |
| Blade count          | `3`                 | agrees with the F1507 bench label `Tri-Blade`                                                |
| Material             | polymer             | catalogue material label, not a strength or balance certificate                              |
| Weight               | `2 g`               | catalogue item datum; four-item arithmetic is conditionally `8 g`, before retention hardware |
| Mounting hole        | `5 mm`              | nominally corresponds to the F1507 drawing's `Ø5` / M5 adapter                               |
| Centre-hub thickness | `6 mm`              | packaging datum only                                                                         |

The product title's `3-inch` language is retained as a class label; the `3.1 in`
specification controls candidate packaging arithmetic. No product name is decoded to
invent either value.

The `Ø5 mm` / M5 adapter, `5 mm` propeller hole and M5 locknut form a coherent nominal
retention chain. They are still not an assembly qualification: the sources provide no
fit/tolerance stack, seating-face definition, tightening torque, usable thread
engagement, balance requirement, inertia, CW/CCW allocation or controlled statement that
the current product revision is the exact bench specimen.

### ESC guide and bench-identity boundary

The F1507 product page separates three different kinds of information:

- its `Relevant Products` card links the individual F35A;
- its `Matching Guide` names the Mini F45A 6S 4-in-1 ESC and F7 35A AIO, together with
  an M12199 propeller; and
- its KV3800 bench table separately names T3140 but provides no ESC, firmware, control
  protocol, PWM frequency, timing, voltage-source identity or duration for the 50–95%
  rows. The one-minute note applies only to the 100% temperature observation.

The guide therefore provides two new candidate identities, not the missing join to the
bench setup:

| ESC/control lead    | Official catalogue facts usable now                                                                                                                             | Boundary that remains                                                                                                                            |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| F35A individual ×4  | related product only; 35 A continuous, 45 A peak for 10 s, 3–6S, no BEC, `4.3 g` each                                                                           | not a matching-guide or bench identity; product text and official media disagree on AM32 versus BLHeli_32                                        |
| Mini F45A 4-in-1 ×1 | matching-guide lead; 45 A catalogue current, 55 A peak with no published duration, 3–6S, no BEC, `9.2 g`; product text names AM32 and DShot/ProShot/Oneshot/PWM | catalogue says BLHeli_32; board envelope, exact SKU/revision, combined-board current/thermal limits and bench settings remain unresolved         |
| F7 35A AIO ×1       | matching-guide lead; catalogue gives 35/40 A, 3–6S and 25.5 × 25.5 mounting                                                                                     | peak duration, exact SKU/revision, full envelope/mass, bench settings and compatibility with the separate Pixhawk architecture remain unresolved |

All eleven T3140 row currents are below the 35 A and 45 A per-channel catalogue labels.
At the reported 100% row, the arithmetic margins are `35 − 25.87 = 9.13 A` and
`45 − 25.87 = 19.13 A`. Those margins do not establish four-channel board input-current
capacity, switching loss, cooling, firmware compatibility or a permitted motor point;
the same row still conflicts with the motor's own 23 A / 372 W 60-second labels.

### Existing CAD consequences

The current `MotorEnvelope` is `17.9 × 16.6 mm`; it cannot contain the F1507's
`18.9 × 29.7 mm` catalogue envelope. The current static propeller proxy is `3.0 in`
diameter (`76.2 mm`), so it under-represents the T3140 product datum by `2.54 mm` in
diameter and `1.27 mm` in radius.

Using only the current 100 mm cardinal motor-centre placement and the `78.74 mm` T3140
diameter gives this reversible nominal screen:

| Screen                           | Calculation            |          Result |
| -------------------------------- | ---------------------- | --------------: |
| Adjacent centre distance         | `sqrt(100² + 100²)`    | `141.421356 mm` |
| Adjacent disc-edge gap           | `141.421356 − 78.74`   |  `62.681356 mm` |
| Opposite disc-edge gap           | `200 − 78.74`          |     `121.26 mm` |
| Radial disc-to-deck-planform gap | `100 − 78.74 / 2 − 50` |      `10.63 mm` |

All three nominal gaps remain positive, but the screen excludes tolerances, blade shape,
deformation, motor-axis error, nearby components, guards and rotation. It does not
justify a CAD change or dynamic-clearance claim.

### Operating-limit conflict

The retained 100% T3140 row reports `25.87 A` and `391.57 W` after a one-minute run.
Those values exceed the same page's 60-second labels by `2.87 A` and `19.57 W`. The row
remains a source observation, not a permitted design point. The 50% row remains only a
first documented table point, not hover.

The
[pre-sizing basis](propulsion-energy-presizing-basis-20260908.md#alternative-exact-name-bench-lead--f1507-kv3800-with-t3140)
now retains all eleven exact 50–100% T3140 rows as an exact source lookup. It does not
interpolate or compare same-percentage F1404/F1507 points as equivalent operating
conditions.

## Bounded alternative-pair search — no new 3-inch card

A later read-only search covered official LIGPOWER/T-Hobby, iFlight, BETAFPV, GEPRC,
HGLRC, Flywoo, EMAX, HQProp and Gemfan pages. No additional pairing satisfied all four
conditions together: motor body within `17.9 × 16.6 mm`, approximately 3-inch propeller
within the current `76.2 mm` proxy, an exact joined motor/propeller identity, and an
official thrust/current/power map at a named voltage. This is a bounded search result,
not proof that no such product exists.

The closest better-joined source was iFlight's product family: the official
[Defender 25 assembly page](https://shop.iflight.com/Defender25-4S-HD-RTF-Pro1928) names
its Defender25 1404 motor and Defender25 2525 propeller together. The separate
[Defender 25 1404 4150KV motor](https://shop.iflight.com/Defender-25-Motor-4PCS-Pro1930)
page supplies an official test-report image; the separate
[Defender 2525-3 propeller](https://shop.iflight.com/Defender-25-Prop-Set-Pro1934) page
controls the named propeller's product dimensions. The published `17.7 × 14.3 mm` motor
body fits the current motor envelope nominally, but the exact propeller is
`2.5 in = 63.5 mm`, not the approximately 3-inch class being screened. The motor page
also states a `1.8 mm` shaft while the propeller page lists `1.9/1.5 mm`; the bench ESC
and test duration remain unstated. It is therefore recorded only as an out-of-class
search boundary, not a candidate card or an instruction to shrink the propeller proxy.

The result strengthens the current ordering rather than adding an option: seek the small
F17 supplier packet for the envelope-compatible F1404 lead, or deliberately reopen the
propeller-class requirement later. Neither choice is made here.

## Prepared supplier clarification packet — not sent

The smallest useful request is:

1. For F1404 KV4600, identify the controlled motor revision and confirm whether the
   propeller shaft is `1.5 mm` or `2 mm`; provide shaft tolerance/usable length and the
   base-hole pitch, depth and tolerance.
2. Identify the exact `GF3016` bench specimen by maker, SKU, revision, diameter, pitch,
   blade count, rotation pair and mounting variant; provide the mating drawing used on
   F1404 KV4600.
3. For F1507 KV3800, confirm whether the current T3140 SKU/revision is the specimen used
   in the published table and provide the controlled motor–adapter–propeller stack,
   tolerances, seating, thread engagement and tightening requirement.
4. Reconcile the KV3800 + T3140 100% one-minute row with the `23 A / 372 W` 60-second
   ratings; state the permitted continuous and transient current, power, winding and
   surface-temperature limits and their test conditions.
5. Provide T3140 revision, per-prop mass tolerance, inertia, balance grade, CW/CCW
   allocation and any installation restrictions, plus the exact tested ESC SKU/revision,
   firmware/protocol, PWM and timing configuration, voltage-source identity and duration
   of every bench plateau.

No recipient, email, ticket or supplier message has been created. External contact
requires a separate human decision and exact-message review.

## Friction disposition and next boundary

The stale T3140 unknowns and under-read drawings are documentation quick wins and are
corrected in the linked ID01 notes. The missing supplier revisions, source
contradictions and physical tolerances remain external-evidence frictions F17/F18. The
global Grok plugin startup noise remains F14 and is not changed inside this repository.
No generic propulsion solver is added: F13 remains deferred until a selected source
packet exposes one bounded unsupported calculation.

The next valid G0.4 action is human review of the two candidate cards and, if desired,
authorization to send the prepared clarification packet for the preferred follow-up
lead. In parallel, G0.1 mission quantities and G0.2 installed-item decisions can be
closed without pretending that either candidate is selected.

## Review boundary

Four bounded native Grok 4.6 read-only audits separately checked F1404, T3140, `GF3016`,
and the F1507/T3140 packet. All completed; their recurring unrelated global
plugin-startup warnings remain workflow friction rather than engineering evidence. Codex
independently reopened the official pages, downloaded and visually inspected the three
official drawings/specification images, verified their SHA-256 values, recomputed the
dimensional and electrical arithmetic, and accepted only the bounded statements above.
Two later Grok read-only audits checked the full F1507 table and its comparison
boundary; Codex accepted the exact-row expansion but not an inter-type ranking. No Terra
or Astra escalation, provider execution, CAD edit, Project/Thread mutation or broad test
campaign occurred. A later bounded Grok audit separated the F1507 matching-guide cards
from the unnamed bench ESC; Codex independently reopened the official motor, ESC and
catalogue pages before accepting that distinction. One final bounded Grok search tested
alternative exact 3-inch pairings; Codex reopened the closest iFlight product pages and
retained only the negative search boundary above.
