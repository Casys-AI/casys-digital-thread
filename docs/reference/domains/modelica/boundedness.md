# Modelica boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of closed-subset v2 source, experiment grid, outputs, and the fixed
local runtime. It does not invent a limit. Status words: **enforced**,
**physical-only**, **unbounded**, **needs decision**.

The capture frontend and worker must use the same authorizer. Admission and a separate
human MRTR remain required. Documentary success is not a requirement verdict.

Sibling contracts: [language](language.md), [execution](execution.md). Shared isolation:
[isolation and Thread boundedness](../../runtime/isolation-and-thread-boundedness.md).

## Source and semantic IR

Domain authorizer:
[`closed-subset-v2.ts`](../../../../src/domain/modelica/source/closed-subset-v2.ts).
Lexer/parser:
[`lexical.ts`](../../../../src/domain/modelica/source/lexical.ts),
[`parse.ts`](../../../../src/domain/modelica/source/parse.ts).
Byte ceiling at capture and worker (the domain authorizer checks non-empty text without
NUL, not UTF-8 length):
[`QUALIFIED_MODELICA_MAX_SOURCE_BYTES = 262_144`](../../../../src/adapters/modelica/source/source-analysis-composition.ts),
[`authorizeAdmittedModelicaSource`](../../../../src/adapters/modelica/admitted/closed-subset-v2/run.ts)
(1 to 262144 bytes).

| Surface | Today | Status | Missing value |
| ------- | ----- | ------ | ------------- |
| Source bytes | 1–262144 UTF-8 at capture and worker | Enforced there | Domain authorizer does not repeat the byte check |
| Parameters | 1–32 unique `parameter Real` | Enforced | None |
| Outputs | 1–16 unique `output Real`; names must not collide with parameters | Enforced | None |
| Equations | Exactly one per output; every LHS is a declared output; at least one `der` | Enforced | None |
| Name resolution | Parameter, output, declared-name and equation-LHS lookups use one-pass `Set` indexes | Enforced | None |
| Experiment duration | `> 0` and `<= 120` s | Enforced | None |
| Experiment intervals | Exact signed-decimal grid of 10–2000 | Enforced | None |
| Tolerance | `[1e-12, 0.1]` | Enforced | None |
| Unit strings | Non-empty ASCII, length `<= 64` | Enforced | None |
| Tokens | No token-count check | **Physical-only** (source bytes) | Explicit token cap would be a product decision (H04); not implied by the runtime profile |
| Expression nodes | Iterative heap/loop parse, no node cap | **Physical-only** | Same |
| Identifier length | Regex `^[A-Za-z_][A-Za-z0-9_]*$` only | **Physical-only** | Same |

## Isolated outputs and runtime

Admitted manifest
[`MODELICA_ADMITTED_OUTPUT_MANIFEST`](../../../../src/domain/modelica/admitted/run-proposal.ts):
exactly `evidence` (`evidence.json`) and `result` (`result.csv`). Qualified-kit
manifest
[`MODELICA_ISOLATED_OUTPUT_MANIFEST`](../../../../src/domain/modelica/qualified-kit/isolated-execution.ts):
the same two roles (evidence format `modelica-isolated-evidence-v1` vs admitted `v2`).
Receipts that are not exactly those two roles fail closed.

Runtime authority: `LOCAL_MODELICA_EXECUTION_LIMITS` in
[`first-party-modelica-execution.ts`](../../../../src/adapters/modelica/first-party-modelica-execution.ts)
(admitted and qualified-kit policy bodies). The qualified-kit grammar
[`QUALIFIED_LIMITS`](../../../../src/domain/modelica/qualified-kit/run-proposal.ts)
repeats the same numbers and adds `QUALIFIED_MAXIMUM_BUNDLE_BYTES = 8_388_608`.

| Limit | Code-owned value |
| ----- | ---------------- |
| Wall / CPU | 120000 ms each |
| Memory | 3221225472 bytes (3 GiB) |
| Processes | 64 (unattested) |
| Stdout / stderr | 1048576 bytes each |
| Per-file output | 16777216 bytes (16 MiB) |
| Total output | 17825792 bytes (17 MiB) |
| Qualified-kit input bundle | 8388608 bytes |

The isolated admitted/kit output count is exactly **2**. No generic isolated-output
quota is required.
