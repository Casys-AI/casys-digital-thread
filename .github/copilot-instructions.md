# Copilot review guidance

Read `AGENTS.md` before changing or reviewing repository code. Treat it as the
authority map for operations, contracts, persisted truth, and provider boundaries.

## Review priorities

- Report concrete bugs, contract violations, authority leaks, regressions, and
  missing invariant tests before style concerns.
- Keep registered operation identities, server-owned selection, and literal
  contract states intact. Do not suggest aliases, caller-selected runtimes,
  invented evidence, or UI-only substitutes for server authority.
- Check that new behavior has focused co-located tests, especially for rejected
  inputs, stale evidence, unresolved states, and deterministic outputs.
- Prefer the smallest change consistent with the existing Deno, Vite, and MCP
  patterns. Do not broaden provider capabilities or repair unrelated failures.

## Validation

Use the narrowest relevant check first. The main repository gates are:

```text
deno task fmt
deno task verify:docs
deno task lint
deno task check
deno task check:ui
deno task test
deno task verify:evidence
deno task verify:thread:presentation
```

The GitHub Actions `Quality` workflow is required evidence for pull requests.
