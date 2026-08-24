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

`captureRequest` is a caller-authored requested parser/source identity (`profileId` +
`sourceId`). Vertical 1 stores it inertly and grants nothing. It is not a registered
profile, compilation-profile, provider, tool, image, executable, endpoint, credentials,
or runtime selection. Vertical 2 will resolve it fail-closed against the registry.
Workspace records cannot represent those fields.

`project_resource_capture` remains the only byte ingress. File put accepts a full
`AgentResourceReference` and reopens it exactly before the event is accepted.
