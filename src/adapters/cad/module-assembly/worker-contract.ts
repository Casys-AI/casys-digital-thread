/** Code-owned guest/runtime contract shared by the assembler worker and composition. */

export const GEOMETRY_MODULE_ASSEMBLER_MICROSANDBOX_WORKER_CONTRACT = Object
  .freeze({
    executable: "/usr/local/bin/python3",
    args: Object.freeze([
      "-I",
      "-B",
      "/opt/casys/bin/run-module-assembler.py",
      "/input/geometry-module.bundle",
      "/out",
    ]),
    expectedImageUser: "65532:65532",
    sourcePath: "/input/geometry-module.bundle",
    outputDirectory: "/out",
    workDirectory: "/work",
    childDirectory: "/work/children",
    childStepBasename: (index: number): string =>
      `${String(index).padStart(3, "0")}.step`,
    controlFiles: Object.freeze({
      directory: "/work/.casys",
      quiescencePath: "/work/.casys/quiesced.json",
      quiescenceText:
        '{"schemaVersion":"casys-geometry-module-assembler-quiescence/1.0","status":"bundle-decoded-compound-exported"}\n',
      stdoutPath: "/work/.casys/stdout.bin",
      stderrPath: "/work/.casys/stderr.bin",
    }),
    cpus: 1,
    rootDiskMiB: 1_024,
    maxDurationMs: 120_000,
    maxOpenFiles: 128,
  });
