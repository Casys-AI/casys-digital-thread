# Cross-source admission compiler spike

This isolated experiment proves one narrow step of the future admission boundary: five
exact native sources can be analyzed, explicitly linked, and compiled into a
deterministic provider-neutral draft.

```text
brief source + structurally consistent review claim
                 |
                 v
       explicit caller-supplied bindings
                 |
                 v
    rendered SysML source draft (local symbol anchor)
          /             |              \
         v              v               v
 build123d projection  Modelica projection  CalculiX projection
```

The brief source retains intent content, but this pure compiler does not possess enough
server state to prove authority. It checks that an `EngineeringApprovedBriefBasis` and
an approved human `ProjectBriefReview` claim are structurally consistent with the exact
brief bytes. Those JSON claims remain forgeable here, so the output calls them
`brief-source-review-claim`, never `human-approved`. Likewise, the explicit bindings are
caller-supplied and consistency-checked, not reviewed. The compiler never matches
symbols by name.

The output schema is `admission-compilation-spike/0.1`. It is canonicalizable and
SHA-256 content-addressable. A missing binding or any analyzer-reported unresolved
construct yields `unresolved`; changed source bytes, a rejected analysis policy, or a
different SysML draft anchor are rejected before the document exists. Lowering profiles
are passed as a conventionally server-owned catalog in this pure spike. Because the
catalog is still injected by the caller here, production must freeze it inside the
server-owned resolver rather than trusting request data. The caller can select only
registered profile ids and cannot provide a provider, MCP tool, endpoint, shell command,
or arbitrary arguments.

The real five-source fixture is expected to remain globally `unresolved`. The production
Python frontend conservatively retains build123d imports and calls as unresolved syntax,
so the build123d projection is also `unresolved` even when every symbol has a binding.
The Modelica and CalculiX linkage projections can be binding-resolved independently.
Future resolution requires a reviewed provider profile and exact capture/readback; it
must not be achieved by deleting or suppressing the source diagnostics.

This is deliberately not production wiring and grants no execution, evidence, or
engineering authority. It performs no provider I/O, does not mutate the Thread, does not
queue work, and has no dispatch envelope. `IsolatedRunner` is only a runtime-neutral
port for a later stage: an adapter may use Deno Sandbox, a container, VM, WASI runtime,
or another reviewed isolation implementation. The spike neither chooses nor invokes one.

That statement applies to the pure compiler. `integrated-smoke.ts` is a separate,
explicitly effectful fixture-only harness. It verifies the exact brief items and their
13 proposal-field mappings, creates and rereads an ephemeral SysON project, passes the
real SysON element ids to a fixed build123d-to-CalculiX path, proves the nine recorded
CalculiX resources by exact byte reads, deletes the SysON project, and only then runs a
separate qualified Modelica solver-conformance scenario. It writes no Engineering
Project or Thread state and never changes the compilation from `unresolved` or the
admission status from `not-admitted`.

The real-native-chain test uses the production `ProjectBriefSourceAnalyzer`,
`RenderedArchitectureSysmlAnalyzer`, and `PythonCadSourceAnalyzer` on exact native text.
No qualified Modelica or CalculiX source frontend exists yet, so `mini-frontends.ts`
contains small fail-closed, fixture-only subsets. They compute the exact UTF-8 SHA-256
themselves and emit explicit symbols, but they are not complete parsers and must not be
promoted as qualified production analyzers.

The required fifth-source fixture is deliberately named `SolverConformanceRamp`. It is
only a syntax/linkage conformance source: it carries no product requirement, physical
claim, or engineering verdict, and it is not coupled to the generic mechanical support
specimen.

All three output contracts are explicitly `spike-only/*` linkage documents and are not
executable provider inputs. The Modelica `.mo` source is only a candidate-qualification
link: the current MCP path consumes server-qualified model and scenario ids. The
CalculiX `.inp` source is only a closed lexical/source-linkage subset: it requires the
fixture sequence and minimum data-bearing sections, but it does not validate node and
element referential integrity or solver semantics and is not a qualified deck parser.
The recorded MCP path consumes STEP plus server-owned proof, material, mesh, and
selection data, then the provider generates its own `mesh.inp` and `job.inp`. This spike
source must never be presented as that final executable input or as a physical proof.

The next production slice must resolve authority and identity from server-owned
readbacks: the exact project snapshot, the `project.brief-approve` receipt, and the
`BriefSourceAnalysisReference` before promoting a brief to human-approved. It must also
replace `sysml-source-draft` with an exact SysON readback carrying the
`editingContextId`, provider element ids, and reviewed binding kind/scope. This spike
does not implement that readback.

Run the bounded gates:

```sh
deno fmt --check experiments/admission-compiler-spike
deno lint experiments/admission-compiler-spike
deno check experiments/admission-compiler-spike/*.ts
deno test --allow-read --allow-env=LOG \
  experiments/admission-compiler-spike/*_test.ts
```

After the gates are green, the bounded live harness is:

```sh
task_tmp="${TMPDIR%/}"
task_tmp_real="$(cd "$task_tmp" && pwd -P)"
docker_bin="$(command -v docker)"
deno run \
  --allow-net=127.0.0.1:3009,127.0.0.1:3015,127.0.0.1:3024 \
  --allow-run="$docker_bin" \
  --allow-read="$PWD,$task_tmp,$task_tmp_real" \
  --allow-write="$task_tmp,$task_tmp_real" \
  --allow-env=LOG,TMPDIR \
  experiments/admission-compiler-spike/integrated-smoke.ts
```

The command has privileged Docker authority and is not the future untrusted-code
sandbox. Its generated STEP handoff files and SysON project are deleted fail-closed. The
independently reread result from 2026-08-13 is recorded in
[`LIVE_RESULT.md`](./LIVE_RESULT.md).
