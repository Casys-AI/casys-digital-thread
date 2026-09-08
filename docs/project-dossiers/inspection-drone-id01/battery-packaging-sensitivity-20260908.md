# ID01 — battery packaging sensitivity

Audience: both · Diátaxis: none · Kind: dated engineering working note

Observation **2026-09-08**, primary atelier, local. This note tests documented battery
envelopes against the current CAD keep-in without changing that geometry. It is not a
battery selection, a clearance approval, a restraint design, or evidence of flight
readiness.

## Current verdict

Keep the current `BatteryReservedVolume` unchanged while mission, mass, current and
usable-energy needs remain unresolved. Of the six sourced candidates, only the Gens ace
200 mAh pack fits the reserve geometrically, and its `6 A` label-current arithmetic is
below the `20.92 A` summed motor current at the first retained F1404 bench row.
Enlarging the CAD now would therefore optimize around no viable selected configuration.

The companion
[propulsion and energy basis](propulsion-energy-presizing-basis-20260908.md) records the
electrical screen and source limitations. This note answers only the orthogonal
packaging question.

## Persisted geometry basis

The current source defines a 38 × 34 × 25 mm reserve, a 40 × 36 × 32 mm tray interior
above its floor, and a 44 × 40 × 35 mm outer tray. After the persisted `ElectricalPower`
root translation `(0, 10, 15)` mm:

| Volume          | Root-frame bounds in mm              | Current relation                                                               |
| --------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| Tray outer      | `x[-22,22]`, `y[-10,30]`, `z[15,50]` | 2 mm side walls, 3 mm base; wall top meets the deck underside                  |
| Tray interior   | `x[-20,20]`, `y[-8,28]`, `z[18,50]`  | open top; 40 × 36 footprint and 32 mm height above the floor                   |
| Reserved volume | `x[-19,19]`, `y[-7,27]`, `z[18,43]`  | 1 mm nominal lateral gap per side; touches the floor; 7 mm remains to wall top |

The nearest named root envelopes are also tight enough to matter after a future change:

- the two skid envelopes begin at root `x = ±25 mm`, leaving 3 mm from each tray outer X
  face;
- the camera-bracket footprint ends at `y = -21 mm`, leaving 11 mm from the tray outer
  front face at `y = -10 mm`;
- the deck underside is at `z = 50 mm`, already coincident with the tray wall top.

These are nominal static envelope relations. They omit battery leads, connector bend,
strap, swelling, insulation, cooling, manufacturing tolerance and service access.

## Orthogonal containment matrix

Each count is the number of the six axis permutations whose three pack dimensions are no
larger than the named fixed box axes. For Tattu/Gens pages, the maximum screen uses the
separately published fields `Length(+5 mm)`, `Width(+2 mm)` and `Height(+2 mm)`; that is
not a blanket ±5 mm on every axis. The Tattu 450 page conflicts between 16.59 mm width
in its prose and 16.95 mm in its field table, so the larger 16.95 mm value is used for
the conservative screen. The GNB page publishes no dimensional tolerance; its maximum
row therefore remains `unresolved`.

