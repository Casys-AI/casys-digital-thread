# ID01 — propulsion and energy pre-sizing basis

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-08**, primary atelier, local. This document is a reversible,
documentary calculation basis prepared by Codex. It does not replace Project or Thread
truth, approve a component, authorize an operation, or establish flight readiness.

## Status and outcome

The live control plane is at project r674 / Thread r93. Question
`propulsion-energy-presizing-priority-r1` has a human-sourced answer selecting
`presize-before-simulations`. Proposed brief r5,
`inspection-drone-id01:brief:r5:7180b5c1fe7eef09`, is still **pending**; approved brief
r4 remains current.

No whole-vehicle thrust, power, current, endurance, centre-of-gravity or
operational-load result can yet be reported. The current evidence does not provide a
quantified mission, a complete mass inventory, a selected motor/propeller/ESC/battery
set, or comparable operating curves. Those states remain `unresolved`; the CAD envelopes
and the 5 N RadialArm bench case are not substituted for them.

The later
[propulsion source-control packet](propulsion-source-control-packet-20260908.md) reopens
the official motor drawings and T3140 product specification. It narrows several
interfaces below without selecting a candidate or changing Project/Thread truth.

## Evidence classes

| Class                   | Current evidence                                                                                                    | Permitted use                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Human intent            | Civil exterior camera inspection; pre-size propulsion and energy before another solver demonstration                | Orders the next work, without selecting hardware or a performance number |
| Project observation     | Four motor occurrences; one coarse motor envelope; a static 3-inch-class propeller proxy; a battery reserved volume | Defines architecture and packaging questions only                        |
| Primary external source | Official motor/bench, ESC, battery and auxiliary-component pages inspected 2026-09-08                               | Candidate facts, with variant and source caveats retained                |
| Calculated              | Unit conversions, current/energy/mass sums, source-derived structural volumes and equations below                   | Reproducible consequences of named inputs only                           |
| Assumption              | None accepted yet for the vehicle sizing                                                                            | Any future provisional value needs an owner and review trigger           |

The solid `MotorEnvelope` is not a motor mass model. The `StaticPropellerEnvelope` has
no airfoil, pitch, twist, hub interface or rotation. The `BatteryReservedVolume` is not
a cell chemistry, capacity, current rating or usable energy value.

## Candidate source observation — F1404 KV4600 with GF3016

The [manufacturer page](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html)
lists several F1404 variants. For **KV4600** it reports 9.34 g including cable, diameter
17.9 mm by height 16.6 mm, 138 mΩ internal resistance, 2 mm shaft, 3–4S LiPo, 0.6 A idle
current at 10 V, 20 A peak current for 60 s, and 316 W maximum power for 60 s. These are
catalogue facts, not an ID01 selection or compatibility proof.

