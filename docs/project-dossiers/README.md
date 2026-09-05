# Dated project dossier registry (non-authoritative)

Audience: both · Diátaxis: none · Kind: dated dossier registry

Registry reconciled **2026-08-26** (Asia/Taipei). This is the date of the
documentation census, not a claim that every local runtime or persisted record was
observed again on that date. Each row keeps its own stated observation date and scope.

This directory is a **compact Behave product index**. It is documentation only. It does
not store project revisions, Thread artifacts, CAS bytes, provider captures, or signed
decisions. Repository code or configuration, a dated live-runtime observation,
rereadable persisted evidence, and a consequential human decision are separate facts;
presence in this registry cannot substitute for any of them.

## Not a second authority

| Authoritative surface                                                         | Owns                                                  | Tracking pages must not                                         |
| ----------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------- |
| [`EngineeringProjectSnapshot`](../reference/contracts/engineering-project.md) | Live project intent, plan, work, decisions, approvals | Invent a project id, revision, or brief                         |
| [`ThreadSnapshot`](../reference/contracts/thread-snapshot.md) and CAS         | Documentary and technical evidence                    | Treat a markdown row as persisted proof                         |
| Provider captures and registered operations                                   | Execution, lowering, recovery                         | Choose a provider, tool, envelope, or runtime                   |
| Signed MRTR in the paired chat                                                | Consequential human decisions                         | Self-approve, infer L5, or treat an engine success as an oracle |

Actor split: [AGENTS.md](../../AGENTS.md). Pipeline:
[source analysis and authority](../reference/pipeline/analysis-authority-pipeline.md).
Workbench is read-only `GET` + SSE
([product direction](../explanations/product/product-direction.md)).

An internal planning record, a test fixture, a catalog specimen, and a live project are
not substitutes. Living coverage remains in
[domain coverage](../reference/domains/README.md) and the Behave how-tos.

## Registry

| Folder                                                                     | Role                                                                                 | Status page                                        | Live EngineeringProject (primary atelier, latest observation stated per row, local)                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [articulated-led-desk-lamp](articulated-led-desk-lamp/README.md)           | Reference demo (generic Behave surfaces)                                             | [status](articulated-led-desk-lamp/status.md)      | `articulated-led-desk-lamp-al01` project r227; Thread r26. Mechanical/thermal/electrical L3–L5 plus impact recross. Exact dated identities: [runtime evidence](articulated-led-desk-lamp/runtime-evidence.md).                                                                                                                                                                      |
| [capability-lamp-cl01](capability-lamp-cl01/README.md)                     | Capability-runtime, multi-file assembly, prescribed-kinematics and admitted-SPICE canary | [status](capability-lamp-cl01/status.md)            | 2026-09-05: `capability-lamp-cl01` project r195; Thread r26; workspace r41. Four canonical child geometries, one immediate assembly, static-integrity L3–L5, Chrono prescribed-kinematics L1–L5 and circuit-only SPICE L3–L5. Local runtime acquisition is proven; external image distribution remains outside this dossier. [Runtime evidence](capability-lamp-cl01/runtime-evidence.md). |
| [motorized-camera-slider-mcs02](motorized-camera-slider-mcs02/README.md)   | Current-contract workspace, attachment and single-root Behave proving project        | [status](motorized-camera-slider-mcs02/status.md)  | 2026-08-25: `motorized-camera-slider-mcs02` project r146; Thread r20; workspace r15. Separate mechanical, scalar-motion and circuit-current L5 closeouts; no assembly or whole-product verdict. [Runtime evidence](motorized-camera-slider-mcs02/runtime-evidence.md). |
| [desktop-parts-sorter-ps01](desktop-parts-sorter-ps01/README.md)           | Multi-piece MCP authoring and navigation AX proving project                          | [status](desktop-parts-sorter-ps01/status.md)      | 2026-08-25: `desktop-parts-sorter-ps01` project r52; Thread r3; workspace r27. Six typed occurrences, six attached source files, four passed technical parsers at one common workspace basis; compilation preview remains `unresolved`. [Runtime evidence](desktop-parts-sorter-ps01/platform/runtime-evidence.md). |
| [precision-heated-specimen-stage-hs01](precision-heated-specimen-stage-hs01/README.md) | Live Behave pilot for resource-backed CAD, FEA, Modelica, SPICE and cross-domain impact lineage | [status](precision-heated-specimen-stage-hs01/status.md) | 2026-08-24 primary atelier, local runtime observed: `precision-heated-specimen-stage-hs01` project r223. Persisted evidence: Thread r32. Human decisions: mechanical, thermal and electrical L5 closeouts bounded to their exact branch scopes; X09 records electrical `impact-unresolved`, thermal `invalidated` and mechanical `carried-forward`. X11 is documentary preservation without a CalculiX rerun. X10 remains `unavailable`; no whole-product verdict. |
| [low-voltage-heated-mug-coaster](low-voltage-heated-mug-coaster/README.md) | Portability canary (agent-proposed class; human-sourced demo scope; confirmed brief) | [status](low-voltage-heated-mug-coaster/status.md) | `heated-mug-coaster-hc01` project r29 (`heated-mug-coaster-hc01:project:r29:23da822e32f1ae06`). Thread r1 documentary baseline, r2 SysON seed container, r3 single-part architecture, r4 exact PartDefinition reread (`HeatedMugCoaster`; no usages). No requirements, CAD, FEA, Modelica, electrical, or impact. Cockpit primary focus revision 4 is projection only. |
| [two-piece-tablet-stand-tps01](two-piece-tablet-stand-tps01/README.md) | Multi-file, two-part canonical-assembly and correction-loop canary | [status](two-piece-tablet-stand-tps01/status.md) | 2026-08-26: `two-piece-tablet-stand-tps01` project r111; Thread r16; workspace r16. Two canonical part geometries, one versioned placement correction, current contact with zero intersection, static-integrity L3/L4 and bounded human L5 closeout. [Runtime evidence](two-piece-tablet-stand-tps01/runtime-evidence.md). |
| [two-piece-tablet-stand-tps03](two-piece-tablet-stand-tps03/README.md) | From-zero multi-file navigation, canonical assembly and fail-closed FEA-lifecycle canary | [status](two-piece-tablet-stand-tps03/status.md) | 2026-08-27: `two-piece-tablet-stand-tps03` project r135; Thread r17; workspace r18. Two exact multi-file CAD closures, two canonical child geometries, static assembly-integrity L3/L4/L5, one preserved evidence-free CalculiX failure, then a server-derived successful successor and bounded human mechanical L5 closeout. [Runtime evidence](two-piece-tablet-stand-tps03/runtime-evidence.md). |
| [modular-sensor-mount-msm01](modular-sensor-mount-msm01/README.md) | SysML-first, multi-file workspace navigation and immediate-module export canary | [status](modular-sensor-mount-msm01/status.md) | 2026-08-26: `modular-sensor-mount-msm01` project r14; workspace r27. Three canonical child geometries and one exact immediate module STEP/GLB, with static assembly-integrity L3/L4/L5 limited to imported children, placements, BRep validity and pairwise intersection. Multi-file Build123d execution remains `unresolved` / `source.dependency-lowering-unavailable`. [Runtime evidence](modular-sensor-mount-msm01/runtime-evidence.md). |

