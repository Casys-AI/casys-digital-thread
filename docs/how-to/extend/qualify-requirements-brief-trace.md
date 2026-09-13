# How-to: qualify requirements-to-brief correspondence

Audience: maintainers · Diátaxis: how-to · Kind: runbook

Status: **the first real provider-free ID01 claim canary is validated**. Native writer
@2 runtime qualification, a live successor after changed source, and browser inspection
remain pending. This page establishes neither a native provider result nor a qualified
engineering proof.

## Keep the two contracts separate

Native authoring and documentary correspondence are distinct, versioned operations.

- The prior native-authoring route is `model.write-requirements@2`. It seals the
  original approved-brief provenance into `requirements-capture/5.0`.
- The prior read-only native recapture route is `model.recapture-requirements@2`. It
  reopens an unchanged traced family and publishes `requirements-capture/6.0`; it does
  not decide that an old criterion satisfies a later brief.
- `model.write-requirements@1` is retired for new planning, proposal and queueing.
  Historical schemas 3/4 and completed historical replay retain their literal meaning;
  an original missing source remains `TRACE GAP`.
- The new provider-free route is `record.seal-requirements-brief-trace@1`. It appends a
  `requirements-brief-trace/1.0` document that records one late, reviewed correspondence
  between one exact captured requirement and one exact normative brief clause plus its
  component clause. It may use a capture at schema 3, 4, 5 or 6.

The record is a documentary claim, not a native edit, provenance backfill,
satisfaction/equivalence statement, solver result, qualification or physical proof. It
does not modify a prior requirements capture or its original source metadata.

## Request the read-only review

Call `project_requirements_brief_trace_review` with exactly these five identities:

1. `projectId`
2. `containerComponent`
3. `containerSourceItemId`
4. `requirementId`
5. `sourceItemId`

Do not submit a threshold, unit, source text, native target, provider, tool, runtime, or
an alias such as `latest`. The server selects the unique active requirements family,
reopens the selected canonical requirement and its scalar values unchanged, reopens the
current approved brief, and finds the unique previous head for that claim series. It
returns either `unresolved` with diagnostics and no parameters, or the exact
`operation`, `baseSnapshot`, `briefBasis`, `requirementsCaptureEvidenceRef`,
`inputEvidenceRefs`, and `decisionParameters`. Reuse these returned values verbatim.

No label or prose similarity can select a claim. The series identity is the exact
project, native PartDefinition target and canonical metric; all capture, clause and
predecessor revisions are revalidated by their exact IDs and fingerprints.

## Plan, review and queue the documentary append

Append a normal project change with exactly one `approvedBrief` binding and one or two
`claimInput` bindings, each an exact current-basis Thread `artifact`.

- First claim: one `claimInput`, the requirements capture.
- Successor claim: two `claimInput`s, the requirements capture and the previous claim
  document.

The record executor proves that this is the complete signed set. Extra, substituted or
historical inputs are refused. Normal planning derives the same one or two
`inputEvidenceRefs` for the MRTR; no special evidence path exists.

Propose the returned parameters, obtain the usual human MRTR approval, then queue the
registered operation on the exact returned Thread basis. A first claim has revision 1
and no predecessor. A successor names the exact previous record and advances the claim
revision. A stale predecessor, split head, cycle, no-op duplicate, missing source or
ambiguous join is refused.

On completion, the server appends a new documentary Thread document. The old capture and
old claim remain immutable. A successor can record a changed brief clause, a new native
requirement capture, or both; it never silently retargets an earlier claim.

## Qualify proportionately

Source tests can establish closed parsing, exact review resolution, command/queue
guards, first and successor binding shapes, append-only extension and historical replay.
They do not establish a real native write, provider behaviour or a qualified claim.

The first authorized ID01 canary established a real composed review, normal
project-change/MRTR/queue ceremony, first documentary append, exact public-MCP replay,
no-op refusal, and strict preservation of prior evidence. Its exact identities and
boundaries are recorded in the
[ID01 first-claim ledger](../../annex/project-dossiers/inspection-drone-id01/requirements-brief-claim-20260907.md).

Further authorized qualification must retain separate evidence for:

1. A real composed read-only review for one selected requirement and clause.
2. The normal project-change/MRTR/queue ceremony with the exact returned bindings.
3. First documentary append, exact readback, and replay without dispatch.
4. A later approved-brief or requirements-capture change followed by an explicit
   successor claim and its two-input readback/replay.
5. Refusal of a forged, stale, ambiguous, cyclic, no-op or extra-input request.

The validated first claim does not establish the live successor route or writer @2
runtime qualification. Keep native authoring/recapture evidence, documentary claim
evidence, and any engineering proof as separate statements.

See [agent workspace reference](../../reference/agent/agent-workspace.md) and
[requirements recapture qualification](qualify-requirements-recapture.md).
