# TPS01 — platform frictions

Audience: both · Diátaxis: explanation · Kind: dated agent-experience findings

These observations concern the generic product-authoring experience. They are not
engineering claims about the tablet stand.

## Global attribute-name collision

The first architecture review rejected repeated generic names such as `width` across
different child parents. The canary proceeded with globally distinct handles. The
current behavior is workable for a two-part product but should be reconsidered before
large assemblies make naming a systemic authoring burden.

## Protocol header on raw resource reads

Raw MCP `resources/read` without the required `Mcp-Name` header was refused. A
conforming retry succeeded. The refusal is preserved as integration friction, not
evidence of an unavailable resource.

## Review append and module projection

The initial review-append material omitted `projectId`; the proposal was corrected and
the flow then succeeded. Separately, the canonical module was initially absent from the
Workbench projection. That projection defect was fixed; it did not invalidate the raw
Thread capture or its assets.

## Workspace recross refresh

A workspace-only recross did not live-refresh the authoring exact basis until a reload.
The BFF event identity tracked the Project and Thread heads but not the independent
workspace head. It now includes the exact workspace revision and hash-chained event
fingerprint, so a workspace-only successor emits a fresh read-only snapshot and the
authoring client performs its uncached GET again. This was a projection/refresh defect;
the persisted r16 workspace event and reread attachments remain the engineering
evidence.

## Navigation versus lowering

Exact graph navigation and multi-file resource reread worked. The system supports the
bounded deterministic closures recorded in this dossier; it must not be presented as
semantic compilation of general multi-file Build123d/Python imports. Unsupported shapes
remain fail-closed.
