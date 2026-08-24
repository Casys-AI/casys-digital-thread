import { assertEquals, assertThrows } from "@std/assert";
import { validElectricalObservationMethodSheet } from "../../../../testing/electrical-observation-method-sheet-fixtures.ts";
import {
  fingerprintElectricalObservationMethodSheet,
  validateElectricalObservationMethodSheet,
} from "../../../../domain/electrical/observation-method-sheet.ts";
import {
  evaluateAdmittedSpiceObservations,
  SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
} from "../../../../domain/electrical/spice/evaluation/admitted-observation-evaluation.ts";
import { spiceDocumentaryRequirementBindings } from "../../../../domain/electrical/spice/evaluation/spice-documentary-requirement-binding.ts";
import { sha256Fingerprint } from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringAgentRun } from "../../../../domain/project/engineering-project.ts";
import { requirementEvaluationIdentity } from "../../../../domain/thread/requirement-evaluation-identity.ts";
import { computeArchiveCascade } from "../../../../domain/thread/thread-retirement.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtension } from "../../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  validateSpiceAdmittedObservationEvaluationCapture,
} from "./admitted-spice-observation-evaluation-capture.ts";
import { buildAdmittedSpiceObservationEvaluationSuccessor } from "./admitted-spice-observation-evaluation-successor.ts";

const AT = "2026-08-21T12:00:00.000Z";
const NATIVES = [
  { name: "v(n1)", value: 3, unit: "V" as const },
  { name: "i(vsrc)", value: -2, unit: "A" as const },
];

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}

function artifact(
  id: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  tool: string,
  runId: string,
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://fixture/${id}`,
    mediaType: "application/json",
    producer: { serverId: "digital-thread", tool, runId },
    inputArtifactIds: [],
    freshness: fresh(),
  };
}

function run(id: string): EngineeringAgentRun {
  return {
    id,
    workItemId: `work.${id}`,
    status: "running",
    summary: "Evaluate admitted SPICE observations",
    queuedAt: AT,
    startedAt: AT,
    evidenceRefs: [],
  };
}

async function successorContext() {
  const sheet = validateElectricalObservationMethodSheet(
    validElectricalObservationMethodSheet(),
  );
  const sheetFingerprint = await fingerprintElectricalObservationMethodSheet(sheet);
  const methodSheetSealFingerprint = await sha256Fingerprint({
    kind: "electrical-observation-method-sheet-seal-capture",
    sheetFingerprint,
  });
  if (methodSheetSealFingerprint.digest === sheetFingerprint.digest) {
    throw new TypeError(
      "Method-sheet content fingerprint must not equal the seal-capture artifact fingerprint.",
    );
  }
  const brief = artifact(
    "artifact.brief",
    "document",
    { algorithm: "sha256", digest: "1".repeat(64) },
    "baseline.from-approved-brief@1",
    "run.brief",
  );
  const methodSheet = artifact(
    `electrical-observation-method-sheet-seal-${methodSheetSealFingerprint.digest}`,
    "document",
    methodSheetSealFingerprint,
    "verify.seal-electrical-observation-method-sheet@1",
    "run.seal-sheet",
  );
  const spiceCapture = artifact(
    sheet.spice.capture.id,
    "document",
    sheet.spice.capture.fingerprint,
    "simulate.run-admitted-spice@1",
    sheet.spice.producer.runId,
  );
  const evidence = artifact(
    sheet.spice.evidence.id,
    "evidence",
    sheet.spice.evidence.fingerprint,
    "simulate.run-admitted-spice@1",
    sheet.spice.producer.runId,
  );
  const result = artifact(
    sheet.spice.result.id,
    "solver-result",
    sheet.spice.result.fingerprint,
    "simulate.run-admitted-spice@1",
    sheet.spice.producer.runId,
  );
  const created = [brief, methodSheet, spiceCapture, evidence, result];
  const basisSnapshot = validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "snap.spice-successor",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: sheet.subject.id,
      name: "Electrical method",
      kind: "system",
      version: "r1",
      modelArtifactId: brief.id,
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
        kind: "created" as const,
        target: { kind: "artifact" as const, id: item.id },
        summary: `Created ${item.id}.`,
        afterFingerprint: item.fingerprint,
      })),
    },
    artifacts: created,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: created.map((item) => ({
      id: `prov-${item.id}`,
      relation: "changes" as const,
      from: { kind: "change" as const, id: `change.${item.id}` },
      to: { kind: "artifact" as const, id: item.id },
      rationale: `Created ${item.id}.`,
    })),
    proposedActions: [],
  });
  const evaluation = await evaluateAdmittedSpiceObservations(sheet, NATIVES);
  const capture = validateSpiceAdmittedObservationEvaluationCapture({
    schemaVersion: "spice-admitted-observation-evaluation-capture/1.0",
    kind: "spice-admitted-observation-evaluation",
    operation: {
      id: "verify.evaluate-admitted-spice-observations",
      version: "1",
    },
    overall: evaluation.overall,
    evaluations: evaluation.evaluations,
    limitations: SPICE_ADMITTED_OBSERVATION_EVALUATION_LIMITATIONS,
  });
  const captureFingerprint = await sha256Fingerprint(capture);
  const expectedRequirementIds = sheet.criteria.flatMap((criterion) =>
    spiceDocumentaryRequirementBindings({
      criterion,
      methodSheetFingerprint: sheetFingerprint,
    }).map((binding) => binding.requirementId)
  );
  const sealArtifactRequirementIds = sheet.criteria.flatMap((criterion) =>
    spiceDocumentaryRequirementBindings({
      criterion,
      methodSheetFingerprint: methodSheetSealFingerprint,
    }).map((binding) => binding.requirementId)
  );
  return {
    sheet,
    sheetFingerprint,
    methodSheetSealFingerprint,
    basisSnapshot,
    evaluation,
    capture,
    captureFingerprint,
    expectedRequirementIds,
    sealArtifactRequirementIds,
    lineage: {
      methodSheet,
      spiceCapture,
      evidence,
      result,
      observations: [],
    },
  };
}

