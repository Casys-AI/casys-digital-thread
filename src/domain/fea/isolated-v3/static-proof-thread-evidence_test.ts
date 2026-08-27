import { assertEquals, assertThrows } from "@std/assert";
import { validateMechanicalProofCase } from "../seal-case/mechanical-proof-case.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import { validateThreadSnapshot } from "../../thread/thread-snapshot-validation.ts";
import type { ThreadArtifact, ThreadSnapshot } from "../../thread/thread-snapshot.ts";
import { CALCULIX_ISOLATED_OUTPUT_MANIFEST } from "./calculix-isolated-execution.ts";
import type { MechanicalRequirement } from "../seal-case/mechanical-proof-case.ts";
import { evaluationsFromStaticProofOracle } from "./static-proof-oracle-input.ts";
import {
  assertExactCompletedStaticProofProjectBinding,
  assertExactStaticProofLocalArtifacts,
  buildStaticProofSuccessor,
  exactStaticProofEvidenceRefs,
} from "./static-proof-thread-evidence.ts";

const AT = "2026-08-16T00:00:00.000Z";
const RUN_ID = "run-fea-3";
const LOCAL = {
  serverId: "digital-thread",
  tool: "verify.run-fea-static-proof@3",
  runId: RUN_ID,
};
const ORACLE = {
  serverId: "syson",
  tool: "syson_constraint_evaluate",
  runId: `capture:${"e".repeat(64)}`,
};

function fp(digest: string): ContentFingerprint {
  return { algorithm: "sha256", digest };
}

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

async function catalogRequirements(): Promise<readonly MechanicalRequirement[]> {
  return validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      new URL(
        "../../../../src/testing/fixtures/fea/mechanical-proof-cases/desk-lamp-dl04-arm-cantilever.json",
        import.meta.url,
      ),
    ),
  )).requirements;
}

function artifact(
  id: string,
  kind: ThreadArtifact["kind"],
  digest: string,
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: digest,
    fingerprint: fp(digest),
    uri: `casys://fixture/${id}`,
    mediaType: kind === "step" ? "model/step" : "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "verify.seal-proof-case@1",
      runId: "run-seal",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function traced(
  id: string,
  feature: string,
  sourceArtifactId: string,
) {
  return {
    id,
    name: feature,
    statement: `Recorded ${feature}.`,
    version: "1",
    criterion: {
      metric: feature,
      operator: "<=" as const,
      limit: { value: 1, unit: "mm" },
    },
    trace: {
      sourceArtifactId,
      elementId: feature,
      targetArtifactIds: ["step-a"],
    },
    freshness: fresh(),
  };
}

function basisSnapshot(
  requirements: ReturnType<typeof traced>[],
): ThreadSnapshot {
  const model = artifact("model-a", "sysml-model", "1".repeat(64));
  const geometry = artifact("geometry-a", "cad-model", "2".repeat(64));
  const reqs = artifact("req-a", "sysml-model", "3".repeat(64));
  const step = artifact("step-a", "step", "4".repeat(64));
  const proof = artifact("fea-proof-a", "document", "5".repeat(64));
  const created = [model, geometry, reqs, step, proof];
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap-static-proof",
    revision: 6,
    generatedAt: AT,
    subject: {
      id: "subject-a",
      name: "Arm",
      kind: "system",
      version: "1",
      modelArtifactId: model.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "change-set.basis",
      name: "Basis",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: created.map((item) => ({
        id: `change.${item.id}`,
        kind: "created",
        target: { kind: "artifact", id: item.id },
        summary: `Created ${item.id}.`,
        afterFingerprint: item.fingerprint,
      })),
    },
    artifacts: created,
    consumptions: [],
    observations: [],
    requirements,
    evaluations: [],
    violations: [],
    provenance: [
      ...created.map((item) => ({
        id: `prov-${item.id}`,
        relation: "changes" as const,
        from: { kind: "change" as const, id: `change.${item.id}` },
        to: { kind: "artifact" as const, id: item.id },
        rationale: `Created ${item.id}.`,
      })),
      ...requirements.map((requirement) => ({
        id: `trace-${requirement.id}`,
        relation: "traces_to" as const,
        from: { kind: "requirement" as const, id: requirement.id },
        to: { kind: "artifact" as const, id: "step-a" },
        rationale: `Requirement ${requirement.id} traces to the exact STEP.`,
      })),
    ],
    proposedActions: [],
  });
}

