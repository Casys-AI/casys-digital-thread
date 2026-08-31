import { assertEquals } from "@std/assert";
import {
  DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION,
  DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION,
  encodeSpiceAdmittedObservationEvaluationCloseoutAdmission,
  parseAcceptAdmittedSpiceEvaluationParameters,
  parseRejectAdmittedSpiceEvaluationParameters,
} from "./admitted-observation-evaluation-closeout-proposal.ts";

const DIGEST = "b".repeat(64);

function admission(consequence: "accept" | "reject") {
  return {
    schemaVersion: "spice-admitted-observation-evaluation-closeout/1.0",
    consequence,
    projectId: "project.electrical-method",
    subjectId: "subject.electrical-method",
    basis: {
      snapshotId: "placeholder-thread-snapshot",
      revision: 2,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    sheet: {
      id: "placeholder-electrical-observation-method-sheet",
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
    capture: {
      id: `spice-admitted-observation-evaluation-${DIGEST}`,
      fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
    },
  };
}

Deno.test("SPICE L5 accept and reject name the same identities and differ only in consequence", () => {
  const accept = encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
    admission("accept"),
  );
  const reject = encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
    admission("reject"),
  );
  assertEquals(
    `${DECIDE_ACCEPT_ADMITTED_SPICE_EVALUATION_OPERATION.id}@1`,
    "decide.accept-admitted-spice-evaluation@1",
  );
  assertEquals(
    `${DECIDE_REJECT_ADMITTED_SPICE_EVALUATION_OPERATION.id}@1`,
    "decide.reject-admitted-spice-evaluation@1",
  );
  const parsedAccept = parseAcceptAdmittedSpiceEvaluationParameters(accept);
  const parsedReject = parseRejectAdmittedSpiceEvaluationParameters(reject);
  assertEquals(parsedAccept.capture.id, parsedReject.capture.id);
  assertEquals(parsedAccept.sheet.id, parsedReject.sheet.id);
  assertEquals(parsedAccept.consequence, "accept");
  assertEquals(parsedReject.consequence, "reject");
});

Deno.test("SPICE L5 accept grammar refuses a reject consequence", () => {
  const parameters = encodeSpiceAdmittedObservationEvaluationCloseoutAdmission(
    admission("reject"),
  );
  const error = throws(() => parseAcceptAdmittedSpiceEvaluationParameters(parameters));
  assertEquals(error.message.includes("accept"), true);
});

function throws(run: () => unknown): TypeError {
  try {
    run();
  } catch (error) {
    if (error instanceof TypeError) return error;
    throw error;
  }
  throw new Error("expected TypeError");
}
