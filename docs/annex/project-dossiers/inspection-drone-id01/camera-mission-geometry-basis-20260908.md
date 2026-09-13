# ID01 — camera-to-target geometry basis

Audience: both · Diátaxis: none · Kind: dated engineering basis

Observation **2026-09-08**, primary atelier, local. This is a source-backed, reversible
documentary calculation prepared by Codex against project r674 / Thread r93. It does not
change Project or Thread truth, approve proposed brief r5, select a camera, calibrate an
optical system, authorize a test, establish defect detectability or create a sensitivity
result.

## Current bounded result

The provisional candidate is the visible-light Raspberry Pi Camera Module 3 with the
**standard, normal field of view**: not Wide, not NoIR and not the standalone sensor
assembly. The official full-resolution dimensions and horizontal/vertical field angles
support one first-order lookup for a planar target normal to the optical axis.

At an optical distance of exactly `1.000 m`, the catalogue-angle model gives:

| Quantity                                 | Normalized result                    |
| ---------------------------------------- | ------------------------------------ |
| Target-plane footprint                   | `1.298815 m × 0.747769 m`            |
| Nominal horizontal object-plane sampling | `0.281861 mm/pixel` at `4608` pixels |
| Nominal vertical object-plane sampling   | `0.288491 mm/pixel` at `2592` pixels |

These values scale linearly with optical distance in this model. No ID01 stand-off,
capture mode, feature size, pixel criterion, overlap, speed or image acceptance rule is
selected. The table is therefore an image-scale lookup, not proof that the camera can
detect, recognize or measure an inspection feature.

## Official Camera Module 3 Standard facts

