import { assertEquals, assertRejects } from "@std/assert";
import type { ThermalMethodSheetCompilationJoin } from "../../../ports/out/compile/admission/thermal-method-sheet-compilation-join.ts";
import type {
  AdmittedObservationEvidence,
  AdmittedObservationEvidenceReader,
} from "../../../ports/out/modelica/evaluation/admitted-observation-evidence-reader.ts";
import type { ThermalMethodSheetSourceCaptureReader } from "../../../ports/out/modelica/thermal-method-sheet-source-capture-reader.ts";
import type { ThermalMethodSheetSourceIdentity } from "../../../../domain/modelica/thermal-method-sheet-recross.ts";
import type { EngineeringProjectSnapshot } from "../../../../domain/project/engineering-project.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import { parseAdmittedObservationEvaluationParameters } from "../../../../domain/modelica/evaluation/admitted-observation-evaluation-proposal.ts";
import { fingerprintModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { validateModelicaThermalMethodSheet } from "../../../../domain/modelica/thermal-method-sheet.ts";
import { validThermalMethodSheetPlaceholder } from "../../../../testing/modelica-thermal-method-sheet-fixtures.ts";
import {
  PrepareProjectAdmittedModelicaEvaluationReview,
  ProjectAdmittedModelicaEvaluationReviewError,
} from "./prepare-project-admitted-modelica-evaluation-review.ts";

const AT = "2026-08-21T12:00:00.000Z";
const PROJECT_ID = "articulated-led-desk-lamp";
const SUBJECT_ID = "articulated-led-desk-lamp";
const EVIDENCE_DIGEST = "c".repeat(64);
const PARAMETER_SYMBOL_ID = `3b6a${"d".repeat(60)}`;
const OUTPUT_SYMBOL_ID = `3b6a${"c".repeat(60)}`;
const NATIVE_PARAMETER_NAME = "heatingRate";
const NATIVE_OUTPUT_NAME = "temperature";

Deno.test(
  "admitted Modelica evaluation review derives MRTR from projectId only",
  async () => {
    const fixture = await harness();
    const result = await fixture.service.execute({ projectId: PROJECT_ID });
    const replay = parseAdmittedObservationEvaluationParameters(
      result.decisionParameters,
    );
    assertEquals(result.admission, replay);
    assertEquals(result.admission.projectId, PROJECT_ID);
    assertEquals(result.method.selections[0]?.outputSymbolId, OUTPUT_SYMBOL_ID);
    assertEquals(result.method.selections[0]?.role, "final");
    assertEquals(
      result.decisionParameters.some((parameter) =>
        parameter.key.includes("feature") || parameter.key.includes("provider")
      ),
      false,
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review rejects caller-selected identities",
  async () => {
    const fixture = await harness();
    await assertRejects(
      () =>
        fixture.service.execute({
          projectId: PROJECT_ID,
          feature: "temperature",
          limit: 80,
          unit: "K",
          provider: "syson",
          tool: "syson_constraint_evaluate",
          args: { solver: "dassl" },
        }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "exact validation",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses an unavailable method sheet",
  async () => {
    const fixture = await harness();
    fixture.sheets.missing = true;
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "unavailable",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses missing admitted evidence",
  async () => {
    const fixture = await harness({ includeEvidence: false });
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "evidence",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses a native-name mismatch",
  async () => {
    const fixture = await harness();
    fixture.evidence.payload = {
      modelName: "placeholder-module",
      outputs: [{ name: "placeholder-output", unit: "unit-pending-source" }],
      metrics: [{
        outputName: "placeholder-output",
        statistic: "final",
        unit: "unit-pending-source",
        value: 0,
      }],
    };
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "exact native source output",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses a wrong-kind source symbol",
  async () => {
    const fixture = await harness();
    fixture.sources.symbols = [
      { id: PARAMETER_SYMBOL_ID, kind: "parameter", name: NATIVE_PARAMETER_NAME },
      { id: OUTPUT_SYMBOL_ID, kind: "parameter", name: NATIVE_OUTPUT_NAME },
    ];
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "exact source-analysis variable",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review selects the unique Thread pair among shared SysML ids",
  async () => {
    const fixture = await harness({ requirements: "shared-element" });
    const result = await fixture.service.execute({ projectId: PROJECT_ID });
    assertEquals(result.method.selections[0]?.requirementMetric, "placeholder-output");
    assertEquals(
      result.method.selections[0]?.requirementElementId,
      "placeholder-requirement",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses a missing Thread requirement pair before MRTR",
  async () => {
    const fixture = await harness({ requirements: "missing" });
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "no current requirement",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review refuses an ambiguous Thread requirement pair before MRTR",
  async () => {
    const fixture = await harness({ requirements: "ambiguous" });
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "will not choose one",
    );
  },
);

Deno.test(
  "admitted Modelica evaluation review leaves a unit mismatch unresolved",
  async () => {
    const fixture = await harness();
    fixture.evidence.payload = {
      modelName: "placeholder-module",
      outputs: [{ name: NATIVE_OUTPUT_NAME, unit: "K" }],
      metrics: [{
        outputName: NATIVE_OUTPUT_NAME,
        statistic: "final",
        unit: "K",
        value: 0,
      }],
    };
    await assertRejects(
      () => fixture.service.execute({ projectId: PROJECT_ID }),
      ProjectAdmittedModelicaEvaluationReviewError,
      "unresolved",
    );
  },
);

async function harness(
  options: {
    includeEvidence?: boolean;
    requirements?: "unique" | "missing" | "ambiguous" | "shared-element";
  } = {},
) {
  const includeEvidence = options.includeEvidence !== false;
  const requirementMode = options.requirements ?? "unique";
  const sheet = validateModelicaThermalMethodSheet(identitySheetInput());
  await fingerprintModelicaThermalMethodSheet(sheet);
  const evidenceFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: EVIDENCE_DIGEST,
  };
  const snapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "placeholder-thread-snapshot",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Thermal evaluation fixture",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: fresh(AT),
    changeSet: {
      id: "change-set.brief",
      name: "Brief",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change.brief",
        kind: "created",
        target: { kind: "artifact", id: "artifact.brief" },
        summary: "Recorded the documentary brief.",
        afterFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      }],
    },
    artifacts: [
      {
        id: "artifact.brief",
        name: "Brief",
        kind: "document",
        version: "1",
        fingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
        producer: {
          serverId: "digital-thread",
          tool: "baseline.from-approved-brief@1",
          runId: "run.brief",
        },
        inputArtifactIds: [],
        freshness: fresh(AT),
      },
      ...(includeEvidence
        ? [{
          id: `modelica-admitted-evidence-${EVIDENCE_DIGEST}`,
          name: "Admitted Modelica normalized evidence",
          kind: "evidence" as const,
          version: EVIDENCE_DIGEST,
          fingerprint: evidenceFingerprint,
          uri: `casys://isolated-output/sha256/${EVIDENCE_DIGEST}`,
          mediaType: "application/json",
          producer: {
            serverId: "digital-thread",
            tool: "simulate.run-admitted-modelica@1",
            runId: "run.admitted-modelica",
          },
          inputArtifactIds: [],
          freshness: fresh(AT),
        }]
        : []),
    ],
    consumptions: [],
    observations: [],
    requirements: reviewRequirements(requirementMode),
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: "provenance.change.brief",
        relation: "changes",
        from: { kind: "change", id: "change.brief" },
        to: { kind: "artifact", id: "artifact.brief" },
        rationale: "The applied change introduced the brief document.",
      },
      ...reviewRequirementProvenance(requirementMode),
    ],
    proposedActions: [],
  });
  const objective = "Evaluate admitted Modelica observations.";
  const project = {
    schemaVersion: "4.0",
    id: `${PROJECT_ID}:r2`,
    revision: 2,
    previous: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    generatedAt: AT,
    project: {
      id: PROJECT_ID,
      name: "Lamp",
      subjectId: SUBJECT_ID,
      objective: { title: objective, statement: objective },
    },
    framing: {
      intent: {
        statement: objective,
        source: { kind: "human", reference: "conversation:thermal" },
        capturedAt: AT,
        capturedBy: { id: "agent:guide", origin: "agent" },
      },
      questions: [],
      answers: [],
    },
    threadSnapshots: [{
      snapshotId: snapshot.id,
      revision: snapshot.revision,
      subjectId: SUBJECT_ID,
    }],
    phases: [],
    workItems: [],
    agentRuns: [],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [{
      commandId: "project-start",
      type: "project.start",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "1".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r1`, revision: 1 },
    }, {
      commandId: "project-question-propose",
      type: "project.question-propose",
      actor: { id: "agent:guide", origin: "agent" },
      issuedAt: AT,
      appliedAt: AT,
      requestFingerprint: { algorithm: "sha256", digest: "2".repeat(64) },
      resultingSnapshot: { snapshotId: `${PROJECT_ID}:r2`, revision: 2 },
    }],
  } as unknown as EngineeringProjectSnapshot;
  const sheets = new MemorySheetJoin(sheet);
  const evidence = new MemoryEvidenceReader({
    modelName: "placeholder-module",
    outputs: [{ name: NATIVE_OUTPUT_NAME, unit: "unit-pending-source" }],
    metrics: [{
      outputName: NATIVE_OUTPUT_NAME,
      statistic: "final",
      unit: "unit-pending-source",
      value: 0,
    }],
  });
  const sources = new MemorySourceReader(sheet.model.sourceCaptureFingerprint);
  const service = new PrepareProjectAdmittedModelicaEvaluationReview({
    projects: { get: () => Promise.resolve(project) },
    snapshots: {
      get: (id) => Promise.resolve(id === snapshot.id ? snapshot : undefined),
      latest: () => Promise.resolve(snapshot),
      save: () => Promise.reject(new Error("review must not write snapshots")),
    },
    methodSheets: sheets,
    evidence,
    sourceCaptures: sources,
  });
  return { service, sheets, evidence, sources, snapshot };
}

class MemorySheetJoin implements ThermalMethodSheetCompilationJoin {
  missing = false;
  constructor(
    readonly sheet: ReturnType<typeof validateModelicaThermalMethodSheet>,
  ) {}
  read() {
    if (this.missing) return Promise.resolve(undefined);
    return Promise.resolve(this.sheet);
  }
}

class MemorySourceReader implements ThermalMethodSheetSourceCaptureReader {
  missing = false;
  symbols: ThermalMethodSheetSourceIdentity["symbols"] = [
    { id: PARAMETER_SYMBOL_ID, kind: "parameter", name: NATIVE_PARAMETER_NAME },
    { id: OUTPUT_SYMBOL_ID, kind: "variable", name: NATIVE_OUTPUT_NAME },
  ];
  constructor(readonly fingerprint: ContentFingerprint) {}
  read(
    fingerprint: ContentFingerprint,
  ): Promise<ThermalMethodSheetSourceIdentity | undefined> {
    if (this.missing || fingerprint.digest !== this.fingerprint.digest) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({
      fingerprint,
      role: "modelica-model",
      language: "modelica",
      symbols: this.symbols,
    });
  }
}

class MemoryEvidenceReader implements AdmittedObservationEvidenceReader {
  payload: AdmittedObservationEvidence;
  constructor(payload: AdmittedObservationEvidence) {
    this.payload = payload;
  }
  read() {
    return Promise.resolve(this.payload);
  }
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

function reviewRequirements(
  mode: "unique" | "missing" | "ambiguous" | "shared-element",
) {
  if (mode === "missing") return [];
  const elementId = "placeholder-requirement";
  const matching = reviewRequirement(
    "thread-placeholder-requirement",
    elementId,
    "placeholder-output",
  );
  if (mode === "unique") return [matching];
  if (mode === "ambiguous") {
    return [
      matching,
      reviewRequirement(
        "thread-placeholder-requirement-duplicate",
        elementId,
        "placeholder-output",
      ),
    ];
  }
  return [
    reviewRequirement("thread-max-displacement", elementId, "maxDisplacement"),
    reviewRequirement("thread-max-von-mises", elementId, "maxVonMises"),
    matching,
  ];
}

function reviewRequirementProvenance(
  mode: "unique" | "missing" | "ambiguous" | "shared-element",
) {
  return reviewRequirements(mode).map((requirement) => ({
    id: `trace-${requirement.id}-to-brief`,
    relation: "traces_to" as const,
    from: { kind: "requirement" as const, id: requirement.id },
    to: { kind: "artifact" as const, id: "artifact.brief" },
    rationale: "The placeholder requirement constrains the brief artifact.",
  }));
}

function reviewRequirement(id: string, elementId: string, metric: string) {
  return {
    id,
    name: id,
    statement: "Placeholder requirement. Not a thermal verdict.",
    version: "1",
    criterion: {
      metric,
      operator: "<=" as const,
      limit: { value: 1, unit: "unit-pending-source" },
    },
    trace: {
      sourceArtifactId: "artifact.brief",
      elementId,
      targetArtifactIds: ["artifact.brief"],
    },
    freshness: fresh(AT),
  };
}

function identitySheetInput(): Record<string, unknown> {
  const input = validThermalMethodSheetPlaceholder();
  const parameters = input.parameters as Array<{ modelSymbolId: string }>;
  const outputs = input.outputs as Array<{ modelSymbolId: string }>;
  const bindings = input.bindings as {
    parameterizes: Array<{ modelSymbolId: string }>;
    outputRequirements: Array<{ modelSymbolId: string }>;
  };
  parameters[0]!.modelSymbolId = PARAMETER_SYMBOL_ID;
  outputs[0]!.modelSymbolId = OUTPUT_SYMBOL_ID;
  bindings.parameterizes[0]!.modelSymbolId = PARAMETER_SYMBOL_ID;
  bindings.outputRequirements[0]!.modelSymbolId = OUTPUT_SYMBOL_ID;
  return input;
}
