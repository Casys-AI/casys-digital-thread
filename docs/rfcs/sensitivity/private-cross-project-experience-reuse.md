Audience: agent · Diátaxis: none · Kind: RFC

Status: implemented

# RFC: private cross-project sensitivity experience reuse

This page records the implemented exact-reuse lot. Living truth remains the
[sensitivity domain reference](../../reference/domains/sensitivity/README.md), the
[AnalysisGraph contract](../../reference/contracts/graph-data-model.md), the
[source-analysis authority pipeline](../../reference/pipeline/analysis-authority-pipeline.md),
and
[closed-language compilation](../../explanations/product/closed-language-compilation.md).

The implemented target is **exact reuse between projects owned by one trusted local
Desktop installation**. The server derives a project-neutral scientific experience
record from verified local evidence; it must not copy a source project's raw data into
another project.

## Outcome

One local installation compounds sensitivity experience across its user's projects. A
target project may avoid repeated work only when the server's installed compiler derives
the same complete scientific identity from the target and one healthy local experience.

```text
source project Thread/CAS evidence
        ↓  reopen, rehash, validate
installed closed compiler
        ↓  derive project-neutral scientific record
installation-private experience index
        ↓  recompute target compatibility, unique exact match only
target-project reuse review and receipt
```

The source project remains the authority for its raw capture and lineage. The target
project receives a new receipt over derived experience, never the source project bytes,
identifiers, human decisions, or mutable state.

## Product decision

- The feature is available to every Desktop user and is bounded to projects owned by one
  trusted local installation.
- The audience is always `installation-private`. Missing or wider audience is an error.
- Experience is admitted locally from reread Thread/CAS evidence by an installed,
  versioned compiler. No caller-authored cache entry is accepted.
- The scientific identity is derived from compiled semantics and exact method/runtime
  facts, not a project id, product name, label, similar hash, or Casys-authored
  template.
- Exact reuse may avoid named CAD/solver calls only when every scientific compatibility
  field matches and the source evidence remains healthy.
- A reused study remains data. It is not a fresh proof, requirement verdict, correction
  authority, or copied human decision.

## Implemented truth

[`analyze.run-fea-sensitivity@1`](../../../src/adapters/sensitivity/live-fea/analyze-run-fea-sensitivity-run-executor.ts)
now performs its server-owned exact lookup and writes its reuse WAL before any CAD
dispatch. A miss continues through the unchanged two isolated CAD executions and two
solver calls, then admits the verified fresh result. An exact hit writes a target-local
review, receipt, and
[`sensitivity-study-reuse-result/1.0`](../../../src/domain/sensitivity/study/sensitivity-study-result.ts)
and avoids exactly those four calls. No new agent operation or selector was added.

The project-neutral closed record, separate server-private origin binding, append-only
admission/invalidation journals, deterministic index rebuild, review, receipt, and reuse
attempt WAL are implemented under
[`src/adapters/sensitivity/experience/`](../../../src/adapters/sensitivity/experience/).
Admission and every hit revalidate the frozen compiler, profile, CAD runtime, solver
provider/lowerer/parser/validator and the exact observed pinned solver container image.
The source project's current intact Thread tip must descend from the exact source
snapshot bound at admission, and every bound artifact must still be fresh. Missing
identity, lineage, freshness, or unhealthy evidence is `unavailable`; multiple different
results under one key are `unresolved`.

Fresh captures remain `sensitivity-study-capture/1.0`. A reuse never fabricates CAD
evidence: downstream base evaluation, sensitivity-edge rendering, vector correction, and
corrected-source preparation reopen the explicit scientific result union. Target
observations are rebuilt from the reused measurements and cite only the target result.
The target Thread contains no source capture, source MRTR, source URI, or readable
source origin.

The pre-dispatch reuse WAL is recovery state, not evidence. Its directory and complete
ancestor chain must remain real directories, every record must recross the requested
project/run tuple, and a transplanted, malformed, symlinked, or divergent entry fails
closed before it can select a read or rewrite destination.

## Scope and non-goals

This RFC owns only:

- local derivation of project-neutral sensitivity experience from healthy persisted
  project evidence;
- an installation-private index across that local user's projects;
- exact cross-project compatibility, reuse review, receipt, and invalidation; and
- a later, separately activated study of compiler-family candidates inside the same
  installation.

Team or organization sharing, export, public packs, registries, marketplaces,
cross-installation exchange, cloud pooling, and federation are future out-of-scope
topics. This RFC does not design them.

It also does not add a solver, CAD admission path, proof verdict, L5 authority,
universal AST, physical-equivalence oracle, or caller-selected similarity search.

## Derived experience, not copied project data

The experience compiler produces two different local records.

### Project-neutral scientific record

The indexed record contains only the normalized facts required for compatibility and
reuse:

- record schema and derivation versions;
- closed frontend, inventory, compiler, and determinism identities;
- a compiler-derived digest of the admitted source plus project-neutral normalized
  structure and semantic roles/bindings;
- dimensioned parameter base, step, response measurements, derivative, and validity
  neighborhood;