The
[Raspberry Pi Camera Module 3 product brief](https://datasheets.raspberrypi.com/camera/camera-module-3-product-brief.pdf),
published June 2024 and inspected 2026-09-08, supplies the specification on PDF page 3
and the variant table on PDF page 5. The
[official camera documentation](https://www.raspberrypi.com/documentation/accessories/camera.html#hardware-specifications),
also inspected 2026-09-08, supplies the corresponding hardware table.

| Field                         | Retained fact                                    | Use here                                                       |
| ----------------------------- | ------------------------------------------------ | -------------------------------------------------------------- |
| Sensor                        | Sony IMX708, `11.9 MP`                           | identity only                                                  |
| Published full resolution     | `4608 × 2592` pixels                             | sampling denominator for this lookup                           |
| Published field of view       | `66°` horizontal, `41°` vertical, `75°` diagonal | horizontal and vertical angles drive the footprint calculation |
| Focus                         | phase-detection autofocus; `10 cm–∞`             | catalogue range, not an installed-focus result                 |
| Focal length and focal ratio  | `4.74 mm`, `F1.8`                                | retained facts; not substituted for the published field angles |
| Standard visible-light filter | integrated IR-cut filter                         | distinguishes this candidate from NoIR                         |

The product page's headline `75°` is the **diagonal** field of view. It must not be used
as horizontal coverage. The Wide variant's `102°` horizontal, `67°` vertical, `120°`
diagonal and `5 cm–∞` focus range are different facts and do not describe the current
provisional Standard envelope.

The existing
[camera and propeller provenance](sources/camera-and-propeller-envelope-provenance.md#cameraboardenvelope)
owns the `25 × 24 × 11.5 mm` mechanical envelope. The
[mass closure worksheet](mass-and-position-closure-worksheet-20260908.md#purchased-and-installed-item-census)
owns the `4 g` module-only mass and its exclusions. Neither mechanical geometry nor mass
supplies an optical axis, calibrated field of view or installed image result.

## Calculation contract

Let:

- `d` be the distance in metres from the effective optical projection centre to a planar
  target normal to the optical axis;
- `α_H = 66°` and `α_V = 41°` be the published full-frame field angles;
- `N_H = 4608` and `N_V = 2592` be the published full-resolution pixel counts.

The first-order rectilinear/pinhole footprint is:

`W(d) = 2 d tan(α_H / 2)`

`H(d) = 2 d tan(α_V / 2)`

The nominal target-plane sample pitch is:

`s_H(d) = 1000 W(d) / N_H` in `mm/pixel`

`s_V(d) = 1000 H(d) / N_V` in `mm/pixel`

Substitution gives:

`W(d) = 1.298815186395 d m`

`H(d) = 0.747769358970 d m`

`s_H(d) = 0.281860934548 d mm/pixel`

`s_V(d) = 0.288491265035 d mm/pixel`

where `d` is entered numerically in metres. The horizontal and vertical coefficients
differ slightly because the published whole-degree field angles do not reproduce the
pixel aspect ratio exactly. They must not be averaged or presented as calibrated lens
data.

For a later human-approved smallest feature `L_min` in millimetres and required support
`n_min` in pixels, a necessary geometry-only condition would be:

`max(s_H(d), s_V(d)) ≤ L_min / n_min`

That inequality is deliberately symbolic. `L_min` and `n_min` do not exist yet in the
approved ID01 mission, and satisfying it would still not establish real feature
detectability.

## Human decisions and observations still required

Blank status means `unresolved`, never zero or an agent default.

| Input or criterion                   | Required form                                                                 | Current status |
| ------------------------------------ | ----------------------------------------------------------------------------- | -------------- |
| Inspection claim                     | target class plus `detect`, `recognize`, `measure` or another explicit verb   | `unresolved`   |
| Smallest relevant feature            | named feature and dimension with provenance                                   | `unresolved`   |
| Image-scale criterion                | maximum sample pitch or minimum pixels across that feature                    | `unresolved`   |
| Optical geometry                     | stand-off range, incidence range, sensor orientation and boresight convention | `unresolved`   |
| Capture configuration                | exact still/video mode, resolution, crop, compression and autofocus policy    | `unresolved`   |
| Motion and exposure                  | vehicle state, speed/dwell, exposure rule and permitted blur                  | `unresolved`   |
| Coverage policy                      | overlap, edge exclusion and revisit rule                                      | `unresolved`   |
| Photometric and environmental bounds | illumination, contrast, weather and image acceptance method                   | `unresolved`   |

The inspection claim, feature, image-scale criterion, optical geometry and capture
configuration are all needed to evaluate the lookup against a mission. Motion, coverage,
photometric and environmental bounds are then needed before that geometric screen
becomes a credible installed image-quality question. Once stand-off, overlap and target
coverage are known, the footprint can inform frame count, inspection path and dwell;
only then may those times and payload duties enter the
[mission sizing sheet](mission-sizing-decision-sheet-20260908.md) and energy
calculation.

## Model and evidence limits

| Limit                              | Consequence                                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Whole-degree catalogue angles      | no angular tolerance, distortion map, point principal or calibration uncertainty is available                 |
| Optical-distance origin            | distance from the PCB, lens face, airframe or rotor envelope is not automatically `d`                         |
| Oblique façade or roof view        | the footprint becomes non-uniform and local scale worsens toward the far side; no incidence is selected       |
| Capture mode or crop               | this lookup applies only when the published `4608 × 2592` full frame and its field angles are actually used   |
| Autofocus and depth of field       | catalogue focus range does not prove focus lock, edge sharpness or installed performance                      |
| Motion, vibration and rolling scan | geometric pitch does not bound motion blur, jitter, rolling-shutter distortion or rotor excitation            |
| Exposure and image processing      | RAW/HDR/JPEG/video processing, compression, noise, contrast and lighting can dominate usable detail           |
| Installed geometry                 | current CAD placement does not establish optical boresight, occlusion, propeller intrusion or gimbal pointing |
| Camera/GNSS interaction            | the documented GPS-L1 RFI risk remains an electrical/EMI verification input, not an optical closure           |

Raspberry Pi's documentation explains that its Global Shutter Camera is the distinct
module intended to minimize rolling-shutter motion distortion and contrasts it with the
other Camera Modules. For ID01, motion distortion therefore remains a measured
verification item; no shutter timing is assumed here.

## Proportionate verification handoff

1. **Documentary check:** preserve the exact camera variant, capture mode and source
   revision; recompute this lookup from the published facts.
2. **Static camera bench:** use a dimensioned planar target at measured optical distance
   and incidence, preserving original images and metadata. Observe usable field,
   sampling, focus, distortion and feature visibility against the later approved
   criterion.
3. **Installed ground check:** measure boresight, occlusion, autofocus behavior,
   exposure, vibration/jitter and camera/GNSS coexistence on the exact article.
4. **Progressive mission evidence:** only after the safety, site, operating and external
   authority gates in the
   [verification plan](verification-and-test-plan-20260908.md#g3g5--progressive-physical-evidence).

No test is queued or authorized here. A later physical record remains evidence of its
exact article, setup, conditions and protocol. It is not automatically stored as a
sensitivity result; `verify.evaluate-sensitivity-base@1` is a separate explicit
registered evaluation over its admitted sensitivity basis.

## Review boundary

Three bounded native Grok 4.6 tasks independently inspected official specifications, the
geometry arithmetic and the smallest dossier integration. Codex reopened the official
Raspberry Pi brief and documentation, recalculated every retained coefficient and
accepted one manufacturer-angle model only. It rejected additional example distances and
a competing focal-length model because neither was needed for the current decision. The
known F14 optional-plugin and intermittent Grok web-fetch noise recurred; no answer from
a failed fetch was accepted and no global configuration was changed. A fourth bounded
read-only diff reviewer recalculated the coefficients and began its source and anchor
checks, but was stopped after it ceased progressing without a final verdict. Its partial
stream is not accepted as review evidence.

No Project/Thread mutation, provider call, camera selection, mission number, physical
test, sensitivity operation, Astra consultation or Terra reinforcement occurred.
