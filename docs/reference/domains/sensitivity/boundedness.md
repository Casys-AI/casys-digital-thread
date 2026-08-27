# Sensitivity boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of catalogued sensitivity-study templates and study-case collections. It
does not invent a limit. Status words: **enforced**, **physical-only**, **unbounded**,
**needs decision**.

Ambiguous or missing catalog matches stay `catalog-absent` or `catalog-ambiguous`. The
study produces derivatives, never a verdict.

Sibling: [domain index](README.md). CAD ceilings used when a study reopens admitted
Build123d: [CAD boundedness](../cad/boundedness.md). Shared isolation:
[isolation and Thread boundedness](../../runtime/isolation-and-thread-boundedness.md).

## Catalog

Reader:
[`file-catalogued-sensitivity-study-case-reader.ts`](../../../../src/adapters/sensitivity/study/file-catalogued-sensitivity-study-case-reader.ts)
(`sensitivity-study-case-catalog/1.0` at `config/sensitivity-study-cases/`).

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Catalog schema / keys | Exact `{schemaVersion, cases}`; each case `{id, file}` | Enforced | None |
| Catalog ids | `^[A-Za-z0-9][A-Za-z0-9._-]*$` (no length cap; no `:`) | Enforced shape; **unbounded** length | A length cap would be a product/storage decision. FEA catalog ids are already 1–256; this page does not copy that number. |
| Catalog paths | Safe relative `*.json`; canonical `catalog.json` and declared case files must be strict descendants of the canonical catalog root | Enforced | None |
| Catalog uniqueness | Unique id and unique file; case-file `id` must match | Enforced | None |
| Catalog entry count / raw bytes | No max | **Unbounded** | Needs a product/storage decision. Not implied by the Build123d or CalculiX profile. |

## Study case v2

Authority:
[`sensitivity-study-v2.ts`](../../../../src/domain/sensitivity/study/sensitivity-study-v2.ts).

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| `min` / `max` / `value` vectors | Exactly three finite numbers | Enforced | None |
| Metrics | Non-empty; unique ids | Enforced non-empty; **unbounded** upper count | Needs a product/storage decision |
| Solver supports / loads | Non-empty; unique ids | Enforced non-empty; **unbounded** upper count | Same |
| Domain limitations | Non-empty; unique strings | Enforced non-empty; **unbounded** upper count | Same |
| Selection names | `^[A-Za-z][A-Za-z0-9_]{0,63}$` | Enforced (1–64 chars) | None |
| CAD source / isolated CAD output | Reopens admitted Build123d bytes; execution uses the Build123d profile | **Derived** from [CAD boundedness](../cad/boundedness.md) | Do not invent a second CAD ceiling here |
