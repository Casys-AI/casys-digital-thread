# How-to: author and seal architecture SysML

Audience: agent · Diátaxis: how-to · Kind: how-to

Use this when an agent must capture SysML that matches the locked architecture closed
subset, preview the analysis, and later seal it as a Thread document.

This is **not** `model.write-architecture@1`. That operation renders SysML from flat
MRTR parameters and inserts into SysON. This path never calls SysON.

![Renderer path versus agent-authored seal. Different capture schemas, operations, and grants.](../../media/sysml-two-paths.svg)

## Preconditions

- Digital Thread MCP is running (`deno task start` or `deno task dev`).
- The project already has a Thread basis if you intend to queue
  `model.seal-architecture-sysml@1`. Capture and preview themselves do not require a
  project.
- Profile id is exactly `sysml-architecture-closed-subset-v1`. No other profile is
  registered.

## Closed subset

The tokenizer admits only keywords, identifiers, `{`, `}`, `:`, and `;`. Comments,
strings, numbers, and attributes are rejected at the lexical guard.

The parser then accepts **exactly one** of these write forms:

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
part usage wing : Wing;
```

Anything else that still tokenizes is recorded as `unresolved`. Unresolved is always
returned. It is never omitted. A preview with unresolved may still be useful as a
diagnostic; a seal requires analysis policy status `passed`.

Bindings later consumed from a sealed document are **symbol ids**, never labels.

## 1. Capture exact bytes

First call `project_resource_capture` with the `.sysml` UTF-8 (`text/x-sysml` or
`text/plain`). Then call `project_architecture_sysml_source_capture` with:

| Field         | Rule                                  |
| ------------- | ------------------------------------- |
| `profileId`   | `sysml-architecture-closed-subset-v1` |
| `sourceId`    | Caller-chosen stable id               |
| `resourceRef` | Full reference from the upload        |

The tool writes draft CAS under
`state/local/recorded-analysis/architecture-sysml/{sources,analyses}` and returns an
opaque `architecture-sysml-source-analysis-capture/1.0` reference.

Preserve that object verbatim. Do not rebuild it from hashes you typed.

This creates no `EngineeringProject`, no Thread revision, no MRTR, and no SysON element.

## 2. Preview

Call `project_architecture_sysml_preview` with the opaque `sourceRef` from that capture.
A reopened passed capture may include `decisionParameters`. Those are the only values
allowed in a later `model.seal-architecture-sysml@1` proposal. This path does not call
SysON. `model.write-architecture@1` remains the renderer path.

Treat `status !== "ready-for-review"` as diagnostic. Do not invent missing parameters.

## 3. Propose and seal

Only after a passed captured preview:

1. `project_change_append` — work item `model.seal-architecture-sysml@1` plus its
   required decision in the **same** append.
2. `project_decision_propose` — parameters copied from `decisionParameters` in the exact
   order returned. The grammar is the 14 keys in
   [`architecture-sysml-seal-proposal.ts`](../../../src/domain/architecture/agent-seal/architecture-sysml-seal-proposal.ts).
3. Human `project_decision_approve` (MRTR).
4. `project_agent_run_queue` then `project_agent_run_execute`.

The executor reopens the exact CAS identities, writes
`architecture-sysml-seal-capture/1.0`, and adds one Thread **document**.

The Workbench treats that document as Activity evidence when its id starts with
`architecture-sysml-seal-`. Its generic record inspector shows exact identity and
provenance only. It does not reopen `sourceText`, interpret symbols or render a native
SysML seal surface. A domain presentation is available only through one explicitly
registered whole App for the exact recorded anchor; zero or multiple matches stay
unavailable or ambiguous. The seal is not Product Structure and not a SysON model.

It does **not**:

- insert into SysON
- reuse `compile.seal-admission@3`
- accept a renderer `sysml-source-capture/1.0` envelope as agent-authored authority

## Fail closed

| Symptom                                                               | Meaning                            | Recovery                                   |
| --------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------ |
| Lexical error (`comment_not_qualified`, `attribute_not_qualified`, …) | Bytes are outside the subset       | Rewrite source; do not strip diagnostics   |
| `syntax_not_recognized`                                               | Not one of the three write forms   | One form per source                        |
| Unresolved constructs in preview                                      | Extra SysML that tokenized         | Keep them visible; do not seal as `passed` |
| Preview without `decisionParameters`                                  | Raw-text preview or failed capture | Capture first, then preview the reference  |
| Mixing this seal with `model.write-architecture@1`                    | Different authorities              | Use write-architecture to change SysON     |

## Related

- Authority and lookalikes: [agent workspace](../../reference/agent/agent-workspace.md)
- Pipeline:
  [analysis-authority-pipeline](../../reference/pipeline/analysis-authority-pipeline.md#implemented-agent-authored-architecture-sysml-slice)
- SysON insertion path: `model.write-architecture@1` in
  [engineering-project](../../reference/contracts/engineering-project.md)