function outputs() {
  return CALCULIX_ISOLATED_OUTPUT_MANIFEST.map((declaration, index) => {
    const digest = index.toString().repeat(64).slice(0, 64);
    return {
      role: declaration.role,
      sha256: digest,
      casUri: `casys://isolated-output/sha256/${digest}`,
      mediaType: declaration.mediaType,
    };
  });
}

function metrics() {
  return {
    maximumDisplacement: {
      value: 0.1,
      unit: "mm" as const,
      nodeId: 2,
      vectorMm: [0, 0, -0.1] as const,
    },
    maximumVonMises: {
      value: 2,
      unit: "MPa" as const,
      elementId: 1,
    },
  };
}

function successorInput(
  basis: ThreadSnapshot,
  requirements: readonly MechanicalRequirement[],
  outcomes: ReadonlyMap<
    string,
    | {
      readonly status: "pass" | "fail";
      readonly computedValue: number;
      readonly threshold: number;
      readonly margin: number;
      readonly unit: string;
    }
    | { readonly status: "error" | "unresolved" }
  >,
) {
  const proofArtifact = basis.artifacts.find((item) => item.id === "fea-proof-a")!;
  return {
    basis,
    capturedAt: AT,
    localOperation: LOCAL,
    oracleOperation: ORACLE,
    proofArtifact,
    geometryArtifact: basis.artifacts.find((item) => item.id === "geometry-a")!,
    requirementsArtifact: basis.artifacts.find((item) => item.id === "req-a")!,
    proofRequirements: requirements,
    evidence: {
      fingerprint: fp("d".repeat(64)),
      uri: `casys://calculix-isolated-execution-evidence/sha256/${"d".repeat(64)}`,
      outputs: outputs(),
      metrics: metrics(),
    },
    evaluation: {
      sha256: "e".repeat(64),
      uri: `casys://calculix-isolated-syson-evaluation/sha256/${"e".repeat(64)}`,
      outcomes,
    },
  };
}

function passOutcomes(requirements: readonly MechanicalRequirement[]) {
  return new Map(requirements.map((requirement) => [
    requirement.id,
    {
      status: "pass" as const,
      computedValue: 0.1,
      threshold: 1,
      margin: 0.9,
      unit: requirement.limit.unit,
    },
  ]));
}

Deno.test("static proof successor publishes nine closed roles as eleven artifacts", async () => {
  const requirements = await catalogRequirements();
  const basis = basisSnapshot(
    requirements.map((requirement) =>
      traced(`thread-${requirement.id}`, requirement.feature, "req-a")
    ),
  );
  const snapshot = buildStaticProofSuccessor(
    successorInput(basis, requirements, passOutcomes(requirements)),
  );
  const local = assertExactStaticProofLocalArtifacts(snapshot, LOCAL);
  assertEquals(CALCULIX_ISOLATED_OUTPUT_MANIFEST.length, 9);
  assertEquals(local.length, 11);
  assertEquals(
    local.filter((artifact) => artifact.name.startsWith("Local CalculiX ")).map(
      (artifact) => artifact.name,
    ),
    CALCULIX_ISOLATED_OUTPUT_MANIFEST.map((item) => `Local CalculiX ${item.role}`),
  );
  const refs = exactStaticProofEvidenceRefs(snapshot, LOCAL);
  assertEquals(refs.length, 11);
  assertEquals(refs.every((ref) => ref.snapshotId === snapshot.id), true);
});

