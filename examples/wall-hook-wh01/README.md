# WH01 wall hook — public two-file CAD source

Checked-in Build123d 3.0 closed-subset source for a **new** Behave-only wall-hook
project. It is not historical `wall-hook-wh01`, `dl04`, or `dl05` state, and it is not a
live Thread record.

Walk:
[Verify a new wall hook from source](../../docs/how-to/verify-design/verify-a-new-wall-hook-from-source.md).
Contract:
[Build123d workspace-closure lowering v1](../../docs/reference/domains/cad/build123d-workspace-closure-lowering-v1.md).

| Workspace `fileId` | File                           | Role in the V1 closure                                            |
| ------------------ | ------------------------------ | ----------------------------------------------------------------- |
| `wh01-dimensions`  | [dimensions.py](dimensions.py) | Direct scalar-leaf: `length`, `width`, `thickness` in millimetres |
| `wh01-hook`        | [hook.py](hook.py)             | Executable root: `Box(length, width, thickness)`                  |

The root imports the leaf only as `casys_workspace.f_<UTF-8-file-id-hex>`. That virtual
module is `casys_workspace.f_776830312d64696d656e73696f6e73`. Do not rename a `fileId`
without rewriting the import. Do not add a generated script, a lowerer, or another
source shape.

Optional MCP helper for the dynamic resource-reference and revision handoff:
`deno task probe:wall-hook-wh01-source --project-id=<id>`. It talks only to
`http://127.0.0.1:3020/mcp`. It does not attach the root, admit source, or run FEA.
