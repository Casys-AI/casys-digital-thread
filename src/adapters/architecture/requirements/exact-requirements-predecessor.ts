/**
 * One exact predecessor proof for generic requirements-capture/3.0 and 4.0.
 *
 * Writer enrichment and recapture review/executor share this reader so a
 * weaker second authority cannot admit a forged lineage.
 */

import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { MODEL_WRITE_ARCHITECTURE_OPERATION } from "../../../domain/architecture/renderer/architecture-proposal.ts";
import type { RequirementsTarget } from "../../../domain/architecture/requirements/requirements-proposal.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadArtifactConsumption,
  type ThreadProvenanceLink,
  type ThreadSnapshot,
  type TracedRequirement,
} from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";
import { parseExactArchitectureCapture } from "../renderer/architecture-capture.ts";
import {
  requireCurrentArchitectureSourceAnalyses,
  type SysmlSourceAnalysisReader,
} from "../renderer/sysml-source-analysis-capture.ts";
import {
  assertRequirementsRecaptureProvenanceContinuity,
  type ExactRequirementsCapture,
  isRecaptureRequirementsCapture,
  parseExactRequirementsCapture,
  recapturePredecessorArtifactMatches,
  REQUIREMENTS_TRACED_WRITE_PRODUCER_TOOL,
  type RequirementsCaptureConstraintUsage,
  requirementsCaptureObservedAt,
  requirementsCaptureProducerTool,
} from "./requirements-capture.ts";
import { MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL } from "../../../domain/architecture/requirements/requirements-traced-recapture-proposal.ts";
import {
  requirementsUriFor,
  requirementsUriPrefix,
} from "./requirements-identities.ts";
import {
  expectedRequirementsUsesProvenance,
  expectedRequirementTraceLink,
  requirementsProjectionKind,
} from "./requirements-thread-projection.ts";
import type { OracleRequirement } from "../../../domain/kernel/proof-case.ts";

export interface ExactRequirementsPredecessorRead {
  readonly capture: ExactRequirementsCapture;
  readonly requirements: readonly OracleRequirement[];
  readonly requirementsElementId: string;
  readonly authoritativeConstraintUsages: readonly RequirementsCaptureConstraintUsage[];
  readonly historicalArchitecture: ThreadArtifact;
  readonly predecessorRequirementsArtifact: ThreadArtifact | undefined;
}

