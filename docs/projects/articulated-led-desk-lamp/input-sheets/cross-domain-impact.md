# G6 — cross-domain impact input sheet

Audience: human · Diátaxis: how-to · Kind: decision input

Status: `reviewed YOLO decision` on 2026-08-23 for project
`articulated-led-desk-lamp-al01` at Thread r22 snapshot
`project:articulated-led-desk-lamp-al01:r22:decide-accept-admitted-spice-evaluation-run:al01-queue-admitted-spice-closeout-r21-20260823`.
This is a documentary causal judgement, not a product pass.

## Change and causal map

| Required fact                                        | Human/source entry |
| ---------------------------------------------------- | ------------------ |
| Current product and Thread revision                  | Project `articulated-led-desk-lamp-al01`; Thread r22 snapshot `project:articulated-led-desk-lamp-al01:r22:decide-accept-admitted-spice-evaluation-run:al01-queue-admitted-spice-closeout-r21-20260823` |
| Exact proposed power or brightness change            | Adopt the accepted G5 source-delivered power observation `0.345924 W` as a candidate shared power-coupling input. It would replace the isolated G4 `5 W` assumption only on a future branch rerun; it does not silently mutate that G4 assumption now. Not a brightness change. |
| Change source, revision, and fingerprint             | Source change id `decide-accept-admitted-spice-evaluation-run:al01-queue-admitted-spice-closeout-r21-20260823:created:spice-admitted-observation-evaluation-closeout-0b7866266962f7dad56b2502d5a3e35ec28c180da8b91650bc78bd6b74f6db5b`; source artifact `spice-admitted-observation-evaluation-closeout-0b7866266962f7dad56b2502d5a3e35ec28c180da8b91650bc78bd6b74f6db5b`; fingerprint `sha256:0b7866266962f7dad56b2502d5a3e35ec28c180da8b91650bc78bd6b74f6db5b` |
| Electrical inputs/artifacts affected and why         | Positive causal edge: that accepted G5 observation is a candidate shared power-coupling input for the electrical branch. Exact existing electrical results are proposed `invalidated` by this impact judgement. |
| Thermal inputs/artifacts affected and why            | Positive causal edge: the same `0.345924 W` observation is the candidate replacement for isolated G4 `electricalPower = 5 W` on a future thermal rerun. Exact existing thermal results are proposed `invalidated`. The current G4 admitted source is not mutated now. |
| Mechanical inputs claimed independent                | No positive causal edge from this power observation to mechanical FEA inputs. Mechanical is proposed `carried-forward` only after exact recross of the current FEA execution evidence, every verified input consumption, and the accepted mechanical L5 closeout. |
| Positive evidence supporting mechanical independence | That recross of the current FEA execution evidence, every verified input consumption, and the accepted mechanical L5 closeout. Silence is not independence. |

## Consequences

| Required fact                                                     | Human/source entry |
| ----------------------------------------------------------------- | ------------------ |
| Expected electrical gate transition                               | Proposed `invalidated`. Generic X10 is `unavailable`; no solver rerun is hidden or automatically queued. |
| Expected thermal gate transition                                  | Proposed `invalidated`. Generic X10 is `unavailable`; no solver rerun is hidden or automatically queued. |
| Expected mechanical gate transition                               | Proposed `carried-forward` only after the exact recross named above. Silence is not independence. |
| Required branch reruns, each through its own registered operation | None queued by this judgement. Generic X10 is `unavailable`. Any later electrical or thermal rerun is a separate registered operation. |
| Intended impact decision and responsible reviewer                 | Documentary causal judgement: adopt the named G5 observation as candidate shared power-coupling input; propose electrical and thermal `invalidated` and mechanical `carried-forward` after recross. Origin/reviewer `local-yolo:startup-opt-in` under `conversation:2026-08-23:yolo-g6-impact`. |

Silence is not independence. An unavailable electrical vertical remains `unavailable`;
an absent causal edge remains `impact-unresolved`. The impact decision itself does not
run ngspice, OpenModelica, or CalculiX and does not authorize hidden cascades.

Observed AL01 execution after this sheet (not this sheet itself): Thread r23 sealed the
manifest, r24 proposed electrical `invalidated`, thermal `invalidated`, mechanical
`carried-forward`, r25 applied those exact statuses, r26 confirmed mechanical
`carried-forward`. Generic X10 stayed `unavailable`. G6 remains a proposed shared
coupling input for a future re-run, not a thermal result.

This sheet is not a product pass, a safety or certification claim, a physical equality
of electrical power and heat, or an automatic rerun.
