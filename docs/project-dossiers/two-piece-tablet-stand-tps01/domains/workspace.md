# TPS01 — project source workspace

Audience: both · Diátaxis: explanation · Kind: dated source trace

Workspace r16 has three modules, five files and four active attachments. Its final
`project-source-workspace-event/4.0` fingerprint is
`sha256:f2274e70724c91445f44055c36bc0d4a2492e26f6e6eb2f91f9a60e3efb288a1`.
Every active attachment head has an exact basis.

| Source role | Closure | Target surface |
| --- | --- | --- |
| StandBase CAD root | Two files, one direct edge | `StandBase` PartDefinition |
| StandBackrest CAD root | Two files, one direct edge | `StandBackrest` PartDefinition |
| Immediate placement | One file | The two immediate PartUsages |

The placement file kept its identity while its revision advanced r1 → r2. That change
only moved the backrest from `[0, 72, 8]` mm to `[0, 44, 8]` mm. It was recrossed at
workspace r15; the r13 canonical successor reopened that exact corrected basis.
After the L5 Thread successor reached r16, one final atomic batch recross advanced the
workspace to r16 and aligned all four active attachment heads with that current Thread
basis. The workspace-r16 fingerprint above belongs to this final batch event, not to
the earlier placement-only recross at workspace r15.

MCP graph navigation and multi-file resource reread worked for this source tree. The
record establishes exact recorded bytes and the current bounded deterministic
closure/lowering only. It does not establish semantic compilation of arbitrary
inter-file Python imports.
