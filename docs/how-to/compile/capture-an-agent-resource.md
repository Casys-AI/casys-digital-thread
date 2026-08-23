# How-to: capture an agent resource

Audience: agent · Diátaxis: how-to · Kind: how-to

Use this when an agent must put one small file into draft CAS, then feed an existing
domain capture. This is not admission and not a microVM input.

Why: [MCP resource ingress](../../explanations/runtime/mcp-resource-ingress.md).
Contract: [agent workspace](../../reference/agent/agent-workspace.md#agent-resource-ingress-draft-mcp-resource).

## Preconditions

- Digital Thread MCP is running on loopback (`deno task start` or `deno task dev`).
- The payload is at most 262144 bytes. Not STEP, STL, or images.
- You have a display `name` (not a path) and a nonempty MIME type from the domain set
  below.

## 1. Upload once

Call `project_resource_capture` with `name`, `mimeType`, and exactly one of UTF-8
`text` or canonical padded standard-base64 `blob`. Do not send a path, project id,
fingerprint, CAS URI, provider, runtime, or MRTR.

Keep the structured `reference` (`AgentResourceReference`) verbatim. `resources/read`
projects those bytes; it is not a second upload. Roots carry no payload.

## 2. Pass `resourceRef` to the domain capture

| File                         | MIME guard                                         | Next public tool                                    |
| ---------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| Build123d `.py`              | `text/x-python`, `text/plain`                      | `project_technical_source_capture`                  |
| Modelica `.mo`               | `text/x-modelica`, `text/plain`                    | `project_technical_source_capture`                  |
| SPICE `.cir`                 | `text/x-spice`, `application/x-spice`, `text/plain` | `project_technical_source_capture`                  |
| Architecture `.sysml`        | `text/x-sysml`, `text/plain`                       | `project_architecture_sysml_source_capture`         |
| FEA proof-case JSON          | `application/json`, `text/plain`                   | `project_fea_proof_case_capture`                    |
| Impact manifest JSON         | `application/json`, `text/plain`                   | `project_cross_domain_impact_manifest_capture`      |
| LED-driver human-source JSON | `application/json`, `text/plain`                   | `project_led_driver_source_capture`                 |

Technical capture still names `profileId` and `sourceId`. Architecture SysML capture
still names `profileId` (`sysml-architecture-closed-subset-v1`) and `sourceId`. The
other captures take `resourceRef` only. None of them accept `sourceText`.

MIME does not choose the parser. `profileId` / the closed domain schema does.

## Method sheets

`modelica-thermal-method-sheet/1.0` and `electrical-observation-method-sheet/1.0` are
interpreted inside `project_resource_capture` by the existing codecs. Pass
`interpretation.typed.fingerprint` to the existing seal-review tools. Do not invent a
second capture tool. Do not pass raw CAS to a microVM.

## Do not

- Do not pass raw CAS to a microVM. Isolated execution remains
  `compile.seal-admission@1` → `ReopenAdmittedCompilationSource` →
  `IsolatedCodeRunner`.
- Do not treat `model.write-architecture@1` as the agent-authored SysML path. That
  operation still renders into SysON. `model.seal-architecture-sysml@1` never writes
  SysON.
- Do not upload large binaries. The 256 KiB bound is the source-document ceiling.
