/**
 * Complete paginated prescribed-kinematics receipt readback.
 *
 * L3 dispatch and the private Chrono runtime qualification probe share this
 * helper so a crash cannot treat a partial page as a factual receipt.
 */

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
  sha256Hex,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  PrescribedKinematicsObservationRecord,
  PrescribedKinematicsObserver,
} from "../../../ports/out/mechanics/prescribed-kinematics-observer.ts";
import type { PrescribedKinematicsLoweredCase } from "../../../ports/out/mechanics/prescribed-kinematics-case-lowerer.ts";

export const PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT = 64;

export const CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS = 5 * 60 * 1_000;

export const CHRONO_QUALIFICATION_PROTOCOL = Object.freeze({
  schemaVersion: "chrono-qualification-protocol/2.0",
  sampleOffset: 0,
  sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
  timeoutMs: null,
  // Local operator bound: the fixture is 1 s of kinematics plus one extra
  // receipt page. Five minutes covers host inspect/start jitter without a
  // poll counter. Rapid recoveries cannot advance this clock.
  dispatchDeadlineMs: CHRONO_QUALIFICATION_DISPATCH_DEADLINE_MS,
});

export function fingerprintChronoQualificationProtocol(): Promise<ContentFingerprint> {
  return sha256Fingerprint(CHRONO_QUALIFICATION_PROTOCOL);
}

export async function readCompletePrescribedKinematicsReceipt(
  observer: Pick<PrescribedKinematicsObserver, "readReceipt">,
  receiptSha256: string,
): Promise<PrescribedKinematicsObservationRecord> {
  const first = await observer.readReceipt(receiptSha256, {
    sampleOffset: 0,
    sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
  });
  const samples: Array<(typeof first.samplePage.samples)[number]> = [];
  const seenTimes = new Set<number>();
  assertReceiptPage(first, first, 0, samples, seenTimes);
  let current = first;
  while (current.samplePage.hasMore) {
    const nextOffset = samples.length;
    const next = await observer.readReceipt(receiptSha256, {
      sampleOffset: nextOffset,
      sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
    });
    assertSameReceiptEnvelope(first, next);
    assertReceiptPage(next, first, nextOffset, samples, seenTimes);
    current = next;
  }
  if (samples.length !== first.samplePage.total) {
    throw new TypeError(
      "The prescribed-kinematics receipt pages do not cover their declared total.",
    );
  }
  if (
    samples.length === 0 ||
    samples[0]!.timeSeconds !== first.sampleTimeRangeSeconds.first ||
    samples[samples.length - 1]!.timeSeconds !== first.sampleTimeRangeSeconds.last
  ) {
    throw new TypeError(
      "The prescribed-kinematics receipt sample times do not match the declared range.",
    );
  }
  return {
    ...first,
    samplePage: {
      sampleOffset: 0,
      sampleLimit: PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT,
      total: first.samplePage.total,
      returned: samples.length,
      hasMore: false,
      samples,
    },
  };
}

export function fingerprintPrescribedKinematicsCompleteReceipt(
  record: PrescribedKinematicsObservationRecord,
): Promise<ContentFingerprint> {
  if (record.samplePage.hasMore) {
    throw new TypeError(
      "A local prescribed-kinematics receipt fingerprint requires the complete page.",
    );
  }
  return sha256Fingerprint(record);
}

export function assertPrescribedKinematicsRecordBoundToIdentity(
  record: PrescribedKinematicsObservationRecord,
  identity: {
    readonly requestId: string;
    readonly caseSha256: string;
  },
): void {
  if (
    record.request.requestId !== identity.requestId ||
    record.request.caseSha256 !== identity.caseSha256 ||
    record.request.caseUri !== `chrono-case:sha256:${identity.caseSha256}` ||
    record.receipt.caseSha256 !== identity.caseSha256 ||
    record.receipt.requestId !== identity.requestId
  ) {
    throw new TypeError(
      "The prescribed-kinematics receipt does not bind the exact dispatched request identity.",
    );
  }
}

export async function assertPrescribedKinematicsLoweredCase(
  lowered: PrescribedKinematicsLoweredCase,
  sourceFingerprint: PrescribedKinematicsLoweredCase["sourceFingerprint"],
): Promise<void> {
  if (
    !fingerprintsEqual(lowered.sourceFingerprint, sourceFingerprint) ||
    lowered.requestFingerprint.algorithm !== "sha256" ||
    lowered.loweringFingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(lowered.requestFingerprint.digest) ||
    !/^[a-f0-9]{64}$/.test(lowered.loweringFingerprint.digest) ||
    typeof lowered.exactRequestText !== "string" ||
    lowered.exactRequestText.length === 0 ||
    lowered.exactRequestText.length > 524_288
  ) {
    throw new TypeError(
      "The server-owned prescribed-kinematics lowering is absent, unbound, or exceeds its fixed bound.",
    );
  }
  if (
    (await sha256Hex(new TextEncoder().encode(lowered.exactRequestText))) !==
      lowered.requestFingerprint.digest
  ) {
    throw new TypeError(
      "The server-owned prescribed-kinematics lowering request fingerprint does not bind its exact bytes.",
    );
  }
}

function assertSameReceiptEnvelope(
  expected: PrescribedKinematicsObservationRecord,
  observed: PrescribedKinematicsObservationRecord,
): void {
  const omitPage = (
    record: PrescribedKinematicsObservationRecord,
  ): unknown => {
    const { samplePage: _page, ...rest } = record;
    return rest;
  };
  if (deterministicJson(omitPage(expected)) !== deterministicJson(omitPage(observed))) {
    throw new TypeError(
      "A prescribed-kinematics receipt page changed identity or total during readback.",
    );
  }
}

function assertReceiptPage(
  pageRecord: PrescribedKinematicsObservationRecord,
  first: PrescribedKinematicsObservationRecord,
  expectedOffset: number,
  accumulated: Array<
    PrescribedKinematicsObservationRecord["samplePage"]["samples"][number]
  >,
  seenTimes: Set<number>,
): void {
  const page = pageRecord.samplePage;
  if (
    page.sampleOffset !== expectedOffset ||
    page.sampleLimit !== PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT ||
    page.returned !== page.samples.length || page.total !== first.samplePage.total ||
    page.total > 512 || page.total !== pageRecord.sampleCount ||
    page.returned !==
      Math.min(PRESCRIBED_KINEMATICS_RECEIPT_PAGE_LIMIT, page.total - expectedOffset) ||
    page.hasMore !== (expectedOffset + page.returned < page.total) ||
    accumulated.length !== expectedOffset
  ) {
    throw new TypeError(
      "The prescribed-kinematics receipt page is incomplete, overlapping, or has invalid bounds.",
    );
  }
  let previous = accumulated.length === 0
    ? Number.NEGATIVE_INFINITY
    : accumulated[accumulated.length - 1]!.timeSeconds;
  for (const sample of page.samples) {
    if (seenTimes.has(sample.timeSeconds) || sample.timeSeconds <= previous) {
      throw new TypeError(
        "The prescribed-kinematics receipt pages contain a duplicate or unordered sample time.",
      );
    }
    seenTimes.add(sample.timeSeconds);
    previous = sample.timeSeconds;
    accumulated.push(sample);
  }
}
