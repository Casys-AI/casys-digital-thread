import { assertEquals } from "@std/assert";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { readRecrossedRequirementsCaptureScopes } from "./requirements-definition-scope-reader.ts";

const USAGE = "122501cd-54d6-4aa9-b6a6-50b361ee2168";
const BACKREST = "20e71742-390d-4c6d-a91c-120debab5aa8";
const DIGEST = "44c478" + "ab".repeat(29);
const ARTIFACT = `requirements-StandBackrest-${DIGEST}`;
const ARCH_DIGEST = "1".repeat(64);
const ARCHITECTURE = `architecture-${ARCH_DIGEST}`;

Deno.test(
  "requirements definition scopes recross a SysON-produced tip by capture target, not producedBy",
  async () => {
    const scopes = await readRecrossedRequirementsCaptureScopes(
      thread(),
      { read: () => Promise.resolve(deterministicJson(capture())) },
      {
        artifactId: ARCHITECTURE,
        fingerprint: `sha256:${ARCH_DIGEST}`,
      },
    );
    assertEquals(scopes, [{
      artifactId: ARTIFACT,
      requirementUsageId: USAGE,
      targetElementId: BACKREST,
    }]);
  },
);

Deno.test(
  "requirements definition scopes refuse a different architecture basis and a predecessor tip",
  async () => {
    const stale = await readRecrossedRequirementsCaptureScopes(
      thread(),
      { read: () => Promise.resolve(deterministicJson(capture())) },
      {
        artifactId: ARCHITECTURE,
        fingerprint: `sha256:${"9".repeat(64)}`,
      },
    );
    assertEquals(stale, []);

    const predecessorDigest = "e".repeat(64);
    const predecessor = artifact(
      `requirements-StandBackrest-${predecessorDigest}`,
      predecessorDigest,
    );
    const snapshot = thread([
      predecessor,
      {
        ...artifact(ARTIFACT, DIGEST),
        inputArtifactIds: [predecessor.id],
      },
    ]);
    const old = {
      ...capture(),
      target: { ...capture().target, elementId: "part-definition:decoy" },
    };
    const current = await readRecrossedRequirementsCaptureScopes(
      snapshot,
      {
        read: (fingerprint) =>
          Promise.resolve(
            fingerprint.digest === predecessorDigest
              ? deterministicJson(old)
              : deterministicJson(capture()),
          ),
      },
      {
        artifactId: ARCHITECTURE,
        fingerprint: `sha256:${ARCH_DIGEST}`,
      },
    );
    assertEquals(current.map((item) => item.targetElementId), [BACKREST]);
  },
);

function capture() {
  return {
    schemaVersion: "requirements-capture/3.0",
    operation: { id: "model.write-requirements", version: "1" },
    trustedRunId: "run:requirements",
    containerComponent: "StandBackrest",
    partDefName: "StandBackrestRequirements",
    target: {
      kind: "part-definition",
      label: "StandBackrest",
      elementId: BACKREST,
    },
    architectureBasis: {
      snapshotId: "thread:tps03:r15",
      revision: 15,
      fingerprint: ARCH_DIGEST,
    },
    requirements: [{
      id: "maxDisplacement",
      name: "Maximum displacement",
      metric: "maxDisplacement",
      operator: "<=",
      limit: { value: 2, unit: "mm" },
    }, {
      id: "maxVonMises",
      name: "Maximum von Mises",
      metric: "maxVonMises",
      operator: "<=",
      limit: { value: 80, unit: "Pa" },
    }],
    seed: {
      artifactId: "artifact:seed",
      fingerprint: { algorithm: "sha256", digest: "b".repeat(64) },
      producerRunId: "run:seed",
    },
    architecture: {
      artifactId: ARCHITECTURE,
      fingerprint: { algorithm: "sha256", digest: ARCH_DIGEST },
      producerRunId: "run:architecture",
    },
    requirementsElementId: USAGE,
    requirementUsage: {
      id: USAGE,
      kind: "RequirementUsage",
    },
    constraintUsages: [{
      requirementId: "maxDisplacement",
      id: "constraint-usage:maxDisplacement",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:maxDisplacement",
    }, {
      requirementId: "maxVonMises",
      id: "constraint-usage:maxVonMises",
      kind: "ConstraintUsage",
      sourceId: "constraint-usage:maxVonMises",
    }],
    insertedAt: "2026-08-26T00:00:00.000Z",
  };
}

function thread(
  artifacts: readonly ThreadArtifact[] = [artifact(ARTIFACT, DIGEST)],
): ThreadSnapshot {
  return {
    artifacts,
    changeSet: { changes: [] },
  } as unknown as ThreadSnapshot;
}

function artifact(id: string, digest: string): ThreadArtifact {
  return {
    id,
    name: "Requirements: StandBackrest",
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://requirements-capture/StandBackrest/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "syson",
      tool: "syson_element_insert_sysml",
      runId: "run:requirements",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-26T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}
