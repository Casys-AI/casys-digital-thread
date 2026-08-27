# Reference: impact domain

Audience: both · Diátaxis: reference · Kind: index

The impact bounded context owns closed cross-domain judgement: a sealed
`cross-domain-impact-manifest/2.0`, a provider-free recross, a human application of
already-proposed gate-claim statuses, and a later mechanical preservation control.
It never owns a solver, a provider envelope, or a Workbench command.

Causal `changeKinds` are document-defined `safeId` tokens on the closed manifest.
Branch IDs are likewise document-defined `safeId` tokens: the sealed V2 manifest
declares its own nonempty unique lexicographically canonical branch list. Every
edge, `gateMap` entry, independence assertion, readiness fact, evaluation
branch, branch fact, and gate claim must join that declared set. Capture
boundaries enforce exact set equality in both directions. There is no global
branch catalogue. The exact id `mechanical` is the only branch that may carry
an independence assertion or X11 preservation; every other declared branch uses
one generic nonmechanical evaluation policy. Those two vocabularies
(`changeKinds` vs declared branch ids) are not interchangeable.

- [Coverage](coverage.md) inventories X04–X11 as they exist in production: supported,
  bounded, or `unavailable`.
- [Boundedness](boundedness.md) records authority, fail-closed recross, and the
  surfaces that grant no provider, solver, or Workbench write.
- Operator closeout of one static FEA `@3` branch:
  [Review static-mechanical closeout](../../../how-to/verify-design/close-out-a-static-mechanical-proof.md).
- Operator walk from public draft capture through seal, recross, human decision, and
  mechanical preservation:
  [Walk cross-domain impact judgement](../../../how-to/verify-design/review-cross-domain-impact.md).

Lookalikes: [lookalike traps § Cross-domain impact](../../agent/lookalike-traps.md#cross-domain-impact).
Mechanical L4/L5 stays on [FEA coverage](../fea/coverage.md). Electrical product
runtime is the admitted SPICE path plus method-sheet L4/L5, not an impact path and
not `mcp-spice`.

A successful CalculiX, OpenModelica, or SysON call is never L4 and never L5. An L4
`pass` is never L5. Gate-claim statuses are `current`, `impact-unresolved`,
`invalidated`, or `carried-forward` — never `pass` or `fail`.