| Official candidate                                                                                                               | Nominal dimensions L × W × H | Maximum screen L × W × H | Reserve nominal / max | Inner nominal / max | Outer nominal / max |
| -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------: | -----------------------: | --------------------: | ------------------: | ------------------: |
| [Tattu R-Line 650 mAh 4S 95C](https://genstattu.com/tattu-r-line-95c-650mah-4s1p-xt30-plug-lipo-battery.html)                    |              61 × 31 × 25 mm |          66 × 33 × 27 mm |             0/6 · 0/6 |           0/6 · 0/6 |           0/6 · 0/6 |
| [Tattu 650 mAh 4S LiHV 95C long](https://genstattu.com/tattu-650mah-4s-15-2v-95c-lipo-battery-long-pack-with-xt30-plug/)         |            74 × 17 × 24.5 mm |        79 × 19 × 26.5 mm |             0/6 · 0/6 |           0/6 · 0/6 |           0/6 · 0/6 |
| [Tattu 450 mAh 4S 75C long](https://genstattu.com/ta-75c-450-4s1p-l-xt30.html)                                                   |              63 × 16 × 25 mm |          68 × 18 × 27 mm |             0/6 · 0/6 |           0/6 · 0/6 |           0/6 · 0/6 |
| [Gens ace 200 mAh 4S 30C](https://genstattu.com/gens-ace-200mah-4s-14-8v-30c-lipo-battery-pack-with-jst-plug/)                   |     32.65 × 17.86 × 23.62 mm | 37.65 × 19.86 × 25.62 mm |             4/6 · 1/6 |           4/6 · 2/6 |           6/6 · 4/6 |
| [GNB 300 mAh 4S LiHV 80C](https://www.gaoneng.shop/products/gaoneng-gnb-lihv-4s-15.2v-300mah-80c-xt30-lipo-battery)              |              53 × 24 × 17 mm |             `unresolved` |               0/6 · — |             0/6 · — |             0/6 · — |
| [Tattu 450 mAh 4S LiHV 95C long](https://genstattu.com/tattu-450mah-4s-95c-15-2v-hv-lipo-battery-pack-with-xt30-plug-long-size/) |      62.32 × 16.95 × 26.7 mm |  67.32 × 18.95 × 28.7 mm |             0/6 · 0/6 |           0/6 · 0/6 |           0/6 · 0/6 |

The Gens maximum-tolerance reserve fit has one orientation: `37.65 × 25.62 × 19.86 mm`
against `38 × 34 × 25 mm`, leaving axis margins 0.35, 8.38 and 5.14 mm. The inner box
has only two maximum-tolerance orientations because the 37.65 mm side must align with
its 40 mm axis; it exceeds both the 36 mm and 32 mm axes. This corrects an earlier
review overclaim of six nominal inner orientations and avoids treating a dimension-sort
test as an orientation count.

For both GNB and Tattu 450 LiHV, nominal dimensions alone establish the failure: their
53 mm and 62.32 mm long sides already exceed the tray outer's largest 44 mm axis. Only
GNB lacks a precise maximum triplet. The Tattu maximum triplet is shown because its
official per-axis tolerance fields are present; the 16.59/16.95 mm width conflict stays
visible rather than being silently resolved.

## Conditional geometry consequence after selection

Let an eventual selected pack, including every approved swelling, connector and service
allowance, have oriented envelope `(p_x, p_y, p_z)`. If the future design preserves the
current 1 mm lateral reserve-to-inner gap on each side, 2 mm side walls, 3 mm floor and
7 mm vertical gap above the reserved envelope, then:

- `outer_x = p_x + 2×1 + 2×2 = p_x + 6`;
- `outer_y = p_y + 2×1 + 2×2 = p_y + 6`;
- `outer_z = 3 + p_z + 7 = p_z + 10`.

Relative to the current outer 44 × 40 × 35 mm tray, the corresponding symmetric size
changes are `Δx = p_x − 38`, `Δy = p_y − 34` and `Δz = p_z − 25`. The Z relation is
specific to the current open-top, floor-touching concept; a closed or vertically
restrained design needs its own clearance rule.

This formula is a sensitivity, not an instruction to edit the source. A symmetric X
increase consumes the current 3 mm gap to each skid after 6 mm total growth. A symmetric
Y increase toward the front consumes the 11 mm camera-bracket gap after 22 mm total
growth. Any selected change therefore requires a fresh root placement/intersection
screen and an explicit retention/connector design; fitting the rectangular cell body is
not enough.

## Decision gate

Change the CAD keep-in only after all four items exist:

1. a reviewed mission and reserve policy;
2. a closed mass/current/usable-energy requirement;
3. one exact battery candidate including tolerances, leads, connector, restraint and
   thermal/service envelope;
4. an explicit human decision that the keep-in is a soft hypothesis rather than a hard
   constraint, if enlargement or relocation is proposed.

The resulting source successor would then need the ordinary exact admission, canonical
geometry, affected module/root rebuild and proportional static placement recross. No
such mutation is authorized or useful in the current pass.

## Review boundary

One targeted Terra check independently recomputed every orientation count. Codex also
recomputed all six permutations directly and inspected the official per-axis tolerance
fields. The accepted result is 4/6, 4/6 and 6/6 for the nominal Gens pack, then 1/6, 2/6
and 4/6 at its maximum published dimensions. No component selection, CAD change,
provider run, broad test campaign or Astra consultation was made.
