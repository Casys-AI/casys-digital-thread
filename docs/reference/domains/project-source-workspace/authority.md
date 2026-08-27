# Project source workspace — authority

Audience: agent · Diátaxis: reference · Kind: contract

| Boundary                 | Owns                                                      | Does not own                                      |
| ------------------------ | --------------------------------------------------------- | ------------------------------------------------- |
| Agent resource CAS       | Exact immutable bytes                                     | Project membership, a current version, execution  |
| Project source workspace | Logical file identity, path, revision, draft dependencies | MRTR, providers, tools, Thread evidence, verdicts |
| Engineering Project      | Reviewed work, decisions, runs and their exact bases      | Editable source bytes                             |
| Engineering Thread       | Published evidence and exact lineage                      | Draft authoring state                             |

A workspace `current` file revision is current only inside that workspace. Product
authority begins only when a later reviewed operation names and re-opens exact workspace
file revisions.

`captureRequest` is exactly `{profileId}`. Vertical 2 resolves it fail-closed against
the registered technical-source catalogue. The registered profile owns the analyzer
language and analyzer role; the workspace file `role` remains an authoring
classification for navigation and is not a duplicate analyzer selector. It is not a
compilation-profile, provider, tool, image, executable, endpoint, credentials, or
runtime selection. Workspace records cannot represent those fields.

A multi-file project compiles only from one common workspace basis: the same
`projectId`, the same `workspaceRevision`, and the same `workspaceEventFingerprint`. An
unchanged sibling is recaptured at that common revision rather than mixed with an
earlier snapshot. A later sibling bump does not reuse an earlier fingerprint at the same
numeric revision.

`project_resource_capture` remains the only byte ingress. File put accepts a full
`AgentResourceReference` and reopens it exactly before the event is accepted. A later
correction is a new resource plus a successor file revision, then a new technical-source
capture.
