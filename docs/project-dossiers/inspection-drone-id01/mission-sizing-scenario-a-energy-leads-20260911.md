# ID01 — scenario A energy leads (HOLD packets, no SKU)

Audience: both · Diátaxis: none · Kind: dated engineering working sheet

Observation **2026-09-11**, primary atelier, local. Documentary G0 only. Does not select
hardware, seal Thread energy (F13/F21), or authorize flight. Configuration matrix stays
**HOLD**. F1404 50% / F1507 50% bench rows are **not** ID01 hover.

Companion geometry/time pack:
[scenario A instantiation](mission-sizing-scenario-a-instantiation-20260911.md)
(`t_sum` excluding reserve = **19.494076 s** = 0.005415021 h).

## Live source re-read

[LIGPOWER F1404 KV4600](https://www.ligpower.com/product/f1404-kv4600-fpv-motor.html)
re-read **2026-09-11**. KV4600 + **GF3016** 50% row still: thrust 184.21 g, 15.93 V,
5.23 A, 83.28 W. 100% still 17.54 A / 274.32 W for 60 s. Maker: bench for reference
only. `GF3016` SKU remains unidentified (F17).

F1507 KV3800 + T3140 50% / 100% rows stay as in the
[energy basis](propulsion-energy-presizing-basis-20260908.md) (not re-tabulated here).
100% four-motor current 103.48 A conflicts with the motor 60 s rating — **not** a
mission point (F18).

## Screening `P_prop` (four motors, HOLD lead, not selected)

| Lead | Throttle label | Four-motor reported power | Four-motor current | Class | Use |
| ---- | -------------- | ------------------------: | -----------------: | ----- | --- |
| F1404 KV4600 + GF3016 | 50% | 333.12 W | 20.92 A | quoted bench ×4 | **H_P1404** screening `P_prop` for all hypothesized phases |
| F1404 KV4600 + GF3016 | 100% | 1097.28 W | 70.16 A | quoted 60 s peak | **not** a G0 mission point |
| F1507 KV3800 + T3140 | 50% | 378.28 W | 24.64 A | quoted bench ×4 | **H_P1507** alternate screening, still HOLD |
| F1507 KV3800 + T3140 | 100% | 1566.28 W | 103.48 A | quoted, conflicts 60 s rating | **not** a G0 mission point |

Neither 50% label is an FC command or a hover proof. They are the only non-peak rows
on the retained maps. Equivalent supported mass at those rows is **0.73684 kg** /
**0.95260 kg**. The
[mass screen](mission-sizing-scenario-a-mass-screen-20260911.md) shows sourced COTS
partials (174–193 g) sit below both figures; structure remains `unresolved` (F16), not
`0`. Reject the 50% `P_prop` screen only after a closed `Σm` exceeds that row.

## Screening `P_aux`

| Term | Value | Class | Source |
| ---- | ----: | ----- | ------ |
| Pi Zero 2 W typical active | 1.785 W | calculated from quoted | Raspberry Pi docs typical 350 mA × 5.1 V, already in the energy basis. Workload/camera remain unresolved on that page. |
| Camera Module 3 continuous viewfinder at USB-C | ~2 W | quoted staff | Raspberry Pi product-news thread 2023-01-09: “Typically the V3 will consume 2W (at USB-C port)” for `libcamera-still -t 0`. Includes the host board — **do not add** on top of 1.785 W. |
| Pixhawk 6C Mini self-draw | `unresolved` | unknown | spec gives port limiters, not controller watts |
| Radio TX/RX (SiK V3, if selected) | 0.5 W TX / 0.125 W RX | quoted | electrical-power-architecture-basis. Duty cycle `unresolved` — do not add into `E_screen` as 100% TX. |
| Radio / ESC idle / wiring loss `P_loss` | `unresolved` | unknown | not 0 |

**H_Paux:** 2.0 W during the façade zone (USB-C viewfinder quote); 1.785 W on the other
hypothesized phases (Pi typical, camera off). Pixhawk/`P_loss` omitted — `E` is therefore
a **lower bound**, not a closed budget.

## Calculated screening energy (incomplete)

`E_prop = P_prop × t_sum`, `t_sum = 19.494076 s`.

| Hypothesis | `E_prop` | `E_aux` | `E_screen = E_prop+E_aux` | vs nameplates (not usable energy) |
| ---------- | -------: | ------: | ------------------------: | --------------------------------- |
| H_P1404 + H_Paux | 1.804 Wh | 0.010 Wh | **1.814 Wh** | Gens ace 200 mAh 4S nameplate 0.200 A·h × 14.8 V = **2.96 Wh**; GNB 300 mAh LiHV 0.300 × 15.2 = **4.56 Wh** |
| H_P1507 + H_Paux | 2.048 Wh | 0.010 Wh | **2.058 Wh** | same nameplates |

F20: nameplate is not `E_usable`. Gens 200 mAh pack is the only geometric keep-in fit
and its **6 A** label is below F1404 50% four-motor **20.92 A** — current screen **fails**
even if 1.814 Wh < 2.96 Wh. Do not select Gens 200. Do not treat 1.814 Wh as endurance.

## Phase binding

All five hypothesized phases use the same `P_prop` screening row (50%). Climb/approach
are not assigned the 100% row. Reserve has no `t` — no energy term.

| Phase | `t` (from geometry pack) | `P_prop` | `P_aux` | `P_loss` |
| ----- | ------------------------ | -------- | ------- | -------- |
| Climb | 2.5 s | H_P1404 or H_P1507 | 1.785 W | `unresolved` |
| Approach | 4.0 s | same | 1.785 W | `unresolved` |
| Façade zone | 6.494 s | same | 2.0 W | `unresolved` |
| Return | 4.0 s | same | 1.785 W | `unresolved` |
| Land | 2.5 s | same | 1.785 W | `unresolved` |
| Reserve | `unresolved` | — | — | — |

## Test

Measured representative workflow (already recorded) plus a later current/voltage log if
a HOLD lead is ever selected. Reject H_P1404 / H_P1507 if measured four-motor power is
outside the 50% row ± the maker’s “reference only” caveat, or if vehicle mass exceeds
that row’s equivalent supported mass. Never replace a missing `P_*` with `0`.
