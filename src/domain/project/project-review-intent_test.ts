import { assertEquals, assertThrows } from "@std/assert";
import {
  isApprovalBoundProjectReviewIntent,
  validateLegacyProjectReviewIntent,
  validateProjectReviewIntent,
  validateProjectReviewIntentAcknowledgement,
} from "./project-review-intent.ts";

const BASE = {
  intentId: "review-intent-1",
  projectId: "desk-lamp-dl01",
  expectedRevision: 41,
  decisionId: "decision:geometry-v2",
  approvalId: "approval:decision:geometry-v2:proposal-2",
  inputFingerprint: { algorithm: "sha256", digest: "a".repeat(64) },
  action: "validate",
  submittedAt: "2026-08-09T10:45:00.000Z",
} as const;

Deno.test("ProjectReviewIntent preserves an exact optional reviewer comment without granting decision authority", () => {
  const comment = "  Validé avec la réserve mécanique indiquée.  ";
  const intent = validateProjectReviewIntent({ ...BASE, comment });

  assertEquals(intent.comment, comment);
  assertEquals(intent.action, "validate");
  assertEquals(Object.isFrozen(intent), true);
  assertEquals(Object.isFrozen(intent.inputFingerprint), true);
});

Deno.test("ProjectReviewIntent requires a bounded non-blank comment for a revision request", () => {
  assertThrows(
    () => validateProjectReviewIntent({ ...BASE, action: "request-revision" }),
    TypeError,
    "comment is required",
  );
  assertThrows(
    () =>
      validateProjectReviewIntent({
        ...BASE,
        action: "request-revision",
        comment: " \n ",
      }),
    TypeError,
    "must be non-blank",
  );
  assertThrows(
    () =>
      validateProjectReviewIntent({
        ...BASE,
        action: "request-revision",
        comment: "x".repeat(2_001),
      }),
    TypeError,
    "must not exceed 2000",
  );
});

Deno.test("ProjectReviewIntent rejects unknown fields and malformed fingerprints", () => {
  assertThrows(
    () => validateProjectReviewIntent({ ...BASE, authority: "approve" }),
    TypeError,
    "unsupported field authority",
  );
  assertThrows(
    () =>
      validateProjectReviewIntent({
        ...BASE,
        inputFingerprint: { algorithm: "sha256", digest: "g".repeat(64) },
      }),
    TypeError,
    "64 lowercase hexadecimal",
  );
  assertThrows(
    () =>
      validateProjectReviewIntent({
        ...BASE,
        inputFingerprint: { algorithm: "sha256", digest: "A".repeat(64) },
      }),
    TypeError,
    "64 lowercase hexadecimal",
  );
});

Deno.test("ProjectReviewIntent requires an exact approval attempt while legacy decoding remains explicit", () => {
  const { approvalId: _approvalId, ...legacyPayload } = BASE;
  assertThrows(
    () => validateProjectReviewIntent(legacyPayload),
    TypeError,
    "approvalId is required",
  );

  const legacy = validateLegacyProjectReviewIntent(legacyPayload);
  assertEquals(isApprovalBoundProjectReviewIntent(legacy), false);
  assertEquals(Object.hasOwn(legacy, "approvalId"), false);
  assertThrows(
    () => validateLegacyProjectReviewIntent(BASE),
    TypeError,
    "unsupported field approvalId",
  );
  assertEquals(
    validateLegacyProjectReviewIntent({
      ...legacyPayload,
      inputFingerprint: { algorithm: "sha256", digest: "A".repeat(64) },
    }).inputFingerprint.digest,
    "A".repeat(64),
  );
});

Deno.test("ProjectReviewIntent acknowledgement remains a receipt rather than an approval", () => {
  const acknowledgement = validateProjectReviewIntentAcknowledgement({
    intentId: BASE.intentId,
    projectId: BASE.projectId,
    acknowledgedAt: "2026-08-09T10:46:00.000Z",
    acknowledgedBy: "agent:paired-reviewer",
  });

  assertEquals(acknowledgement, {
    intentId: BASE.intentId,
    projectId: BASE.projectId,
    acknowledgedAt: "2026-08-09T10:46:00.000Z",
    acknowledgedBy: "agent:paired-reviewer",
  });
});