- normalized material, mesh, supports, loads, contacts, assumptions, metrics, extraction
  semantics, tolerances, and limitations; and
- exact operation, method, provider contract, lowerer/parser, solver image/runtime, and
  validator identities.

It must not contain source project or subject ids, project/component display names, work
item/run/decision ids, prompt or chat content, file paths, `thread-artifact://` URIs,
private CAS locators, raw source/CAD/STEP/solver bytes, or copied human approvals. A
content or compiler digest may identify normalized scientific input locally; it is not a
locator for the source project's raw bytes.

Derived quantities can still disclose engineering knowledge. Their
`installation-private` audience is therefore a data boundary, not an anonymization
claim.

### Private origin binding

Provenance that is necessary to revalidate or invalidate the experience stays in a
separate server-private binding. It binds the derived record digest to the exact source
project, Thread revision, study artifact fingerprint, compilation/admission evidence,
and derivation version. It is never copied into the target project or exposed as an
experience-selector input.

The target receipt cites the derived record and a digest of this origin binding. Only
the server may reopen the binding and its source evidence.

## Local compiler admission

Admission into the experience index is a fail-closed local compilation step:

1. Reopen the exact source Thread revision, study capture, compilation/admission, and
   referenced evidence by immutable identity.
2. Rehash and validate every record with its current closed schema; reject missing,
   foreign, archived, malformed, or divergent evidence.
3. Recompute measurements and derivatives from the captured case and observations rather
   than trusting a stored summary.
4. Derive the project-neutral record and scientific key with one installed, versioned
   experience-derivation profile.
5. Enforce the exact output schema and forbidden-field inventory before saving the
   record and its separate origin binding.
6. Reread both records and index only the healthy derived result.

Compiler admission grants neither execution nor proof authority. Unknown frontend,
profile, runtime, validator, unit, semantic binding, or unresolved construct yields
`unavailable` or `unresolved`; it never falls back to a label or best-effort parser.

## Compatibility and versioning

The server computes a project-neutral **scientific compatibility key** independently for
the source experience and target project. The key excludes project/Thread identity,
which belongs to provenance and target lineage rather than physics.

At minimum the key binds:

- derived-record schema, derivation profile, compiler frontend/inventory, normalized
  structure, determinism class, and semantic binding versions;
- exact admitted-source digest plus project-neutral normalized compilation and semantic
  binding identity and, when the active operation requires an existing geometry
  artifact, its exact eligible STEP identity;
- subject topology and the normalized target/parameter roles;
- base value, step, dimensions, units, metric identities, and extraction semantics;
- material, mesh, supports, loads, contacts, assumptions, domain limitations, validity
  neighborhood, and supported direction;
- registered operation, method, provider contract, tool schema, lowerer/parser, solver
  image/runtime, output validator, and numerical tolerances.

Evidence health, provenance, invalidation, audience, and freshness are eligibility
checks outside the scientific key. The target compiler can derive the key without access
to the source project; the server then validates those source-side checks through the
private origin binding.

Version equality is the default. A version difference is compatible only through an
explicit, code-owned, versioned compatibility profile validated by the receiving server.
There is no `latest`, alias, prefix match, implicit upgrade, name join, or caller
override.

The target project/Thread basis is bound separately in the reuse review and receipt. A
target revision change after review makes that review stale and requires recomputation;
it does not change the scientific identity of the source experience.

## Exact cross-project reuse

The active reuse mode is exact memoization only. The server may avoid the intended
CAD/solver calls when:

- the target compiler derives a complete scientific key;
- exactly one healthy installation-private entry has the same key;
- the origin binding and its source evidence are reread and still valid and fresh;
- the source project's current intact Thread tip descends from the exact source snapshot
  named by that binding;
- the active operation permits reuse for that freshness class; and
- no invalidation or ambiguity exists.

Several origins may bind the same byte-identical derived record without creating several
scientific candidates. If the same scientific key instead names different derived
results, the lookup is `unresolved`; the server never chooses the newest, most frequent,
or most favorable result.

The server writes a new reuse review and receipt into the target project's lineage. The
receipt records the target basis, derived experience digest, origin-binding digest,
compatibility and derivation versions, source-health decision, work actually avoided,
and whether fresh execution remains required. It does not copy the source project's
capture, labels, decisions, evaluations, or Thread entities.

If any predicate fails, the lookup returns a literal miss and the normal registered
execution path continues. A lookup never silently upgrades a reused study to a fresh
proof or human decision.

Operationally, an `exact` review is the only hit. `incompatible` with
`scientific-key-miss` is a normal exact-match miss; `unavailable` means the server could
not prove required index, provenance, lineage, freshness, or health; `unresolved` means
selection was ambiguous, including divergent results under one key. Every non-`exact`
outcome requires the normal fresh execution path.

## Authority, audience, and isolation

- The **server** admits derived records, builds the installation-private index, computes
  keys, selects at most one exact entry, applies invalidation, and records reuse.
- The **agent** requests registered operations only. It cannot supply an experience id,
  source project fallback, compatibility key, provider, runtime, native payload, or
  threshold.
