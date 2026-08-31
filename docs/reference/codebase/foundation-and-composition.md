# Reference: source map — foundation and composition

Audience: agent · Diátaxis: reference · Kind: contract

Census of entry contracts, hexagonal port roots, kernel primitives, and shared adapters.
Not domain coverage and not a runtime port list.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`AGENTS.md`](../../../AGENTS.md)

Entry contract for coding and project-control agents: authority split, lookalike traps,
links to the parseable catalogues

#### [`docs/README.md`](../../README.md)

Dual reading plan (human / agent / living documentation) and Diátaxis catalogue

#### [`docs/reference/agent/agent-workspace.md`](../agent/agent-workspace.md)

Agent-oriented catalogues of tools, operations, frontends, persistence roots and
verification commands

#### [`docs/reference/agent/lookalike-traps.md`](../agent/lookalike-traps.md)

Split lookalike catalogue (SysML, CAD, Modelica, FEA, DFM). Not substitutes.

#### [`docker-compose.yml`](../../../docker-compose.yml)

Maintainer diagnostic Compose topology and loopback mappings. Not the H1 JIT launch
groups and not the Digital Thread cold start.

#### [`config/mcp-fleet.json`](../../../config/mcp-fleet.json)

Desired MCP endpoints, tools, views and trust posture. URLs remain fixed current
compatibility publications. The SysON seed and assembly-observation canaries verify
their fleet URL against the sealed launch-group publication and wrap it in a lease-bound
process-local handle; the remaining clients do not yet use that seam. Ephemeral ports
remain a later, separate migration.

#### [`docs/explanations/product/product-direction.md`](../../explanations/product/product-direction.md)

Product compass: verified now vs V1, and the three judgement branches (behave / make /
buy) that share a STEP but not verdicts

#### [`src/adapters/shared/`](../../../src/adapters/shared)

Cross-authority adapters: `mcp/` HTTP, `stores/` project/thread, `execution/`
microsandbox backend, `cas/` byte/CAS, `wal/` generic helpers, `executor-run-helpers`,
`docker-observer`, `thread-write-basis-guard`, SysON constraint-oracle parse. Not
`src/infrastructure/`. Context-specific WAL stays next to its executor

#### [`src/application/ports/in/`](../../../src/application/ports/in)

Inbound use-case contracts and authenticated command-origin identities; tools invoke
these ports without selecting providers or persistence

#### [`src/application/ports/out/`](../../../src/application/ports/out)

Outbound capability contracts for MCP calls, canonical assets, project revisions and
cockpit focus; HTTP/filesystem implementations remain in adapters

#### [`src/domain/kernel/primitives.ts`](../../../src/domain/kernel/primitives.ts)

Minimal cross-domain primitives (`IsoDateTime`, SHA-256 fingerprint); Console DTOs do
not live in the kernel

#### [`src/domain/kernel/proof-case.ts`](../../../src/domain/kernel/proof-case.ts)

Discipline-agnostic oracle requirements and SysON unit/constraint rendering; units are
mandatory. Shared by architecture requirements, FEA oracle, and sensitivity — not an FEA
proof-case

#### [`src/domain/kernel/unit-normalisation.ts`](../../../src/domain/kernel/unit-normalisation.ts)

Code-owned compilation-boundary rescale onto `SUPPORTED_ORACLE_UNITS`. Affine and
multiplicative transforms are named functions, not coefficients

#### `deno task mcp:call --name=<tool> --args='{}'`

Write-capable loopback `tools/call` client for `:3020/mcp`; fills omitted `issuedAt`
only on mutations that already carry `commandId`; `--args=-` reads the JSON object
from stdin; `--receipt` prints the compact human receipt for a completed mutation;
does not change server clock rules

#### [`docs/reference/pipeline/analysis-authority-pipeline.md`](../pipeline/analysis-authority-pipeline.md)

End-to-end boundary from native source capture to either private provider MCP execution
or an independently qualified local microVM vertical, with explicit authority and
evidence limits

#### [`src/adapters/shared/mcp/http-mcp-tool-client.ts`](../../../src/adapters/shared/mcp/http-mcp-tool-client.ts)

Backend-only stateless HTTP implementation of the outbound `McpToolClient` port

#### [`src/adapters/shared/mcp/stateless-mcp-http-transport.ts`](../../../src/adapters/shared/mcp/stateless-mcp-http-transport.ts)

Internal stateless MCP 2026-07-28 HTTP/JSON-RPC envelope shared by typed backend
adapters; rejects redirects and sessions

#### [`src/adapters/shared/mcp/http-mcp-resource-reader.ts`](../../../src/adapters/shared/mcp/http-mcp-resource-reader.ts)

Strict `resources/read` adapter for one expected URI: exactly one text/blob content,
canonical base64, exact MIME, byte count and SHA-256; never calls `resources/list`

#### [`src/domain/kernel/proof-case.ts`](../../../src/domain/kernel/proof-case.ts)

Owns `UNIT_TO_SYSML_TYPE`: the only units the SysON oracle can round-trip, each admitted
by a dated live probe. Contract and the temperature gap:
[Oracle units](../providers/oracle-units.md)

#### [`src/adapters/shared/cas/file-capture-store.ts`](../../../src/adapters/shared/cas/file-capture-store.ts)

One content-addressed capture engine, typed per evidence family, including immutable
`sensitivity-catalog-offer-capture/1.0` envelopes

#### [`src/adapters/shared/cas/file-text-capture-store.ts`](../../../src/adapters/shared/cas/file-text-capture-store.ts)

Immutable UTF-8 transport over `FileByteStore`. Encodes and decodes canonical string
bytes only. Owns no descriptor, schema, manifest, selector, or evidence meaning.

#### [`src/adapters/shared/cas/file-byte-store.ts`](../../../src/adapters/shared/cas/file-byte-store.ts)

Generic raw-byte CAS with write-all, data sync, atomic no-overwrite publication,
directory sync, verified reread and opaque receipt

#### [`src/adapters/shared/cas/provider-artifact-capture-manifest.ts`](../../../src/adapters/shared/cas/provider-artifact-capture-manifest.ts)

Manifest from canonical acquisition-ledger bytes, exact provider reads and opaque CAS
reread receipts. It is not proof of the provider-native run envelope and carries no
graph, verdict or authority

#### [`src/adapters/shared/executor-run-helpers.ts`](../../../src/adapters/shared/executor-run-helpers.ts)

Shared executor primitives — run and basis resolution, snapshot refs, unexpected-status
errors, and `describeCause`, which surfaces the bounded structural reason a coarser
terminal wrapper is about to replace

#### [`src/adapters/shared/thread-write-basis-guard.ts`](../../../src/adapters/shared/thread-write-basis-guard.ts)

Refuses a thread write whose sibling holds the same basis; every reconciliation must
retain its exact sealed human ceremony, and an accepted write remains blocked until the
distinct canonical release ceremony is complete

#### [`src/adapters/assets/container-asset-stager.ts`](../../../src/adapters/assets/container-asset-stager.ts)

Fail-closed Docker Compose STEP staging: pre-host verify → copy → post-container verify,
idempotent when SHA-256 already matches; inverse of `host-asset-materializer.ts`;
`ContainerAssetStagingError` requires operator review

#### [`src/adapters/assets/canonical-asset-reader.ts`](../../../src/adapters/assets/canonical-asset-reader.ts)

Filesystem implementation of the outbound `CanonicalAssetReader` port for
content-addressed STEP assets in `state/local/thread-assets`; filename is the digest and
any deviation yields `integrity_mismatch`
