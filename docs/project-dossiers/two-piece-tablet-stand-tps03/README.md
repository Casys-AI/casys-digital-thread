# Two-piece tablet stand — TPS03

Audience: both · Diátaxis: none · Kind: dated canary dossier

Local **Behave** canary observed on **2026-08-26 and 2026-08-27** (Asia/Taipei). This folder records
what a fresh agent-driven project actually exercised. It is not project authority, an
engineering verdict, or a completion percentage.

## Purpose

`two-piece-tablet-stand-tps03` tests the intended scalable authoring path from zero:
a SysML product graph, several versioned files, exact source attachments on definitions
and usages, graph navigation, deterministic multi-file CAD closures, canonical child
geometry, canonical assembly, static assembly-integrity evidence, and one bounded FEA
branch through human L5 closeout.

The demo geometry uses a 120 × 80 × 8 mm base and a 120 × 8 × 100 mm backrest. The
base placement is `[0, 0, 0]` mm and the backrest placement is `[0, 44, 8]` mm. These
are authorized canary hypotheses, not requirements or validated design values.

## Pages

| Page | Owns |
| --- | --- |
| [status](status.md) | Literal status by exercised surface |
| [runtime evidence](runtime-evidence.md) | Exact local revisions, capture identities and asset digests |
| [SysML](domains/sysml.md) | Product graph, usages and requirement identity |
| [workspace](domains/workspace.md) | Multi-file tree, attachments, closures and recross |
| [CAD](domains/cad.md) | Canonical child geometry and assembly |
| [assembly integrity](domains/assembly-integrity.md) | Bounded L3/L4/L5 static evidence |
| [FEA](domains/fea.md) | Sealed proof, preserved failed revision, successful successor and L5 |
| [platform frictions](platform-frictions.md) | Generic AX and architecture findings |

## Deliberate boundary

The static assembly and isolated-backrest static gates are current. The first FEA run
remains a literal evidence-free `isolated_output_validation_failed` history item. A
separate server-derived successor completed, published exact CalculiX/SysON evidence,
evaluated both declared criteria as `pass`, and received a human L5 acceptance. The
successor does not repair, retry or reinterpret the failed run.

The assembly sequence proves only exact import, occurrence coverage, placement recross,
BRep validity and absence of positive pairwise intersection. It proves no joint,
clearance envelope, movement, load capacity, safety, manufacturability, certification
or whole-product fitness. Make and Buy are outside this dossier.
