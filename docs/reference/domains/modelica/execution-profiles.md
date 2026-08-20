# Reference: Modelica execution profiles

Audience: both · Diátaxis: reference · Kind: contract

Two local Modelica operations are registered. They use one image family but have
different source authority, profile identities, image pins and worker selection. They
are not substitutes.

|                    | Qualified kit                                                     | Admitted source                                                                                  |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Operation          | `simulate.run-qualified-modelica-kit@1`                           | `simulate.run-admitted-modelica@1`                                                               |
| Purpose            | Runtime and solver-conformance smoke                              | Execute exact project `.mo` bytes already sealed by compilation admission                        |
| Source authority   | Code-owned `linear-thermal-ramp-v1@0.1.0` source inside the image | Unique fresh `compile.seal-admission@1` artifact on the current Thread tip                       |
| Source values      | Fixed `20 degC`, `1 K/s`; expected result `22 degC`               | Defaults embedded in the admitted source, within [closed-subset limits](closed-subset-v1.md)     |
| Caller supplies    | No `.mo`, provider, runtime or solver selection                   | `projectId` to the read-only review; no `.mo`, admission identity, provider or runtime selection |
| Worker selection   | Image `ENTRYPOINT`                                                | Fixed backend args select `modelica-closed-subset-v1/run.ts` on `/input/source.mo`               |
| What success means | The pinned kit ran under the qualified local method               | The exact sealed project source ran under the admitted local method                              |

Both profiles own the same scenario shape: `linear-ramp-nominal`, `0..2 s`, 20
intervals, DASSL and one `temperature_final` observation. The admitted path varies only
the permitted model name and the two source defaults; it is not a general scenario
runner.

## Isolation and outputs

`--local-execution` (including `start:yolo`) must compose the concrete review and
executor. Without it the descriptors remain registered but dispatch is `unavailable`.
The server owns a digest-pinned image, fixed executable and arguments, deny-all network,
no image pull, output validator and limits. The current outer caps are 120 seconds wall
and CPU time, 3 GiB memory, 64 processes, 1 MiB each for stdout/stderr, 16 MiB per
output and 17 MiB total. These caps are distinct from the 30-second simulation request
timeout.

Each worker emits exactly:

- `evidence.json` — normalized method, engine, resolved parameters and metric;
- `result.csv` — the retained OpenModelica samples.

Publication adds a third Thread artifact, the execution capture, plus the one
`temperature_final` observation. The qualified-kit artifacts consume no project source
artifact. The admitted run explicitly consumes and derives from the exact compilation
admission. Neither path publishes a requirement, evaluation, violation or verdict;
success remains `documentary`.

## Replay boundary

A completed run reopens its durable claim, WAL, CAS outputs, capture and Thread
successor. It does not call OpenModelica again. For admitted execution, an uncertain
generation-0 outcome may authorize one generation-1 dispatch only after exact absence
and cleanup are proven; generation 2 does not exist. Pre-WAL development runs are not
adopted or preserved as current authority.

Historical `simulate.run-modelica-scenario@1` and `@2` provider operations are not
registered fallbacks. They are neither the qualified kit nor admitted source execution.

Operational and code references:

- [run admitted Modelica](../../../how-to/run/run-admitted-modelica.md)
- [shared admitted-source pattern](../../pipeline/admitted-source-isolated-execution.md)
- [qualified-kit contract](../../../../src/domain/modelica/qualified-kit/isolated-execution.ts)
- [admitted-run contract](../../../../src/domain/modelica/admitted/run-proposal.ts)
- [runtime composition and limits](../../../../server.ts)