No registry row is a percentage, a verdict, or permission to invent values, units,
materials, thresholds, parts, or operations.

## Truth-column legend

Use these columns on every status page. A later page must not collapse them.

| Column                        | Means                                                                          | Evidence that may tick it                                 | Must not be filled by                                           |
| ----------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------------- | --------------------------------------------------------------- |
| **Code capability available** | A generic registered operation or public review tool exists in this repository | Registry / living coverage / how-to                       | Internal planning wording, a fixture name, a UI card            |
| **Project/capture written**   | Git or dated local files exist for _this_ product identity                     | Named fixture, internal planning record, or CAS path       | A similar historical vehicle (`desk-lamp-dl05`, CA02)           |
| **Live runtime observed**     | Dated inspection of gitignored local runtime                                   | Directory names under `state/local/engineering-projects/` | Docs, tests, or another machine's atelier                       |
| **Persisted proof**           | Rereadable Thread/CAS identity (id, revision, fingerprint, digest)             | Exact identity from a snapshot or capture store           | A terminal log, solver exit, or “it ran”                        |
| **Human decision**            | Signed MRTR or recorded L5 on those exact identities                           | Project `approvals` / decision records                    | Agent proposal, internal gate text, cockpit focus, or engine success |

`unavailable`, `unresolved`, `error`, `provisional`, `documentary`, `unverified`,
`demo`, `TRACE GAP`, and `UNLINKED` stay literal ([AGENTS.md](../../AGENTS.md)).
Checkboxes mark only facts that can be evidenced. Do not derive a completion percentage
from prose.

A successful engine run is **not** an oracle and **not** L5
([proofs and verdicts](../explanations/product/proofs-and-verdicts.md),
[Behave decision roadmap](../explanations/product/behave-decision-roadmap.md)). `pass`
is L4. Make and Buy are other judgement branches; they do not close Behave
([three judgement branches](../explanations/product/product-direction.md#three-judgement-branches)).

## Local observation rule

`state/local/` is gitignored ([`.gitignore`](../../.gitignore)). It may drift. Name the
atelier, the observation date, and the label **local**. A docs worktree listing is not
the primary atelier. Use the observation date stated in each row: MCS-02 is observed on
2026-08-25, while the unchanged heated-mug-coaster entry retains its earlier
architecture-only observation.
