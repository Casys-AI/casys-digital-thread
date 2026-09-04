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

| Surface             | Command                                                                  | What it proves                                                                                                                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Docker smoke        | `scripts/gates/verify-ngspice-microsandbox-worker.ts --run`              | Container contract outside IsolatedCodeRunner. Not product runtime state.                                                                                                                                                                                   |
| Maintainer recovery | `deno task prepare:ngspice:microsandbox`                                 | Exceptional recovery only: inspect a server-owned acquisition source or rebuild a candidate Dockerfile, then import only if it attests to the exact runtime digest. No alias pull and not a product run.                                                |
| Product run         | `project_admitted_spice_run_review` then `simulate.run-admitted-spice@1` | Documentary isolated execution over the server-owned worker profile. After durable authorization, server-owned preload may prepare the exact runtime material; this worker publishes no host port.                                                     |

The Docker distribution/index digest
`casys/ngspice-microsandbox-worker@sha256:4350b3b70bb75acee46d24ffe329b809d1132acd506cc9bd4e83c1340aa6942d`
is an internal bootstrap acquisition input. The executable Microsandbox manifest
`casys/ngspice-microsandbox-worker@sha256:54079cf7c0e1fcdf9dc30941cc97a752460d787d8d27dd9617d4cfe462e59720`
is the only runtime `imageReference`, catalogued material, and JIT attestation target.
Backend inspect requires `imageReference` digest == attested `manifestDigest`. Do not
pin the Docker index digest as the runtime image or expose it in a project plan.
`pullPolicy` stays `never`. A local `trusted-dockerfile` rebuild is a candidate recipe,
not bit-reproducible proof and not an `oci-digest` distribution. It can fail to attest
to the exact runtime target digest; then the capability remains unavailable. GHCR OCI
promotion is deferred until separate qualification promotes an exact digest. A moving
APT repository does not promise that a later rebuild will reproduce the pin.

Ordinary start is cold Deno. Do not start the root Compose provider stack: H1 activates
enrolled groups JIT under a lease when covered work needs them, and those groups collide
with root Compose on the same loopback ports. A root `docker compose up` remains a
manual maintainer probe only and must not run concurrently with H1-managed groups.

```bash
deno task start:yolo    # YOLO approval only; it does not activate SPICE
```

ERPNext is an optional sibling integration; start it separately only when its checkout
and environment file are available.

Connect the agent to `http://127.0.0.1:3020/mcp`. The Workbench is read-only. After a
durable brief authorization, the local control plane schedules a guarded preload of the
exact `casys.spice-worker/ngspice-runtime-image` material; after a server restart it
first reconverges the durable authorization lock and re-schedules those authorized
preloads. The admitted-SPICE executor only observes that exact material in its H1
execution session before it claims a run. It never pulls, rebuilds, imports, or selects
an acquisition source JIT. An absent, acquiring, failed, or unattested preload leaves
the work item and run unchanged and reports the capability literally `unavailable`.
Restarting the console alone is not an activation mechanism.

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

Call `project_technical_compilation_preview` with exactly
`{ projectId, sourceRefs: [capture.result.reference] }`. When more than one capture is
compiled, every locator in `sourceRefs` must resolve to one shared
ProjectSourceWorkspace basis. The server joins the current Thread tip, the unique
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

Obtain human MRTR, queue, then execute `simulate.run-admitted-spice@1`. A missing or
in-progress exact microVM preload, failed exact image attestation, or missing operational
envelope keeps the executor literal `unavailable` before it claims the run. Maintainer
recovery preparation or a standalone worker check is not a product run.

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

After the completed L3 run, call
`project_electrical_observation_method_sheet_seal_review` with `projectId` only. Its
`mode: preparation` result reopens the unique current completed admitted-SPICE activity
and returns:

- `methodSheet`: the exact project/subject, current Thread basis including its
  server-computed fingerprint, and capture/evidence/result identities to copy into the
  agent-authored `electrical-observation-method-sheet/1.0`;
- `l3.observations`: literal native names, values and units recrossed between the
  current Thread and the exact stored `result.json`;
- `l3.limitations`: the documentary L3 limits, still not criteria or verdicts;
- `briefItems`: exact approved Brief identities that a later criterion may name.

The preparation returns no provider, image, endpoint, source bytes or arguments and does
not invent a threshold. A completed `simulate.run-admitted-spice@1` also exposes its
matching observations on `project_snapshot` for ordinary run inspection, but only the
preparation mode supplies the current canonical Thread fingerprint required by the
method sheet.

Author the remaining `id`, `scope`, `limitations`, sources, criteria and review fields,
then capture the canonical JSON with `project_resource_capture`. Pass only
`interpretation.typed.fingerprint` back to
`project_electrical_observation_method_sheet_seal_review` with the same `projectId`. Its
`mode: review` result is returned only after the sheet's Brief gates, selected L3 branch
and current Thread basis recross exactly. Use its MRTR parameters to seal with
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
