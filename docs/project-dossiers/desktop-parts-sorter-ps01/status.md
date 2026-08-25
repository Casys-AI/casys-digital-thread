# PS-01 status

Audience: both · Diátaxis: none · Kind: tracking

Thread state observed locally on 2026-08-25. `state/local/` is gitignored and may drift;
the provider smoke below is a separate direct observation that does not alter Thread
state.

| Surface                           | Current fact                                                                                                                                                                                                                                                                |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engineering Project               | `desktop-parts-sorter-ps01` r101; approved brief; all 13 recorded work items completed                                                                                                                                                                                      |
| Thread                            | r10; current snapshot seals canonical Frame geometry                                                                                                                                                                                                                        |
| Product structure                 | One `DesktopPartsSorter` root, six exact typed `PartUsage` occurrences and nine technical `AttributeUsage` handles                                                                                                                                                          |
| Source workspace                  | r31; 8 modules, 6 active files, 6 active attachments                                                                                                                                                                                                                        |
| Electrical                        | SPICE admitted at Thread r5 and executed through ngspice at r6                                                                                                                                                                                                              |
| Behavior                          | Modelica admitted at Thread r7 and executed through OMC/DASSL at r8                                                                                                                                                                                                         |
| Geometry                          | Frame CAD admitted at Thread r9; exact PartDefinition STEP and GLB sealed at r10                                                                                                                                                                                            |
| Assembly-integrity provider smoke | Direct normal-fleet `mcp-build123d` 0.5.0 smoke over exact local STEP `415401322b6ce4678db220c4ad34358a788c73ce81a58745fa0e9e735a5d4968` (97,975 bytes): valid BRep, 6 solids, 6 shells, 6 occurrences, 15 zero-volume no-contact pairs; outside the current Digital Thread |
| Assembly-integrity Digital Thread | Pending: no `verify.observe-assembly-integrity@1` L3 capture, `verify.evaluate-assembly-integrity@1` L4 capture, or human L5 closeout/gate result                                                                                                                           |
| Remaining compile gap             | Diverter multi-file CAD stays `source.dependency-lowering-unavailable`                                                                                                                                                                                                      |
| Workbench                         | Product structure 7/7; Frame geometry opens; unavailable component geometry buttons stay disabled                                                                                                                                                                           |
| Verdict                           | zero requirement, evaluation or verdict recorded                                                                                                                                                                                                                            |

The project has proved incremental multi-file authoring, graph navigation and three
single-root technical verticals. Its `Completed` activity status is not product
completion: the direct provider smoke does not create a Digital Thread
assembly-integrity run, FEA, routing evaluation, L4, or L5 claim.
