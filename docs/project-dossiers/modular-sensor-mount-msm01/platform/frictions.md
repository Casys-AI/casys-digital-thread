# MSM01 — platform frictions

These are generic AX findings from the canary, not product claims.

## Exact-basis recross — absorbed

One atomic `project_source_attachment_recross` moved the six heads onto the current
Thread r14 / architecture r3 basis, preserving file, role and target, grants none.
Replay of the same `mutationId` returned workspace r27 and the same
`project-source-workspace-event/4.0` fingerprint. The fail-closed provenance rule
remains; the current contract absorbs the former repetitive reattachment churn.

## Global attachment inventory — absorbed

Unfiltered `project_source_attachment_list` walked the six active heads at r27 in three
pages of two. Reusing that unfiltered cursor with `fileId` is refused `cursor_mismatch`.
The current list contract absorbs the former missing global inventory.

## Navigation is not executable lowering

The workspace can navigate and seal a multi-file closure. During the MSM01 run, that
closure had no registered executable lowering, so preview and admission stayed
`unresolved` / `source.dependency-lowering-unavailable`. The current
[Build123d workspace-closure lowering v1](../../../reference/domains/cad/build123d-workspace-closure-lowering-v1.md)
covers only the narrow direct root-to-direct-scalar-leaf form; it does not retroactively
make MSM01's non-trivial two-file closure executable or prove it as a runtime path.
Treat navigation and executable lowering as distinct capabilities.

## Structure capture prerequisite

The first module export remained `unavailable` until `model.capture-part-definitions@1`
reread the exact architecture structure. The operation is a legitimate prerequisite but
should be surfaced by authoring guidance before the module-export attempt.

## Resource reread probe

The MCP probe has no `resources/read` helper. Exact attachment and closure navigation
worked, but resource-byte reread requires a separate path; a read helper would make
agent-side source inspection more direct.
