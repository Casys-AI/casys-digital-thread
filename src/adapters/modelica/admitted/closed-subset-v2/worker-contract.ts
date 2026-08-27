/** Code-owned guest/runtime contract for admitted Modelica closed-subset v2. */

export const MODELICA_ADMITTED_MICROSANDBOX_WORKER_CONTRACT = Object.freeze({
  executable: "/usr/local/bin/deno",
  args: Object.freeze([
    "run",
    "--cached-only",
    "--no-config",
    "--no-prompt",
    "--allow-read=/input,/out,/work,/opt/casys/src",
    "--allow-write=/out,/work",
    "--allow-run=omc,perl",
    "--allow-env=HOME,LANG,LC_ALL,OPENMODELICALIBRARY,PATH,TMPDIR",
    "/opt/casys/src/adapters/modelica/admitted/closed-subset-v2/run.ts",
    "/input/source.mo",
    "/out",
    "/work",
  ]),
  expectedImageUser: "65532:65532",
  sourcePath: "/input/source.mo",
  outputDirectory: "/out",
  workDirectory: "/work",
  controlFiles: Object.freeze({
    directory: "/work/.casys",
    quiescencePath: "/work/.casys/quiesced.json",
    quiescenceText:
      '{"schemaVersion":"casys-modelica-worker-quiescence/1.0","status":"all-awaited-commands-completed"}\n',
    stdoutPath: "/work/.casys/stdout.bin",
    stderrPath: "/work/.casys/stderr.bin",
  }),
  cpus: 2,
  rootDiskMiB: 2_048,
  maxDurationMs: 120_000,
  maxOpenFiles: 256,
});