function successorInput(
  context: Awaited<ReturnType<typeof successorContext>>,
  runId: string,
  overrides: {
    readonly basisSnapshot?: ThreadSnapshot;
    readonly captureFingerprint?: ContentFingerprint;
  } = {},
) {
  const basisSnapshot = overrides.basisSnapshot ?? context.basisSnapshot;
  return {
    basisSnapshot,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: basisSnapshot.id,
      revision: basisSnapshot.revision,
      subjectId: basisSnapshot.subject.id,
    },
    run: run(runId),
    capture: context.capture,
    captureFingerprint: overrides.captureFingerprint ?? context.captureFingerprint,
    sheet: context.sheet,
    methodSheetFingerprint: context.sheetFingerprint,
    evaluation: context.evaluation,
    lineage: context.lineage,
  };
}

function archiveL4(snapshot: ThreadSnapshot, l4Id: string): ThreadSnapshot {
  const cascade = computeArchiveCascade(snapshot, [{
    kind: "artifact",
    id: l4Id,
  }]);
  assertEquals(
    cascade.some((entry) => entry.ref.kind === "requirement"),
    false,
  );
  return applyThreadSnapshotExtension(snapshot, {
    id: "archive-previous-l4",
    name: "Archive previous admitted SPICE evaluation",
    subjectId: snapshot.subject.id,
    capturedAt: AT,
    artifacts: [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
    archived: cascade.map((entry) => ({
      target: entry.ref,
      summary: `Retired because ${entry.because}.`,
    })),
  }, { appliedAt: AT });
}

Deno.test(
  "SPICE successor reuses same-sheet documentary requirements after an archived L4",
  async () => {
    const context = await successorContext();
    assertEquals(
      context.sheetFingerprint.digest === context.methodSheetSealFingerprint.digest,
      false,
    );
    assertEquals(
      context.expectedRequirementIds.some((id) =>
        context.sealArtifactRequirementIds.includes(id)
      ),
      false,
    );
    const first = buildAdmittedSpiceObservationEvaluationSuccessor(
      successorInput(context, "run.evaluate-spice-1"),
    );
    assertEquals(
      first.snapshot.requirements.map((item) => item.id),
      context.expectedRequirementIds,
    );
    assertEquals(
      first.snapshot.requirements.map((item) => item.version),
      context.expectedRequirementIds.map(() => context.sheetFingerprint.digest),
    );
    assertEquals(
      first.snapshot.requirements.some((item) =>
        item.id.includes(context.methodSheetSealFingerprint.digest) ||
        item.version === context.methodSheetSealFingerprint.digest
      ),
      false,
    );
    const firstEvaluationIds = first.snapshot.evaluations.map((item) => item.id);
    assertEquals(
      firstEvaluationIds,
      context.expectedRequirementIds.map((requirementId) =>
        requirementEvaluationIdentity({
          requirementId,
          evidenceFingerprint: context.captureFingerprint,
        }).id
      ),
    );

    const archived = archiveL4(first.snapshot, first.artifact.id);
    const secondFingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: "b".repeat(64),
    };
    const second = buildAdmittedSpiceObservationEvaluationSuccessor(
      successorInput(context, "run.evaluate-spice-2", {
        basisSnapshot: archived,
        captureFingerprint: secondFingerprint,
      }),
    );
    const requirementIds = second.snapshot.requirements.map((item) => item.id);
    assertEquals(requirementIds, context.expectedRequirementIds);
    assertEquals(new Set(requirementIds).size, requirementIds.length);
    const published = second.snapshot.evaluations.filter((item) =>
      item.evidenceArtifactIds[0] === second.artifact.id
    );
    assertEquals(
      published.map((item) => item.requirementId),
      context.expectedRequirementIds,
    );
    const secondEvaluationIds = published.map((item) => item.id);
    assertEquals(
      secondEvaluationIds,
      context.expectedRequirementIds.map((requirementId) =>
        requirementEvaluationIdentity({
          requirementId,
          evidenceFingerprint: secondFingerprint,
        }).id
      ),
    );
    assertEquals(
      secondEvaluationIds.some((id) => firstEvaluationIds.includes(id)),
      false,
    );
  },
);

