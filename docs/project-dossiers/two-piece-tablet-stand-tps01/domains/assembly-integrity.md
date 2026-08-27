# TPS01 — assembly-integrity evidence

Audience: both · Diátaxis: explanation · Kind: dated verification trace

TPS01 completed two distinct, exact static-assembly sequences. The current sequence is
the r13 successor module after the placement-only correction. It is not a retroactive
reinterpretation of the earlier r9 result.

| Sequence | Stage | TPS01 evidence |
| --- | --- | --- |
| Initial r9 module | L3 r10 | Imported two valid solids; 28 mm gap; zero intersection volume |
| Initial r9 module | L4 r11 | All five static criteria `pass` |
| Initial r9 module | L5 r12 | Human acceptance of that static result only |
| Current r13 module | L3 r14 (`e809d4bbe810…`) | Imported two valid solids; exact placements; contact; minimum distance 0 mm; intersection volume 0 mm³ |
| Current r13 module | L4 r15 (`55418ae3f8f4…`) | All five static criteria `pass` |
| Current r13 module | L5 r16 (`c5df1a23284e…`) | Human acceptance; `verification.assembly-integrity` is current |

The five L4 criteria are exact import, occurrence coverage, placement recross, BRep
validity, and pairwise positive-interference detection. Contact and minimum distance
are L3 facts, not an L4 clearance, joint, or assemblability criterion. Thus the current
acceptance does not show a physical joint, a clearance envelope, permitted motion,
loading or strength, safety, manufacturability or fabricability, certification, or
product fitness.

The exact r14–r16 capture identifiers are recorded in
[runtime evidence](../runtime-evidence.md).

The canonical contract is the [assembly-integrity reference](../../../reference/domains/cad/assembly-integrity.md).
The executable procedure, including the review and closeout boundaries, is the
[assembly-integrity how-to](../../../how-to/verify-design/verify-assembly-integrity.md).
