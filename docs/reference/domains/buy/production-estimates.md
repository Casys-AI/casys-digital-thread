# Sourced documentary estimates in the Buy calculation

> Verified-Against: ba8bde23 (2026-09-13). Domain contracts plus the guarded read-only
> costing preview that reopens captured bytes.

Audience: both · Diátaxis: reference · Kind: contract

This note owns the versioned contracts that let a sourced documentary estimate join the
existing Buy calculation without becoming an ERP price, and the read-only preview that
recomputes costs only from reopened bytes. The existing Buy capture/seal operations
remain version 1; a seal for the extended bundle and its recorded viewer are separate
surfaces and are not defined here.

Parent contract: [Buy configuration and dated cost evidence](README.md). Lookalikes:
[lookalike traps § Buy](../../agent/lookalike-traps.md#buy).

## What an estimate is and is not

A `buy-documentary-estimate/1.0` is a dated documentary monetary observation bound to
one exact configuration and STEP basis. Each line is explicitly `per-configuration-unit`
with a product UOM; the configuration quantity is multiplied exactly once at
composition. There is no setup/amortization term and no lot lump sum disguised as a unit
cost.

An estimate is **not** an ERP Item Price and **not** a Supplier Quotation. Estimate
lines always carry `costClass: "estimate"` with an `external-documentary` citation.
`buy-cost-bundle/1.0` still refuses documentary citations as ERP prices and still parses
only its own schema.

## Contracts

| Schema                               | File                                                                         | Role                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `buy-documentary-estimate/1.0`       | `src/domain/buy/buy-documentary-estimate.ts`                                 | Closed immutable multi-line input + envelope                                                        |
| `buy-production-estimate-bundle/1.0` | `src/domain/buy/buy-production-estimate.ts`                                  | Computation/provenance annex of per-unit facts; no totals                                           |
| `buy-cost-bundle/2.0`                | `src/domain/buy/buy-cost-bundle-v2.ts`                                       | Composition of a preserved v1 bundle with annexes                                                   |
| Costing preview                      | `src/application/use-cases/buy/prepare-project-buy-cost-estimate-preview.ts` | Guarded read-only recomputation from reopened bytes; no seal                                        |
| Preview evidence (draft)             | `src/adapters/buy/file-buy-cost-estimate-preview-evidence-store.ts`          | Immutable namespace `buy-cost-estimate-preview-evidence`; bounded summary + paged sections; no seal |

All modules use closed parsers with explicit bounds (`BUY_ESTIMATE_MAX_*`,
`BUY_ESTIMATE_MAX_TEXT`), `rejectDuplicates`, `safeId`, ISO-4217, canonical UTC
timestamps, real YYYY-MM-DD validity, `sha256:`, and `deepFreeze`. All arithmetic reuses
the `buy-decimal/1.0` engine; no ad hoc math and no new dependency.

## Single totals/coverage authority

`aggregateBuyCoveredTotals` in `src/domain/buy/buy-cost-bundle.ts` is the only
sum/totals/coverage engine. `computeBuyCostCandidate` (v1) and
`computeBuyCostCandidateV2` (v2) both call it; the annex computes per-unit facts only
and carries no totals, coverage, or dimensions. V1 JSON, readers, and calculator outputs
are unchanged for supported inputs; v1 readers refuse v2 bundles structurally.

## Operands, terms, and unit cost

Each term has an identity, a nature (`material|machine-time|labour|other`), a
consumption operand, and a rate operand. Each operand is discriminated:

- `sourced`: decimal plus an exact captured `agent-resource-capture/1.0` reference,
  anchor, and claimed observation date;
- `assumed`: decimal plus an explicit immutable justification; the priced fact stays
  `provisional`, never observed;
- `unknown`: no decimal at all; a decimal on an unknown operand is refused structurally.

Every priced operand names an exact captured agent-resource reference; there is no
arbitrary stated amount without a source, and no arbitrary HTTP/filesystem URL. Term
amount = consumption decimal x rate decimal. Unit cost = exact sum of term amounts when
every term is priced. An unknown term, a consumption/rate UOM mismatch, or a currency
mismatch leaves no complete unit cost: priced term facts stay in the annex with named
gaps, and the line is excluded from the final covered subtotal. No zero defaults, no
UOM/FX conversion. Consumption UOM must equal rate per-UOM; rate currency must equal
estimate currency (structural) and estimate currency must equal pricing currency (gap,
no invention).

## Basis, digest, and dates

The configuration digest is the SHA-256 hex of the UTF-8 canonical bytes
(`deterministicJson`) of the validated `buy-configuration/1.0`. Both async computes
recompute it and refuse an equal-but-invented caller or source digest. Estimate project,
subject, basis, and parent CAD/STEP identities must match exactly, else
`estimate-basis-mismatch` and no price. STEP, configuration, item identities, and the
pricing context/`asOf` are preserved through composition.

Observation timestamps must be canonical UTC (`YYYY-MM-DDTHH:mm:ss.sssZ`, round-tripped,
no rolled-over or offset forms). Validity bounds must be real `YYYY-MM-DD` dates (Feb
30, prose, noncanonical, and reversed ranges are refused). `asOf` after validity end is
`estimate-expired` (old validity kept, never current) and blocks pricing. SHA-256
envelope preimage/tamper checks stay async.

## V2 composition

`computeBuyCostCandidateV2({configuration, configurationDigest, baseBundle,
estimates, pricingContext})`
requires the base v1 bundle, configuration, and pricing context to match exactly, annex
digests to match the validated configuration, and every annex line to name a known
configuration line exactly once. A simultaneous usable ERP price and usable estimate for
one line is refused: estimates never silently replace catalogue prices. Catalogue lines
keep exact ERP provenance; estimate lines point at exact annex bytes. Required
tax/transport/discount/fees/MOQ/FX stay `dimension-unknown`. Complete arithmetic
coverage never removes documentary/provisional origin.

Lineage (`assertBuyProductionEstimateLineage`, `assertBuyCostBundleV2Lineage`) recrosses
retained bytes, digests, citations, and operand refs without repricing. ERP
citation-to-capture checks stay with the existing buy-source-lineage authority over the
base bundle and captures.

## Capture provenance

The authored estimate payload never carries its own store-minted capture URI: the
resource store returns the capture reference separately from the payload's canonical
preimage bytes. Raw captured estimate bytes must equal the exact canonical bytes or be
refused. Operand evidence references are exact captured agent-resource references,
distinct from the estimate input locator; the preview reopens every named evidence
source and matches its stored fingerprint, keeping anchor and observation metadata
without claiming numeric extraction or engineering qualification from existence or hash
alone. Values and assumptions stay for human MRTR review. Registered Thread-artifact
evidence sources are an explicit unresolved boundary: only exact captured agent-resource
references are accepted in this first path.

## Read-only costing preview

The preview composes the existing seal@1 review authority (completed capture run,
project association, STEP applicability) and reopens the exact candidate canonical bytes
for configuration and base bundle; caller-supplied bundles are never trusted. It reopens
1..8 estimate inputs plus every named evidence source from draft CAS, recomputes
digests, annexes, lineage, and the V2 bundle from retained bytes only, and refuses
stale, missing, foreign, or basis-mismatched inputs before returning usable costs. There
is no ERP refresh, no source replacement, and no capture@2. The result carries literal
`nature: "documentary"` with a separate `provisional` flag — arithmetic-complete
coverage never clears assumed origin — plus exact basis and source identities, computed
annexes, bundle, gaps, and assumptions. Explicitly no executed registered seal, no
spending approval, no qualification, no ready advertisement, and no MRTR decision
parameters. Candidate fingerprints must be `sha256` with lowercase hex digests; anything
else is refused before reads. No cost or authority computation happens in the Workbench.

## Preview evidence and bounded retrieval

Each preview persists as draft immutable evidence under the dedicated
`buy-cost-estimate-preview-evidence` namespace (existing generic byte store; no new CAS
framework, no Thread artifact, no capture@2). Evidence retains project/Thread basis,
candidate, configuration and base-bundle digests, input refs, and computed facts; reopen
validates canonical bytes, hash, byte count, project equality, and nested annex/bundle
structures. The default response is a canonical summary of at most 8192 UTF-8 bytes
(nature, status, basis, `evidenceRef`, digests, coverage/subtotals, provisional and gap
counts with bounded samples); private source bytes stay out. Detail reads address named
sections (`pricing`, `lines`, `annex-terms`, `source-evidence`, `assumptions`) by exact
`evidenceRef` with bounded pages and opaque continuations scoped to project, evidence
hash, section, and offset; scope mismatch, foreign, stale, or tampered refs and cursors
are refused without switching basis or recomputing. Explicit `full-evidence` exists only
for human full review, never by default. MCP tools `project_buy_cost_estimate_preview` /
`project_buy_cost_estimate_preview_detail` are read-only. They register no new execution
operation or MRTR grammar and cannot seal the extended bundle.

## Relation to ERP manufacturing costs

ERPNext already owns manufacturing BOMs, operations, workstations, Work Orders, Job
Cards, and Project/Task/Timesheet service costs. This surface is documentary
pre-production estimation only, not a second manufacturing manager: it adds no BOM,
work-order, or project writes. Where ERP later supplies sourced catalogue or actual
costs for the same consumption or operation, the overlap must be selected and reconciled
explicitly — one priced origin per line, never a silent replacement or a double count of
the same consumption.

## Explicit limitations

- Domain plus guarded read-only MCP preview: immutable draft evidence is persisted for
  detail retrieval. No Thread document, new seal operation, or recorded viewer is
  provided by this surface.
- No FX, no UOM conversion, no division-derived unit prices, no complete total while
  anything required is unknown.
- Fixture amounts in tests are synthetic labels, not actual spend.
