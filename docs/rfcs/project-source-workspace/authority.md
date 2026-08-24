# Authority and boundaries

## Four different things

| Boundary | Owns | Does not own |
| --- | --- | --- |
| Agent resource CAS | Exact immutable bytes | Project membership, a current version, execution authority |
| Project source workspace | Logical file identity, path, revision and draft dependencies | MRTR, providers, tools, Thread evidence, verdicts |
| Engineering Project | Reviewed work, decisions, runs and their exact bases | Editable source bytes |
| Engineering Thread | Published evidence and exact lineage | Draft authoring state |

Keeping these boundaries separate is intentional. A source file may exist in CAS
without belonging to a project. Attaching it to a workspace still does not make it an
admitted compilation. A reviewed operation must name and re-open the exact source-file
revisions it consumes.

## Actor rules

- The agent may upload bytes, create and revise logical files, organise modules, and
  declare draft dependencies.
- The server validates identities, predecessors, paths, project scope, graph integrity
  and byte references. It owns profile resolution, lowering, runtime and recovery.
- A human decision is still required wherever the registered operation is
  consequential. Local YOLO may exercise only the existing explicit human delegation.
- The Workbench remains a read-only projection. It may display the source tree but
  cannot mutate it.

## No second product authority

The workspace is a draft-authoring bounded context, comparable to a source working
tree. Its `current` file revisions are current only inside that workspace. They are not
current product evidence. Product authority begins only when an operation seals exact
workspace file revisions into the Engineering Thread.

The workspace therefore lives in a dedicated append-only store keyed by `projectId`.
It must not inline its state into every Engineering Project or Thread revision.
