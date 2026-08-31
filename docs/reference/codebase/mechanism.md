# Reference: source map — mechanism

Audience: agent · Diátaxis: reference · Kind: contract

Census for the prescribed-kinematics domain, its L3 execution seam, and its recovery
boundary. It does not expose a provider selection or replace the project/Thread census.

Index: [workspace source map](codebase-map.md). Domain contract:
[mechanism](../domains/mechanism/README.md). Provider boundary:
[Chrono](../providers/chrono/README.md).

## Source map

#### [`src/domain/mechanism/prescribed-kinematics/`](../../../src/domain/mechanism/prescribed-kinematics)

Closed case source, exact source/workspace closure, factual observation, method, L4
evaluation, L5 closeout, and the provider-neutral operation identities. No MCP, Docker,
filesystem, endpoint, or bearer.

#### [`src/application/ports/in/mechanics/prescribed-kinematics/`](../../../src/application/ports/in/mechanics/prescribed-kinematics)

Inbound L3 command and review contracts. The transport-facing command is internal; it is
not an MCP argument schema.

#### [`src/application/ports/out/mechanics/`](../../../src/application/ports/out/mechanics)

Provider-neutral observer, case lowerer, and L3 attempt-WAL ports. Their identities bind
sealed facts and fingerprints, not caller-selected provider parameters.

#### [`src/application/use-cases/mechanics/prescribed-kinematics/`](../../../src/application/use-cases/mechanics/prescribed-kinematics)

One-shot L3 dispatch/recovery and complete receipt readback. After a durable dispatch
claim, continuation is same-request readback only.

#### [`src/adapters/mechanics/chrono/`](../../../src/adapters/mechanics/chrono)

Server-owned Chrono lowerer, private adapter, capture store, L3 WAL implementation,
architecture recross adapter, registered run executor, and the first uncertain-writer
lifecycle qualifier. Context-specific WAL stays here; it is not generic provider
recovery, not L3 evidence, and not an agent transport.

#### [`src/application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts`](../../../src/application/ports/out/record/uncertain-writer-lifecycle-qualifier.ts)

Provider-neutral server-side uncertain-writer lifecycle qualification. Callers name a
project and failed run only. The closed default never grants eligibility.

#### [`src/adapters/shared/thread-write-basis-guard.ts`](../../../src/adapters/shared/thread-write-basis-guard.ts)

Shared one-successor Thread-basis lease and sibling-writer block. It includes every
prescribed-kinematics writer so an uncertain L3 effect blocks conflicting writes. A
server-computed lifecycle recross can treat a historical generic Chrono failure as
terminal-uncertain without broadening the dedicated failure catalogue.

#### [`src/domain/record/reconcile-uncertain-writer-proposal.ts`](../../../src/domain/record/reconcile-uncertain-writer-proposal.ts)

Canonical terminal-uncertain failure catalogue and human reconciliation proposal. The
separate accepted-effect basis-release contract remains under `src/domain/record/`.

#### [`src/application/control-plane/capability-runtime-qualification-service.ts`](../../../src/application/control-plane/capability-runtime-qualification-service.ts)

Private host qualification orchestration. It is separate from product L3 WAL, project
MRTR, Thread evidence, and a product verdict.