Deno.test("static proof successor observes only declared criteria and keeps unique requirement traces", async () => {
  const [displacement, stress] = await catalogRequirements();
  const declared = [displacement!];
  const basis = basisSnapshot([
    traced(`thread-${displacement!.id}`, displacement!.feature, "req-a"),
    traced(`thread-${stress!.id}`, stress!.feature, "req-a"),
  ]);
  const snapshot = buildStaticProofSuccessor(
    successorInput(basis, declared, passOutcomes(declared)),
  );
  const added = snapshot.observations.filter((item) =>
    item.id.startsWith("calculix-isolated-observation-")
  );
  assertEquals(added.map((item) => item.metric), [displacement!.feature]);
  assertEquals(snapshot.evaluations.map((item) => item.requirementId), [
    `thread-${displacement!.id}`,
  ]);

  const ambiguous = basisSnapshot([
    traced("thread-a", displacement!.feature, "req-a"),
    traced("thread-b", displacement!.feature, "req-a"),
  ]);
  assertThrows(
    () =>
      buildStaticProofSuccessor(
        successorInput(ambiguous, declared, passOutcomes(declared)),
      ),
    TypeError,
    "has no unique Thread requirement",
  );
});

Deno.test("static proof successor keeps pass/fail/error/unresolved oracle semantics", async () => {
  const requirements = await catalogRequirements();
  const [disp, stress] = requirements;
  const basis = basisSnapshot(
    requirements.map((requirement) =>
      traced(`thread-${requirement.id}`, requirement.feature, "req-a")
    ),
  );
  const mixed = buildStaticProofSuccessor(successorInput(
    basis,
    requirements,
    new Map([
      [disp!.id, {
        status: "pass",
        computedValue: 0.1,
        threshold: 1,
        margin: 0.9,
        unit: "mm",
      }],
      [stress!.id, { status: "unresolved" }],
    ]),
  ));
  const pass = mixed.evaluations.find((item) =>
    item.requirementId === `thread-${disp!.id}`
  )!;
  const unresolved = mixed.evaluations.find((item) =>
    item.requirementId === `thread-${stress!.id}`
  )!;
  assertEquals(pass.status, "pass");
  assertEquals(pass.comparison !== undefined, true);
  assertEquals(mixed.violations.length, 0);
  assertEquals(unresolved.status, "unresolved");
  assertEquals(unresolved.comparison, undefined);

  const errored = buildStaticProofSuccessor(successorInput(
    basis,
    requirements,
    new Map([
      [disp!.id, { status: "error" }],
      [stress!.id, {
        status: "pass",
        computedValue: 1,
        threshold: 2,
        margin: 1,
        unit: "Pa",
      }],
    ]),
  ));
  assertEquals(
    errored.evaluations.find((item) => item.requirementId === `thread-${disp!.id}`)
      ?.comparison,
    undefined,
  );
  assertEquals(
    errored.evaluations.find((item) => item.requirementId === `thread-${stress!.id}`)
      ?.status,
    "pass",
  );

  const failOnly = evaluationsFromStaticProofOracle(
    new Map([[disp!.id, {
      status: "fail",
      computedValue: 2,
      threshold: 1,
      margin: -1,
      unit: "mm",
    }]]),
    [disp!],
    {
      verdictCaptureFp: "e".repeat(64),
      evaluatedAt: AT,
      evidenceArtifactId: "eval-capture",
      observationIds: ["obs-disp"],
      threadRequirementIds: new Map([[disp!.id, `thread-${disp!.id}`]]),
      evaluator: ORACLE,
    },
  );
  assertEquals(failOnly[0]?.status, "fail");
  assertEquals(failOnly[0]?.comparison !== undefined, true);
});

