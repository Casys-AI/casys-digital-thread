import { assertEquals } from "@std/assert";
import type { ThreadArtifact, ThreadSnapshot } from "./thread-snapshot.ts";
import {
  listRequirementsCaptureContainers,
  selectRequirementsTip,
} from "./requirements-tip.ts";

Deno.test("requirements tip selects one exact component lineage", () => {
  const armOld = requirementArtifact("req-arm-r1", "Arm", "a");
  const armTip = {
    ...requirementArtifact("req-arm-r2", "Arm", "b"),
    inputArtifactIds: [armOld.id],
  };
  const housing = requirementArtifact("req-housing-r1", "Housing", "c");
  const snapshot = thread([armOld, housing, armTip]);

  const selected = selectRequirementsTip(snapshot, "Arm");

  assertEquals(selected.kind, "one");
  if (selected.kind === "one") assertEquals(selected.artifact.id, armTip.id);
  assertEquals(selectRequirementsTip(snapshot, "Bracket").kind, "absent");
});

Deno.test("requirements capture containers ignore a bare sha256 URI segment", () => {
  const snapshot = thread([
    requirementArtifact("req-arm-r1", "Arm", "a"),
    {
      ...requirementArtifact("req-bad", "sha256", "d"),
      uri: "casys://requirements-capture/sha256/" + "d".repeat(64),
    },
  ]);
  assertEquals(listRequirementsCaptureContainers(snapshot), ["Arm"]);
});

Deno.test("requirements tip reports an archived exact component as retired", () => {
  const arm = requirementArtifact("req-arm-r1", "Arm", "a");
  const housing = requirementArtifact("req-housing-r1", "Housing", "b");
  const snapshot = thread([arm, housing], arm.id);

  assertEquals(selectRequirementsTip(snapshot, "Arm").kind, "retired");
  assertEquals(selectRequirementsTip(snapshot, "Housing").kind, "one");
});

function requirementArtifact(
  id: string,
  component: string,
  digestCharacter: string,
): ThreadArtifact {
  const digest = digestCharacter.repeat(64);
  return {
    id,
    name: `${component} requirements`,
    kind: "sysml-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `casys://requirements-capture/${component}/sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "model.write-requirements@1",
      runId: `run-${id}`,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: "2026-08-16T00:00:00.000Z",
      invalidatedByChangeIds: [],
    },
  };
}

function thread(
  artifacts: readonly ThreadArtifact[],
  archivedArtifactId?: string,
): ThreadSnapshot {
  return {
    artifacts,
    changeSet: {
      changes: archivedArtifactId
        ? [{
          kind: "archived",
          target: { kind: "artifact", id: archivedArtifactId },
        }]
        : [],
    },
  } as unknown as ThreadSnapshot;
}
