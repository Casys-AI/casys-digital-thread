/**
 * Code-owned constants for the generic admitted SPICE operating-point worker.
 *
 * This is not mcp-spice, not a fixed circuit kit, and not product
 * IsolatedCodeRunner wiring. Product wiring availability is composition
 * or runtime state. Isolated evidence limitations stay intrinsic to a
 * completed operating-point execution.
 */

export const SPICE_OPERATING_POINT_RESULT_SCHEMA =
  "spice-operating-point-result/1.0" as const;
export const SPICE_ISOLATED_EVIDENCE_SCHEMA = "spice-isolated-evidence/1.0" as const;
export const SPICE_WORKER_QUIESCENCE_SCHEMA =
  "casys-ngspice-worker-quiescence/1.0" as const;

export const SPICE_CIRCUIT_CLOSED_SUBSET_EXECUTION_PROFILE = Object.freeze(
  {
    id: "spice-circuit-closed-subset-v1",
    version: "1.0.0",
  } as const,
);

export const SPICE_OPERATING_POINT_WRAPPER = Object.freeze(
  {
    id: "spice-circuit-closed-subset-v1-operating-point",
    version: "1.0.0",
  } as const,
);

export const SPICE_OPERATING_POINT_EXPORT = Object.freeze(
  {
    id: "spice-operating-point-print-vectors",
    version: "1.0.0",
  } as const,
);

export const SPICE_OPERATING_POINT_ANALYSIS_KIND = "operating-point" as const;
export const SPICE_OPERATING_POINT_ENGINE_NAME = "ngspice" as const;

export const SPICE_OPERATING_POINT_SIGN_CONVENTION = Object.freeze(
  {
    kind: "ngspice-native",
    voltageSourceBranchCurrent: "positive-into-positive-terminal",
    passiveCurrent: "positive-from-first-named-node-to-second",
  } as const,
);

export const SPICE_ADMITTED_RESULT_OUTPUT = Object.freeze(
  {
    role: "result",
    basename: "result.json",
    mediaType: "application/json",
    format: "spice-operating-point-result-v1",
  } as const,
);

export const SPICE_ADMITTED_EVIDENCE_OUTPUT = Object.freeze(
  {
    role: "evidence",
    basename: "evidence.json",
    mediaType: "application/json",
    format: "spice-isolated-evidence-v1",
  } as const,
);

export const SPICE_ADMITTED_OUTPUT_MANIFEST = Object.freeze([
  SPICE_ADMITTED_EVIDENCE_OUTPUT,
  SPICE_ADMITTED_RESULT_OUTPUT,
]);

export const SPICE_ISOLATED_EVIDENCE_LIMITATIONS = Object.freeze(
  [
    "documentary-operating-point-only",
    "not-a-requirement-verdict",
    "not-l4",
    "not-safety-claim",
  ] as const,
);

export const SPICE_ADMITTED_MAX_SOURCE_BYTES = 262_144;
export const SPICE_ADMITTED_MAX_OBSERVABLES = 2_048;
export const SPICE_ADMITTED_MAX_RESULT_BYTES = 262_144;
export const SPICE_ADMITTED_MAX_EVIDENCE_BYTES = 262_144;
export const SPICE_ADMITTED_MAX_VECTOR_BYTES = 262_144;
export const SPICE_ADMITTED_MAX_LOG_BYTES = 1_048_576;
export const SPICE_ADMITTED_MAX_DURATION_MS = 30_000;
export const SPICE_ADMITTED_MAX_CPU_TIME_MS = 25_000;
export const SPICE_ADMITTED_MAX_MEMORY_BYTES = 512 * 1_048_576;
export const SPICE_ADMITTED_MAX_PROCESSES = 16;
export const SPICE_ADMITTED_MAX_STDOUT_BYTES = 65_536;
export const SPICE_ADMITTED_MAX_STDERR_BYTES = 65_536;
export const SPICE_ADMITTED_MAX_OUTPUT_TOTAL_BYTES = 524_288;

export const SPICE_ADMITTED_REQUESTED_LIMITS = Object.freeze({
  maxWallTimeMs: SPICE_ADMITTED_MAX_DURATION_MS,
  maxCpuTimeMs: SPICE_ADMITTED_MAX_CPU_TIME_MS,
  maxMemoryBytes: SPICE_ADMITTED_MAX_MEMORY_BYTES,
  maxProcesses: SPICE_ADMITTED_MAX_PROCESSES,
  maxStdoutBytes: SPICE_ADMITTED_MAX_STDOUT_BYTES,
  maxStderrBytes: SPICE_ADMITTED_MAX_STDERR_BYTES,
  maxOutputFileBytes: SPICE_ADMITTED_MAX_RESULT_BYTES,
  maxOutputTotalBytes: SPICE_ADMITTED_MAX_OUTPUT_TOTAL_BYTES,
});

export const SPICE_OPERATING_POINT_CURRENT_PARAMS = Object.freeze(
  [
    "i",
    "id",
    "ib",
    "ic",
    "ie",
    "ig",
    "is",
    "current",
  ] as const,
);