- The **human** retains every existing consequential MRTR decision in the paired chat.
- The **Workbench** remains a read-only `GET` + SSE projection. It may display the
  target receipt and sanitized provenance status, never source-project data or a
  command.
- The **AnalysisGraph** remains a provider-neutral fact index, never admission or
  execution authority.

All experience storage and lookup stay inside one trusted local installation. There is
no network fetch, upload, export, registry lookup, peer discovery, or cross-user read
path. Loopback is a deployment boundary, not multi-user authentication; this RFC makes
no team or tenant-isolation claim. There is no team-sharing or marketplace surface in
this lot.

Generic logs, telemetry, ACP taps, and Workbench payloads must not contain derived study
values, source-origin bindings, raw project data, or stable cross-project identifiers
beyond an explicit existing projection contract.

`unavailable`, `unresolved`, `provisional`, `unverified`, `incompatible`, and `error`
remain literal. Ambiguity is never resolved by choosing the newest, nearest, or most
successful study.

## Invalidation

The index is a reconstructible read model, not authority. A derived entry becomes
ineligible for new reuse when:

- its source capture, compilation/admission, Thread revision, or origin binding is
  missing, corrupt, foreign, digest-divergent, or archived;
- its derivation, frontend/inventory, semantic-binding, operation, method/runtime,
  lowerer/parser, validator, tolerance, or compatibility version is no longer accepted;
- its scientific scope, units, validity neighborhood, evidence health, or freshness rule
  no longer supports the requested use; or
- the local owner withdraws the experience or its `installation-private` audience.

Invalidation is append-only and reason-coded. It excludes the entry from future
selection and causes a literal miss; it does not edit historical Thread snapshots,
source captures, or previously persisted receipts. A rebuild must derive the same active
set from current healthy evidence plus invalidation records.

Target-basis drift is different: it invalidates the pending review, not the source
experience. The server recomputes the target key and compatibility on the new basis.

## Implemented records — server internal

These are closed persisted schemas used inside the existing registered operation; none
is a caller-selectable operation or tool:

1. **Derived experience record** — the closed project-neutral scientific payload and
   server-derived compatibility key, with `installation-private` audience.
2. **Private origin binding** — the server-only link from that record to exact source
   project/Thread/CAS evidence and derivation version.
3. **Experience invalidation** — an append-only reason tied to the exact record and
   origin-binding digests.
4. **Reuse review** — target basis, lookup outcome (`exact`, `incompatible`,
   `unresolved`, or `unavailable`), reason codes, unique selected record when present,
   and freshness requirement.
5. **Reuse receipt** — target lineage, compatibility decision and versions, derived
   record/origin-binding digests, work actually avoided, and final status.

The callable path remains `analyze.run-fea-sensitivity@1`. The agent supplies neither an
experience identifier nor a compatibility key, provider, runtime, or source project.

## Implemented lot

The completed lot is **exact private reuse between local projects**:

- add the missing resolved compiler/method/runtime/validator identity needed to derive a
  complete experience record from current captures;
- implement the local experience compiler, forbidden-field checks, separate origin
  binding, and deterministic reread;
- build the installation-private index across local projects;
- implement exact lookup, target-basis review, persisted receipt, and fail-closed normal
  execution on a miss;
- implement append-only invalidation and deterministic rebuild; and
- prove the complete privacy, compatibility, provenance, authority, and replay boundary.

Compiler-family candidates across different parameter values, response models, and
surrogates remain unauthorized. They require a later explicit scope decision and
measured qualification; this implementation is exact memoization only.

## Acceptance and stop rules

- Two local projects with different ids but the same complete scientific identity
  produce one original execution plus one target-project receipt, with the named
  CAD/solver calls measurably avoided.
- Changing only project id, display name, run id, or source project lineage does not
  change the scientific key; changing any scientific or version field causes a miss.
- Serialized derived records contain every allowed field and none of the forbidden raw
  project fields; target snapshots and Workbench payloads expose no source origin.
- The source origin binding is reread and revalidated before every hit. Missing,
  corrupt, archived, incompatible, stale, withdrawn, or ambiguous evidence fails closed.
- Repeated byte-identical derived records coalesce while retaining their distinct
  private origins; divergent results under one scientific key are `unresolved` and never
  reused.
- A target revision change after review prevents reuse until the review is recomputed.
- Replay reconstructs the same review and receipt without a provider dispatch and never
  converts an interrupted unknown effect into reuse.
- No source human decision, evaluation, correction grant, or proof verdict is copied;
  downstream freshness and MRTR rules remain unchanged.
- No network, export, sharing, registry, marketplace, or cross-user surface is
  introduced.
- The Workbench remains GET/SSE only and receives no command or experience-selection
  surface.

Stop rather than weakening the key, widening the audience, copying raw source evidence,
or falling back to similarity when identity, provenance, health, freshness, version, or
authority is missing.

## Product evidence

Do not claim that the product gets faster with use from capture or index counts. Measure
eligible cross-project lookups, exact hits, misses by reason, ambiguous matches, named
CAD/solver calls and wall time actually avoided, false exact applicability, invalidation
latency, deterministic rebuild, local storage growth, and index latency.
