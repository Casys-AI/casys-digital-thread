# TPS03 — assembly-integrity evidence

Audience: both · Diátaxis: explanation · Kind: dated verification trace

TPS03 completed one exact static assembly-integrity sequence against the r11 canonical
module.

| Stage | Exact evidence | Bounded result |
| --- | --- | --- |
| L3 r12 | `assembly-integrity-observation-06c7252971e8…` | Imported two solids; occurrence and placement coverage exact; BReps valid; zero positive pairwise intersection |
| L4 r13 | `assembly-integrity-evaluation-42402a50ab4e…` | Five literal criteria `pass` |
| L5 r14 | `assembly-integrity-evaluation-closeout-b4918b9b845f…` | Human acceptance; `verification.assembly-integrity` current |

The five L4 criteria are import, occurrence coverage, placement recross, BRep validity
and pairwise positive-interference detection. They do not establish a physical joint,
minimum-clearance envelope, allowed movement, load capacity, safety, manufacturability,
certification or whole-product fitness.

The first L5 work item omitted the gate claim required by the accept operation. Its run
was cancelled and history preserved; a successor exact work item completed. That is an
agent-experience defect, not an alternative engineering result. The closeout review
surface is being tightened to return a server-derived append template so the same
omission cannot recur.

The generic contract remains the
[assembly-integrity reference](../../../reference/domains/cad/assembly-integrity.md),
and the operation sequence remains the
[assembly-integrity how-to](../../../how-to/verify-design/verify-assembly-integrity.md).
