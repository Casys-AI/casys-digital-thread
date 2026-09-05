import { assertEquals, assertRejects } from "@std/assert";
import type {
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
} from "../../../ports/out/mechanics/prescribed-kinematics-observer.ts";
import {
  PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
  readCompletePrescribedKinematicsReceipt,
} from "./prescribed-kinematics-receipt-readback.ts";

Deno.test("complete prescribed-kinematics receipt readback walks every page and refuses gaps", async () => {
  const offsets: number[] = [];
  const observer: Pick<PrescribedKinematicsObserver, "readReceipt"> = {
    readReceipt: (_receiptSha256, request) => {
      offsets.push(request?.sampleOffset ?? -1);
      return Promise.resolve(page(request?.sampleOffset ?? 0, 65));
    },
  };
  const complete = await readCompletePrescribedKinematicsReceipt(
    observer,
    "c".repeat(64),
  );
  assertEquals(offsets, [0, 64]);
  assertEquals(complete.samplePage.hasMore, false);
  assertEquals(complete.samplePage.returned, 65);
  assertEquals(complete.samplePage.samples.length, 65);
  assertEquals(
    complete.samplePage.sampleLimit,
    PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
  );

  await assertRejects(
    () =>
      readCompletePrescribedKinematicsReceipt({
        readReceipt: () => Promise.resolve(page(0, 65, { returned: 0, samples: [] })),
      }, "c".repeat(64)),
    TypeError,
    "incomplete, overlapping, or has invalid bounds",
  );
});

Deno.test("complete prescribed-kinematics receipt readback refuses metadata drift, duplicates, reverse order and overlap", async () => {
  await assertRejects(
    () =>
      readCompletePrescribedKinematicsReceipt({
        readReceipt: (_sha, request) => {
          const current = page(request?.sampleOffset ?? 0, 65);
          if ((request?.sampleOffset ?? 0) === 0) return Promise.resolve(current);
          return Promise.resolve({
            ...current,
            request: { ...current.request, requestId: "other-request" },
          });
        },
      }, "c".repeat(64)),
    TypeError,
    "changed identity or total",
  );

  const duplicateBase = page(0, 3);
  const duplicate = {
    ...duplicateBase,
    samplePage: {
      ...duplicateBase.samplePage,
      samples: [
        duplicateBase.samplePage.samples[0]!,
        {
          ...duplicateBase.samplePage.samples[1]!,
          timeSeconds: duplicateBase.samplePage.samples[0]!.timeSeconds,
        },
        duplicateBase.samplePage.samples[2]!,
      ],
    },
  };
  await assertRejects(
    () =>
      readCompletePrescribedKinematicsReceipt({
        readReceipt: () => Promise.resolve(duplicate),
      }, "c".repeat(64)),
    TypeError,
    "duplicate or unordered",
  );

  const reversedBase = page(0, 3);
  const reversed = {
    ...reversedBase,
    samplePage: {
      ...reversedBase.samplePage,
      samples: [
        reversedBase.samplePage.samples[2]!,
        reversedBase.samplePage.samples[1]!,
        reversedBase.samplePage.samples[0]!,
      ],
    },
  };
  await assertRejects(
    () =>
      readCompletePrescribedKinematicsReceipt({
        readReceipt: () => Promise.resolve(reversed),
      }, "c".repeat(64)),
    TypeError,
    "duplicate or unordered",
  );

  await assertRejects(
    () =>
      readCompletePrescribedKinematicsReceipt({
        readReceipt: (_sha, request) =>
          Promise.resolve(page(request?.sampleOffset === 64 ? 63 : 0, 65)),
      }, "c".repeat(64)),
    TypeError,
    "incomplete, overlapping, or has invalid bounds",
  );
});

function page(
  offset: number,
  total: number,
  fault?: {
    readonly returned: number;
    readonly samples: PrescribedKinematicsObservationRecord["samplePage"]["samples"];
  },
): PrescribedKinematicsObservationRecord {
  const returned = fault?.returned ??
    Math.min(PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT, total - offset);
  const samples = fault?.samples ?? Array.from({ length: returned }, (_, index) => ({
    timeSeconds: offset + index,
    bodies: [{
      bodyId: "base",
      positionMetres: [0, 0, 0] as const,
      rotationWxyz: [1, 0, 0, 0] as const,
    }],
    joints: [{
      jointId: "hinge",
      motorAngleRadians: 0,
      declaredLimitObservation: "within" as const,
      translationResidualMetres: [0, 0, 0] as const,
      rotationQuaternionImagResidual: [0, 0, 0] as const,
    }],
  }));
  return {
    request: {
      requestId: "chrono-runtime-qualification-request-v1",
      caseSha256: "a".repeat(64),
      caseUri: `chrono-case:sha256:${"a".repeat(64)}`,
    },
    recordedAt: "2026-08-29T00:00:00.000Z",
    receipt: {
      receiptSha256: "c".repeat(64),
      caseSha256: "a".repeat(64),
      outcomeSha256: "d".repeat(64),
      requestId: "chrono-runtime-qualification-request-v1",
      recordedAt: "2026-08-29T00:00:00.000Z",
      engine: { name: "Project Chrono", version: "10.0.0" },
      runtime: {
        binding: "pychrono",
        pythonVersion: "3.12.0",
        serverDenoVersion: "2.0.0",
      },
      workerSourceSha256: "e".repeat(64),
      executionState: "completed",
      kinematicsExit: { rawCode: 1, rawName: "SUCCESS" },
    },
    notEvaluated: [
      "collision",
      "clearance",
      "contact",
      "forces",
      "torques",
      "dynamics",
      "strength",
      "safety",
      "product fitness",
    ],
    sampleCount: total,
    sampleTimeRangeSeconds: { first: 0, last: total - 1 },
    samplePage: {
      sampleOffset: offset,
      sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
      total,
      returned: samples.length,
      hasMore: offset + samples.length < total,
      samples,
    },
  };
}
