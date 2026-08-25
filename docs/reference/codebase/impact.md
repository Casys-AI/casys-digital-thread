# Reference: source map — impact

Audience: agent · Diátaxis: reference · Kind: contract

Census of sealed manifest, X07, X09, and X11 preservation files. Preservation is not a
CalculiX run and not X10.

Index: [workspace source map](../codebase/codebase-map.md). Domain coverage stays
on [engineering domains](../domains/README.md).

## Source map

#### [`src/domain/impact/`](../../../src/domain/impact)

Cross-domain impact contracts: sealed V2 manifest, X07 evaluation, X09 decision, and X11
`analyze.evaluate-mechanical-preservation@2`. Causal `changeKinds` and branch IDs are
document-defined `safeId` tokens on the sealed manifest, not a global catalogue.
Independence assertions and X11 preservation are legal only for the exact id
`mechanical`. Preservation is not a CalculiX run and not X10.

#### [`src/application/ports/in/impact/`](../../../src/application/ports/in/impact)

Inbound impact review/evaluation ports. Agent tools name `projectId` plus opaque refs
only.

#### [`src/application/ports/out/impact/`](../../../src/application/ports/out/impact)

Outbound manifest, capture, Brief-gate, lineage, and L5-closeout readers. No MCP
provider client.

#### [`src/application/use-cases/impact/`](../../../src/application/use-cases/impact)

Provider-free recross of manifest, evaluation, decision, and mechanical preservation.

#### [`src/adapters/impact/`](../../../src/adapters/impact)

Impact CAS/Thread adapters and `analyze.evaluate-mechanical-preservation@2` executor.
Reopens existing FEA closeout identities; never calls CalculiX.
