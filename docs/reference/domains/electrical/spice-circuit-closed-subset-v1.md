# Reference: circuit-only SPICE closed subset v1

Audience: both · Diátaxis: reference · Kind: contract

`spice-circuit-closed-subset-v1` / `1.0.0` is a bounded circuit-declaration language,
not general ngspice, not a simulation deck, and not the LED-driver human fiche. The
capture frontend authorizes the same grammar a later isolated worker would accept as
circuit source. Analysis commands and `.end` are refused because a later server-owned
worker would own them.

This page is capture → analysis → compilation preview → `compile.seal-admission@3` plus
the generic ngspice Microsandbox worker contract. Product IsolatedCodeRunner wiring is
`simulate.run-admitted-spice@1` after `project_admitted_spice_run_review`. It is
documentary L3 evidence only. mcp-spice and the LED-driver fiche are not this path.
Derived power, L4, and L5 are later registered operations on a sealed electrical method
sheet; they are not granted by this worker. Safety remains `unavailable`.

## Accepted form

One canonical UTF-8 source (1 to 262,144 bytes, no NUL) is a netlist body:

```text
* comment
Vname n+ n- [DC] <number|{param}>
Rname n1 n2 <number|{param}>
Cname n1 n2 <number|{param}>
Lname n1 n2 <number|{param}>
Dname n+ n- <model>
Qname nc nb ne [ns] <model>
Mname nd ng ns nb <model> [L=<number|{param}>] [W=<number|{param}>]
Kname L1 L2 <number|{param}>
.param name = <finite-number>
.model name D|NPN|PNP|NMOS|PMOS[(p=v ...)]
.title <text>
```

- There are 1–256 uniquely named elements and 1–256 unique nodes. Names are compared
  case-insensitively; the first spelling is kept.
- `.param` declarations are optional (0–32). They are the only named numeric levers.
  Device values, model-card numbers, and `{name}` substitutions are not levers. A
  reachable literal without `.param` is ordinary circuit structure, not
  `source.no-named-numeric-lever`.
- `{name}` may reference only a declared `.param`. Semiconductor devices must name a
  declared `.model` of a compatible type. `K` may couple only declared inductors.
- Line comments (`*`), inline `$` / `;` comments, and `+` continuations are accepted.
  `.title` is optional documentation; the analysis artifact name is always `circuit`.
- Numeric spellings are finite decimals with at most one closed-subset scale suffix:
  `t`, `g`, `meg`, `k`, `m`, `u`, `n`, `p`, `f`. Trailing unit junk (`1kOhm`) is
  refused.

Whitespace and comments are not authority. The first line is not silently a title.

## Named levers and compilation

Compilation uses the generic technical-source spine. The unique catalogue profile is
`spice-circuit-closed-subset-v1` / `1.0.0` (`spice-circuit` / `spice` →
`spice-circuit-source`). Admission requires unique `parameterizes` only for `.param`
symbols. An ordinary numeric netlist with zero `.param` can be `ready-for-review`.
Callers never pass bindings, profileRequests, a provider, a tool, or a runtime.

## Rejected

These forms are rejected rather than partially interpreted: `.control` / `.endc`,
`.include` / `.inc` / `.lib`, `.shell`, host file access (`FILE=`, `PWL FILE=`),
behavioral sources (`B`, `VALUE=`, `TABLE=`, `POLY`, `LAPLACE`), subcircuits (`X`,
`.subckt`), caller-owned analysis and closeout (`.op`, `.tran`, `.ac`, `.dc`, `.end`,
`.print`, `.probe`, `.meas`, `.save`), and any other dotted directive.

## Isolated worker and product run

[`images/ngspice-microsandbox-worker/`](../../../../images/ngspice-microsandbox-worker)
is a dedicated Microsandbox family. It is not `mcp-spice` and not a qualified fixed
circuit kit. The image `ENTRYPOINT` is the complete worker command: no caller arguments,
provider envelope, paths, or observation list.

Docker smoke, Microsandbox cache preparation, and the product run are not substitutes:

