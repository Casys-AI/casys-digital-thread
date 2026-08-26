# TPS03 — project source workspace

Audience: both · Diátaxis: explanation · Kind: dated source trace

Workspace r18 contains three modules, five files and four active attachments. Its final
hash-chained event fingerprint is
`sha256:7eff1cfc15f00c4a51020aa1e12ee2124c7d76ead94fe8d99c0d1e0db98a462e`.

```text
/assembly/immediate-placements
/base/base.py
/base/base_dimensions.py
/backrest/backrest.py
/backrest/backrest_dimensions.py
```

| Source head | Target | Reread closure |
| --- | --- | --- |
| `attach.tps03.base` r7 | StandBase PartDefinition | Two files, one dependency, status `observed` |
| `attach.tps03.backrest` r7 | StandBackrest PartDefinition | Two files, one dependency, status `observed` |
| `attach.tps03.placement.standBase` r4 | standBase PartUsage | One shared immediate-placement file |
| `attach.tps03.placement.standBackrest` r4 | standBackrest PartUsage | One shared immediate-placement file |

The Base and Backrest closure fingerprints are respectively
`sha256:b3149bd97de2533ee114ba826e25111f4da5edfae68e7e64433639f6c37335d9`
and
`sha256:057bd643b494f49cef1a82f53a083d173846072c4d7d54acef25910875c35205`;
their exact closure documents contain no diagnostic. The final atomic recross at
workspace r18 aligned all four heads to Thread r17 without rewriting their source
bytes.

The Backrest root file was then followed from `project_source_file_read` to its exact
`resources/read` URI. The MCP returned 229 UTF-8 bytes with MIME `text/x-python` and
the expected digest `0bb682900af6c31618cda39c4b91b8d644419d197f67fefd55d603c80d63ceee`.

This proves versioned multi-file navigation, exact attachment targeting, dependency
reread and the registered Build123d direct-scalar-leaf lowering. It does not prove
semantic compilation of arbitrary Python imports.

The two CAD roots retain historical file identifiers named `file.tps02.*`. The bytes
and TPS03 attachments are exact, but those embedded identifiers expose a portability
friction. A future symbolic-import or source-template contract should solve that; a
closeout patch must not rewrite persisted source history.
