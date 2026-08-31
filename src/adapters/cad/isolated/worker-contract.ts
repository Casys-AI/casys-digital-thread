/** Code-owned guest/runtime contract shared by isolated execution and cache. */

export const BUILD123D_ISOLATED_WORKER_UNIT_ID =
  "casys.build123d-isolated-worker" as const;
export const BUILD123D_ISOLATED_WORKER_MATERIAL_ID =
  "build123d-isolated-worker-image" as const;

export const BUILD123D_MICROSANDBOX_WORKER_CONTRACT = Object.freeze({
  executable: "/usr/local/bin/python3",
  args: Object.freeze([
    "-I",
    "-B",
    "/opt/casys/bin/run-build123d.py",
  ]),
  expectedImageUser: "0:0",
  sourcePath: "/input/source.py",
  outputDirectory: "/out",
  workDirectory: "/work",
  controlFiles: Object.freeze({
    quiescencePath: "/run/casys/quiesced.json",
    quiescenceText:
      '{"schemaVersion":"casys-build123d-worker-quiescence/1.0","status":"descendants-killed-and-reaped"}\n',
    stdoutPath: "/run/casys/stdout.bin",
    stderrPath: "/run/casys/stderr.bin",
  }),
  cpus: 1,
  rootDiskMiB: 1_024,
  maxDurationMs: 120_000,
  maxOpenFiles: 128,
});
