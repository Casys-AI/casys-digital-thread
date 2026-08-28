import { assertEquals, assertThrows } from "@std/assert";
import {
  parseChronoPrescribedKinematicsReceipt,
  parseChronoPrescribedKinematicsRequestReference,
} from "./chrono-prescribed-kinematics-receipt.ts";

Deno.test("normalized Chrono L3 receipt admits only its exact qualified identity", () => {
  const receipt = validReceipt();
  assertEquals(parseChronoPrescribedKinematicsReceipt(receipt), receipt);
  for (
    const malformed of [
      { ...receipt, extra: true },
      { ...receipt, caseSha256: "A".repeat(64) },
      { ...receipt, requestId: "not a request id" },
      { ...receipt, requestId: "chrono:run-1" },
      { ...receipt, recordedAt: "2026-08-29T00:00:00Z" },
      { ...receipt, engine: { ...receipt.engine, version: "10.0.1" } },
      { ...receipt, runtime: { ...receipt.runtime, binding: "other" } },
      {
        ...receipt,
        executionState: "completed",
        kinematicsExit: { rawCode: 0, rawName: "NOT_CONVERGED" },
      },
      { ...receipt, kinematicsExit: { rawCode: 1, rawName: "NOT_CONVERGED" } },
    ]
  ) {
    assertThrows(() => parseChronoPrescribedKinematicsReceipt(malformed));
  }
});

Deno.test("normalized Chrono L3 request reference is a strict receipt binding", () => {
  const request = { requestId: "chrono-run-1", caseSha256: "b".repeat(64) };
  assertEquals(parseChronoPrescribedKinematicsRequestReference(request), request);
  for (
    const malformed of [
      { ...request, extra: true },
      { ...request, requestId: "not a request id" },
      { ...request, requestId: "chrono:run-1" },
      { ...request, caseSha256: "B".repeat(64) },
    ]
  ) {
    assertThrows(() => parseChronoPrescribedKinematicsRequestReference(malformed));
  }
});

function validReceipt() {
  return {
    receiptSha256: "a".repeat(64),
    caseSha256: "b".repeat(64),
    outcomeSha256: "c".repeat(64),
    requestId: "chrono-run-1",
    recordedAt: "2026-08-29T00:00:00.000Z",
    engine: { name: "Project Chrono", version: "10.0.0" },
    runtime: {
      binding: "pychrono",
      pythonVersion: "3.13.0",
      serverDenoVersion: "2.9.6",
    },
    workerSourceSha256: "d".repeat(64),
    executionState: "completed" as const,
    kinematicsExit: { rawCode: 1, rawName: "SUCCESS" },
  };
}
