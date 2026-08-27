# How-to: run admitted SPICE

Audience: both · Diátaxis: how-to · Kind: how-to

Walk product circuit-only SPICE as closed-subset source: capture → compile seal → reopen
the exact bytes in the local microVM. The current and only admitted-source profile is
`spice-circuit-closed-subset-v1`, version `1.0.0`.

Do **not** call `mcp-spice`. Do **not** pass a netlist, image, args, path, or
observations to the admitted review or operation. Do **not** use the LED-driver human
fiche as this source. Agent source must not include `.op`, `.end`, `.control`, or
`.include`: the worker owns analysis and termination.

Contract:
[admitted source isolated execution](../../reference/pipeline/admitted-source-isolated-execution.md).
Lookalikes: [lookalike traps](../../reference/agent/lookalike-traps.md). Domain limits:
[circuit-only SPICE closed subset v1](../../reference/domains/electrical/spice-circuit-closed-subset-v1.md).

## 0. Surfaces

Three operator surfaces. They are not substitutes.

| Surface           | Command                                                                  | What it proves                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Docker smoke      | `scripts/gates/verify-ngspice-microsandbox-worker.ts --run`              | Container contract outside IsolatedCodeRunner. Not the Microsandbox cache.                                                                  |
| Cache preparation | `deno task prepare:ngspice:microsandbox`                                 | Idempotent import of the Docker source digest into the local Microsandbox cache under the runtime manifest pin. No pull. Not a product run. |
| Product run       | `project_admitted_spice_run_review` then `simulate.run-admitted-spice@1` | Documentary isolated execution after `--local-execution`.                                                                                   |

The Docker distribution/index digest
`casys/ngspice-microsandbox-worker@sha256:62748f195c86751c5fc565ea8e0ac5ab6bd283ddcae2426918d697b25ce6d392`
is the `docker image save` source. The executable Microsandbox manifest
`casys/ngspice-microsandbox-worker@sha256:3350527ceba0dbe8f2e31e435e834f962978e800134b83d6ee8f4875b7ffb79a`
is the runtime `imageReference`. Backend inspect requires `imageReference` digest ==
attested `manifestDigest`. Do not pin the Docker index digest as the runtime image.
`pullPolicy` stays `never`. Server startup does not pull or import.

```bash
docker compose up -d syson-db syson-app mcp-syson mcp-build123d mcp-build123d-sandbox mcp-calculix
deno task prepare:ngspice:microsandbox   # once per host cache; idempotent
deno task start:yolo    # or start:local; review/executor need --local-execution
```

ERPNext is an optional sibling integration; start it separately only when its checkout
and environment file are available.

Connect the agent to `http://127.0.0.1:3020/mcp`. The Workbench is read-only. Restart is
required after composing `--local-execution` so the review tool and executor are wired.

## 1. Capture

Call `project_resource_capture` with the `.cir` UTF-8, put that resource as a workspace
file, attach it, then `project_technical_source_capture` with only `projectId`,
`workspaceRevision`, `attachmentId` and `attachmentRevision`. The source must satisfy
the v1 circuit-only grammar. Ordinary numeric netlists without `.param` are admissible.
There is no inline `sourceText`, `profileId`, `sourceId` or `resourceRef`.

Read the result fields separately:

- `parser.status` reports the shared circuit-only authority. It is not admission.
- Pass `result.reference` only. Never copy the source text into the next tool.

A rejected source is a closed-language refusal. There is no mcp-spice fallback.

## 2. Compile and seal

Call `project_technical_compilation_preview` with `projectId` plus `result.reference`
only. The server joins the current Thread tip, the unique
`spice-circuit-closed-subset-v1` / `1.0.0` profile, and unique SysML `parameterizes`
bindings for every `.param` symbol. A netlist with zero named levers does not need
`parameterizes`. Concurrent CAD or Modelica sources are not this profile.

Unresolved previews hoist `gaps`. A missing or ambiguous `.param` bind is
`binding.missing`.

Obtain human MRTR, queue, then execute `compile.seal-admission@3`.

## 3. Review and run

