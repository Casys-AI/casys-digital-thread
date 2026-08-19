# How-to: add a recorded analysis engine

Use this checklist when a new engineering engine must accept a reviewed artefact from an
agent-led project, execute privately through MCP, and return evidence that survives
recovery. It follows the Modelica and CalculiX `@2` vertical; it is not a recipe for a
generic workflow runner.

## 1. State the capability in the right vocabulary

Name the engine, analysis family and qualified method separately. For example, CalculiX
is the engine, static structural analysis is the family, and a reviewed
mesh/material/proof profile is the method. Decide whether the operation is observational
only or may invoke a separate evaluation method. Do not call completion a verdict.

Write down the method id/version, input limits, expected measurements, provider contract
version and the exact resource roles expected after a successful run. If the engine
cannot return identity-bound exact bytes, do not claim a recorded-analysis operation
yet.

## 2. Keep the provider boundary closed

Add a provider adapter under `src/adapters/providers/<engine>/` for fixed MCP tools and
wire envelopes. Add an `HttpMcpResourceReader` consumer for the exact URI returned by
the provider; never use `resources/list` as evidence discovery. Every resource must
carry and be checked against media type, byte count and SHA-256, then be saved and
reread in a fixed-namespace `FileByteStore`.

The agent must not supply a provider name, tool, endpoint, filesystem path, raw envelope
or arbitrary native source. If the product needs agent-authored source, add a reviewed
source boundary and parser contract first; do not bypass the qualified-method boundary.

## 3. Add the one-action ROP2 plan

Define the action, resource profile and recovery policy in
`src/domain/compile/rop/` (and the authority domain: `src/domain/modelica/`,
`src/domain/fea/`, …). Add a
registered `@2` descriptor whose run bindings are exact Thread artefacts and whose
`resolvedOperationPlan` is `2.0`. Extend `ResolvedOperationPlanResolver` so queueing
rereads the direct approved MRTR decision, immutable thread basis, qualified method and
each input artefact before writing one CAS-backed plan reference to the queued run.

Do not add a caller-facing plan JSON or `execute-plan` operation. The plan inspection
tool may read the sealed plan; only the registered executor may execute it.

## 4. Make recovery boring

Create a typed WAL next to the executor and persist intent before every non-idempotent
provider call. Generic WAL helpers live in `src/adapters/shared/wal/`. After acknowledgement, store the provider request/run identity. A restart
may read that identity back, but must never repeat the same dispatch, solve or
evaluation effect. A later evaluator follows its own WAL and may run once only if its
intent has not already been recorded. After a phase's CAS capture, reopen only local CAS
bytes and rederive its evidence; do not trust mutable WAL summaries.

If an effect might have happened but no safe identity is known, preserve an explicit
unknown/quarantine state for human review. Do not turn uncertainty into `failed` or a
fresh retry.

## 5. Publish only supported claims

Capture provider evidence and normalize observations with explicit units and provenance.
For a separate evaluator, journal its call independently, capture its exact request and
structured response as a Digital Thread artefact, and retain the evaluation service as
evaluator while Digital Thread owns the capture artefact. Do not assign false producer
or byte-consumption claims. Bind every evaluation to the exact requirement, observation
and evidence artefacts. A failure needs its violation/action semantics; an observational
run must publish none.

## 6. Wire and prove it

In `server.ts`, construct the fixed stores, closed CAS reader and plan resolver/sealer
before the project runtime. Compose the executors after the runtime, then inject the
same plan reader into queueing, plan inspection and execution. Register the descriptor
and expose the executor only when all required provider URLs are configured.

Add focused tests for: queue-time MRTR/basis/source rejection; URI or digest transplant;
WAL tampering; lost acknowledgement; provider-known readback; CAS-only replay; missing
or wrong resource roles; evaluator uncertainty; and no duplicate provider call. `deno
task check` globs new adapter modules; update named `check:*` tasks if they cite a moved
path. Run the targeted suite,
then the repository gates before considering a live MRTR run.

The checklist describes a code-level integration. A real provider and MRTR test is a
separate operational step and must be reported as such.
