# FEA boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of catalogued mechanical proof declarations, CalculiX isolated I/O, and
the fixed local runtime. It does not invent a limit. Status words: **enforced**,
**physical-only**, **unbounded**, **needs decision**.

A case label or past result never selects a solver deck. Missing or ambiguous catalog
matches stay `catalog-absent` or `catalog-ambiguous`.

Sibling contracts: [mechanical proof case V1](mechanical-proof-case-v1.md),
[CalculiX static proof V3](calculix-static-proof-v3.md). Shared isolation:
[isolation and Thread boundedness](../../runtime/isolation-and-thread-boundedness.md).

## Catalog and declaration

Catalog reader:
[`file-catalogued-mechanical-proof-case-reader.ts`](../../../../src/adapters/fea/seal-case/file-catalogued-mechanical-proof-case-reader.ts)
(`mechanical-proof-case-catalog/1.0` at `config/mechanical-proof-cases/`). Declaration:
[`mechanical-proof-case.ts`](../../../../src/domain/fea/seal-case/mechanical-proof-case.ts).

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Catalog schema / keys | Exact `{schemaVersion, cases}`; each case `{id, file}` | Enforced | None |
| Catalog ids | `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$` | Enforced (1–256 chars) | None |
| Catalog paths | Relative `*.json`; no `/` prefix, `\`, empty, `.`, or `..` segments | Enforced | None |
| Catalog uniqueness | Unique id and unique file; case-file `id` must match manifest | Enforced | None |
| Catalog entry count | No max | **Unbounded** | Needs a product/storage decision. Not implied by the CalculiX profile. |
| Catalog / case raw bytes | `Deno.readTextFile` with no byte ceiling | **Unbounded** | Same |
| Supports | Non-empty; unique ids; unique selection names; closed mm boxes; no support/load overlap | Enforced non-empty + unique; **unbounded** upper count | Needs a product/storage decision. Not implied by the nine output roles. |
| Loads | Same; force is exactly three finite newtons, not all zero | Enforced non-empty + unique + vector length 3; **unbounded** upper count | Same |
| Requirements | Non-empty; at most the two admitted metrics `maximum-displacement` and `maximum-von-mises-stress`; unique id/name/feature/metric | Enforced 1–2 by metric kind | None |
| Selection names | `^[A-Za-z][A-Za-z0-9_]{0,63}$` | Enforced (1–64 chars) | None |

## Isolated CalculiX I/O and runtime

Authority:
[`calculix-isolated-execution.ts`](../../../../src/domain/fea/isolated-v3/calculix-isolated-execution.ts)
(`MAXIMUM_MANIFEST_BYTES = 1_048_576`; nine-role
`CALCULIX_ISOLATED_OUTPUT_MANIFEST`),
[`CALCULIX_MAXIMUM_ISOLATED_BUNDLE_BYTES = 256 * 1_048_576`](../../../../src/adapters/fea/isolated-v3/fixed-calculix-isolated-execution-profile.ts).
Runtime: `LOCAL_CALCULIX_EXECUTION_LIMITS` in [`server.ts`](../../../../server.ts).

Nine output roles, in code order: `input.step`, `request.json`, `mesh.geo`,
`mesh.inp`, `gmsh.log`, `job.inp`, `ccx.log`, `job.dat`, `result.json`.

| Limit | Code-owned value |
| ----- | ---------------- |
| Input-bundle manifest | 1048576 bytes (1 MiB) |
| Isolated input bundle | 268435456 bytes (256 MiB) |
| Output roles | Exactly 9 |
| Wall | 180000 ms |
| Requested CPU | 160000 ms (unattested) |
| Memory | 3221225472 bytes (3 GiB) |
| Processes | 64 (unattested) |
| Stdout / stderr | 1048576 bytes each |
| Per-file output | 134217728 bytes (128 MiB) |
| Total output | 268435456 bytes (256 MiB) |

No generic isolated-output quota is required beyond this profile.
