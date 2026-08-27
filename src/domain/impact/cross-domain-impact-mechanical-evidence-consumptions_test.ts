import { assertEquals } from "@std/assert";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadOperationRef,
} from "../thread/thread-snapshot.ts";
import { recrossExactMechanicalProducerConsumptions } from "./cross-domain-impact-mechanical-evidence-consumptions.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PRODUCER: ThreadOperationRef = {
  serverId: "digital-thread",
  tool: "verify.run-fea-static-proof@3",
  runId: "run-fea",
};
const EVIDENCE = {
  id: "mechanical-fea-evidence",
  fingerprint: fingerprint("a"),
};
const STEP = artifact("mechanical-step-input", fingerprint("b"));
const INSPECTED = [{
  id: "mechanical-consumption-step",
  input: { id: STEP.id, fingerprint: STEP.fingerprint },
}];

Deno.test(
  "exact mechanical producer consumption star recrosses the inspected set",
  () => {
    const recrossed = recrossExactMechanicalProducerConsumptions({
      producer: PRODUCER,
      evidence: EVIDENCE,
      inspected: INSPECTED,
      consumptions: [verifiedConsumption(INSPECTED[0]!.id, STEP, PRODUCER)],
      artifacts: [STEP],
      archived: new Set(),
    });
    assertEquals(recrossed, [{
      id: INSPECTED[0]!.id,
      consumerEvidence: EVIDENCE,
      input: { id: STEP.id, fingerprint: STEP.fingerprint },
    }]);
  },
);

Deno.test(
  "an extra actual verified consumption by the same producer fails closed",
  () => {
    const extra = artifact("mechanical-extra-input", fingerprint("c"));
    const recrossed = recrossExactMechanicalProducerConsumptions({
      producer: PRODUCER,
      evidence: EVIDENCE,
      inspected: INSPECTED,
      consumptions: [
        verifiedConsumption(INSPECTED[0]!.id, STEP, PRODUCER),
        verifiedConsumption("mechanical-consumption-extra", extra, PRODUCER),
      ],
      artifacts: [STEP, extra],
      archived: new Set(),
    });
    assertEquals(recrossed, undefined);
  },
);

Deno.test(
  "unverified, archived, stale, or foreign producer consumptions fail closed",
  () => {
    const unverified = recrossExactMechanicalProducerConsumptions({
      producer: PRODUCER,
      evidence: EVIDENCE,
      inspected: INSPECTED,
      consumptions: [{
        ...verifiedConsumption(INSPECTED[0]!.id, STEP, PRODUCER),
        status: "mismatch",
      }],
      artifacts: [STEP],
      archived: new Set(),
    });
    assertEquals(unverified, undefined);

    const archived = recrossExactMechanicalProducerConsumptions({
      producer: PRODUCER,
      evidence: EVIDENCE,
      inspected: INSPECTED,
      consumptions: [verifiedConsumption(INSPECTED[0]!.id, STEP, PRODUCER)],
      artifacts: [STEP],
      archived: new Set([`artifact:${STEP.id}`]),
    });
    assertEquals(archived, undefined);

    const stale = recrossExactMechanicalProducerConsumptions({
      producer: PRODUCER,
      evidence: EVIDENCE,
      inspected: INSPECTED,
      consumptions: [verifiedConsumption(INSPECTED[0]!.id, STEP, PRODUCER)],
      artifacts: [{
        ...STEP,
        freshness: { ...STEP.freshness, status: "stale", reason: "replaced" },
      }],
      archived: new Set(),
    });
    assertEquals(stale, undefined);

    const foreign = recrossExactMechanicalProducerConsumptions({
      producer: PRODUCER,
      evidence: EVIDENCE,
      inspected: INSPECTED,
      consumptions: [verifiedConsumption(INSPECTED[0]!.id, STEP, {
        ...PRODUCER,
        runId: "run-other",
      })],
      artifacts: [STEP],
      archived: new Set(),
    });
    assertEquals(foreign, undefined);
  },
);

function verifiedConsumption(
  id: string,
  input: ThreadArtifact,
  consumer: ThreadOperationRef,
): ThreadArtifactConsumption {
  return {
    id,
    artifactId: input.id,
    consumer,
    observedFingerprint: input.fingerprint,
    verifiedAt: AT,
    status: "verified",
  };
}

function artifact(
  id: string,
  fingerprintValue: ThreadArtifact["fingerprint"],
): ThreadArtifact {
  return {
    id,
    name: id,
    kind: "step",
    version: "1",
    fingerprint: fingerprintValue,
    producer: {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: "run-export",
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}

function fingerprint(character: string) {
  return { algorithm: "sha256" as const, digest: character.repeat(64) };
}