export interface ExactRequirementsPredecessorReaderDependencies {
  readonly captures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly architectureCaptures: {
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
}

export async function readExactRequirementsPredecessor(
  base: ThreadSnapshot,
  priorArtifact: ThreadArtifact,
  expected: {
    readonly containerComponent: string;
    readonly partDefName: string;
    readonly target: RequirementsTarget;
  },
  dependencies: ExactRequirementsPredecessorReaderDependencies,
): Promise<ExactRequirementsPredecessorRead> {
  const text = await dependencies.captures.read(priorArtifact.fingerprint);
  if (!text) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prior requirements capture is not durably readable.",
    );
  }
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prior requirements capture is invalid JSON.",
    );
  }
  let priorRecord: ExactRequirementsCapture;
  try {
    priorRecord = parseExactRequirementsCapture(record);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The prior requirements capture is not exact requirements-capture/3.0 or 4.0 evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    priorRecord.containerComponent !== expected.containerComponent ||
    priorRecord.partDefName !== expected.partDefName
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prior requirements capture does not match the expected schema or target component.",
    );
  }
  const operation = priorRecord.operation;
  const observedAt = requirementsCaptureObservedAt(priorRecord);
  const expectedProducerTool = requirementsCaptureProducerTool(priorRecord);
  const architecture = priorRecord.architecture;
  const historicalArchitecture = base.artifacts.find((artifact) =>
    artifact.id === architecture.artifactId
  );
  const requirementsInputs = priorArtifact.inputArtifactIds.flatMap((id) => {
    const artifact = base.artifacts.find((candidate) => candidate.id === id);
    return artifact?.uri?.startsWith(
        requirementsUriPrefix(expected.containerComponent),
      )
      ? [artifact]
      : [];
  });
  const predecessorRequirementsArtifact = requirementsInputs.length === 1
    ? requirementsInputs[0]
    : undefined;
  const architectureBasis = priorRecord.architectureBasis;
  const priorSeed = priorRecord.seed;
  if (
    priorArtifact.id !==
      `requirements-${expected.containerComponent}-${priorArtifact.fingerprint.digest}` ||
    priorArtifact.kind !== "sysml-model" ||
    priorArtifact.uri !== requirementsUriFor(
        expected.containerComponent,
        priorArtifact.fingerprint,
      ) ||
    priorArtifact.mediaType !== "application/json" ||
    priorArtifact.producer.serverId !== "syson" ||
    priorArtifact.producer.tool !== expectedProducerTool ||
    operation.id !== priorRecord.operation.id ||
    operation.version !== priorRecord.operation.version ||
    priorRecord.trustedRunId !== priorArtifact.producer.runId ||
    !isExactIsoTimestamp(observedAt) ||
    !architecture || !historicalArchitecture ||
    historicalArchitecture.id !==
      `architecture-${historicalArchitecture.fingerprint.digest}` ||
    historicalArchitecture.kind !== "sysml-model" ||
    historicalArchitecture.uri !==
      `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${historicalArchitecture.fingerprint.digest}` ||
    historicalArchitecture.mediaType !== "application/json" ||
    historicalArchitecture.producer.serverId !== "syson" ||
    historicalArchitecture.producer.tool !== "syson_element_insert_sysml" ||
    !isContentFingerprint(architecture.fingerprint) ||
    !fingerprintsEqual(
      architecture.fingerprint,
      historicalArchitecture.fingerprint,
    ) ||
    architecture.producerRunId !== historicalArchitecture.producer.runId ||
    new Set(priorArtifact.inputArtifactIds).size !==
      priorArtifact.inputArtifactIds.length ||
    requirementsInputs.length > 1 ||
    priorArtifact.inputArtifactIds.length !==
      1 + (predecessorRequirementsArtifact ? 1 : 0) ||
    !priorArtifact.inputArtifactIds.includes(historicalArchitecture.id) ||
    (predecessorRequirementsArtifact !== undefined &&
      (predecessorRequirementsArtifact.id !==
          `requirements-${expected.containerComponent}-${predecessorRequirementsArtifact.fingerprint.digest}` ||
        predecessorRequirementsArtifact.kind !== "sysml-model" ||
        predecessorRequirementsArtifact.uri !== requirementsUriFor(
            expected.containerComponent,
            predecessorRequirementsArtifact.fingerprint,
          ) ||
        predecessorRequirementsArtifact.mediaType !== "application/json" ||
        predecessorRequirementsArtifact.producer.serverId !== "syson" ||
        (predecessorRequirementsArtifact.producer.tool !==
            "syson_element_insert_sysml" &&
          predecessorRequirementsArtifact.producer.tool !==
            "syson_constraint_extract" &&
          predecessorRequirementsArtifact.producer.tool !==
            REQUIREMENTS_TRACED_WRITE_PRODUCER_TOOL &&
          predecessorRequirementsArtifact.producer.tool !==
            MODEL_RECAPTURE_TRACED_REQUIREMENTS_PRODUCER_TOOL)))
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prior requirements artifact/capture pair is not exact requirements-capture evidence " +
        "anchored to its historical architecture artifact.",
    );
  }
  const derivedInputs = base.provenance.filter((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === priorArtifact.id && link.to.kind === "artifact"
  ).map((link) => link.to.id);
  const expectedDerivedInputs = [
    historicalArchitecture.id,
    ...(predecessorRequirementsArtifact ? [predecessorRequirementsArtifact.id] : []),
  ];
  if (
    derivedInputs.length !== expectedDerivedInputs.length ||
    new Set(derivedInputs).size !== derivedInputs.length ||
    expectedDerivedInputs.some((id) => !derivedInputs.includes(id))
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prior requirements Thread lineage is not a bijective architecture plus " +
        "optional single requirements-predecessor chain.",
    );
  }
  const historicalCaptureText = await dependencies.architectureCaptures.read(
    historicalArchitecture.fingerprint,
  );
  let historicalCapture: ReturnType<typeof parseExactArchitectureCapture>;
  try {
    if (!historicalCaptureText) throw new Error("capture is absent");
    historicalCapture = parseExactArchitectureCapture(
      JSON.parse(historicalCaptureText),
    );
    if (deterministicJson(historicalCapture) !== historicalCaptureText) {
      throw new Error("capture is not canonical JSON");
    }
    if (
      !fingerprintsEqual(
        await sha256Fingerprint(historicalCapture),
        historicalArchitecture.fingerprint,
      )
    ) {
      throw new Error("capture fingerprint is not exact");
    }
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The historical architecture capture is not exact architecture-capture/4.0 evidence: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    await requireCurrentArchitectureSourceAnalyses(
      historicalCapture.sourceAnalyses,
      dependencies.sysmlSourceAnalysis,
      {
        runId: historicalArchitecture.producer.runId,
        operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
        packageName: historicalCapture.packageName,
      },
    );
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `Historical architecture source-analysis evidence is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const basisSnapshot = architectureBasis &&
      typeof architectureBasis.snapshotId === "string"
    ? await dependencies.snapshots.get(architectureBasis.snapshotId)
    : undefined;
  const historicalSeedArtifact = basisSnapshot?.artifacts.find((artifact) =>
    artifact.id === historicalCapture.seed.artifactId
  );
  const historicalPredecessor = historicalCapture.predecessor
    ? basisSnapshot?.artifacts.find((artifact) =>
      artifact.id === historicalCapture.predecessor!.artifactId
    )
    : undefined;
  const expectedHistoricalInputs = historicalSeedArtifact
    ? [
      historicalSeedArtifact.id,
      ...(historicalPredecessor ? [historicalPredecessor.id] : []),
    ]
    : [];
  if (
    !architectureBasis || typeof architectureBasis.snapshotId !== "string" ||
    !Number.isSafeInteger(architectureBasis.revision) ||
    architectureBasis.fingerprint !==
      historicalArchitecture.fingerprint.digest ||
    !basisSnapshot || basisSnapshot.id !== architectureBasis.snapshotId ||
    basisSnapshot.revision !== architectureBasis.revision ||
    basisSnapshot.subject.id !== base.subject.id ||
    !basisSnapshot.artifacts.some((artifact) =>
      artifact.id === historicalArchitecture.id &&
      deterministicJson(artifact) ===
        deterministicJson(historicalArchitecture)
    ) ||
    historicalCapture.trustedRunId !==
      historicalArchitecture.producer.runId ||
    !historicalSeedArtifact ||
    historicalSeedArtifact.id !==
      `syson-model-seed-${historicalSeedArtifact.fingerprint.digest}` ||
    historicalSeedArtifact.kind !== "sysml-model" ||
    historicalSeedArtifact.uri !==
      `casys://syson-model-seed-capture/sha256/${historicalSeedArtifact.fingerprint.digest}` ||
    historicalSeedArtifact.mediaType !== "application/json" ||
    historicalSeedArtifact.producer.serverId !== "syson" ||
    historicalSeedArtifact.producer.tool !== "syson_model_create" ||
    historicalSeedArtifact.producer.runId !==
      historicalCapture.seed.producerRunId ||
    !fingerprintsEqual(
      historicalSeedArtifact.fingerprint,
      historicalCapture.seed.fingerprint,
    ) ||
    (historicalCapture.predecessor !== undefined &&
      (!historicalPredecessor ||
        historicalPredecessor.id !==
          `architecture-${historicalPredecessor.fingerprint.digest}` ||
        historicalPredecessor.kind !== "sysml-model" ||
        historicalPredecessor.uri !==
          `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${historicalPredecessor.fingerprint.digest}` ||
        historicalPredecessor.mediaType !== "application/json" ||
        historicalPredecessor.producer.serverId !== "syson" ||
        historicalPredecessor.producer.tool !==
          "syson_element_insert_sysml" ||
        historicalPredecessor.producer.runId !==
          historicalCapture.predecessor.producerRunId ||
        !fingerprintsEqual(
          historicalPredecessor.fingerprint,
          historicalCapture.predecessor.fingerprint,
        ))) ||
    historicalArchitecture.inputArtifactIds.length !==
      expectedHistoricalInputs.length ||
    new Set(historicalArchitecture.inputArtifactIds).size !==
      historicalArchitecture.inputArtifactIds.length ||
    expectedHistoricalInputs.some((id) =>
      !historicalArchitecture.inputArtifactIds.includes(id)
    ) ||
    !priorSeed || typeof priorSeed.artifactId !== "string" ||
    typeof priorSeed.producerRunId !== "string" ||
    !isContentFingerprint(priorSeed.fingerprint) ||
    priorSeed.artifactId !== historicalCapture.seed.artifactId ||
    priorSeed.producerRunId !== historicalCapture.seed.producerRunId ||
    !fingerprintsEqual(
      priorSeed.fingerprint,
      historicalCapture.seed.fingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The prior requirements capture basis or seed anchor diverges from its " +
        "historical architecture evidence.",
    );
  }
  const rawTarget = priorRecord.target;
  if (
    rawTarget.kind !== expected.target.kind ||
    rawTarget.label !== expected.target.label ||
    rawTarget.elementId !== expected.target.elementId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The prior requirements capture targets a different SysON PartDefinition " +
        `than "${expected.target.label}" (${expected.target.elementId}). A target identity change ` +
        "requires an explicit reviewed transition, not in-place enrichment.",
    );
  }
  const rawReqsElementId = priorRecord.requirementsElementId;
  const validated = priorRecord.requirements;
  const archived = archivedRefKeys(base);
  const projected = base.requirements.filter((requirement) =>
    requirement.trace.sourceArtifactId === priorArtifact.id &&
    !archived.has(`requirement:${requirement.id}`)
  );
  const expectedIds = new Set(
    validated.map((requirement) =>
      `requirement-${priorArtifact.fingerprint.digest}-${requirement.id}`
    ),
  );
  if (projected.length !== validated.length) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The active Thread requirements projection is not one-to-one with its prior capture.",
    );
  }
  const projectedById = new Map(projected.map((item) => [item.id, item]));
  const expectedTraceLinks: ThreadProvenanceLink[] = [];
  for (const expectedRequirement of validated) {
    const expectedId =
      `requirement-${priorArtifact.fingerprint.digest}-${expectedRequirement.id}`;
    const expectedProjection: TracedRequirement = {
      id: expectedId,
      name: expectedRequirement.name,
      statement:
        `${expectedRequirement.name}: ${expectedRequirement.metric} ${expectedRequirement.operator} ` +
        `${expectedRequirement.limit.value} ${expectedRequirement.limit.unit}.`,
      version: priorArtifact.fingerprint.digest,
      criterion: {
        metric: expectedRequirement.metric,
        operator: expectedRequirement.operator,
        limit: {
          value: expectedRequirement.limit.value,
          unit: expectedRequirement.limit.unit,
        },
      },
      trace: {
        sourceArtifactId: priorArtifact.id,
        elementId: rawReqsElementId,
        targetArtifactIds: [historicalArchitecture.id],
      },
      freshness: {
        status: "fresh",
        changedAt: observedAt,
        invalidatedByChangeIds: [],
      },
    };
    const projectedRequirement = projectedById.get(expectedId);
    if (
      !projectedRequirement || !expectedIds.has(projectedRequirement.id) ||
      deterministicJson(projectedRequirement) !==
        deterministicJson(expectedProjection)
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The active Thread requirements projection diverges from its prior capture.",
      );
    }
    expectedTraceLinks.push(expectedRequirementTraceLink({
      requirementId: expectedId,
      architectureId: historicalArchitecture.id,
      targetLabel: expected.target.label,
      targetElementId: expected.target.elementId,
    }));
  }
  const observedTraceLinks = base.provenance.filter((link) =>
    link.relation === "traces_to" && link.from.kind === "requirement" &&
    expectedIds.has(link.from.id)
  );
  if (
    observedTraceLinks.length !== expectedTraceLinks.length ||
    expectedTraceLinks.some((expectedLink) => {
      const observed = observedTraceLinks.find((link) => link.id === expectedLink.id);
      return !observed ||
        deterministicJson(observed) !== deterministicJson(expectedLink);
    })
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The active Thread requirements trace projection diverges from its prior capture.",
    );
  }

  const expectedConsumptions: ThreadArtifactConsumption[] = [
    {
      id: `consume-${historicalArchitecture.id}-by-${priorArtifact.id}`,
      artifactId: historicalArchitecture.id,
      consumer: priorArtifact.producer,
      observedFingerprint: historicalArchitecture.fingerprint,
      verifiedAt: observedAt,
      status: "verified",
    },
    ...(predecessorRequirementsArtifact
      ? [{
        id: `consume-${predecessorRequirementsArtifact.id}-by-${priorArtifact.id}`,
        artifactId: predecessorRequirementsArtifact.id,
        consumer: priorArtifact.producer,
        observedFingerprint: predecessorRequirementsArtifact.fingerprint,
        verifiedAt: observedAt,
        status: "verified" as const,
      }]
      : []),
  ];
  const observedConsumptions = base.consumptions.filter((consumption) =>
    deterministicJson(consumption.consumer) ===
      deterministicJson(priorArtifact.producer)
  );
  if (
    observedConsumptions.length !== expectedConsumptions.length ||
    expectedConsumptions.some((expectedConsumption) => {
      const observed = observedConsumptions.find((item) =>
        item.id === expectedConsumption.id
      );
      return !observed ||
        deterministicJson(observed) !== deterministicJson(expectedConsumption);
    })
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The prior requirements consumption projection is not exact.",
    );
  }
  const expectedUses = expectedRequirementsUsesProvenance({
    kind: requirementsProjectionKind(priorRecord),
    artifactId: priorArtifact.id,
    architectureId: historicalArchitecture.id,
    predecessorId: predecessorRequirementsArtifact?.id,
    digest: priorArtifact.fingerprint.digest,
  });
  const expectedConsumptionIds = new Set(
    expectedConsumptions.map((consumption) => consumption.id),
  );
  const observedUses = base.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    expectedConsumptionIds.has(link.from.id)
  );
  if (
    observedUses.length !== expectedUses.length ||
    expectedUses.some((expectedUse) => {
      const observed = observedUses.find((link) => link.id === expectedUse.id);
      return !observed ||
        deterministicJson(observed) !== deterministicJson(expectedUse);
    })
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The prior requirements uses provenance is not exact.",
    );
  }
  if (isRecaptureRequirementsCapture(priorRecord)) {
    if (
      !predecessorRequirementsArtifact ||
      !recapturePredecessorArtifactMatches(
        priorRecord,
        predecessorRequirementsArtifact,
      )
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The recapture predecessor field is not the exact Thread requirements input.",
      );
    }
  }
  if (predecessorRequirementsArtifact) {
    const predecessorText = await dependencies.captures.read(
      predecessorRequirementsArtifact.fingerprint,
    );
    if (!predecessorText) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements predecessor capture is not durably readable.",
      );
    }
    let predecessorCapture: ExactRequirementsCapture;
    try {
      predecessorCapture = parseExactRequirementsCapture(
        JSON.parse(predecessorText),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The prior requirements predecessor capture is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (
      predecessorRequirementsArtifact.producer.tool !==
        requirementsCaptureProducerTool(predecessorCapture) ||
      predecessorCapture.containerComponent !== expected.containerComponent ||
      predecessorCapture.trustedRunId !==
        predecessorRequirementsArtifact.producer.runId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The prior requirements predecessor capture producer is not the exact discriminant pair.",
      );
    }
    if (isRecaptureRequirementsCapture(priorRecord)) {
      try {
        assertRequirementsRecaptureProvenanceContinuity(
          priorRecord,
          predecessorCapture,
        );
      } catch (error) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          `The prior requirements recapture provenance is not continuous: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
  return {
    capture: priorRecord,
    requirements: validated,
    requirementsElementId: rawReqsElementId,
    authoritativeConstraintUsages: priorRecord.constraintUsages,
    historicalArchitecture,
    predecessorRequirementsArtifact,
  };
}

function isExactIsoTimestamp(value: string): boolean {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value;
}

function isContentFingerprint(value: unknown): value is ContentFingerprint {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.algorithm === "sha256" &&
    typeof record.digest === "string" && /^[a-f0-9]{64}$/.test(record.digest);
}
