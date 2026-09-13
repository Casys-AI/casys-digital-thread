# How-to: qualify a documentary clause-response

Audience: maintainers · Diátaxis: how-to · Kind: runbook

This page qualifies the provider-free route that records one source-backed documentary
answer to one approved brief item. It does not create a requirement, a pass, or human
acceptance of the answer content.

## Keep the contracts separate

- `record.seal-requirements-brief-trace@1` binds an **existing** captured requirement to
  one approved clause. Do not reuse it for an exclusion, question, or other context
  answer.
- `record.seal-documentary-clause-response@1` records an agent's source-backed proposal
  against one exact current approved brief item. Human MRTR authorizes the **act of
  recording**. It does not accept the content.
- A verification clause still needs its exact applicable proof. A documentary answer
  cannot inherit or manufacture an evaluation.

## Request the read-only review

Call `project_documentary_clause_response_review` with:

1. `projectId`
2. `sourceItemId` of the current approved brief item
3. bounded `answer` and `scope`
4. `sourceRefs`: full `agent-resource-capture/1.0` `resourceRef` values from
   `project_resource_capture`, and/or current-basis Thread `artifactId`s

Do not submit a URL+digest pair, a requirement id, a provider, a runtime, or an alias
such as `latest`. The server reopens the current approved brief, the named item, and
every source. It returns `unresolved` or the exact `operation`, `briefBasis`,
`baseSnapshot`, empty `inputEvidenceRefs`, and `decisionParameters`. Reuse those values
verbatim.

## Plan, review and queue

Append a normal project change with exactly one `approvedBrief` binding. Propose the
returned parameters, obtain the usual human MRTR, then queue
`record.seal-documentary-clause-response@1` on the exact returned Thread basis. A first
claim has revision 1. A successor names the exact previous record. A stale predecessor,
missing item, unknown source, or no-op duplicate is refused.

On completion, the server appends a new documentary Thread document. The previous answer
remains immutable. Current `project_response_read` and the Workbench GET/SSE projection
emit `project-response/2.0` with `clauseResponses`. Historical `project-response/1.0`
payloads remain readable as that discriminator and do not carry these fields. The
proposal is `recordingStatus: "proposal"` without changing correspondence or closing a
proof gap.
