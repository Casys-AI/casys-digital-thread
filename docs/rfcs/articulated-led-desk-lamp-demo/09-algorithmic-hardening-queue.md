Audience: agent · Diátaxis: none · Kind: RFC Status: active Living pages:
[Analysis authority pipeline](../../reference/pipeline/analysis-authority-pipeline.md),
[Behave roadmap](../../explanations/product/behave-decision-roadmap.md)

# RFC: 09 — algorithmic correctness and boundedness queue

This lane improves algorithms only where the lamp demo or the DDD refactor exposes a
measurable correctness, determinism, complexity or recovery risk. It does not reward
cleverness, generic graph engines, speculative caching, concurrency, or benchmark-only
rewrites.

Run [08 — DDD refactor](08-ddd-refactor-queue.md) first where an algorithm is trapped
inside I/O orchestration. Preserve the exact authority boundary while extracting it.

## Global invariants

- Fail closed on duplicate, ambiguous, stale, archived, foreign or unbounded input.
- Canonical output does not depend on filesystem enumeration, map insertion order,
  provider response order, locale, wall clock or object identity.
- A retry never gains authority. A completed replay performs no engine, provider, oracle
  or mutation call.
- Source/input size, token/node count, graph size, artifact count and output bytes have
  explicit bounds at the earliest trusted boundary.
- Complexity claims require a focused benchmark or a proof from the implemented data
  structure. Do not write “O(n)” comments over nested hidden scans.

## Queue

### H01 — define causal budgets

Inventory current enforced bounds for:

- architecture proposal entries and graph nodes;
- build123d and Modelica source bytes/tokens/nodes;
- FEA/sensitivity/electrical manifest entries;
- Thread artifacts/evidence references;
- isolated output count and bytes; and
- WAL attempts/generations.

Record missing bounds as explicit findings. Add no arbitrary limit without tying it to
an existing runtime/profile capacity or a reviewed product decision.

### H02 — one-pass exact artifact selection

Audit selectors used by the demo for repeated scans, prefix matching and “first”/“last”
assumptions. Build a typed one-pass index per snapshot/result where it materially
reduces ambiguity and makes uniqueness explicit.

Selection keys must include the context's real authority: artifact id, snapshot id and
revision, kind/media type, freshness/archive state, producer tool/run, fingerprint/URI
and required causal inputs. Do not create a universal fuzzy artifact finder.

Table-test zero, one, duplicate, lookalike, archived, foreign-run and corrupted cases.

### H03 — architecture graph-delta algorithm

The extracted A07/R05 ratchet must compare predecessor, reviewed proposal and live
readback using indexed semantic ids and owner-scoped keys. Produce a closed delta:
inherited exact, reviewed addition, missing, replaced, moved, duplicate or unreviewed.

Prove order independence and deterministic failure selection. Bound graph size before
index construction. Add metamorphic tests that shuffle definitions/features without
changing the accepted result.

### H04 — bounded Modelica semantic IR

Audit `closed-subset-v2` and its lexer/parser/authorizer as one authority:

- byte and token/node/equation/identifier bounds;
- unique symbol table construction;
- no quadratic duplicate/reference resolution;
- deterministic source-order outputs/equations;
- finite constants and analytically derived expectations; and
- exact experiment-grid validation.

Add focused adversarial/metamorphic tests only for demonstrated holes. The worker and
frontend must consume the same authority modules; never duplicate a parser or family
table in the image.

### H05 — closed WAL transition tables

For each active CAD, Modelica, FEA and electrical attempt store, express allowed phase ×
event transitions as a closed pure table or discriminated transition function. Preserve
context-specific identity and receipts; share only the tiny transition primitive if its
semantics are literally identical.

Prove:

- exactly one fresh dispatch capability;
- at most one authorized/consumed redispatch generation where supported;
- durable-before-dispatch ordering;
- ACK-loss fail-closed behaviour;
- late receipt fencing; and
- completed replay with zero outward calls.

No retry loop or timeout is an authority substitute.

### H06 — canonical evidence builders

Extract deterministic builders for architecture, mechanical, thermal and electrical
evidence after their inputs have been validated. Builders must sort only fields whose
contract is set-like and preserve declared order where it carries meaning.

Recompute fingerprints from canonical preimages in tests. Reject extra metrics,
duplicate observations, non-finite values, mismatched byte counts, wrong media types and
producer/run drift before Thread publication.

### H07 — explicit impact closure

Coordinate with [06 — cross-domain impact](06-cross-domain-impact-loop.md). The
algorithm may propagate impact only through persisted, reviewed dependency claims. An
omitted dependency must never make a consequential gate look safer.

Before coding, specify:

- the graph node/edge identities;
- whether dependency sets are exhaustive or conservative-by-default;
- cycle handling and deterministic traversal order;
- which normative evidence claim becomes stale/unresolved;
- why historical artifacts remain inspectable; and
- how a human-readable impact matrix derives from the same canonical object.

Do not infer dependencies from matching labels, units, filenames or provider names. A
negative/ambiguous closure yields `impact-unresolved`, not “unaffected”.

### H08 — strict manifest algorithms

Mechanical, sensitivity and future electrical manifests use fixed roots. In one bounded
pass, validate schema/keys, safe ids and relative paths, uniqueness, sorted/canonical
identity, file id equality and symlink/canonical-path confinement before returning
bytes.

Test traversal, separators, duplicate ids/paths, unknown keys, missing files, symlinked
ancestors, manifest/file identity mismatch and concurrent read stability. Provider or
project selection never supplies a path.

### H09 — concurrency evidence where it matters

Use deterministic barriers for at least one real two-process contention test around a
non-idempotent execution path, shared file lease and WAL. Prove one process owns the
dispatch while the other blocks/reopens; then exactly one runner/provider call exists.

Do not add broad timing sleeps or flaky stress loops. The test is justified only for a
path the demo depends on and whose current evidence is same-process only.

### H10 — benchmarks and regression budgets

Benchmark only algorithms changed in H02–H08 with synthetic bounded inputs at normal and
maximum admitted sizes. Record environment and median/range; use generous regression
budgets that catch accidental quadratic work without making CI hardware-sensitive.

A faster algorithm is rejected if its failure semantics or canonical bytes differ.

### H11 — integrated adversarial matrix

Build one table mapping each demo authority boundary to its key counterexamples and
owning focused test. Reuse existing suites; do not create a second giant end-to-end test
that duplicates every fixture.

Required categories: wrong project/revision, stale/archived evidence, wrong producer,
duplicate approval, non-human approval, source/capture mismatch, manifest traversal,
engine output drift, oracle mismatch, WAL deletion/corruption, concurrent dispatch and
completed replay.

## Definition of done

Accepted algorithms have closed inputs/results, explicit bounds, deterministic outputs,
one obvious authority failure mode and focused evidence for their worst counterexample.
The demo behaves identically except for intentional fail-closed fixes or measured
performance improvements. No new engine capability is claimed by this lane.

## Validation and commits

- One commit per H lot or one tightly coupled extraction+algorithm pair.
- Run focused tests/benchmarks only; one `deno task check` after H04/H05 integration and
  once at lane closeout.
- Preserve real persisted demo evidence and prove replays remain read-only after
  H05/H06.
- Update living docs only for a changed bound or authority contract, not internal
  implementation detail.