Deno.test(
  "SPICE successor fails closed when a documentary requirement is archived",
  async () => {
    const context = await successorContext();
    const first = buildAdmittedSpiceObservationEvaluationSuccessor(
      successorInput(context, "run.evaluate-spice-1"),
    );
    const requirementId = first.snapshot.requirements[0]!.id;
    const cascade = computeArchiveCascade(first.snapshot, [{
      kind: "requirement",
      id: requirementId,
    }]);
    assertEquals(
      cascade.some((entry) =>
        entry.ref.kind === "requirement" && entry.ref.id === requirementId
      ),
      true,
    );
    const archived = applyThreadSnapshotExtension(first.snapshot, {
      id: "archive-documentary-requirement",
      name: "Archive documentary electrical requirement",
      subjectId: first.snapshot.subject.id,
      capturedAt: AT,
      artifacts: [],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
      archived: cascade.map((entry) => ({
        target: entry.ref,
        summary: `Retired because ${entry.because}.`,
      })),
    }, { appliedAt: AT });
    assertThrows(
      () =>
        buildAdmittedSpiceObservationEvaluationSuccessor(
          successorInput(context, "run.evaluate-spice-2", {
            basisSnapshot: archived,
            captureFingerprint: {
              algorithm: "sha256",
              digest: "b".repeat(64),
            },
          }),
        ),
      TypeError,
      "archived on the basis snapshot",
    );
  },
);

Deno.test(
  "SPICE successor fails closed when a retained documentary requirement diverges",
  async () => {
    const context = await successorContext();
    const first = buildAdmittedSpiceObservationEvaluationSuccessor(
      successorInput(context, "run.evaluate-spice-1"),
    );
    const diverged = structuredClone(first.snapshot) as ThreadSnapshot;
    (diverged.requirements[0] as { statement: string }).statement =
      "Divergent sealed-method statement.";
    assertThrows(
      () =>
        buildAdmittedSpiceObservationEvaluationSuccessor(
          successorInput(context, "run.evaluate-spice-2", {
            basisSnapshot: diverged,
            captureFingerprint: {
              algorithm: "sha256",
              digest: "b".repeat(64),
            },
          }),
        ),
      TypeError,
      "conflicts with the basis snapshot",
    );
  },
);
