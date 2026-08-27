import { assertEquals, assertLessOrEqual } from "@std/assert";
import { NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT } from "./worker-contract.ts";

const MEBIBYTE = 1_048_576;

Deno.test("ngspice worker tmpfs root disk does not exceed requested memory", () => {
  const worker = NGSPICE_ADMITTED_MICROSANDBOX_WORKER_CONTRACT;
  const requestedMemoryMiB = worker.requestedLimits.maxMemoryBytes / MEBIBYTE;
  assertEquals(Number.isInteger(requestedMemoryMiB), true);
  assertEquals(requestedMemoryMiB, 512);
  assertEquals(worker.rootDiskMiB, 512);
  assertLessOrEqual(worker.rootDiskMiB, requestedMemoryMiB);
});
