import { assertEquals, assertRejects } from "@std/assert";
import { FileIsolatedOutputCas } from "../shared/cas/file-isolated-output-cas.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import {
  assertNoCandidateQualificationRecord,
  assertNoCandidateQualificationSuccessor,
  buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON,
  FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA,
  parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  persistFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  proveCandidateQualificationPredecessorUnpublishedAndDestroyed,
  readCandidateQualificationPredecessorRunFence,
  readFirstPartyMicrosandboxImageCandidateQualificationSuccessor,
  requireSuccessorAttempt,
} from "./first-party-microsandbox-image-candidate-qualification-successor.ts";

const IMPORT_FINGERPRINT = `sha256:${"a".repeat(64)}`;
const PREDECESSOR_RUN_ID = "build123d-isolated-worker-candidate-qualification-pred";

function provenDestruction(runId: string, digest = "d".repeat(64)) {
  return {
    status: "proven" as const,
    runId,
    proofFingerprint: { algorithm: "sha256" as const, digest },
  };
}

Deno.test("successor authority is server-derived, ordinal-1 at producerGeneration 0, and promotion-false", async () => {
  const destruction = provenDestruction(PREDECESSOR_RUN_ID);
  const successor =
    await buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor({
      physicalImageId: "build123d-isolated-worker",
      importRecordFingerprint: IMPORT_FINGERPRINT,
      predecessorAttempts: [{
        id: "build123d-isolated-worker",
        runId: PREDECESSOR_RUN_ID,
        destruction,
      }],
    });
  assertEquals(
    successor.schemaVersion,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_SCHEMA,
  );
  assertEquals(successor.kind, "candidate-qualification-successor");
  assertEquals(
    successor.reason,
    FIRST_PARTY_MICROSANDBOX_IMAGE_CANDIDATE_QUALIFICATION_SUCCESSOR_REASON,
  );
  assertEquals(successor.eligibleForPromotion, false);
  assertEquals(successor.predecessor.ordinal, 0);
  assertEquals(successor.successor.ordinal, 1);
  assertEquals(successor.predecessor.attempts[0]!.runId, PREDECESSOR_RUN_ID);
  assertEquals(successor.predecessor.attempts[0]!.producerGeneration, 0);
  assertEquals(successor.predecessor.attempts[0]!.publication, "not-published");
  assertEquals(successor.predecessor.attempts[0]!.destruction, destruction);
  assertEquals(successor.successor.attempts[0]!.producerGeneration, 0);
  assertEquals(
    successor.successor.attempts[0]!.runId === PREDECESSOR_RUN_ID,
    false,
  );
  assertEquals(
    successor.successor.attempts[0]!.runId.startsWith(
      "build123d-isolated-worker-candidate-qualification-successor-",
    ),
    true,
  );
  const parsed = await parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
    JSON.parse(deterministicJson(successor)),
  );
  assertEquals(deterministicJson(parsed), deterministicJson(successor));
  assertEquals(
    requireSuccessorAttempt(successor, "build123d-isolated-worker").ordinal,
    1,
  );
  const swappedRun = JSON.parse(deterministicJson(successor)) as Record<
    string,
    unknown
  >;
  const predecessor = swappedRun.predecessor as Record<string, unknown>;
  const attempts = predecessor.attempts as Record<string, unknown>[];
  attempts[0] = {
    ...attempts[0],
    destruction: provenDestruction("foreign-run-id"),
  };
  predecessor.attempts = attempts;
  swappedRun.predecessor = predecessor;
  await assertRejects(
    () => parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(swappedRun),
    TypeError,
    "does not match the execution run",
  );
});

