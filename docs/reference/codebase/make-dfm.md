# Reference: source map — make and DFM

Audience: agent · Diátaxis: reference · Kind: contract

Census of DFM case and check files. Not behave proof and not a CAD canonical write.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/domain/make/dfm/dfm-case.ts`](../../../src/domain/make/dfm/dfm-case.ts)

`dfm-check-case/1.0`: attested STEP target, object build volume, declared Z-min filter,
measured verdicts. Distinct from documentary `printability-check-case/1.0`

#### [`src/domain/make/dfm/dfm-proposal.ts`](../../../src/domain/make/dfm/dfm-proposal.ts)

Closed MRTR grammars for `industrialize.seal-dfm-case@1` and
`industrialize.run-dfm-checks@1`

#### [`src/adapters/make/dfm/dfm-case-capture.ts`](../../../src/adapters/make/dfm/dfm-case-capture.ts)

Provider-free `dfm-case-capture/1.0` seal envelope

#### [`src/adapters/make/dfm/dfm-check-capture.ts`](../../../src/adapters/make/dfm/dfm-check-capture.ts)

Measured `dfm-check-capture/1.0`: three mcp-dfm tools, Z-min trace, recomputed
evaluations on reread

#### [`src/adapters/make/dfm/industrialize-seal-dfm-case-run-executor.ts`](../../../src/adapters/make/dfm/industrialize-seal-dfm-case-run-executor.ts)

Provider-free seal of one signed DFM case; verifies the attested STEP in the basis;
never calls mcp-dfm

#### [`src/adapters/make/dfm/industrialize-run-dfm-checks-run-executor.ts`](../../../src/adapters/make/dfm/industrialize-run-dfm-checks-run-executor.ts)

Trusted measured run: three tools with `expected_step_sha256`, declared Z-min filter,
named publishable failures. Not `observe-printability`

#### [`src/adapters/make/dfm/file-dfm-check-attempt-store.ts`](../../../src/adapters/make/dfm/file-dfm-check-attempt-store.ts)

Three-state WAL `dispatched → capture-recorded → completed` for measured DFM; a
dispatched record without capture is not retried
