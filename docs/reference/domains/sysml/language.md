# Reference: SysML language

Audience: both · Diátaxis: reference · Kind: contract

This repository treats SysML as **textual UTF-8**. Language id `sysml-v2` is a closed
label on that text, not generic SysML v2. There is no XMI or XML authoring path.

The only registered agent-authored profile is `sysml-architecture-closed-subset-v1`
(`1.0.0`, role `sysml-model`, analyzer `architecture-sysml-qualified` `1.0.0`). Ceiling:
262144 UTF-8 bytes (`MAX_ARCHITECTURE_SYSML_SOURCE_BYTES` and
`AGENT_RESOURCE_MAX_BYTES`). Renderer surface and exclusions:
[coverage](coverage.md). Byte cardinality: [boundedness](boundedness.md).

Authorities:
[`architecture-sysml-lexical.ts`](../../../../src/domain/architecture/agent-seal/architecture-sysml-lexical.ts),
[`architecture-sysml-parse.ts`](../../../../src/domain/architecture/agent-seal/architecture-sysml-parse.ts),
[`architecture-sysml-tools.ts`](../../../../src/tools/project-control/architecture-sysml-tools.ts).

## Closed-subset tokens

The lexical guard admits only:

- keywords `package`, `part`, `def`
- identifiers `^[A-Za-z][A-Za-z0-9_]*$`
- `{` `}` `:` `;`
- ASCII whitespace (space, tab, LF, CR)

It fail-closes on comments (`//`, `/*`, `--`, `#`), strings, numeric literals, `@`, and
any other character (`unrecognized_token`). Empty source is `empty_source`. Oversize is
`source_too_large`.

## One source is one accepted form

`parseArchitectureSysmlSubset` accepts **exactly one** of these write forms per source:

```sysml
package DroneV4 {
  part def DroneSystem {
    part wing : Wing;
    part motor : Motor;
  }
  part def Wing {}
  part def Motor {}
}
```

```sysml
part def Wing {
  part motor : Motor;
}
```

```sysml
part wing : Wing;
```

A PartUsage name must also match `^[a-z][A-Za-z0-9_]*$`. A source that does not start as
one form is `syntax_not_recognized`. Extra tokenizable constructs, including a remainder
after the first form, are `unresolved` (`sysml-construct-not-qualified`) and are never
omitted.

`model.write-architecture@1` may also render bare `attribute <name>;`. That is **not** a
closed-subset write form; the agent-authored parser records it as `unresolved`.

## Ingress

Public architecture capture takes `profileId`, `sourceId`, and the full `resourceRef`.
It has no `sourceText` field. Preview takes that opaque `sourceRef` only.

```text
project_resource_capture
  → full AgentResourceReference (resourceRef)
  → project_architecture_sysml_source_capture
      (profileId, sourceId, resourceRef)
```

MIME allowlist after reopen: `text/x-sysml`, `text/plain`. The server copies exact UTF-8
bytes; MIME is a guard, not a parser selector. How-to:
[capture an agent resource](../../../how-to/compile/capture-an-agent-resource.md).

## Resource immutability and successor upload

Raw resources are content-addressed (`casys://agent-resource-capture/sha256/<digest>`).
`FileByteStore` never overwrites an existing digest (`link(2)` / `AlreadyExists`). Same
bytes are idempotent. Changed bytes are a **new** resource.

One-file incremental edit is that successor: read, modify, `project_resource_capture`
again, then pass the **new** full `resourceRef` into architecture capture. `sourceId` is
a caller-chosen capture field; it is not lineage. `AgentResourceReference` has no
predecessor, supersedes, or source-set field (`additionalProperties: false`).

A source-set / import graph is **unavailable**. A future `source-set-manifest` is a
candidate in a typed domain or project layer only. It is not a predecessor field on raw
`AgentResourceReference`. It is **not implemented**.

## Literal unavailable

These stay literal. They are not hidden support:

- generic SysML v2
- XMI / XML
- `import`, include, multi-file, source-set, import graph
- public `sourceText` on architecture capture or preview
- comments, strings, numbers, `@`, typed/valued attributes on this closed subset