Call `project_admitted_spice_run_review` with `projectId` only. Do not derive or pass a
Thread basis, admission id, fingerprint, provider, solver, image, args, path, or
observations. The server reopens the current Thread tip and selects exactly one fresh,
non-archived canonical `document` produced by `digital-thread` /
`compile.seal-admission@3` whose compilation target and source are
`spice-circuit-source`. Concurrent CAD or Modelica admissions are not candidates.

Zero SPICE candidates — including stale, archived, malformed, foreign-producer
lookalikes, or CAD/Modelica-only admissions — fail closed. Several SPICE candidates are
ambiguous and also fail closed. The exact admission validator rereads the
server-selected bytes and returns the fixed parameters and registered
`simulate.run-admitted-spice@1` operation. Reuse that `operation` verbatim on the later
work item: `compilationAdmission` names the selected admission on the current review
Thread basis. Do not copy a historical `compile.seal-admission@3` creation snapshot.

Obtain human MRTR, queue, then execute `simulate.run-admitted-spice@1`.

Without `--local-execution` the operation stays registered and the executor is
`unavailable`.

## 4. Read success correctly

A success contains an execution capture, `evidence.json`, `result.json`, and one
documentary observation per native ngspice operating-point quantity (`v(name)`,
`i(name)`, `@name[i|id|…]`), with ngspice-native signs and units `V` or `A`.

The worker prepends a title line, appends a server-owned `.op`/`.end` block, and runs
`ngspice -b -n` on `/input/source.cir`. Callers never choose those commands. The
published branch remains `documentary`: it contains no requirement evaluation, derived
power, L4, L5, or safety. Replay must reopen durable evidence without dispatching
ngspice again. A typed isolated rejection is journaled in the dedicated WAL and
publishes no Thread evidence.

## 5. Method sheet, L4, and L5 (generic capability)

This section is the generic walk. Exact AL01 identities live on
[AL01 runtime evidence](../../project-dossiers/articulated-led-desk-lamp/runtime-evidence.md);
this page does not substitute for them.

Seal a reviewed `electrical-observation-method-sheet/1.0` with
`project_electrical_observation_method_sheet_seal_review` then
`verify.seal-electrical-observation-method-sheet@1`. That seal is not L3, not L4, and
not ngspice.

Call `project_admitted_spice_evaluation_review` with `projectId` only. The server
reopens the unique current Thread tip, unique sealed electrical method sheet, and unique
admitted SPICE evidence. Obtain a new human MRTR, queue, then execute
`verify.evaluate-admitted-spice-observations@1`. The comparator is the sealed method
sheet, not ngspice and not SysON. Unresolved natives stay `unresolved`. An L4 `pass` is
not L5 and not a safety claim.

Call `project_admitted_spice_evaluation_closeout_review` with `projectId` only. The
server selects the unique current L4 from
`verify.evaluate-admitted-spice-observations@1`. Both accept and reject parameters are
always derived. Execute exactly one of `decide.accept-admitted-spice-evaluation@1` or
`decide.reject-admitted-spice-evaluation@1`. Neither operation calls ngspice or SysON.

## Refusals

| Unharnessed move                                | Harness                                                                |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| mcp-spice or LED-driver fiche                   | Circuit-only capture → seal → admitted `@1`                            |
| Caller `.op` / `.end` / `.control` / `.include` | Closed subset rejects analysis and control; the worker owns them       |
| Extra netlist, image, args, path, observations  | Registry and review refuse them                                        |
| Caller Thread/admission identity                | Review accepts `projectId` only; server selects the exact current join |
| Stale or wrong-producer admission               | Not a fresh `digital-thread` `compile.seal-admission@3` candidate      |
| Two fresh SPICE admissions on the current tip   | Ambiguous; a concurrent CAD or Modelica admission is not a candidate   |
| SPICE success used as an L4/L5 verdict          | Documentary L3 observations only; L4 is the method-sheet evaluator     |
| L4 `pass` treated as L5                         | Human closeout of the exact L4; review always offers accept and reject |
| mcp-spice as this product run                   | Circuit-only admitted `@1` only                                        |
