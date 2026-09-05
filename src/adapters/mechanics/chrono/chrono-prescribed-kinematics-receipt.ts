/** Strict parser for the normalized, fact-only mcp-chrono 0.3.2 L3 receipt. */

import type { PrescribedKinematicsReceipt } from "../../../application/ports/out/mechanics/prescribed-kinematics-observer.ts";
import { exactRecord, nonEmptyText } from "../../../domain/kernel/case-validation.ts";

const SHA256 = /^[a-f0-9]{64}$/;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VERSION = /^\d+\.\d+\.\d+$/;

export interface ChronoPrescribedKinematicsRequestReference {
  readonly requestId: string;
  readonly caseSha256: string;
}

export function parseChronoPrescribedKinematicsRequestReference(
  value: unknown,
  path = "$chronoPrescribedKinematicsRequestReference",
): ChronoPrescribedKinematicsRequestReference {
  const root = exactRecord(value, ["requestId", "caseSha256"], path);
  return Object.freeze({
    requestId: requestId(root.requestId, `${path}.requestId`),
    caseSha256: sha256(root.caseSha256, `${path}.caseSha256`),
  });
}

/**
 * This accepts only the repository-normalized receipt, never the provider wire
 * record. Immutable L3 CAS therefore cannot acquire a forged or partially
 * shaped provider identity after the HTTP client has normalized it.
 */
export function parseChronoPrescribedKinematicsReceipt(
  value: unknown,
  path = "$chronoPrescribedKinematicsReceipt",
): PrescribedKinematicsReceipt {
  const root = exactRecord(value, [
    "receiptSha256",
    "caseSha256",
    "outcomeSha256",
    "requestId",
    "recordedAt",
    "engine",
    "runtime",
    "workerSourceSha256",
    "executionState",
    "kinematicsExit",
  ], path);
  const engine = exactRecord(root.engine, ["name", "version"], `${path}.engine`);
  if (engine.name !== "Project Chrono" || engine.version !== "10.0.0") {
    throw new TypeError(
      `${path}.engine is not the qualified Project Chrono 10.0.0 identity.`,
    );
  }
  const runtime = exactRecord(
    root.runtime,
    ["binding", "pythonVersion", "serverDenoVersion"],
    `${path}.runtime`,
  );
  if (runtime.binding !== "pychrono") {
    throw new TypeError(`${path}.runtime.binding must be pychrono.`);
  }
  const exit = exactRecord(
    root.kinematicsExit,
    ["rawCode", "rawName"],
    `${path}.kinematicsExit`,
  );
  const rawCode = integer(exit.rawCode, `${path}.kinematicsExit.rawCode`);
  const rawName = nonEmptyText(exit.rawName, `${path}.kinematicsExit.rawName`);
  const names = new Map<number, string>([
    [0, "NOT_CONVERGED"],
    [1, "SUCCESS"],
    [2, "ABSTOL_RESIDUAL"],
    [3, "RELTOL_UPDATE"],
    [4, "ABSTOL_UPDATE"],
  ]);
  if (names.get(rawCode) !== rawName) {
    throw new TypeError(`${path}.kinematicsExit has an unsupported code/name pair.`);
  }
  const executionState = root.executionState === "completed"
    ? "completed"
    : root.executionState === "not-converged"
    ? "not-converged"
    : (() => {
      throw new TypeError(`${path}.executionState is unsupported.`);
    })();
  if ((executionState === "not-converged") !== (rawName === "NOT_CONVERGED")) {
    throw new TypeError(`${path}.executionState contradicts its raw Chrono exit.`);
  }
  return Object.freeze({
    receiptSha256: sha256(root.receiptSha256, `${path}.receiptSha256`),
    caseSha256: sha256(root.caseSha256, `${path}.caseSha256`),
    outcomeSha256: sha256(root.outcomeSha256, `${path}.outcomeSha256`),
    requestId: requestId(root.requestId, `${path}.requestId`),
    recordedAt: timestamp(root.recordedAt, `${path}.recordedAt`),
    engine: Object.freeze({ name: "Project Chrono", version: "10.0.0" }),
    runtime: Object.freeze({
      binding: "pychrono",
      pythonVersion: version(runtime.pythonVersion, `${path}.runtime.pythonVersion`),
      serverDenoVersion: version(
        runtime.serverDenoVersion,
        `${path}.runtime.serverDenoVersion`,
      ),
    }),
    workerSourceSha256: sha256(
      root.workerSourceSha256,
      `${path}.workerSourceSha256`,
    ),
    executionState,
    kinematicsExit: Object.freeze({ rawCode, rawName }),
  });
}

function sha256(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  if (!SHA256.test(parsed)) {
    throw new TypeError(`${path} must be a lower-case SHA-256.`);
  }
  return parsed;
}

function requestId(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  if (!REQUEST_ID.test(parsed)) {
    throw new TypeError(`${path} is not an mcp-chrono request ID.`);
  }
  return parsed;
}

function version(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  if (!VERSION.test(parsed)) {
    throw new TypeError(`${path} must be an exact three-segment version.`);
  }
  return parsed;
}

function timestamp(value: unknown, path: string): string {
  const parsed = nonEmptyText(value, path);
  let canonical: string;
  try {
    canonical = new Date(parsed).toISOString();
  } catch {
    throw new TypeError(`${path} must be an ISO timestamp.`);
  }
  if (canonical !== parsed) {
    throw new TypeError(`${path} must be an exact canonical ISO timestamp.`);
  }
  return parsed;
}

function integer(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new TypeError(`${path} must be a safe integer.`);
  }
  return value;
}
