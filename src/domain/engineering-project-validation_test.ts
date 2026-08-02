import { assertEquals, assertThrows } from "@std/assert";
import {
  deriveEngineeringPhaseStatus,
  deriveEngineeringProjectStatus,
  type EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import {
  collectEngineeringProjectIssues,
  collectEngineeringProjectThreadReferenceIssues,
  EngineeringProjectValidationError,
  validateEngineeringProjectSnapshot,
  validateEngineeringProjectThreadReferences,
} from "./engineering-project-validation.ts";
import type { ThreadArtifact, ThreadSnapshot } from "./thread-snapshot.ts";

const CONFIG = new URL(
  "../../config/projects/coffee-machine-cm01.project.json",
  import.meta.url,
);

Deno.test("CM-01 project reports observed phases and an honest blocked verification phase", async () => {
  const project = validateEngineeringProjectSnapshot(await projectJson());

  assertEquals(deriveEngineeringProjectStatus(project), "attention-required");
  assertEquals(
    project.phases.map((phase) => [
      phase.id,
      deriveEngineeringPhaseStatus(project, phase.id),
    ]),
    [
      ["definition", "completed"],
      ["architecture", "completed"],
      ["design", "completed"],
      ["simulation", "completed"],
      ["verification", "blocked"],
      ["industrialization", "completed"],
    ],
  );
  assertEquals(
    project.decisions.map((decision) => decision.status),
    ["required"],
  );
  assertEquals(project.approvals, []);
  assertEquals(project.blockers.every((blocker) => blocker.status === "open"), true);

  const serialized = JSON.stringify(project).toLowerCase();
  assertEquals(serialized.includes("120 mpa"), false);
  assertEquals(serialized.includes("90 °c"), false);
  assertEquals(serialized.includes("90 degc"), false);
});

Deno.test("EngineeringProjectSnapshot is cloned, deeply frozen and strictly versioned", async () => {
  const input = await projectJson();
  const project = validateEngineeringProjectSnapshot(input);
  (input as Record<string, unknown>).id = "mutated-outside-validator";

  assertEquals(project.id, "engineering-project-coffee-machine-cm01-r1");
  assertEquals(Object.isFrozen(project), true);
  assertEquals(Object.isFrozen(project.project), true);
  assertEquals(Object.isFrozen(project.phases), true);

  const invalid = await projectJson();
  (invalid.phases[0] as unknown as Record<string, unknown>).status = "completed";
  const issues = collectEngineeringProjectIssues(invalid);
  assertEquals(
    issues.some((issue) =>
      issue.code === "unknown_property" && issue.path === "$.phases[0].status"
    ),
    true,
  );
});

Deno.test("phase status cannot be duplicated as blocked work-item state", async () => {
  const invalid = await projectJson();
  (invalid.workItems[4] as unknown as { status: string }).status = "blocked";

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "invalid_enum" && issue.path === "$.workItems[4].status"
    ),
    true,
  );
});

Deno.test("execution base and normalized input fingerprint are atomic and exact", async () => {
  const invalid = await projectJson();
  invalid.decisions[0].baseSnapshot = structuredClone(invalid.threadSnapshots[0]);

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "incomplete_execution_binding"
    ),
    true,
  );

  const proposed = await projectJson();
  const decision = proposed.decisions[0];
  decision.status = "proposed";
  decision.baseSnapshot = structuredClone(proposed.threadSnapshots[0]);
  decision.inputFingerprint = fingerprint("a");
  decision.proposal = {
    summary: "Test-only proposal",
    parameters: [{ key: "choice", label: "Choice", value: "fixture" }],
    proposedAt: decision.requestedAt,
    proposedBy: { id: "test-human", origin: "human" },
  };
  decision.approvalIds = ["approval-mechanical-criterion-v1"];
  proposed.approvals = [{
    id: "approval-mechanical-criterion-v1",
    decisionId: decision.id,
    status: "pending",
    requestedAt: decision.requestedAt,
    baseSnapshot: structuredClone(decision.baseSnapshot),
    inputFingerprint: structuredClone(decision.inputFingerprint),
    inputEvidenceRefs: structuredClone(decision.inputEvidenceRefs),
  }];

  validateEngineeringProjectSnapshot(proposed);
  proposed.approvals[0].inputFingerprint = fingerprint("b");
  assertEquals(
    collectEngineeringProjectIssues(proposed).some((issue) =>
      issue.code === "approval_input_mismatch"
    ),
    true,
  );
});