The same product packet's
[official mechanical drawing](https://www.ligpower.com/images/202408/091723192759157166.jpg)
instead labels the projecting shaft `Ø1.5`. It also depicts four M2 motor-base holes on
a diameter-9 construction circle, without giving pitch, tolerance or usable thread
depth. The base topology can now be retained as a candidate drawing fact; the shaft
diameter cannot be chosen from the contradictory table and drawing.

Two rows from the same manufacturer's KV4600 + **GF3016** bench table are retained as a
minimal traceable bracket:

| Throttle label |    Thrust | Voltage | Current |      Speed | Reported power | Efficiency |
| -------------- | --------: | ------: | ------: | ---------: | -------------: | ---------: |
| 50%            | 184.21 gf | 15.93 V |  5.23 A | 26,532 rpm |        83.28 W |  2.21 gf/W |
| 100%           | 344.73 gf | 15.64 V | 17.54 A | 40,053 rpm |       274.32 W |  1.26 gf/W |

The source labels thrust and efficiency with `g`; here it is qualified as gram-force
(`gf`), not component mass. With standard gravity it corresponds to 1.806482996 N and
3.380646454 N for the two retained thrust rows; those conversions remain bench-point
observations, not a four-rotor vehicle capability.

The table names an 8 °C ambient condition and reports 50 °C motor-surface temperature
after the 100% one-minute run. The manufacturer says its bench data are for reference
only and discourages comparison across motor types. `V × I` gives 83.3139 W and 274.3256
W for the two rows; the small differences from the reported values are consistent with
display rounding, not an independent validation.

If, and only if, four exact KV4600 motors were later selected, their catalogue mass
would sum to `4 × 9.34 g = 37.36 g` before propellers, fasteners, connectors or ESCs.
That conditional sum is not part of an approved mass budget.

The test label `GF3016` is not accompanied by an exact propeller part reference on the
LIGPOWER page. The official
[Gemfan Hurricane 3016 page](https://www.gemfanhobby.com/3016-hurricane-pc-3-blade.html)
reports a 76.49 mm diameter, 1.6 inch pitch, 1.18 g mass, 5.5 mm hub thickness,
three-hole mounting and recommended 1108–1303 motor classes, which do not include 1404.
Its leading specification block says `1.5 mm, 2 mm, 3-hole design`, while its detailed
table says only `1.5 mm, 3-hole design`. The LIGPOWER page specifies a 2 mm shaft for
F1404 KV4600, while its own mechanical drawing and the official
[T-Hobby store page for the same named variant](https://www.t-hobby.com/products/micro-fpv-drones-brushless-motor)
specify 1.5 mm; a T-Hobby specification image repeats 2 mm. The bench proves only that
something labelled `GF3016` was tested with the named motor; it does not resolve those
conflicting shaft data or identify the same Gemfan maker, SKU, revision and mounting
variant. Both **propeller identity** and the complete **mating interface** therefore
remain `unresolved`. The smallest closing supplier packet is a written cross-reference
from `GF3016` to its exact maker, SKU/revision, diameter, pitch, blade count and
mounting variant, plus a controlled motor/propeller interface drawing and clarification
of the 1.5-versus-2 mm shaft datum. If the 76.49 mm Gemfan diameter were later proven to
be the tested part, the same nominal layout would give 64.931356 mm between adjacent
discs and 11.755 mm radially to the deck planform.

### Related-product ESC screen — F35A

The [F35A manufacturer page](https://www.ligpower.com/product/f35a-fpv-esc.html) is
linked from the motor page as a related product. Its official specification image gives
3–6S LiPo, 35 A continuous, 45 A peak for 10 s, no BEC, 4.3 g and 29 × 17 × 5 mm for the
individual ESC. Four units would therefore add `4 × 4.3 = 17.2 g`. A 4S candidate is
inside the stated voltage range, and the 35 A continuous nameplate exceeds both the
motor's 20 A peak label and its 17.54 A current at the retained 100% bench row. This is
only a per-channel catalogue screen: it does not prove motor–ESC pairing, thermal
acceptability, cooling, installation, wiring, efficiency or operation at every point in
the motor table.

The same official page text advertises AM32 and DShot1200/600/300, while official
product images and the linked user manual label the unit BLHeli_32. That literal
firmware contradiction remains unresolved. `BEC: No` also means the F35A does not close
the separate regulated supply required by the autopilot, companion computer, camera and
other auxiliaries. A related-product link is not an ID01 component selection.

### F1507 matching-guide leads are not bench identity

The
[F1507 manufacturer page](https://www.ligpower.com/product/f1507-kv3800-fpv-motor.html)
names a Mini F45A 6S 4-in-1 ESC and an F7 35A AIO in its `Matching Guide`. That is
stronger than the F35A `Relevant Products` card, but the page never states that either
guide item produced the T3140 table. The table gives no ESC identity, voltage-source
identity, firmware, protocol, PWM, timing or plateau duration below its separate
one-minute 100% temperature note.

The
[Mini F45A product page](https://www.ligpower.com/product/mini-f45a-4in1-fpv-esc.html)
names AM32 and DShot150/300/600, ProShot1000, Oneshot and PWM. LIGPOWER's
[official FPV ESC catalogue](https://www.ligpower.com/categorys/fpv-esc) instead lists
the same named card as 45 A, 3–6S, 9.2 g and BLHeli_32; its broader
[ESC catalogue](https://www.ligpower.com/categorys/drone-esc) adds 55 A peak without a
duration and `BEC: No`. The firmware conflict and missing peak duration remain literal.

The [F7 35A AIO page](https://www.ligpower.com/product/f7-35a-aio-stack.html) is a
combined flight-controller/four-channel-ESC lead. The
[official FPV parts catalogue](https://www.ligpower.com/categorys/fpv-drone-parts) lists
35/40 A, 3–6S and 25.5 × 25.5 mounting, but no peak duration. It cannot be silently
added to the separate Pixhawk-plus-ESC architecture.

At the 25.87 A T3140 endpoint, the per-channel catalogue margins are `9.13 A` for a 35 A
label and `19.13 A` for a 45 A label. Every exact row is below both labels. This is only
a nameplate screen: it proves neither shared-board input capacity, cooling and switching
loss nor the missing bench pairing, and it does not cure the motor's own 23 A / 372 W
60-second conflict.

## Calculated exact-row four-motor envelope

The complete KV4600 + GF3016 table permits a deterministic arithmetic screen without
interpolation. For each exact manufacturer row below:

- equivalent supported mass at static thrust balance is
  `m_equivalent = 4 × T_motor,gf / 1000`;
- summed motor current is `I_4motors = 4 × I_motor`;
- summed reported motor power is `P_4motors = 4 × P_motor,reported`.

| Manufacturer throttle label | Thrust per motor | Bench voltage | Equivalent supported mass | Four-motor current | Four-motor reported power |
| --------------------------: | ---------------: | ------------: | ------------------------: | -----------------: | ------------------------: |
|                         50% |        184.21 gf |       15.93 V |                0.73684 kg |            20.92 A |                  333.12 W |
|                         55% |        210.22 gf |       15.91 V |                0.84088 kg |            25.48 A |                  405.04 W |
|                         60% |        233.36 gf |       15.88 V |                0.93344 kg |            30.56 A |                  485.60 W |
|                         65% |        254.72 gf |       15.85 V |                1.01888 kg |            35.40 A |                  561.12 W |
|                         70% |        268.50 gf |       15.84 V |                1.07400 kg |            40.04 A |                  633.96 W |
|                         75% |        287.60 gf |       15.81 V |                1.15040 kg |            45.28 A |                  715.80 W |
|                         80% |        300.59 gf |       15.78 V |                1.20236 kg |            50.00 A |                  789.28 W |
|                         85% |        316.02 gf |       15.75 V |                1.26408 kg |            54.80 A |                  863.32 W |
|                         90% |        330.89 gf |       15.71 V |                1.32356 kg |            59.92 A |                  941.64 W |
|                         95% |        340.24 gf |       15.68 V |                1.36096 kg |            64.96 A |                 1018.16 W |
|                        100% |        344.73 gf |       15.64 V |                1.37892 kg |            70.16 A |                 1097.28 W |

These are calculated consequences of four identical candidate motors operating at the
same static bench row. They do not establish an ID01 hover point: vehicle mass and load
sharing are unresolved, and the calculation excludes ESC losses, battery sag,
auxiliaries, rotor–vehicle interaction, dynamic inflow, reserve and thrust margin. The
manufacturer throttle label is not an ID01 flight-controller command. The 100% row also
retains the source's one-minute test context and is not treated as continuous operation.

This table also exposes its own coverage boundary. A closed all-up mass below 0.73684 kg
would place symmetric static balance below the first reported row; a mass between two
listed values would require an explicitly justified interpolation or new bench data; a
mass above 1.37892 kg would exceed the four-motor maximum reported static thrust under
these exact bench conditions. None of the lower cases proves suitability, because a
propulsion margin and continuous thermal/electrical operating limits are still required.
The current partial mass ledger is too incomplete to place ID01 in any one of these
cases.

## Alternative exact-name bench lead — F1507 KV3800 with T3140

The official
[F1507 manufacturer page](https://www.ligpower.com/product/f1507-kv3800-fpv-motor.html)
contains a table literally pairing **F1507 KV3800** with **T3140 Tri-Blade**. The same
official product family exposes a separate
[LIGPOWER T3140 page](https://www.ligpower.com/product/t3140-fpv-propeller.html), while
the [T-Hobby store page](https://www.t-hobby.com/products/t3140) repeats the tri-blade
name and `5 mm center hub` wording. This exact shared name is a stronger identity lead
than decoding `GF3016`, but it is still not a controlled bench-to-product revision or
complete physical-interface proof.

For KV3800, the motor page reports 15 g including 100 mm 24 AWG cable, 18.9 mm diameter
× 29.7 mm height, 81 mΩ internal resistance, 2 mm shaft, 3–4S LiPo, 0.9 A idle current
at 5 V, 23 A peak current for 60 s and 372 W maximum power for 60 s. The current ID01
`MotorEnvelope` is only 17.9 mm diameter × 16.6 mm height, so it does not contain this
alternative. Four catalogue motors would total `4 × 15 = 60 g`, which is 22.64 g above
the four-motor F1404 candidate sum before propellers, attachment or any required CAD
successor.

The complete exact T3140 table is retained as a bounded, exact-row source lookup:

| Throttle label | Thrust per motor | Voltage | Current per motor |      Speed | Reported efficiency | Four-motor equivalent supported mass | Four-motor current | Four-motor reported power |
| -------------- | ---------------: | ------: | ----------------: | ---------: | ------------------: | -----------------------------------: | -----------------: | ------------------------: |
| 50%            |        238.15 gf | 15.36 V |            6.16 A | 24,742 rpm |           2.52 gf/W |                           0.95260 kg |            24.64 A |                  378.28 W |
| 55%            |        274.91 gf | 15.32 V |            7.52 A | 26,270 rpm |           2.39 gf/W |                           1.09964 kg |            30.08 A |                  460.56 W |
| 60%            |        309.43 gf | 15.28 V |            8.86 A | 28,161 rpm |           2.29 gf/W |                           1.23772 kg |            35.44 A |                  541.16 W |
| 65%            |        351.90 gf | 15.51 V |           10.50 A | 30,122 rpm |           2.16 gf/W |                           1.40760 kg |            42.00 A |                  651.32 W |
| 70%            |        394.52 gf | 15.58 V |           12.07 A | 31,605 rpm |           2.10 gf/W |                           1.57808 kg |            48.28 A |                  752.28 W |
| 75%            |        447.79 gf | 15.58 V |           14.28 A | 33,458 rpm |           2.01 gf/W |                           1.79116 kg |            57.12 A |                  890.16 W |
| 80%            |        468.07 gf | 15.54 V |           15.34 A | 34,305 rpm |           1.96 gf/W |                           1.87228 kg |            61.36 A |                  953.16 W |
| 85%            |        513.40 gf | 15.48 V |           17.62 A | 35,847 rpm |           1.88 gf/W |                           2.05360 kg |            70.48 A |                1,090.80 W |
| 90%            |        547.14 gf | 15.42 V |           19.60 A | 37,313 rpm |           1.81 gf/W |                           2.18856 kg |            78.40 A |                1,209.28 W |
| 95%            |        588.80 gf | 15.37 V |           21.94 A | 38,329 rpm |           1.75 gf/W |                           2.35520 kg |            87.76 A |                1,348.88 W |
| 100%           |        673.83 gf | 15.14 V |           25.87 A | 40,588 rpm |           1.72 gf/W |                           2.69532 kg |           103.48 A |                1,566.28 W |

The source reports 73 °C motor-surface temperature after the 100% one-minute run at 28
°C ambient and says the bench data are reference-only. Recomputing `V × I` differs from
reported per-motor power by at most `0.1018 W` across all eleven rows, within the
display rounding of voltage and current. Only the 100% row exceeds the same page's 23 A
/ 372 W 60-second motor ratings: by 2.87 A and 19.57 W. The 95% row is still below both
labels at 21.94 A and 337.22 W.

The 100% endpoint is therefore preserved as a reported source row, not interpreted as a
permitted continuous or 60-second operating point. The last tabulated row without that
literal conflict is 95%, whose four-motor static-thrust arithmetic is 2.35520 kg
equivalent; that is not a vehicle mass ceiling or accepted operating limit. Supplier
clarification or a controlled replacement map is required before using the boundary for
design.

The eleven rows permit later lookup or bracketing once vehicle mass is closed; they do
not authorize interpolation. Below 0.95260 kg equivalent the source has no lower T3140
point, and above 2.69532 kg it has no point at all. A mass between two rows needs an
explicit interpolation method or a new bench point, plus the still-missing thrust-margin
criterion.

The common 50–100% labels on the F1404 and F1507 pages are not common installed commands
or equal operating conditions. The two tables use different candidate propellers and
ambient temperatures, and the manufacturer discourages comparison across motor types. No
same-label efficiency ranking or winner is therefore produced.

The official T3140 specification image and catalogue row now supply `3.1 in`
(`78.74 mm`) diameter, `4.0 in` pitch, three blades, polymer, `2 g` catalogue mass,
`5 mm` mounting hole and `6 mm` centre-hub thickness. Four catalogue items would
therefore sum conditionally to `8 g` before retention hardware. That arithmetic does not
make the item selected, establish installed mass or supply inertia, tolerance, balance,
rotation-hand allocation or revision.

The
[F1507 mechanical drawing](https://www.ligpower.com/images/202408/091723192900674709.jpg)
distinguishes the `2 mm` rear/internal motor shaft from a front `M5 × 0.8` / `Ø5 mm`
propeller adapter, and the packing list names an M5 self-locking nut. That adapter,
T3140's `5 mm` hole and the M5 nut form a coherent nominal retention chain. They still
do not provide a controlled fit/tolerance stack, seating face, usable engagement,
tightening requirement or confirmation that the current T3140 revision is the bench
specimen. Physical integration remains `unresolved`, but no longer because `2 mm` and
`5 mm` were assumed to describe the same F1507 mating surface.

Two other Grok-proposed alternatives are not retained as exact-identity candidates.
`HQ3*3*3` in an F1404 KV3800 bench table is not a controlled cross-reference to the
separate HQProp `T3X3X3` SKU, and decoding `GF3028-3` from an F1404 KV2900 bench label
does not establish its maker, SKU or revision. These may be supplier-search leads only.

At the F1507/T3140 first row, the GNB 300 mAh pack's 24 A label-current arithmetic is
already 0.64 A below the four-motor 24.64 A sum; the Tattu 450 LiHV label is above that
row but its geometry fails. The bounded six-pack search still contains no candidate that
passes both current and reserve screens. No propulsion alternative is selected.

## Documented battery-candidate screen

The current `BatteryReservedVolume` is a 38 × 34 × 25 mm orthogonal placeholder. The
tray source has a 40 × 36 mm inner footprint, 32 mm wall height and a 44 × 40 × 35 mm
outer bounding box. Six official maker pages provide candidate facts from a bounded
search; they do not create an ID01 battery selection or establish that no other pack can
meet the need.

| Candidate source                                                                                                                                              | Manufacturer nominal pack |                                     Manufacturer mass state | Calculated nameplate energy | Calculated label-current screen | Reserve result                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------: | ----------------------------------------------------------: | --------------------------: | ------------------------------: | ---------------------------------------------- |
| [R-Line 650 mAh 4S 14.8 V 95C, `TA-RL-95C-650-4S1P-XT30`](https://genstattu.com/tattu-r-line-95c-650mah-4s1p-xt30-plug-lipo-battery.html)                     |           61 × 31 × 25 mm |                                     82 g, page states ±20 g |    `14.8 × 0.650 = 9.62 Wh` |          `0.650 × 95 = 61.75 A` | **fail** for this candidate                    |
| [650 mAh 4S 15.2 V 95C LiHV long, `TA-95C-650-4S1P-HV-L-XT30`](https://genstattu.com/tattu-650mah-4s-15-2v-95c-lipo-battery-long-pack-with-xt30-plug/)        |         74 × 17 × 24.5 mm |                                     60 g, page states ±20 g |    `15.2 × 0.650 = 9.88 Wh` |          `0.650 × 95 = 61.75 A` | **fail** for this candidate                    |
| [450 mAh 4S 14.8 V 75C long, `TA-75C-450-4S1P-L-XT30`](https://genstattu.com/ta-75c-450-4s1p-l-xt30.html)                                                     |           63 × 16 × 25 mm |                **unresolved**: same page says 52 g and 58 g |    `14.8 × 0.450 = 6.66 Wh` |          `0.450 × 75 = 33.75 A` | **fail** for this candidate                    |
| [Gens ace 200 mAh 4S 14.8 V 30C, `GA-B-30C-200-4S1P-JST`](https://genstattu.com/gens-ace-200mah-4s-14-8v-30c-lipo-battery-pack-with-jst-plug/)                |  32.65 × 17.86 × 23.62 mm |                 22 g; page conflicts between ±5 g and ±20 g |    `14.8 × 0.200 = 2.96 Wh` |           `0.200 × 30 = 6.00 A` | geometry fits; current fails                   |
| [GNB 300 mAh 4S LiHV 80C, `GNB3004S80AHV`](https://www.gaoneng.shop/products/gaoneng-gnb-lihv-4s-15.2v-300mah-80c-xt30-lipo-battery)                          |           24 × 17 × 53 mm |                                                    36 ± 2 g |    `15.2 × 0.300 = 4.56 Wh` |          `0.300 × 80 = 24.00 A` | geometry fails; current is only a label screen |
| [Tattu 450 mAh 4S LiHV 95C long, `TA-95C-450-4S1P-HV-L-XT30`](https://genstattu.com/tattu-450mah-4s-95c-15-2v-hv-lipo-battery-pack-with-xt30-plug-long-size/) |   62.32 × 16.59 × 26.7 mm | 49 g, page states ±20 g; same page also says 16.95 mm width |    `15.2 × 0.450 = 6.84 Wh` |          `0.450 × 95 = 42.75 A` | geometry fails; current is only a label screen |

No permutation of the first, second, third, fifth or sixth candidates' nominal
dimensions fits inside 38 × 34 × 25 mm: their largest dimension is respectively 61, 74,
63, 53 or 62.32 mm, while the reserve's largest dimension is 38 mm. The first three and
sixth pages publish separate tolerance fields of ±5 mm length, ±2 mm width and ±2 mm
height; even their minimum listed lengths remain greater than both the 38 mm reserve and
the tray's largest 44 mm outer dimension. The sixth page also conflicts between 16.59 mm
width in its prose and 16.95 mm in its field table. The 53 mm GNB length is a nominal
manufacturer datum without an equivalent dimensional-tolerance proof here. These are
candidate-specific orthogonal-containment failures, not a universal battery-market
result. The complete nominal/maximum permutation matrix and conditional tray-growth
formula are in the
[battery packaging sensitivity](battery-packaging-sensitivity-20260908.md).

The 200 mAh pack is different. Its nominal dimensions fit in four of six orthogonal
orientations. At the page's maximum stated dimensional tolerances, its sorted sides are
37.65 × 25.62 × 19.86 mm, which still fit one orientation of the 38 × 34 × 25 mm reserve
with axis margins 0.35, 8.38 and 5.14 mm. That is a geometric screen, not an
installation approval: connector and cable keep-outs, swelling, cooling, restraint and a
manufacturing-clearance policy remain unresolved. Its `6.00 A` C-label product is also
below the `20.92 A` summed motor current at even the first retained four-motor row,
before ESC losses and auxiliaries. It therefore fails the present electrical screen.

At the exact LIGPOWER F1404 KV4600 + GF3016 50% row, `4 × 83.28 W = 333.12 W`. Dividing
the first three nameplate energies by that propulsion-only power gives respectively
1.733, 1.780 and 1.200 minutes. These are only `E_nameplate / P_propulsion` ratios at
one candidate bench row. They are not usable-energy values, an ID01 hover point,
endurance estimates or physical ceilings. No such ratio is promoted for the 200 mAh pack
because its label-derived current screen already fails the row, nor for the two later
near-misses because their reserve containment already fails. The same boundary applies
to every C-rate product above: it is not proof of delivered current, burst duration,
thermal acceptability or safety. For context only, the four-motor 100% row sums to 70.16
A before ESC losses and auxiliaries; none of the six label-current products reaches that
value.

The immediate design consequence is therefore narrow. The bounded search found no pack
that passes both screens: the 200 mAh Gens ace is the geometry-pass/current-fail
counterexample, while the GNB 300 mAh and Tattu 450 mAh LiHV packs pass only the
first-row label-current arithmetic and fail geometry. Changing the CAD now would still
be premature. The mission duration, closed mass ledger and a reviewable
battery/propulsion candidate packet must first determine whether to enlarge or relocate
the reserve, source a different pack, or reconsider the propulsion combination.

## Mission-energy worksheet without an invented mission

The approved brief r4 supplies a mission **kind**, not a quantified mission: exterior
visual observation of civil building façades and roofs. It also states that the site,
presence of people and admissible weather are not specified. No duration, distance,
height, speed, inspection dwell, wind, temperature, reserve or payload duty cycle is
therefore inserted here.

The smallest useful mission decomposition is a worksheet whose cells remain variables
until their evidence is named:

| Phase               | Duration    | Propulsion operating point | Auxiliary duty                                   | Phase energy                                                    |
| ------------------- | ----------- | -------------------------- | ------------------------------------------------ | --------------------------------------------------------------- |
| Launch and climb    | `t_launch`  | `P_prop,launch`            | avionics, compute, camera and radio states       | `(P_prop,launch + P_aux,launch + P_loss,launch) × t_launch`     |
| Outbound transit    | `t_out`     | `P_prop,out`               | simultaneous transit states                      | `(P_prop,out + P_aux,out + P_loss,out) × t_out`                 |
| Inspection          | `t_inspect` | `P_prop,inspect`           | sourced capture, compute, storage and radio duty | `(P_prop,inspect + P_aux,inspect + P_loss,inspect) × t_inspect` |
| Return transit      | `t_return`  | `P_prop,return`            | simultaneous return states                       | `(P_prop,return + P_aux,return + P_loss,return) × t_return`     |
| Descent and landing | `t_land`    | `P_prop,land`              | simultaneous landing states                      | `(P_prop,land + P_aux,land + P_loss,land) × t_land`             |

With every `t_i` expressed in hours and every power in watts:

`E_mission = Σ_i [(P_prop,i + P_aux,i + P_loss,i) × t_i]`.

Feasibility then requires `E_mission + E_reserve ≤ E_usable`. One reviewed reserve
policy must define `E_reserve`, either directly or through a named reserve phase; it
must not be counted both ways. `E_usable` remains battery-, current-, temperature-, age-
and cutoff-dependent and is not substituted by catalogue nameplate energy.

The first exact four-motor bench row provides one unit-rate conversion only:
`333.12 W / 60 = 5.552 Wh/min` of reported propulsion power at that row. Every actual
auxiliary watt would add `1/60 Wh` per minute. The `5.552 Wh/min` value is neither a
lower nor an upper bound on ID01 flight energy: the unresolved all-up mass can place
ideal static balance below the first row, between rows or beyond the reported table, and
real operation adds losses, margins, vehicle interaction and environment.

### Auxiliary electrical evidence screen

The official component sources close a few input and planning facts, but not an ID01
auxiliary-power subtotal:

| Candidate                                                                                                                 | Official fact                                                                                                                                                                                                                                                                   | Evidence class and permitted use                                                                                                                                                                                     | State for mission power                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Raspberry Pi Zero 2 W](https://www.raspberrypi.com/documentation/computers/raspberry-pi.html#typical-power-requirements) | Current Raspberry Pi documentation reports 350 mA typical bare-board active current and a 2 A recommended PSU capacity; the [product brief](https://datasheets.raspberrypi.com/rpizero2/raspberry-pi-zero-2-w-product-brief.pdf) separately specifies 5 V DC, 2.5 A input power | 350 mA is a typical bare-board reference. The 2 A and 2.5 A figures size a supply and are not consumption. At the documentation's stated 5.1 V supply, `5.1 × 0.350 = 1.785 W` is a calculated reference point only. | Workload-, radio-, encoding-, storage- and peripheral-specific draw remains `unresolved`; do not use 1.785 W as mission average without measurement. |
| [Raspberry Pi Camera Module 3](https://datasheets.raspberrypi.com/camera/camera-module-3-product-brief.pdf)               | The product brief identifies the Module 3 and CSI-2 interface; Raspberry Pi's general power documentation says a Camera Module requires 250 mA.                                                                                                                                 | Generic official accessory supply requirement, not a Module 3 workload trace. The cited statement does not provide the matching rail and operating point needed to turn it into watts here.                          | Capture-mode consumption and simultaneous duty remain `unresolved`; retain 250 mA for later source sizing only.                                      |
| [Holybro Pixhawk 6C Mini Model A Current](https://docs.holybro.com/autopilot/pixhawk-6c-mini/technical-specification)     | USB input is 4.75–5.25 V, maximum input is 6 V; Telem1 + GPS1 and all other ports each have stated 1.5 A output-current limiters.                                                                                                                                               | Input-voltage and output-protection limits. They are neither controller self-draw nor attached-load consumption.                                                                                                     | Controller, heater, sensors and attached-port duty remain `unresolved`; no watt term is added.                                                       |

The design consequence is explicit: a real power-rail worksheet must identify the
battery-side measurement plane, regulator topology and efficiency, Pixhawk self-draw, Pi
workload, camera capture mode, storage, radio/GNSS and their simultaneous duty. A short
instrumented representative-duty trace can close these terms later; supply ratings alone
cannot.

## Partial source-backed mass ledger

The already named candidate components allow a partial ledger. Variant identity and
source quality remain attached to every number; missing structural mass is not filled
from CAD volume.

| Candidate occurrence                                                                                                                   |               External mass evidence | Ledger treatment and exclusions                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Four LIGPOWER F1404 **KV4600** motors](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html)                                  |                 `4 × 9.34 = 37.36 g` | Manufacturer mass includes each 150 mm motor cable; parts bags, fasteners, propellers and ESCs excluded                                                                          |
| [Four LIGPOWER F1507 **KV3800** motors](https://www.ligpower.com/product/f1507-kv3800-fpv-motor.html)                                  |                   `4 × 15 = 60.00 g` | Separate alternative; each mass includes a 100 mm cable; current motor envelope is too small; propellers, attachment and ESCs excluded                                           |
| [Four LIGPOWER F35A ESCs](https://www.ligpower.com/product/f35a-fpv-esc.html)                                                          |                   `4 × 4.3 = 17.2 g` | Official specification-image mass; candidate related product only; motor wiring, power distribution, connector adaptation, cooling and regulated auxiliary supply excluded       |
| [One LIGPOWER Mini F45A 4-in-1 ESC](https://www.ligpower.com/product/mini-f45a-4in1-fpv-esc.html)                                      |                              `9.2 g` | Official catalogue mass; F1507 matching-guide lead only; board envelope, exact bench pairing, firmware conflict, shared input path and thermal installation remain unresolved    |
| [One LIGPOWER F7 35A AIO](https://www.ligpower.com/product/f7-35a-aio-stack.html)                                                      |                                    — | F1507 matching-guide lead combining flight-controller and four-channel ESC roles; no controlled mass accepted here and no compatibility decision with the separate Pixhawk path  |
| [Holybro Pixhawk 6C Mini **Model A Current**](https://docs.holybro.com/autopilot/pixhawk-6c-mini/technical-specification)              |                               42.4 g | Manufacturer technical specification for this exact variant; cables, GPS and power module inclusion is not established and they remain excluded                                  |
| [Raspberry Pi Camera Module 3 **standard**](https://www.raspberrypi.com/documentation/accessories/camera.html#hardware-specifications) |                                  4 g | Official hardware table; camera cable, mount and fasteners excluded                                                                                                              |
| [Raspberry Pi Zero 2 W](https://www.raspberrypi.com/news/what-can-you-build-with-raspberry-pi-zero/)                                   | 12 g, lower-assurance external datum | Raspberry Pi's official 2025 editorial comparison reports 12 g, but the current product page and product brief omit mass; microSD, header, cable, cooling and enclosure excluded |
| [Gemfan Hurricane 3016](https://www.gemfanhobby.com/3016-hurricane-pc-3-blade.html)                                                    |                 1.18 g per propeller | Official Gemfan candidate fact, but excluded from the configuration subtotal because identity with LIGPOWER's `GF3016` and F1404 fit remain unresolved                           |
| [LIGPOWER T3140](https://www.ligpower.com/product/t3140-fpv-propeller.html)                                                            |           `2 g` catalogue item datum | Exact-name F1507 bench lead; four-item arithmetic is conditionally `8 g`, but revision, tolerance, inertia, retention hardware and installed mass remain unresolved              |
| [Holybro PM02 V3, SKU 15010](https://holybro.com/products/pm02-v3-12s-power-module)                                                    |                                 20 g | Candidate power-module mass only; no built-in PDB, installed harness, protection, connector adaptation or position; excluded from every subtotal                                 |
| [Holybro PM06 V2 14S, SKU 15019](https://holybro.com/products/micro-power-module-pm06-v2)                                              |                                 24 g | Alternative candidate with four distribution pads; published height conflicts; installed harness, protection and position excluded                                               |
| [Gens ace 200 mAh 4S](https://genstattu.com/gens-ace-200mah-4s-14-8v-30c-lipo-battery-pack-with-jst-plug/)                             |                         22 g nominal | Official page conflicts between ±5 g and ±20 g tolerances; geometrically fitting candidate, but excluded from a viable configuration because its label-current screen fails      |
| [GNB 300 mAh 4S LiHV](https://www.gaoneng.shop/products/gaoneng-gnb-lihv-4s-15.2v-300mah-80c-xt30-lipo-battery)                        |                             36 ± 2 g | Official candidate datum; excluded from a viable configuration because the 53 mm pack fails the present reserve screen                                                           |
| [Tattu 450 mAh 4S LiHV 95C long](https://genstattu.com/tattu-450mah-4s-95c-15-2v-hv-lipo-battery-pack-with-xt30-plug-long-size/)       |              49 g, page states ±20 g | Official candidate datum; excluded from a viable configuration because its stated dimensions fail the present reserve screen                                                     |

The strict technical-specification subtotal for the specific F1404 + four-F35A +
Pixhawk + camera path is `37.36 + 17.2 + 42.4 + 4 = 100.96 g`. Adding the
lower-assurance official editorial value for the companion board gives `112.96 g`.
Neither ESC guide lead is substituted into those values. Conditional arithmetic with
each screened battery is:

| Conditional documentary subtotal         | Calculation           |                                                   Result |
| ---------------------------------------- | --------------------- | -------------------------------------------------------: |
| Named COTS plus R-Line 650 mAh 14.8 V    | `112.96 + 82`         |              194.96 g nominal; battery page states ±20 g |
| Named COTS plus 650 mAh 15.2 V LiHV long | `112.96 + 60`         |              172.96 g nominal; battery page states ±20 g |
| Named COTS plus 450 mAh 14.8 V long      | `112.96 + {52 or 58}` | 164.96 g or 170.96 g; source conflict prevents one value |
| Named COTS plus Gens ace 200 mAh 4S      | `112.96 + 22`         |  134.96 g nominal; tolerance conflict prevents one range |
| Named COTS plus GNB 300 mAh 4S LiHV      | `112.96 + 36`         |                                 148.96 ± 2 g conditional |
| Named COTS plus Tattu 450 mAh 4S LiHV    | `112.96 + 49`         |              161.96 g nominal; battery page states ±20 g |

These are not candidate configurations or vehicle masses. Each row conditionally adds
four F35A related-product ESCs and one battery to the same incomplete COTS subtotal; the
first, second, third, fifth and sixth packs fail reserve containment, while the fourth
fails the first electrical row. The sums omit structural mass, four exact propellers,
fasteners, retention, power distribution, power module, companion regulator, non-motor
wiring and connectors, GPS, radio, antennas, storage and any guards or protection. The
F1507, Mini F45A, F7 AIO, PM02 and PM06 rows are alternative component or architecture
leads and are deliberately not added to these F1404/F35A-based subtotals. Installed
positions and centre of gravity also remain unresolved. The separate
[mass-and-position closure worksheet](mass-and-position-closure-worksheet-20260908.md)
keeps those absent terms and positions visible without silently entering them into a
vehicle sum.

### Geometry-derived structural volume ledger

The six current structural sources below have simple constructive geometry whose source
hashes match their persisted canonical captures. The latest CentralDeck identity comes
from the [camera/deck rebuild](camera-deck-rebuild-20260907.md); the five unchanged
targets come from the [canonical target ledger](geometry-and-integrity-20260907.md).
SHA-256 prefixes are shown only for readability; those linked ledgers retain the full
identities.

| Structural source                                     | Capture / STEP SHA-256 prefix   | Occurrences | Source-analytical volume per occurrence | Occurrence subtotal | Local geometric centroid `(x, y, z)` mm |
| ----------------------------------------------------- | ------------------------------- | ----------: | --------------------------------------: | ------------------: | --------------------------------------: |
| [CentralDeck](sources/central-deck.py)                | `335e7a221bac` / `9213a54a7c3c` |           1 |                       29,758.725684 mm³ |   29,758.725684 mm³ |        `(0.049877, 0.049877, 1.500000)` |
| [RadialArm](sources/radial-arm.py)                    | `96fba39719f5` / `4351574f57e1` |           4 |                        7,919.575228 mm³ |   31,678.300912 mm³ |               `(0.304656, 0, 2.500000)` |
| [BatteryTray](sources/battery-tray.py)                | `c9c34283fc5a` / `bc69476d7a45` |           1 |                       15,520.000000 mm³ |   15,520.000000 mm³ |                     `(0, 0, 13.046392)` |
| [AvionicsCarrier](sources/avionics-carrier.py)        | `a5beef7c9bec` / `e26bafa27d23` |           1 |                       19,200.000000 mm³ |   19,200.000000 mm³ |                      `(0, 0, 1.500000)` |
| [LandingSkid](sources/landing-skid.py)                | `0f248d7f9d02` / `4d9968a0b397` |           2 |                       12,800.000000 mm³ |   25,600.000000 mm³ |                     `(0, 0, 15.750000)` |
| [CameraMountBracket](sources/camera-mount-bracket.py) | `ae70dd592870` / `b821e5598b75` |           1 |                        6,416.129212 mm³ |    6,416.129212 mm³ |              `(0, 7.030110, 10.559538)` |

The sum over these ten named structural occurrences is
`128,173.155808 mm³ = 128.173155808 cm³`. This is an occurrence-volume sum, not a
whole-drone union and not mass. It deliberately excludes `BatteryReservedVolume`,
`AutopilotEnvelope`, `CompanionComputerEnvelope`, `MotorEnvelope`, `CameraBoardEnvelope`
and `StaticPropellerEnvelope`, because they are packaging proxies or reserved volumes
rather than structural material.

Applying the persisted nested placements gives the following geometric centroids in the
root frame: deck `(0, 0.070537, 51.500000)` mm; symmetric four-arm set
`(0, 0, 55.500000)` mm; tray `(0, 10.000000, 28.046392)` mm; carrier `(0, 0, 59.500000)`
mm; symmetric two-skid set `(0, 0, 21.750000)` mm; bracket `(0, -28.969890, 39.440462)`
mm. They are local or grouped **geometric** centroids, not component mass centres and
not aircraft centre of gravity.

A separate import of the exact sealed STEP bytes with pinned `occt-import-js@0.0.23` and
fine tessellation (`0.002 mm` linear, `0.01 rad` angular) reproduced the six
source-derived volumes with a maximum absolute difference below `0.0011 mm³`. That is a
triangulated cross-check, not exact BRep mass-property authority or an uncertainty
bound. The [current module and root integrity evidence](camera-deck-rebuild-20260907.md)
also reports zero positive pairwise intersection volume; at the root, that covers all 15
subsystem pairs plus five contact diagnostics. No cross-occurrence overlap correction is
therefore introduced here. Contact does not establish a joint or load path.

Physical structural mass remains `m_structure = Σ ρ_k V_k` only after each occurrence's
material and density are sourced or approved. Manufacturing process, infill or wall
strategy, inserts, coatings, tolerances and as-built mass remain unresolved, so neither
a structural mass nor a mass-weighted aircraft CG is calculated.

## Current static propeller-proxy clearance screen

The captured placement basis puts the four motor centres 100 mm from the local origin at
the four cardinal positions. The current static propeller proxy has radius 38.1 mm; the
CentralDeck has a 100 mm square planform. These are geometric design hypotheses, not
selected hardware.

| Screen                                 | Calculation             | Nominal result |
| -------------------------------------- | ----------------------- | -------------: |
| Adjacent motor-centre distance         | `sqrt(100² + 100²)`     |  141.421356 mm |
| Adjacent proxy-disc edge gap           | `141.421356 − 2 × 38.1` |   65.221356 mm |
| Opposite proxy-disc edge gap           | `200 − 2 × 38.1`        |       123.8 mm |
| Radial proxy-disc to deck-planform gap | `100 − 38.1 − 50`       |        11.9 mm |

The common later 45° root rotation does not change these distances. The calculation is a
useful static packaging screen only. It excludes real blade geometry, pitch, elastic
deflection, motor-axis tolerances, shaft/hub fit, guards, nearby subsystems, airflow and
rotation. A selected propeller diameter and deformed operating envelope must replace the
proxy before any dynamic-clearance claim.

The sourced T3140 diameter gives a narrower candidate-only screen without changing CAD:
`141.421356 − 78.74 = 62.681356 mm` between adjacent nominal discs,
`200 − 78.74 = 121.26 mm` between opposite discs, and `100 − 78.74 / 2 − 50 = 10.63 mm`
radially to the deck planform. The current proxy under-represents T3140 by `2.54 mm` in
diameter. Positive nominal gaps do not establish rotating, deformed or tolerance-aware
clearance.

## Calculation contract

No default derating, reserve, thrust-to-weight ratio or safety factor is inserted. Each
coefficient must be sourced or approved before it becomes a number.

| Quantity                   | Equation                                                       | Required evidence before evaluation                                      |
| -------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Vehicle mass               | `m = Σ m_k`                                                    | As-built or supplier mass for every item, including wiring and fasteners |
| Weight                     | `W = m g₀`, with `g₀ = 9.80665 m/s²`                           | Closed mass inventory                                                    |
| Ideal hover thrust         | `T_hover,total = W`; for a symmetric quad, `T_hover,i = W / 4` | Mass, rotor count and justified symmetric load sharing                   |
| Thrust margin              | `Γ_T = 4 T_max,i / W`                                          | Comparable motor-propeller operating map and approved margin criterion   |
| Electrical point           | `P_e = U I`                                                    | Voltage and current measured or sourced at the same operating point      |
| Vehicle electrical power   | `P_total = Σ P_propulsion + P_avionics + P_payload + P_losses` | Simultaneous operating points and documented auxiliaries/losses          |
| Usable energy              | `E_usable = ∫ U(t) I(t) dt` over admitted battery limits       | Cell/pack curve, capacity, temperature, current and cutoff evidence      |
| Mission feasibility        | `∫ P_total(t) dt ≤ E_usable`                                   | Time-resolved mission phases and an explicitly approved reserve          |
| Centre of gravity          | `r_G = Σ(m_k r_k) / Σ m_k`                                     | Mass and installed position for every item in one coordinate frame       |
| Static propeller clearance | `c = d_motor-centres − D_propeller`                            | Exact motor placements, selected propeller diameter and tolerance policy |

The constant-power shortcut `t = E_usable / P_average` is allowed only when an
evidence-backed mission-average power is available and its limitations are recorded.
Manufacturer throttle labels are not a universal control command or an interpolation
law.

## Inputs still required

| Input packet         | Minimum content                                                                                                                            | Current state                                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mission              | Endurance target, inspection dwell, transit, reserve, wind/temperature envelope, payload duty cycle                                        | `unresolved`                                                                                                                                                                       |
| Mass and position    | Airframe, four propulsion units, battery, avionics, camera, wiring, fasteners and landing gear                                             | Closure worksheet now exposes every current class; materials, installed census, total mass and CG remain `unresolved`                                                              |
| Motor                | Exact variant, mass, dimensions, voltage/current/thermal limits and matching test map                                                      | F1404 KV4600 and F1507 KV3800 are documented alternatives only; F1507 exceeds the current CAD motor envelope                                                                       |
| Propeller            | Exact maker/part, diameter, pitch, blade count, mass/inertia, hub interface and thrust/torque map                                          | `GF3016` identity unresolved; T3140 has catalogue geometry/mass and a nominal M5 chain, but revision, tolerances, inertia and installed evidence remain unresolved; CAD is a proxy |
| ESC                  | Exact part, mass/envelope, voltage, continuous/burst current conditions, efficiency, cooling and protocol                                  | F35A passes a nameplate screen only; firmware, pairing, efficiency, cooling, wiring and installation remain `unresolved`                                                           |
| Battery              | Chemistry, series/parallel layout, pack mass/envelope, capacity curve, resistance, continuous/burst current, cutoff and temperature limits | Five sourced packs fail reserve containment; one fits geometrically but fails the first-row current screen                                                                         |
| Payload and avionics | Actual mass, centre, voltage/current and simultaneous duty                                                                                 | Typical Pi bare-board current and supply limits are sourced; mission duty and installed-system power remain `unresolved`                                                           |
| Interfaces           | Propeller–shaft, motor–arm, ESC cooling/wiring, battery retention/connector, power distribution, regulated rails and protection            | F1404 base and F1507/T3140 nominal drawings narrow two candidates; fit, tolerance, engagement and every selected installed interface remain `unresolved`                           |

## Verification sequence

1. Close a source packet for one or more explicitly labelled candidate configurations.
2. Build the mass/position ledger and mission phases; preserve unknowns instead of
   silently filling them.
3. Evaluate the algebraic mass–thrust–power–energy–endurance balance with units and
   explicit bounded ranges for the still-provisional inputs.
4. Check centre of gravity, static and deformed propeller clearances, current paths,
   thermal limits and physical interfaces.
5. Derive named structural load cases from the selected operating envelope.
6. Only then select the smallest fitting verification: current CalculiX for an
   admissible single-part static question; a future modal/vibration or assembly
   extension if screening justifies it; Modelica only for an admitted closed scalar
   model; Chrono only for a prescribed mechanism question. Neither current Modelica nor
   Chrono proves propeller thrust or aircraft stability.
7. A later physical programme would separately require mass/CG measurement, a guarded
   motor-propeller thrust bench, electrical/thermal checks and progressively controlled
   prototype tests. This note authorizes none of them.

## Review boundary

Twenty-two completed native Grok consultations ran across ten bounded review passes. The
first pair used a clean, repository-free sandbox for method cross-checks; after the
human explicitly requested continued Grok-native work on this project, the later reviews
read only the relevant dossier files. They independently checked motor arithmetic,
battery screens, the partial mass ledger, mission equations, source identities,
packaging, electrical architecture and the next mission-decision boundary. The latest
four reviews covered one task each: alternative propulsion, mission sheet, power
architecture and battery-tray orientation screening. A new four-way source-control pass
then audited F1404, T3140, `GF3016`, and the F1507/T3140 assembly chain. All four
completed; Codex independently inspected the linked official drawings and specification
image before accepting the corrections. Two later exact-row audits independently
transcribed and recalculated all eleven F1507/T3140 rows. Codex accepted the full
exact-row table but rejected a same-throttle candidate ranking because the source
conditions differ and the manufacturer explicitly discourages inter-type comparison. A
parallel battery search was cancelled after the recurring permission-classifier timeout
and contributed no accepted verdict, as were an earlier STEP audit and supplier-identity
run. The latest pair audited the exact installed-item census and the F1507 ESC-guide
boundary. Codex accepted the 22-leaf geometry split and the guide-versus-bench
distinction after independently checking the controlled placements and official pages.

Codex inspected the source pages and repository facts, recalculated the values, rehashed
the selected source and STEP bytes, derived the simple constructive-solid volumes and
retained only bounded conclusions. Earlier overreaches or fetch artefacts remained
rejected: current CAD cannot supply physical mass or inertia without sourced material
and component data; `E_nameplate / P_bench` is not an endurance ceiling; an official
editorial mass is not equivalent to a technical-sheet datum; and the 200 mAh pack does
fit the reserve in one maximum-tolerance orientation despite a contrary verdict. A Grok
fetch failure did not make the live Gemfan page unavailable, and a single-axis battery
reading did not override valid orthogonal orientation.

The latest review added five corrections. `HQ3*3*3` and `GF3028-3` labels were not
promoted to exact maker/SKU identities; per-axis battery tolerances were not replaced by
±5 mm on every dimension; the Gens pack was not called a six-orientation inner-box fit;
and “the Pi cannot be powered from Pixhawk” was narrowed to the absence of a
demonstrated and dimensioned path. Terra was used for seven targeted checks in total:
the previous authority, identity, auxiliary-source, structural-arithmetic and
battery-search checks, plus independent packaging-permutation and electrical-wording
audits in this pass. No Astra consultation, broad test campaign, provider execution or
project confirmation was used for this note.
