/** Code-owned guest/runtime contract shared by the worker and composition. */

export const CALCULIX_MICROSANDBOX_WORKER_CONTRACT = Object.freeze({
  executable: "/usr/local/bin/deno",
  args: Object.freeze([
    "run",
    "--cached-only",
    "--no-config",
    "--no-prompt",
    "--allow-read=/input,/out,/work,/tmp",
    "--allow-write=/out,/work,/tmp",
    "--allow-run=gmsh,ccx",
    "--allow-env=HOME,LANG,LC_ALL,PATH,TMPDIR",
    "/opt/casys/profiles/calculix-static-proof-v1/run.ts",
    "/input/calculix-static.bundle",
    "/out",
  ]),
  expectedImageUser: "65532:65532",
  sourcePath: "/input/calculix-static.bundle",
  outputDirectory: "/out",
  workDirectory: "/work",
  controlFiles: Object.freeze({
    directory: "/work/.casys",
    quiescencePath: "/work/.casys/quiesced.json",
    quiescenceText:
      '{"schemaVersion":"casys-calculix-worker-quiescence/1.0","status":"all-awaited-gmsh-and-ccx-commands-completed"}\n',
    stdoutPath: "/work/.casys/stdout.bin",
    stderrPath: "/work/.casys/stderr.bin",
  }),
  cpus: 2,
  rootDiskMiB: 2_048,
  maxDurationMs: 180_000,
  maxOpenFiles: 256,
});
