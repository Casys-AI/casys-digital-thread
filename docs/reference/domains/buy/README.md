# Buy configuration and dated cost evidence
> Verified-Against: b55de771 (2026-09-13).

Audience: both · Diátaxis: reference · Kind: contract

Registered operations: `buy.capture-configuration-cost@1` then
`buy.seal-configuration-cost@1`. They capture and seal a sourced configuration and dated
costs. They do not create ERP documents, send an RFQ, or purchase anything.

DT owns `buy-configuration/1.0` and `buy-cost-bundle/1.0`. The provider owns
`io.casys.mcp-erpnext.buy-source-capture/1.0`, the recorded result/session, and the
whole-view App `io.casys.mcp-erpnext.buy-evidence` (`3.1.0-local.buy-evidence.1`,
`ui://mcp-erpnext/buy-evidence-viewer`). Locked provider tool: `erpnext_buy_capture`.

Lookalikes: [lookalike traps § Buy](../../agent/lookalike-traps.md#buy). Agent IDs:
[agent workspace](../../agent/agent-workspace.md). Behave remains
[verify a new design from scratch](../../../how-to/verify-design/verify-a-new-design-from-scratch.md)
and does not open Make/Buy.

This page describes implemented **source-candidate** behaviour and independent proofs.
It does not claim live ERP, a qualified site binding, an installed App, or a purchase.

## French entry points

Plain speech for a human. The paired assistant maps them to exact reviews and
operations. Do not author envelopes, choose provider args, self-approve, or purchase.

| Dire…                                                    | Ce que l’assistant prépare                                                                                                                 | Ce que ce n’est pas                                     |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| « Prépare la capture des coûts de cette configuration. » | Read-only `project_buy_configuration_cost_capture_review`, then human MRTR, then `buy.capture-configuration-cost@1`                        | Un achat, une BOM ERP, ou `erpnext_bom_get`             |
| « Prépare le scellement de ces coûts enregistrés. »      | Read-only `project_buy_configuration_cost_seal_review`, then human MRTR, then `buy.seal-configuration-cost@1` (reopen CAS, no ERP refresh) | Un second fetch ERP ou un prix « actuel »               |
| « Montre les preuves de coût enregistrées. »             | Recorded Buy App session whose `anchor` is the sealed DT artefact tuple equal to `provenance.bundleRef`                                    | Un viewer BOM live, un refresh, ou `app.callServerTool` |
| « Choisis le projet. »                                   | Paired assistant; MCP routing stays `cockpit_focus_set`                                                                                    | Une route `GET /projects/<id>` ou un bouton Workbench   |

Read-only review is not dispatch or consent. Capture MRTR and seal MRTR each follow the
repo authority. Configuration bytes enter through source-backed
`project_resource_capture`, never an ad-hoc authored BOM JSON.

## Capture then seal

1. Source-backed configuration via `project_resource_capture`.
2. `project_buy_configuration_cost_capture_review` — read-only; no ERP.
3. Human MRTR on exact configuration, STEP, document refs, pricing scope, and authorized
   site fingerprint.
4. `buy.capture-configuration-cost@1` dispatches locked `erpnext_buy_capture` only
   through a **qualified** ERP read binding (`commerce.read-erpnext-buy-source@1` at
   `qualified`). A fleet image tag is not qualification. Canonical bytes land in DT CAS.
   The published artefact is a documentary candidate, not approved spend. The agent does
   not select provider args.
5. `project_buy_configuration_cost_seal_review` then `buy.seal-configuration-cost@1`
   reopen those bytes. No ERP refresh. Partial coverage stays `partial` / `documentary`.

Until an exact pinned site binding/fingerprint is qualified, preparation and execution
stay `unresolved` with that reason and do not dispatch.

## Coverage and totals

`complete` forbids unresolved gaps. `partial` is valid when every selected item is
priced and `excludedLineIds` is empty if tax/transport (or another required dimension)
is an explicit unknown: keep `coveredSubtotal` and the named unknown dimensions. Never
fabricate a zero line or a complete total. Independent frozen-parser check: DT complete
and partial-tax/transport-unknown results are accepted by the provider parser.

## Viewer

DT builds `io.casys.mcp-erpnext.buy-recorded-session/1.0` from the sealed bundle only.
`session.anchor` is the real sealed DT artefact; `anchor.uri` and `anchor.fingerprint`
equal `provenance.bundleRef`. That fingerprint is the published seal bytes, not a hash
of the sanitized displayed result. Absent admitted package → `unavailable`. No live
`erpnext_bom_get`, `latest` package, or `app.callServerTool`.

Provider capture is ephemeral canonical JSON + SHA-256; DT CAS is the durable store.
Local unpublished HTML proof: 853961 bytes, SHA-256
`eee709976f49d43af306fc2a296d21b2e2b1262207b4f50a6d501db5a5a87c0f`. Canonical capture
fixture `sha256:aa33230c6af6abc929f1687ce6ffc00ccf920510e58efa3c53ec71f4dbbe9d5a`, 2435
bytes. Fixtures are fake; they are not a live BOM or a purchase.

## Trusted local ERPNext Buy metadata

Trusted local `state/local/capability-runtime/erpnext-buy-installation-profile.json`
(`local-erpnext-buy-installation-profile/1.0`) describes digest-pinned material, the
exact topology, the exact site, and opaque secret slots only. Trusted local
`state/local/capability-runtime/erpnext-buy-qualification-fixture.json`
(`local-erpnext-buy-qualification-fixture/1.0`) names exact server-parsed document
identities and an optional literal `expectedModified`. The server owns the fixed tool
and envelope.

Closed metadata forbids credentials, a qualified flag, caller-selected tools or args, a
free MCP URL, and aliases. Absent metadata stays `unresolved`. The profile is not
qualification.

Private qualification uses the existing candidate and spec, attempt WAL, host start/stop
proof, and common attestation authority. The actual site must match the installed and
MRTR-authorized `sourceInstance`. Runtime installation and adoption require their
separate authorization; source tests do not imply it.