| Surface           | Owner                                                                     | What it is not                                           |
| ----------------- | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| Docker smoke      | `scripts/gates/verify-ngspice-microsandbox-worker.ts`                     | IsolatedCodeRunner, Microsandbox cache, product evidence |
| Cache preparation | `deno task prepare:ngspice:microsandbox`                                  | A pull, a product run, a caller-selected image           |
| Product run       | `simulate.run-admitted-spice@1` after `project_admitted_spice_run_review` | mcp-spice, the LED-driver fiche, a verdict               |

The Docker source/index digest (`62748f195c86…`) and the Microsandbox runtime manifest
digest (`3350527ceba0…`) are related but distinct profile-owned constants. Product
inspect requires `imageReference` digest == attested `manifestDigest`. `pullPolicy`
stays `never`.

Filesystem contract, analogous to admitted Modelica:

- read exact circuit-only UTF-8 from `/input/source.cir` and leave those bytes unchanged
- authorize the closed subset again inside the worker
- write a separate `/work/run.cir`: server-owned title line, exact source body,
  `.options savecurrents`, `.control` / `op` / redirected `print` of planned vectors /
  `quit` / `.endc` / `.end`
- run `ngspice -b -n` with a 30 s code-owned timeout
- write only `/out/result.json` and `/out/evidence.json`

The first netlist line is ngspice's title. The worker therefore prepends
`casys spice-circuit-closed-subset-v1 operating-point` so agent source is never consumed
as a title. `.include` is never used.

Export method (proven against ngspice-42): one
`print <native> >/>> /work/op-vectors.txt` per planned observable after `op`. ASCII
`write` raw files carry a non-deterministic `Date` and rename device currents
(`i(@r1[i])`); they are not the product result. `set savecurrents` in `.control` is too
late; `.options savecurrents` is server-owned. ngspice may exit 0 after a `print` error,
so the worker fails closed on a missing planned vector and on `Error:` in the log.

Planned observables, in source order then sorted by `nativeName` for JSON:

- node voltages `v(name)` except ground `0`, unit `V`
- `V` source currents `i(name)`, unit `A`
- `I` source currents `@name[current]`, unit `A`
- `R`/`C`/`L` currents `@name[i]`, unit `A`

Named runtime proof: MCS-02 admitted an attachment-rooted motor-phase circuit, observed
`@rphase[i] = 1.92 A`, evaluated the exact reviewed current interval and reached L5 at
Thread r20. See
[MCS-02 electrical](../../../project-dossiers/motorized-camera-slider-mcs02/domains/electrical.md).
This remains the circuit-only operating-point surface; it is not stepper-drive,
transient, thermal, EMC or safety coverage.
- diode `@name[id]`; BJT `@name[ib|ic|ie]`; MOSFET `@name[id|ig|is|ib]`, unit `A`

Sign convention is ngspice-native and is not inverted: a 5 V source into a 1 kΩ / 1 kΩ
divider yields `v(out)=2.5`, `i(vin)=-0.0025` (positive into the source positive
terminal), `@r1[i]=0.0025` (positive from the first named node to the second). The
worker does not compute power or thresholds.

Schemas: `spice-operating-point-result/1.0` and `spice-isolated-evidence/1.0`. Evidence
names engine `ngspice`, wrapper `spice-circuit-closed-subset-v1-operating-point@1.0.0`,
source/result fingerprints, counts/limits, and the fixed intrinsic limitation list
(`documentary-operating-point-only`, `not-a-requirement-verdict`, `not-l4`,
`not-safety-claim`). It never claims L4, pass, or safety. Product run:
`project_admitted_spice_run_review` → `simulate.run-admitted-spice@1`. The server-owned
IsolatedCodeRunner executes the Microsandbox-manifest pin `ENTRYPOINT` with no extra
args. Without `--local-execution` the operation stays registered and the executor is
`unavailable`. That composition state is not a worker `evidence.json` limitation. There
is no worker-gate `wiringGap`.

Node `variable` symbols, component names, and `.model` cards stay
`spice-ast-identity/1.0`. A successful `simulate.run-admitted-spice@1` publishes native
ngspice names (`v(name)`, `i(name)`, `@name[…]`) as documentary L3 observations. The
worker does not invert signs, compute power, or emit L4. Derived current/power and L4
belong to `verify.evaluate-admitted-spice-observations@1` after a sealed method sheet.
Safety stays `unavailable`.