Deno.test("static proof fail successor publishes closed caused_by, evidences and addresses provenance", async () => {
  const requirements = await catalogRequirements();
  const [disp, stress] = requirements;
  const basis = basisSnapshot(
    requirements.map((requirement) =>
      traced(`thread-${requirement.id}`, requirement.feature, "req-a")
    ),
  );
  const snapshot = buildStaticProofSuccessor(successorInput(
    basis,
    requirements,
    new Map([
      [disp!.id, {
        status: "fail",
        computedValue: 2,
        threshold: 1,
        margin: -1,
        unit: "mm",
      }],
      [stress!.id, {
        status: "pass",
        computedValue: 0.1,
        threshold: 1,
        margin: 0.9,
        unit: "Pa",
      }],
    ]),
  ));
  const validated = validateThreadSnapshot(snapshot);
  assertEquals(validated.violations.length, 1);
  const violation = validated.violations[0]!;
  const evaluationId = `thread-${disp!.id}-evaluation-${"e".repeat(64)}`;
  const evidenceId = `calculix-isolated-evidence-${"d".repeat(64)}`;
  const captureId = `calculix-isolated-syson-evaluation-${"e".repeat(64)}`;
  const actionId = `${violation.id}-review`;
  assertEquals(violation.id, `${evaluationId}-violation`);
  assertEquals(violation.evaluationId, evaluationId);
  assertEquals(violation.evidenceArtifactIds, [evidenceId, captureId]);
  assertEquals(validated.proposedActions.map((item) => item.id), [actionId]);
  const failLinks = validated.provenance.filter((link) =>
    link.relation === "caused_by" ||
    link.relation === "addresses" ||
    (link.relation === "evidences" && link.from.kind === "violation")
  );
  assertEquals(failLinks, [
    {
      id: `caused-by-${violation.id}`,
      relation: "caused_by",
      from: { kind: "violation", id: violation.id },
      to: { kind: "evaluation", id: evaluationId },
      rationale:
        "The named violation is caused by the failing local CalculiX evaluation.",
    },
    {
      id: `evidences-${violation.id}-${evidenceId}`,
      relation: "evidences",
      from: { kind: "violation", id: violation.id },
      to: { kind: "artifact", id: evidenceId },
      rationale:
        "The named violation is evidenced by the exact local CalculiX evidence artifact.",
    },
    {
      id: `evidences-${violation.id}-${captureId}`,
      relation: "evidences",
      from: { kind: "violation", id: violation.id },
      to: { kind: "artifact", id: captureId },
      rationale:
        "The named violation is evidenced by the exact local CalculiX evidence artifact.",
    },
    {
      id: `addresses-${actionId}`,
      relation: "addresses",
      from: { kind: "action", id: actionId },
      to: { kind: "violation", id: violation.id },
      rationale: "The proposed review addresses the named local CalculiX violation.",
    },
  ]);
});

Deno.test("static proof successor replay is byte-identical including evidence refs", async () => {
  const requirements = await catalogRequirements();
  const basis = basisSnapshot(
    requirements.map((requirement) =>
      traced(`thread-${requirement.id}`, requirement.feature, "req-a")
    ),
  );
  const input = successorInput(basis, requirements, passOutcomes(requirements));
  const first = buildStaticProofSuccessor(input);
  const second = buildStaticProofSuccessor(input);
  assertEquals(deterministicJson(first), deterministicJson(second));
  assertEquals(
    deterministicJson(exactStaticProofEvidenceRefs(first, LOCAL)),
    deterministicJson(exactStaticProofEvidenceRefs(second, LOCAL)),
  );
  const refs = exactStaticProofEvidenceRefs(first, LOCAL);
  assertExactCompletedStaticProofProjectBinding({
    runStatus: "completed",
    resultSnapshot: {
      snapshotId: first.id,
      revision: first.revision,
      subjectId: first.subject.id,
    },
    evidenceRefs: refs,
    workItemStatus: "completed",
    workItemEvidenceRefs: refs,
    expectedSnapshot: {
      snapshotId: first.id,
      revision: first.revision,
      subjectId: first.subject.id,
    },
    expectedEvidenceRefs: refs,
  });
});
