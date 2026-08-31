# How-to: capture an agent resource

Audience: agent · Diátaxis: how-to · Kind: how-to

Use this when an agent must put one small file into draft CAS, then feed an existing
domain capture. This is not admission and not a microVM input.

Why: [MCP resource ingress](../../explanations/runtime/mcp-resource-ingress.md).
Contract:
[agent workspace](../../reference/agent/agent-workspace.md#agent-resource-ingress-draft-mcp-resource).

## Preconditions

- Digital Thread MCP is running on loopback (`deno task start` or `deno task dev`).
- The payload is at most 262144 bytes. Not STEP, STL, or images.
- You have a display `name` (not a path) and a nonempty MIME type from the domain set
  below.

## 1. Upload once

Call `project_resource_capture` with `name`, `mimeType`, and exactly one of UTF-8 `text`
or canonical padded standard-base64 `blob`. Do not send a path, project id, fingerprint,
CAS URI, provider, runtime, or MRTR.

Keep the structured `reference` (`AgentResourceReference`) verbatim. `resources/read`
projects those bytes; it is not a second upload. Roots carry no payload.

## 2. Use the domain ingress

| File                         | MIME guard                                          | Next public surface                            |
| ---------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| Build123d `.py`              | `text/x-python`, `text/plain`                       | file + attachment → technical capture           |
| Modelica `.mo`               | `text/x-modelica`, `text/plain`                     | file + attachment → technical capture           |
| SPICE `.cir`                 | `text/x-spice`, `application/x-spice`, `text/plain` | file + attachment → technical capture           |
| Architecture `.sysml`        | `text/x-sysml`, `text/plain`                        | `project_architecture_sysml_source_capture`    |
| FEA proof-case JSON          | `application/json`, `text/plain`                    | `project_fea_proof_case_capture`               |
| Impact manifest JSON         | `application/json`, `text/plain`                    | `project_cross_domain_impact_manifest_capture` |
| LED-driver human-source JSON | `application/json`, `text/plain`                    | `project_led_driver_source_capture`            |
| Prescribed-kinematics case JSON | `application/json`, `text/plain`                 | file + `mechanism-source@1` attachments → case review |
| Prescribed-kinematics method JSON | `application/json`, `text/plain`               | `project_prescribed_kinematics_method_review`  |

For CAD, Modelica and SPICE, pass the `resourceRef` to `project_source_file_put`, with a
registered `captureRequest.profileId`, then attach the stable file revision to one exact
SysML `PartDefinition` or `PartUsage`. `project_technical_source_capture` names only
`projectId`, `workspaceRevision`, `attachmentId` and `attachmentRevision`; the server
resolves the file, resource bytes, profile and dependency closure. It refuses
`resourceRef`, `profileId`, `sourceId`, `fileId`, paths and source text.

Architecture SysML capture remains a separate direct resource path: it names
`profileId` (`sysml-architecture-closed-subset-v1`), `sourceId` and `resourceRef`. The
FEA, Impact and LED-driver direct JSON captures in the table take `resourceRef` only.
The mechanism case instead enters a workspace file and attachments. None accepts
`sourceText`.

MIME does not choose the parser. `profileId` / the closed domain schema does.

The two prescribed-kinematics JSON documents must already be exact canonical bytes.
The case follows the
[source contract](../../reference/domains/mechanism/prescribed-kinematics-source-contract.md)
and enters one workspace file before its architecture attachments. The method remains
an exact resource reference and follows the
[method and evaluation contract](../../reference/domains/mechanism/prescribed-kinematics-method-and-evaluation.md).

## Method sheets

`modelica-thermal-method-sheet/1.0` and `electrical-observation-method-sheet/1.0` are
interpreted inside `project_resource_capture` by the existing codecs. Pass
`interpretation.typed.fingerprint` to the existing seal-review tools. Do not invent a
second capture tool. Do not pass raw CAS to a microVM.

The prescribed-kinematics method is different: resource capture stores its bytes but
does not interpret them as one of those typed sheets. Call
`project_prescribed_kinematics_method_review` with `projectId` first and copy
`methodSheet.caseFingerprint` and `methodSheet.observationFingerprint` into the JSON
before capture. After capture, call the same review with the opaque `methodResourceRef`;
the review reopens the exact UTF-8 bytes, requires byte-for-byte canonical JSON, and
recrosses the criteria plus both domain fingerprints against the current L1/L3 evidence
before it returns a next hop. The seal operation reopens and validates that same exact
resource again at execution time.

## Do not

- Do not pass raw CAS to a microVM. Isolated execution remains
  `compile.seal-admission@3` → `ReopenAdmittedCompilationSource` → `IsolatedCodeRunner`.
- Do not treat `model.write-architecture@1` as the agent-authored SysML path. That
  operation still renders into SysON. `model.seal-architecture-sysml@1` never writes
  SysON.
- Do not upload large binaries. The 256 KiB bound is the source-document ceiling.
