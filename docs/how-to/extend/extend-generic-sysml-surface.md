# How-to: extend the generic SysML surface

Audience: maintainers · Diátaxis: how-to · Kind: runbook

Use this only when a requested generic concept is outside
[current coverage](../../reference/domains/sysml/coverage.md). It is not a way to pass
extra parameters, raw SysML or provider arguments through an existing operation. A new
product instance that fits the present grammar is data and a reviewed MRTR; it does not
require this runbook.

## 1. Place the concept on one authority path

Decide explicitly whether the concept is:

- a renderer-backed, provider-mutating architecture or requirement concept;
- an agent-authored, provider-free documentary source construct; or
- neither, in which case it does not belong in this SysML surface yet.

Do not make a source-seal construct writable merely because its parser recognizes it. Do
not use a native SysON feature as the specification. Record the concept's ownership,
identity, allowed cardinality, typing, value/unit semantics, admissible mutations,
explicit exclusions and what evidence it can legitimately support.

## 2. Define a closed brief-to-IR contract

For a renderer path, add a server-derived flat proposal grammar and a typed IR. The
human MRTR signs the resulting consequential values, while the server reconstructs the
IR from the exact approved basis. Reject unknown fields, implicit defaults that change
meaning, ambiguous labels and caller-provided provider envelopes.

For an agent-authored source path, introduce a versioned analysis profile rather than
loosening the existing one. Specify exact bytes, lexical grammar, parser/IR, size and
count limits, symbols, dependencies, unresolved constructs and the policy that turns an
analysis into `ready-for-review`. The profile must preserve source spans and bind later
references by symbol ID, never display label.

## 3. Implement renderer or parser as a common authority

Renderer-backed concepts need deterministic text and a source manifest that proves the
exact emitted construct. A parser is not a substitute for this renderer.

Source-backed concepts need fail-closed lexical and parser behavior, explicit
unresolved/rejected outcomes and an analyzer that can justify each emitted symbol and
dependency. If worker or downstream consumers interpret the construct, they must use the
same versioned authority; no provider-only or consumer-only parsing escape hatch.

## 4. Map the concept to SysON deliberately

For a provider-backed concept, define the exact server-owned SysON calls, code-owned
arguments and response shapes. Establish how a write is targeted from sealed identities,
how each native construct is reread, and which relations require a pinned query instead
of labels. Do not expose AQL, tool names, element IDs or raw SysML to callers.

Specify initial insertion, exact adoption, collision/ambiguity failures and whether the
concept is additive-only. If it needs replace/delete/move semantics, give it a separate
operation and explicit uncertain-write recovery; do not weaken an existing monotone
writer. Keep provider details and call inventory in the
[SysON provider reference](../../reference/providers/syson/README.md), rather than
duplicating them here.

## 5. Extend capture, Thread and ratchets together

Version the exact capture schema when its semantic content changes. Capture provider
identities, kind, owner/target relations, labels only as display facts, the rendered or
source bytes, manifests and fingerprints needed for reread. Reopen every capture before
Thread publication; do not infer missing structure from a live model or UI label.

Define the predecessor comparison before coding the mutation. State what must survive
with the same identity, which additions are allowed, and how removal/replacement/move is
detected. Update replay so a completed run reuses durable capture and Thread evidence
without redispatching SysON.

## 6. Bind operations, review and recovery

Register a distinct operation/version when its grammar, evidence meaning or mutation
semantics differ. Keep it unavailable without its composed provider; never select an
image, runtime alias or provider from the caller. Add a run-scoped WAL before each
non-idempotent write, bounded reread for uncertain outcomes and quarantine where
identity cannot be proven.

Keep source capture/preview, MRTR approval, queue/execute and Thread publication
separate. A preview, CAS object, provider acknowledgement or queued run is not a
published result.

## 7. Prove the whole path with focused tests

Add accepted, boundary and refused IR/source corpus cases. Exercise exact proposal
parsing, deterministic rendering/manifests or parser/analysis, native request and
response validation, ambiguity/mistyping rejection, capture readback, Thread validation,
and ratchet failures for removal, replacement and move.

Then demonstrate a real composed provider path: approved MRTR → sealed plan/WAL → write
or capture → exact reread → CAS → Thread successor. Exercise normal completion,
ambiguous write recovery and completed replay with no second provider dispatch. If the
new construct affects requirements or a verdict, prove the separate evaluation/oracle
path too; structural creation alone is not a verdict.

## 8. Publish the bounded contract

Only after the authority path is proven, update
[coverage](../../reference/domains/sysml/coverage.md), this runbook's relevant links,
the operation/agent references and the
[SysON provider reference](../../reference/providers/syson/README.md) when its fixed
call subset changes. State replay and migration behavior explicitly; do not relabel
prior captures as the new version because the new code happens to read them.
