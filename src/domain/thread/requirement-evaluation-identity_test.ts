import { assertEquals, assertThrows } from "@std/assert";
import type { ContentFingerprint } from "../kernel/primitives.ts";
import { requirementEvaluationIdentity } from "./requirement-evaluation-identity.ts";

const REQUIREMENT_ID = "thread-requirement-displacement";
const FIRST: ContentFingerprint = { algorithm: "sha256", digest: "a".repeat(64) };
const SECOND: ContentFingerprint = { algorithm: "sha256", digest: "b".repeat(64) };

Deno.test(
  "RequirementEvaluation identity is stable for the same requirement and evidence fingerprint",
  () => {
    const first = requirementEvaluationIdentity({
      requirementId: REQUIREMENT_ID,
      evidenceFingerprint: FIRST,
    });
    const again = requirementEvaluationIdentity({
      requirementId: REQUIREMENT_ID,
      evidenceFingerprint: { ...FIRST },
    });
    assertEquals(first, again);
    assertEquals(first.requirementId, REQUIREMENT_ID);
    assertEquals(first.evidenceFingerprint, FIRST);
    assertEquals(first.id, `${REQUIREMENT_ID}-evaluation-${FIRST.digest}`);
  },
);

Deno.test(
  "RequirementEvaluation identity is distinct for a new evidence fingerprint",
  () => {
    const first = requirementEvaluationIdentity({
      requirementId: REQUIREMENT_ID,
      evidenceFingerprint: FIRST,
    });
    const second = requirementEvaluationIdentity({
      requirementId: REQUIREMENT_ID,
      evidenceFingerprint: SECOND,
    });
    assertEquals(first.id === second.id, false);
    assertEquals(second.id.endsWith(SECOND.digest), true);
    assertEquals(second.id.includes(FIRST.digest), false);
  },
);

Deno.test("RequirementEvaluation identity refuses an invalid evidence fingerprint", () => {
  assertThrows(
    () =>
      requirementEvaluationIdentity({
        requirementId: REQUIREMENT_ID,
        evidenceFingerprint: { algorithm: "sha256", digest: "a".repeat(32) },
      }),
    TypeError,
    "sha256 64-lowercase-hex",
  );
  assertThrows(
    () =>
      requirementEvaluationIdentity({
        requirementId: REQUIREMENT_ID,
        evidenceFingerprint: { algorithm: "sha256", digest: "A".repeat(64) },
      }),
    TypeError,
    "sha256 64-lowercase-hex",
  );
  assertThrows(
    () =>
      requirementEvaluationIdentity({
        requirementId: REQUIREMENT_ID,
        evidenceFingerprint: {
          algorithm: "sha1" as "sha256",
          digest: "a".repeat(64),
        },
      }),
    TypeError,
    "sha256 64-lowercase-hex",
  );
  assertThrows(
    () =>
      requirementEvaluationIdentity({
        requirementId: "  ",
        evidenceFingerprint: FIRST,
      }),
    TypeError,
    "non-empty string",
  );
});
