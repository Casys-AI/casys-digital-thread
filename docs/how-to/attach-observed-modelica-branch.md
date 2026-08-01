# How-to: attach a persisted Modelica branch

Attach thermal evidence only after `mcp-modelica` has already persisted a successful
run. This command reads `modelica_run_get`; it never invokes `modelica_simulate`.

First bootstrap the CoffeeMachine CM-01 subject, then inspect the persisted run IDs
through the read-only Modelica catalog. The run must remain available from
`mcp-modelica` at the point of attachment. The common assembly path already attaches the
manifest-declared run; use this focused command for another exact run identifier.

```bash
deno task thread:assemble

curl -fsS -X POST http://127.0.0.1:3016/mcp \
  -H 'accept: application/json' \
  -H 'content-type: application/json' \
  -H 'mcp-protocol-version: 2026-07-28' \
  -H 'mcp-method: tools/call' \
  -H 'mcp-name: modelica_run_list' \
  --data '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/clientInfo":{"name":"casys-digital-thread","version":"0.1.0"}},"name":"modelica_run_list","arguments":{"limit":20}}}'
```

Attach one exact run identifier, rather than whichever item happens to be listed first:

```bash
deno task thread:attach-modelica --run=run_41d5e485-b6a1-48d4-bc72-5aab6fd35f25
```

The adapter accepts only a successful observed run with:

- matching run/model/scenario identities;
- a SHA-256 model artifact matching the declared Modelica model;
- hashed `result` and `evidence` artifacts; and
- at least one quantity with an explicit unit.

It creates an immutable snapshot revision containing the persisted Modelica artifacts, a
verified model-consumption link, and observations sourced from the provider evidence
artifact. It adds no thermal threshold, requirement, evaluation, or violation.

This branch is deliberately independent of CAD/FEA. A Modelica run for the CoffeeMachine
proves its own model/scenario result; it does not by itself prove that the canonical
STEP affected that thermal result. Add such a causal link only when a versioned
transformation or system-model trace genuinely exists.

The result is written under `state/local/thread-snapshots/`, which is ignored local
state. Re-running the exact command against the same base is idempotent; to attach
another run, pass the intended `--base=<snapshot-id>` explicitly.
