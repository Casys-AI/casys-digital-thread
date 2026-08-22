/** Code-owned guest/runtime contract for the generic ngspice operating-point worker. */

import {
  SPICE_ADMITTED_MAX_DURATION_MS,
  SPICE_ADMITTED_REQUESTED_LIMITS,
  SPICE_WORKER_QUIESCENCE_SCHEMA,
} from "../../../../domain/electrical/spice/admitted/contract.ts";

export const NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT = Object.freeze({
  executable: "/usr/local/bin/deno",
  args: Object.freeze([
    "run",
    "--cached-only",
    "--no-config",
    "--no-prompt",
    "--allow-read=/input,/out,/work,/opt/casys/src",
    "--allow-write=/out,/work",
    "--allow-run=ngspice",
    "--allow-env=HOME,LANG,LC_ALL,PATH,TMPDIR",
    "/opt/casys/src/adapters/electrical/spice/admitted/run.ts",
  ]),
  expectedImageUser: "65532:65532",
  sourcePath: "/input/source.cir",
  outputDirectory: "/out",
  workDirectory: "/work",
  runNetlistPath: "/work/run.cir",
  vectorPath: "/work/op-vectors.txt",
  logPath: "/work/ngspice.log",
  controlFiles: Object.freeze({
    directory: "/work/.casys",
    quiescencePath: "/work/.casys/quiesced.json",
    quiescenceText:
      `{"schemaVersion":"${SPICE_WORKER_QUIESCENCE_SCHEMA}","status":"all-awaited-commands-completed"}\n`,
    stdoutPath: "/work/.casys/stdout.bin",
    stderrPath: "/work/.casys/stderr.bin",
  }),
  cpus: 1,
  // Microsandbox tmpfs root disk must not exceed requested memory (512 MiB).
  rootDiskMiB: 512,
  maxDurationMs: SPICE_ADMITTED_MAX_DURATION_MS,
  maxOpenFiles: 128,
  requestedLimits: SPICE_ADMITTED_REQUESTED_LIMITS,
});