Deno.test("successor persist is append-only and refuses a second consume", async () => {
  const directory = await Deno.makeTempDir({
    prefix: "casys-candidate-qualification-successor-",
  });
  try {
    const successor =
      await buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor({
        physicalImageId: "ngspice-worker",
        importRecordFingerprint: IMPORT_FINGERPRINT,
        predecessorAttempts: [{
          id: "ngspice-worker",
          runId: "ngspice-worker-candidate-qualification-pred",
          destruction: provenDestruction(
            "ngspice-worker-candidate-qualification-pred",
          ),
        }],
      });
    await persistFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
      directory,
      successor,
    );
    const reread = await readFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
      directory,
    );
    assertEquals(deterministicJson(reread), deterministicJson(successor));
    await assertRejects(
      () =>
        persistFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
          directory,
          successor,
        ),
      Error,
      "already consumed this predecessor",
    );
    await assertRejects(
      () => assertNoCandidateQualificationSuccessor(directory),
      Error,
      "already consumed this predecessor",
    );
    const swapped = JSON.parse(deterministicJson(successor)) as Record<
      string,
      unknown
    >;
    swapped.eligibleForPromotion = true;
    await assertRejects(
      () => parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(swapped),
      TypeError,
      "eligibleForPromotion",
    );
    const claimedGeneration = JSON.parse(deterministicJson(successor)) as Record<
      string,
      unknown
    >;
    const successorBody = claimedGeneration.successor as Record<string, unknown>;
    const successorAttempts = successorBody.attempts as Record<string, unknown>[];
    successorAttempts[0] = {
      ...successorAttempts[0],
      producerGeneration: 1,
    };
    successorBody.attempts = successorAttempts;
    claimedGeneration.successor = successorBody;
    await assertRejects(
      () =>
        parseFirstPartyMicrosandboxImageCandidateQualificationSuccessor(
          claimedGeneration,
        ),
      TypeError,
      "producerGeneration",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("successor refuses a published predecessor and accepts not-published plus proven destroy", async () => {
  const directory = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "casys-candidate-successor-publication-" }),
  );
  try {
    const cas = new FileIsolatedOutputCas(`${directory}/outputs`);
    await cas.abortByRunId(PREDECESSOR_RUN_ID, 0);
    const fence = await readCandidateQualificationPredecessorRunFence(
      `${directory}/outputs`,
      PREDECESSOR_RUN_ID,
    );
    const destruction =
      await proveCandidateQualificationPredecessorUnpublishedAndDestroyed({
        publications: cas,
        recovery: {
          destroyByRunId: (runId) => Promise.resolve(provenDestruction(runId)),
          advanceProducerGeneration: () => Promise.reject(new Error("not used")),
        },
      }, PREDECESSOR_RUN_ID);
    assertEquals(destruction, provenDestruction(PREDECESSOR_RUN_ID));
    assertEquals(
      await Deno.readTextFile(
        `${directory}/outputs/run-fences/${
          (await Array.fromAsync(Deno.readDir(`${directory}/outputs/run-fences`)))[0]!
            .name
        }`,
      ),
      fence,
    );
    await assertRejects(
      () =>
        proveCandidateQualificationPredecessorUnpublishedAndDestroyed({
          publications: {
            resolvePublicationByRunId: (runId, producerGeneration) =>
              Promise.resolve({
                status: "outcome-unknown" as const,
                runId,
                producerGeneration,
              }),
            readReceipt: () => Promise.resolve(undefined),
            readPublishedObject: () => Promise.resolve(undefined),
          },
          recovery: {
            destroyByRunId: () => Promise.reject(new Error("must not destroy")),
            advanceProducerGeneration: () => Promise.reject(new Error("not used")),
          },
        }, PREDECESSOR_RUN_ID),
      Error,
      "publication outcome is unknown",
    );
    await assertNoCandidateQualificationRecord(directory);
    await Deno.writeTextFile(`${directory}/qualification.json`, "{}\n");
    await assertRejects(
      () => assertNoCandidateQualificationRecord(directory),
      Error,
      "already-successful",
    );
    await assertRejects(
      () =>
        readCandidateQualificationPredecessorRunFence(
          `${directory}/missing`,
          PREDECESSOR_RUN_ID,
        ),
      Error,
      "existing producerGeneration-0 predecessor",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("two-profile successor covers both predecessor run identities", async () => {
  const successor =
    await buildFirstPartyMicrosandboxImageCandidateQualificationSuccessor({
      physicalImageId: "modelica-microsandbox-worker",
      importRecordFingerprint: IMPORT_FINGERPRINT,
      predecessorAttempts: [
        {
          id: "openmodelica-qualified-kit",
          runId: "modelica-kit-pred",
          destruction: provenDestruction("modelica-kit-pred", "1".repeat(64)),
        },
        {
          id: "openmodelica-admitted-modelica",
          runId: "modelica-admitted-pred",
          destruction: provenDestruction("modelica-admitted-pred", "2".repeat(64)),
        },
      ],
    });
  assertEquals(successor.predecessor.attempts.map((attempt) => attempt.id), [
    "openmodelica-qualified-kit",
    "openmodelica-admitted-modelica",
  ]);
  assertEquals(successor.predecessor.attempts.map((attempt) => attempt.ordinal), [
    0,
    0,
  ]);
  assertEquals(
    successor.predecessor.attempts.map((attempt) => attempt.publication),
    ["not-published", "not-published"],
  );
  assertEquals(
    successor.predecessor.attempts.map((attempt) =>
      attempt.destruction.proofFingerprint.digest
    ),
    ["1".repeat(64), "2".repeat(64)],
  );
  assertEquals(
    successor.successor.attempts.map((attempt) => attempt.producerGeneration),
    [0, 0],
  );
  assertEquals(successor.successor.attempts.map((attempt) => attempt.ordinal), [
    1,
    1,
  ]);
  assertEquals(
    successor.successor.attempts[0]!.runId === "modelica-kit-pred",
    false,
  );
  assertEquals(
    successor.successor.attempts[1]!.runId === "modelica-admitted-pred",
    false,
  );
  assertEquals(
    successor.successor.attempts[0]!.runId ===
      successor.successor.attempts[1]!.runId,
    false,
  );
});
