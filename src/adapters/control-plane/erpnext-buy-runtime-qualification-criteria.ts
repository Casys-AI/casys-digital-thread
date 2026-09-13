/** Closed factual criteria for the ERP Buy host qualification fixture. */

import { ERPNEXT_BUY_CAPTURE_TOOL } from "../../domain/buy/buy-operations.ts";
import {
  BUY_SOURCE_CAPTURE_SCHEMA,
  BUY_SOURCE_INSTANCE_KIND,
  type BuySourceCaptureEnvelope,
  validateBuySourceCaptureEnvelope,
} from "../../domain/buy/buy-source-capture.ts";
import { deepFreeze } from "../../domain/kernel/case-validation.ts";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { LocalErpnextBuyInstallationProfile } from "./local-erpnext-buy-installation-profile.ts";
import type { ErpnextBuyRuntimeQualificationCandidate } from "./first-party-erpnext-buy-runtime-qualification-candidates.ts";

export const ERPNEXT_BUY_QUALIFICATION_CRITERIA = deepFreeze({
  schemaVersion: "erpnext-buy-qualification-criteria/1.0",
  probeTool: ERPNEXT_BUY_CAPTURE_TOOL,
  requiredCaptureSchema: BUY_SOURCE_CAPTURE_SCHEMA,
  requiredSourceInstanceKind: BUY_SOURCE_INSTANCE_KIND,
  requiredConsistency: {
    kind: "repeated-read",
    reads: 2,
    consistent: true,
  },
  siteMustEqualInstalledSourceInstance: true,
  returnedDocumentsMustEqualFixtureIdentities: true,
  documentIdentityFields: ["doctype", "name"],
  expectedModifiedComparedToCaptureModifiedAsExactErpLiteral: true,
  evidenceBoundary:
    "Factual host runtime contract only; no purchase, Thread verdict, or spend approval.",
});

export function fingerprintErpnextBuyQualificationCriteria(): Promise<
  ContentFingerprint
> {
  return sha256Fingerprint(ERPNEXT_BUY_QUALIFICATION_CRITERIA);
}

export function assertErpnextBuyQualificationEvidence(input: {
  readonly candidate: ErpnextBuyRuntimeQualificationCandidate;
  readonly profile: LocalErpnextBuyInstallationProfile;
  readonly envelope: unknown;
}): BuySourceCaptureEnvelope {
  const envelope = validateBuySourceCaptureEnvelope(input.envelope);
  if (envelope.schemaVersion !== BUY_SOURCE_CAPTURE_SCHEMA) {
    throw new TypeError("ERP Buy qualification capture schema drifted.");
  }
  if (
    envelope.capture.sourceInstance.kind !== BUY_SOURCE_INSTANCE_KIND ||
    envelope.capture.sourceInstance.siteId !==
      input.profile.sourceInstance.siteId ||
    envelope.capture.sourceInstance.siteId !==
      input.candidate.installedSourceInstance.siteId
  ) {
    throw new TypeError(
      "ERP Buy qualification capture site does not match the installed source instance.",
    );
  }
  if (
    envelope.capture.consistency.kind !== "repeated-read" ||
    envelope.capture.consistency.reads !== 2 ||
    envelope.capture.consistency.consistent !== true
  ) {
    throw new TypeError(
      "ERP Buy qualification capture consistency is not a usable repeated-read.",
    );
  }
  assertFixtureDocumentsMatchCapture(
    input.candidate.fixture.documents,
    envelope.capture.documents,
  );
  return envelope;
}

function assertFixtureDocumentsMatchCapture(
  requested: ErpnextBuyRuntimeQualificationCandidate["fixture"]["documents"],
  returned: BuySourceCaptureEnvelope["capture"]["documents"],
): void {
  const requestedKeys = requested.map((document) =>
    documentIdentity(document.doctype, document.name)
  );
  const returnedKeys = returned.map((document) =>
    documentIdentity(document.doctype, document.name)
  );
  if (new Set(requestedKeys).size !== requestedKeys.length) {
    throw new TypeError(
      "ERP Buy qualification fixture documents contain duplicate identities.",
    );
  }
  if (new Set(returnedKeys).size !== returnedKeys.length) {
    throw new TypeError(
      "ERP Buy qualification capture documents contain duplicate identities.",
    );
  }
  if (requestedKeys.length !== returnedKeys.length) {
    throw new TypeError(
      "ERP Buy qualification capture documents do not equal the fixture identities.",
    );
  }
  const returnedByIdentity = new Map(
    returned.map((document) =>
      [documentIdentity(document.doctype, document.name), document] as const
    ),
  );
  for (const request of requested) {
    const captured = returnedByIdentity.get(
      documentIdentity(request.doctype, request.name),
    );
    if (!captured) {
      throw new TypeError(
        "ERP Buy qualification capture is missing a fixture document identity.",
      );
    }
    if (
      request.expectedModified !== undefined &&
      captured.modified !== request.expectedModified
    ) {
      throw new TypeError(
        "ERP Buy qualification expectedModified does not equal the captured ERP modified token.",
      );
    }
  }
}

function documentIdentity(doctype: string, name: string): string {
  return `${doctype}\u0000${name}`;
}