Deno.test("approval lifecycle cannot contradict its decision", async () => {
  const invalid = await projectJson();
  const decision = invalid.decisions[0];
  decision.status = "approved";
  decision.approvalIds = [];

  assertThrows(
    () => validateEngineeringProjectSnapshot(invalid),
    EngineeringProjectValidationError,
    "an approved decision requires an approved approval",
  );
});

Deno.test("every evidence reference names a declared exact snapshot revision", async () => {
  const invalid = await projectJson();
  invalid.workItems[0].evidenceRefs[0].snapshotRevision = 8;

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "unknown_thread_snapshot" &&
      issue.path === "$.workItems[0].evidenceRefs[0]"
    ),
    true,
  );
});

Deno.test("cross-validation resolves entities in the exact ThreadSnapshot, not latest", async () => {
  const project = validateEngineeringProjectSnapshot(await projectJson());
  const thread = threadSnapshotFor(project);

  assertEquals(
    validateEngineeringProjectThreadReferences(project, [thread]).id,
    project.id,
  );

  const incomplete = structuredClone(thread);
  incomplete.artifacts = incomplete.artifacts.filter((artifact) =>
    artifact.id !== "syson-inventory-ca7f3bda7bfa"
  );
  const issues = collectEngineeringProjectThreadReferenceIssues(project, [incomplete]);
  assertEquals(
    issues.some((issue) =>
      issue.code === "missing_thread_entity" &&
      issue.message.includes("exact ThreadSnapshot revision")
    ),
    true,
  );

  const newerOnly = structuredClone(thread);
  newerOnly.id = `${thread.subject.id}:r8:newer`;
  newerOnly.revision = 8;
  assertEquals(
    collectEngineeringProjectThreadReferenceIssues(project, [newerOnly]).some(
      (issue) => issue.code === "missing_thread_snapshot",
    ),
    true,
  );
});

Deno.test("work dependencies must remain acyclic", async () => {
  const invalid = await projectJson();
  invalid.workItems[0].dependsOnWorkItemIds = ["build-current-cad"];

  assertEquals(
    collectEngineeringProjectIssues(invalid).some((issue) =>
      issue.code === "dependency_cycle"
    ),
    true,
  );
});

async function projectJson(): Promise<Mutable<EngineeringProjectSnapshot>> {
  return JSON.parse(
    await Deno.readTextFile(CONFIG),
  ) as Mutable<EngineeringProjectSnapshot>;
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;

function fingerprint(digit: string): { algorithm: "sha256"; digest: string } {
  return { algorithm: "sha256", digest: digit.repeat(64) };
}

function threadSnapshotFor(project: EngineeringProjectSnapshot): ThreadSnapshot {
  const reference = project.threadSnapshots[0];
  const artifactIds = new Set<string>();
  project.phases.forEach((phase) =>
    phase.evidenceRefs.forEach((evidence) => artifactIds.add(evidence.id))
  );
  project.workItems.forEach((item) =>
    item.evidenceRefs.forEach((evidence) => artifactIds.add(evidence.id))
  );
  project.decisions.forEach((decision) =>
    decision.inputEvidenceRefs.forEach((evidence) => artifactIds.add(evidence.id))
  );

  return {
    schemaVersion: "1.0",
    id: reference.snapshotId,
    revision: reference.revision,
    generatedAt: project.generatedAt,
    subject: {
      id: project.project.subjectId,
      name: project.project.name,
      kind: "system",
      version: String(reference.revision),
      modelArtifactId: "syson-inventory-ca7f3bda7bfa",
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-none",
      name: "Observed project state",
      status: "applied",
      createdAt: project.generatedAt,
      appliedAt: project.generatedAt,
      changes: [],
    },
    artifacts: [...artifactIds].map(artifact),
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
  };
}

function artifact(id: string): ThreadArtifact {
  return {
    id,
    name: id,
    kind: "other",
    version: "1",
    fingerprint: fingerprint("c"),
    producer: {
      serverId: "test",
      tool: "fixture",
      runId: "fixture-run",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function fresh() {
  return {
    status: "fresh" as const,
    changedAt: "2026-08-01T10:36:58.345Z",
    invalidatedByChangeIds: [],
  };
}
