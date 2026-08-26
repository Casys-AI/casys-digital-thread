# Two-piece tablet stand — TPS01

Audience: both · Diátaxis: none · Kind: dated canary dossier

Local **Behave** canary observed on **2026-08-26** (Asia/Taipei). This compact
folder records what was exercised through the Digital Thread; it is not a source of
project authority, an engineering verdict, or a completion percentage.

## Purpose

`two-piece-tablet-stand-tps01` is a deliberately plain two-part product used to test
the useful path end to end: SysML product graph, several attached source files,
multi-file Build123d lowering for each child, canonical part geometries, exact
placement capture, then one canonical assembly.

The working dimensions are authorized **demo hypotheses**: a 120 × 80 × 8 mm base and
a 120 × 8 × 100 mm backrest. The base remains at `[0, 0, 0]` mm; the initial backrest
translation `[0, 72, 8]` mm was later corrected to `[0, 44, 8]` mm. These are canary
inputs, not requirements, physical claims or verdicts.

## Pages

| Page | Owns |
| --- | --- |
| [status](status.md) | Bounded status by surface |
| [runtime evidence](runtime-evidence.md) | Exact recorded Thread, capture and asset identities |
| [SysML](domains/sysml.md) | Product graph and attachment targets |
| [workspace](domains/workspace.md) | Exact source heads, closures and recross boundary |
| [CAD](domains/cad.md) | Multi-file child geometry and canonical assembly |
| [assembly integrity](domains/assembly-integrity.md) | Bounded L3/L4/L5 static evidence and its limits |
| [platform frictions](platform-frictions.md) | Generic agent-experience findings, not product claims |

## Deliberate boundary

The first canonical two-part STEP and GLB were sealed at Thread r9, with the backrest
at `[0, 72, 8]` mm. Its static-integrity sequence completed at r12. A successor
placement-file revision changed only that backrest translation to `[0, 44, 8]` mm;
the recrossed canonical module at r13 is the current geometry. Its L3 observation,
L4 five-criterion evaluation and human L5 acceptance completed at r14–r16.

That acceptance concerns the literal static assembly-integrity gate only. It does not
claim a physical joint, a clearance envelope, permitted motion, load capacity, safety,
manufacturability or fabricability, certification, or general product fitness.

The generic static-assembly boundary is described in the
[CAD reference](../../reference/domains/cad/assembly-integrity.md); the procedure is
the [assembly-integrity how-to](../../how-to/verify-design/verify-assembly-integrity.md).
