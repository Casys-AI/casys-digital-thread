# Explanation: MCP resource ingress

Audience: agent · Diátaxis: explanation · Kind: contract

Why a small agent-authored file enters the atelier as an MCP resource, and why later
domain captures accept only that full `resourceRef`.

How-to: [Capture an agent resource](../../how-to/compile/capture-an-agent-resource.md).
Tools:
[agent workspace](../../reference/agent/agent-workspace.md#agent-resource-ingress-draft-mcp-resource).
Lookalikes: [lookalike traps](../../reference/agent/lookalike-traps.md). Isolated
execution still starts from
[admitted source isolated execution](../../reference/pipeline/admitted-source-isolated-execution.md).

## Two MCP directions

`project_resource_capture` is a mutating `tools/call`. The client sends bytes in the
tool arguments. That is the only client-to-server upload for small agent-authored files.

`resources/read` is a server-to-client projection of a URI the server already minted. It
cannot accept an upload. MCP roots advertise URIs only; they carry no bytes.

## Public captures take `resourceRef` only

After upload, `.py`, `.mo`, `.cir`, `.sysml`, FEA JSON, impact JSON, and LED-driver JSON
enter their existing parsers through `project_resource_capture` then a full
`AgentResourceReference` (`resourceRef`). Public tools no longer accept `sourceText`.
MIME is a guard (small compatible set per domain), not a parser selector and not a
filename inference.

`model.write-architecture@1` remains the server-owned renderer/SysON path. A `.sysml`
resource replaces only the public inline source of
`project_architecture_sysml_source_capture`; `model.seal-architecture-sysml@1` still
never writes SysON.

Method sheets stay on the two automatic closed codecs inside `project_resource_capture`
and their existing seal reviews. There is no second capture tool per domain.

## Two fingerprints

The raw byte fingerprint is SHA-256 of the exact captured payload. The server mints
`casys://agent-resource-capture/sha256/<digest>` from those bytes.

A later domain capture reopens those bytes, then canonicalizes. The typed/domain
fingerprint (technical analysis, FEA case, impact manifest, LED-driver fiche, method
sheet) may differ from the raw SHA and must stay explicit.

Unknown JSON, non-JSON, or an unregistered `schemaVersion` stays `raw` at upload.
Declared `modelica-thermal-method-sheet/1.0` or
`electrical-observation-method-sheet/1.0` that fails validation stays `unresolved`
without a typed reference. Executable `.py`/`.mo`/`.cir` is never auto-dispatched
through those JSON codecs.

## Bounds that stay literal

- Payload: at most 262144 bytes (the source-document ceiling). STEP, STL, and images
  stay outside this contract.
- Process: the Console MCP binds loopback only.
- Registry: `@casys/mcp-server` 0.26 keeps a process-local resource map. Bind restores
  it from the on-disk payload store and sidecar metadata. `resources/list` currently
  lists that whole map with no per-resource auth or pagination policy.

## Authority that does not move

Raw CAS never goes to a microVM. Technical source still goes through capture analysis,
`compile.seal-admission@3`, `ReopenAdmittedCompilationSource`, and `IsolatedCodeRunner`.
Seal reviews stay read-only. Operation/MRTR ownership is unchanged. `grants: none` on
draft capture.
