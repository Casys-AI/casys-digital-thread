# How-to: extend admitted Modelica coverage

Audience: maintainers · Diátaxis: how-to · Kind: runbook

Use this only to create a new bounded, versioned executable language surface. It is not
needed for a new model that already satisfies `modelica-closed-subset-v2` / `2.0.0`:
that is a capture → binding → admission → MRTR → run workflow described in
[Run admitted Modelica](../run/run-admitted-modelica.md).

The invariant is one common authority: capture/analyzer and worker must authorize the
same source. Do not add an OMC-only escape hatch.

## 1. Freeze the extension decision

1. State the exact added forms, size/count limits, units/dimensions policy, simulation
   semantics, output columns and metrics. List explicit refusals too.
2. Choose a new closed profile id/version unless byte-for-byte semantics and all
   contracts are unchanged. In active development, an old surface may instead be
   explicitly removed and tombstoned; never silently change what its admissions mean.
3. Decide whether this is a generic source-language extension or an image-owned
   qualified kit. A kit is not a shortcut for project-authored `.mo`.
4. Assemble accepted, boundary and rejected source corpus cases; name the physical or
   numerical oracle needed to call any result more than documentary.

## 2. Change the common language authority

1. Extend the lexical grammar in
   [`lexical.ts`](../../../src/domain/modelica/source/lexical.ts), the parser/IR in
   [`parse.ts`](../../../src/domain/modelica/source/parse.ts), and semantic limits in
   [`closed-subset-v2.ts`](../../../src/domain/modelica/source/closed-subset-v2.ts), or
   introduce their versioned successors together.
2. Keep exact parsing fail-closed: no partial pass, unknown identifier, ignored
   annotation, implicit unit conversion or best-effort lowering.
3. Update the focused language tests for accepted forms, bounds and every new refusal.
   The source profile's byte ceiling must remain identical in capture and worker.

## 3. Extend analysis and admission together

1. Update `QualifiedModelicaSourceAnalyzer` to emit stable symbols, spans and only the
   dependencies the new IR can justify; update its profile/version in
   [`source-analysis-composition.ts`](../../../src/adapters/modelica/source/source-analysis-composition.ts).
2. Update the server-owned technical compilation catalogue in
   [`fixed-technical-compilation-profile-catalog-provider.ts`](../../../src/adapters/compile/admission/fixed-technical-compilation-profile-catalog-provider.ts).
   Define any new required binding kinds and ambiguity/gap behaviour there, never in a
   caller envelope.
3. Update admission/reopen/review validation to bind the exact new profile, target,
   analysis and source fingerprints. If the old profile is retired, remove its
   registration and make old admissions fail closed with an explicit tombstone; do not
   retain compatibility machinery solely to replay them.

## 4. Extend the worker and lowering

1. Make the image worker import the same versioned pure authority as capture. Its input
   remains the reopened `/input/source.mo`, never caller text.
2. Define code-owned OMC lowering: permitted command/script fields, fixed solver policy,
   timeout, paths, executable allow-list and output variable filter. Do not expose them
   as MRTR parameters.
3. Define how every new language construct is lowered and how OMC failure/diagnostics
   fail the run. For new component families, pin and inventory the library/image rather
   than trusting ambient `MODELICAPATH`.
4. Update the registered worker invocation, resource limits and non-root contract in
   [`worker-contract.ts`](../../../src/adapters/modelica/admitted/closed-subset-v2/worker-contract.ts).

## 5. Change normalisation and evidence as one contract

1. Specify the exact raw OMC CSV columns, row/grid rules, finite-value rules and
   normalised `result.csv` shape.
2. Change the output manifest, validator and evidence schema in
   [`run-proposal.ts`](../../../src/domain/modelica/admitted/run-proposal.ts),
   [`isolated-output.ts`](../../../src/domain/modelica/admitted/isolated-output.ts) and
   [`execution-evidence.ts`](../../../src/domain/modelica/admitted/execution-evidence.ts)
   together.
3. Reopen and cross-check source bytes, evidence, result hashes, receipt, scenario,
   parameter values and metric ordering in the executor. Add a separate qualified
   physical/numerical oracle before publishing a verdict-capable branch.

## 6. Rebuild and bind the image

1. Copy every new worker and shared-authority file into
   [`images/modelica-microsandbox-worker/Dockerfile`](../../../images/modelica-microsandbox-worker/Dockerfile),
   cache it under the locked Deno dependency graph, and update the Dockerfile's checked
   source hashes and relevant labels.
2. Build and inspect the image; verify its non-root identity, direct worker invocation,
   no network authority, exact output set and reviewed byte hashes. A Docker preflight
   is useful worker evidence, but it is not activation proof.
3. Publish the resulting image by OCI digest. Add that _new_ digest only to the
   server-owned admitted profile pin; never use `latest`, an alias, or the qualified-kit
   digest.

## 7. Wire the server-owned profile

1. Update the execution profile/catalogue, output validator ref and composition so all
   profile, compilation and runtime fingerprints agree.
2. Update the server-owned profile and atomic runtime catalogue with the digest, policy
   fingerprint and exact limits if they changed. The future capability-runtime
   supervisor alone may activate it; until then absence of the runtime remains
   fail-closed.
3. Update MRTR/review/executor schemas only where the new profile contract requires it.
   Keep callers unable to choose runtime, provider, image, solver or extra source text.

## 8. Prove the new runtime, recovery and lineage

1. Run the real, digest-pinned image through the local Microsandbox microVM — not just a
   container preflight — using a source exercising each new construct.
2. Persist and reopen the output CAS objects, receipt, capture, observations and exact
   Thread successor. Verify that the capture binds the sealed source and profile
   fingerprints.
3. Exercise the WAL lifecycle: normal completion, uncertain output recovery, permitted
   one-shot redispatch only after proven absence/cleanup, and completed replay with no
   OMC redispatch or VM survival.
4. Record the proof as `documentary` unless a separate approved verdict/evaluation
   authority has been implemented and demonstrated.

## 9. Publish the contract surface

1. Update [Language](../../reference/domains/modelica/language.md) and
   [Execution](../../reference/domains/modelica/execution.md) for normative changes;
   update [Coverage](../../reference/domains/modelica/coverage.md) with the new
   supported and refused surface.
2. Update the operation how-to, the shared
   [admitted-source pattern](../../reference/pipeline/admitted-source-isolated-execution.md),
   workspace map and lookalike tables if operation/profile boundaries changed.
3. State the migration/retirement policy explicitly. An active-development migration may
   intentionally break old runs: unregister and tombstone the old profile so it fails
   closed. Never silently relabel an old admission as the new version merely because the
   new worker can parse it.
