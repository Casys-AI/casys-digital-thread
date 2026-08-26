import { assertEquals } from "@std/assert";
import { threadRequirementsByCaptureScope } from "./requirement-definition-scope.ts";
import { listRequirementsCaptureContainers } from "./requirements-tip.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
  TracedRequirement,
} from "./thread-snapshot.ts";

const USAGE = "122501cd-54d6-4aa9-b6a6-50b361ee2168";
const BACKREST = "20e71742-390d-4c6d-a91c-120debab5aa8";
const BASE = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const DIGEST = "44c478" + "ab".repeat(29);
const ARTIFACT = `requirements-StandBackrest-${DIGEST}`;
const DISPLACEMENT = `requirement-${DIGEST}-maxDisplacement`;
const STRESS = `requirement-${DIGEST}-maxVonMises`;

Deno.test(
  "TPS03-shaped current captures join both unresolved requirements by PartDefinition and RequirementUsage",
  () => {
    const snapshot = tps03Thread();
    const joined = threadRequirementsByCaptureScope(snapshot, [{
      artifactId: ARTIFACT,
      requirementUsageId: USAGE,
      targetElementId: BACKREST,
    }]);
    assertEquals(
      joined.map((item) => [
        item.requirementId,
        item.sourceElementId,
        item.artifactId,
        item.targetElementId,
        item.status,
      ]),
      [
        [DISPLACEMENT, USAGE, ARTIFACT, BACKREST, "unresolved"],
        [STRESS, USAGE, ARTIFACT, BACKREST, "unresolved"],
      ],
    );
  },
);

Deno.test(
  "requirement definition scope does not join a label homonym or a different RequirementUsage",
  () => {
    const snapshot = tps03Thread({
      extraRequirements: [
        requirement(
          "requirement-decoy-mass",
          "StandBackrest mass",
          "requirement-usage:decoy",
          "requirements-StandBackrest-decoy",
        ),
      ],
    });
    assertEquals(
      threadRequirementsByCaptureScope(snapshot, [{
        artifactId: "requirements-StandBackrest-decoy",
        requirementUsageId: "requirement-usage:decoy",
        targetElementId: BACKREST,
      }]).map((item) => item.requirementId),
      ["requirement-decoy-mass"],
    );
    assertEquals(
      threadRequirementsByCaptureScope(snapshot, [{
        artifactId: ARTIFACT,
        requirementUsageId: USAGE,
        targetElementId: BACKREST,
      }]).map((item) => item.requirementId),
      [DISPLACEMENT, STRESS],
    );
  },
);

Deno.test(
  "requirement definition scope keeps a recorded fail and never promotes error or a stale evaluation",
  () => {
    const snapshot = tps03Thread({
      evaluations: [
        evaluation(DISPLACEMENT, "fail", "fresh"),
        evaluation(STRESS, "error", "fresh"),
        {
          ...evaluation("requirement-other", "pass", "fresh"),
          id: "eval-stale",
          requirementId: STRESS,
          evaluatedAt: "2026-08-25T00:00:00.000Z",
          freshness: {
            status: "stale",
            changedAt: "2026-08-25T00:00:00.000Z",
            reason: "superseded",
            invalidatedByChangeIds: [],
          },
        },
      ],
    });
    const joined = threadRequirementsByCaptureScope(snapshot, [{
      artifactId: ARTIFACT,
      requirementUsageId: USAGE,
      targetElementId: BACKREST,
    }]);
    assertEquals(
      Object.fromEntries(joined.map((item) => [item.requirementId, item.status])),
      {
        [DISPLACEMENT]: "fail",
        [STRESS]: "unresolved",
      },
    );
  },
);

Deno.test(
  "requirement definition scope omits a retired requirement and a conflicting target",
  () => {
    const snapshot = tps03Thread({
      archivedRequirementId: STRESS,
    });
    const retired = threadRequirementsByCaptureScope(snapshot, [{
      artifactId: ARTIFACT,
      requirementUsageId: USAGE,
      targetElementId: BACKREST,
    }]);
    assertEquals(
      retired.map((item) => item.requirementId),
      [DISPLACEMENT],
    );
    assertEquals(
      threadRequirementsByCaptureScope(tps03Thread(), [{
        artifactId: ARTIFACT,
        requirementUsageId: USAGE,
        targetElementId: BACKREST,
      }, {
        artifactId: ARTIFACT,
        requirementUsageId: USAGE,
        targetElementId: BASE,
      }]),
      [],
    );
  },
);

Deno.test(
  "requirements capture containers come from the URI path, not a PartDefinition label",
  () => {
    assertEquals(
      listRequirementsCaptureContainers(tps03Thread()),
      ["StandBackrest"],
    );
  },
);

function tps03Thread(
  extras: {
    readonly extraRequirements?: readonly TracedRequirement[];
    readonly evaluations?: ThreadSnapshot["evaluations"];
    readonly archivedRequirementId?: string;
  } = {},
): ThreadSnapshot {
  return {
    artifacts: [artifact(ARTIFACT, "StandBackrest", DIGEST)],
    requirements: [
      requirement(DISPLACEMENT, "Maximum displacement", USAGE, ARTIFACT),
      requirement(STRESS, "Maximum von Mises", USAGE, ARTIFACT),
      ...(extras.extraRequirements ?? []),
    ],
    evaluations: extras.evaluations ?? [],
    changeSet: {
      changes: extras.archivedRequirementId
        ? [{
          id: "archive",
          kind: "archived",
          target: { kind: "requirement", id: extras.archivedRequirementId },
          summary: "retired",
        }]
        : [],
    },
  } as unknown as ThreadSnapshot;
}

function requirement(
  id: string,
  name: string,
  elementId: string,
  sourceArtifactId: string,
): TracedRequirement {
  return {
    id,
    name,
    statement: name,
    version: "1",
    criterion: {
      metric: id,
      operator: "<=",
      limit: { value: 1, unit: "mm" },
    },
    trace: {
      sourceArtifactId,
      elementId,
      targetArtifactIds: ["architecture-current"],
    },
    freshness: {
      status: "fresh",
      changedAt: "2026-08-26T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function artifact(
  id: string,
  container: string,
  digest: string,
): ThreadArtifact {
  return {
    id,
    name: `Requirements: ${container}`,
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://requirements-capture/${container}/sha256/${digest}`,
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

function evaluation(
  requirementId: string,
  status: "pass" | "fail" | "error",
  freshness: "fresh" | "stale",
) {
  return {
    id: `eval-${requirementId}`,
    name: requirementId,
    requirementId,
    observationIds: [],
    status,
    evaluatedAt: "2026-08-26T12:00:00.000Z",
    evaluator: {
      serverId: "digital-thread",
      tool: "evaluate",
      runId: "run:eval",
    },
    evidenceArtifactIds: [],
    message: status,
    freshness: {
      status: freshness,
      changedAt: "2026-08-26T12:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}
