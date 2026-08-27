# CAD boundedness inventory (H01)

Audience: both · Diátaxis: reference · Kind: inventory

HEAD inventory of Build123d source, tokens, outputs, and the fixed local runtime. It
does not invent a limit. Status words: **enforced**, **physical-only**, **unbounded**,
**needs decision** (see [SysML inventory](../sysml/boundedness.md) for the same
legend).

The server owns the analyzer, D4, profile, image, command, and recovery. A human signs
each consequential MRTR. Isolated success is not canonical geometry.

Sibling contracts: [closed subset v1](build123d-closed-subset-v1.md),
[execution paths](execution-paths.md). Shared isolation:
[isolation and Thread boundedness](../../runtime/isolation-and-thread-boundedness.md).

## Source and analysis

| Surface | Today | Authority | Status | Missing value |
| ------- | ----- | --------- | ------ | ------------- |
| Technical capture / execution-profile source | 262144 UTF-8 bytes | `INITIAL_QUALIFIED_BUILD123D_MAX_SOURCE_BYTES` in [`initial-technical-source-analysis-composition.ts`](../../../../src/adapters/compile/captures/initial-technical-source-analysis-composition.ts); profile `maximumSourceBytes` must equal it | Enforced | None |
| D4 reachability | 65536 bytes (`64 * 1024`) | `MAX_SCRIPT_BYTES` in [`geometry-script-validation.ts`](../../../../src/domain/cad/source/geometry-script-validation.ts) | Enforced; tighter than capture | None |
| D4 tokens | 8000 tokenizer entries (`MAX_TOKENS = 8_000`); a finished script is admitted only with at most 8000 entries, and the 8001st is rejected | Same D4 module | Enforced | None |
| Qualified AST nodes | Lezer walk in [`qualified-build123d-source-analyzer.ts`](../../../../src/adapters/cad/source/qualified-build123d-source-analyzer.ts) has no node-count check | Analyzer 1.6.0 | **Physical-only** (64 KiB and the token guard) | An explicit node cap would be a product decision; it is not implied by the runtime profile |

D4 is a reachability guard. Capture 262144 does not widen D4.

## Isolated output and runtime

Output authority:
[`BUILD123D_EXECUTION_OUTPUT`](../../../../src/domain/cad/isolated/build123d-execution-proposal.ts)
is exactly one role `geometry` / `geometry.step` / `model/step` / `step-ap214`. The
profile manifest is that one entry.

Runtime authority: `LOCAL_BUILD123D_EXECUTION_LIMITS` in
[`server.ts`](../../../../server.ts). CPU and process count remain unattested (see
[workspace map](../../runtime/local-runtime-and-ports.md)).

| Limit | Code-owned value |
| ----- | ---------------- |
| Wall | 30000 ms |
| Requested CPU | 25000 ms (unattested) |
| Memory | 1073741824 bytes (1 GiB) |
| Processes | 32 (unattested) |
| Stdout / stderr | 65536 bytes each |
| Per-file output | 134217728 bytes (128 MiB) |
| Total output | 134217728 bytes (128 MiB) |

Worker composition in
[`build123d-execution-composition.ts`](../../../../src/adapters/cad/isolated/build123d-execution-composition.ts)
also pins 1 vCPU, 1024 MiB root disk, 120000 ms max duration, and 128 open files. Those
are server-owned process facts, not a second source ceiling.

The isolated CAD output count is exactly **1**. No generic isolated-output quota is
required; see the [shared page](../../runtime/isolation-and-thread-boundedness.md).
