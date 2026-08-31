import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sampleAgentResourceReference } from "../../../testing/agent-resource-test-support.ts";
import {
  applyProjectSourceWorkspaceCommand,
  emptyProjectSourceWorkspace,
} from "../../project-source-workspace/transitions.ts";
import { resolveProjectSourceClosure } from "../../project-source-workspace/closure.ts";
import type { ProjectSourceWorkspaceState } from "../../project-source-workspace/types.ts";
import {
  canonicalizePrescribedKinematicsCaseSource,
  parsePrescribedKinematicsCaseSourceText,
  prescribedKinematicsRequiredSampleTimes,
} from "./prescribed-kinematics-case-source.ts";
import {
  prescribedKinematicsEvaluationCloseoutCandidates,
  validatePrescribedKinematicsEvaluationCloseoutCandidate,
} from "./prescribed-kinematics-evaluation-closeout.ts";
import { evaluatePrescribedKinematics } from "./prescribed-kinematics-evaluation.ts";
import {
  fingerprintPrescribedKinematicsMethodSheetSource,
  type PrescribedKinematicsMethodSheetSource,
  sealPrescribedKinematicsMethodSheet,
  validatePrescribedKinematicsMethodSheetSource,
  validatePrescribedKinematicsMethodSheetSourceAgainstEvidence,
} from "./prescribed-kinematics-method-sheet.ts";
import {
  fingerprintPrescribedKinematicsObservation,
  parsePrescribedKinematicsObservation,
  prescribedKinematicsObservationMethod,
} from "./prescribed-kinematics-observation.ts";
import {
  PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
  resolvePrescribedKinematicsSourceClosure,
  sealPrescribedKinematicsCase,
} from "./prescribed-kinematics-source-closure.ts";

const PROJECT_ID = "project-mech";
const DIGEST = "a".repeat(64);

Deno.test("prescribed-kinematics source accepts only the connected SI mechanism scenario", () => {
  const { source, text } = canonicalizePrescribedKinematicsCaseSource(sourceValue());
  assertEquals(parsePrescribedKinematicsCaseSourceText(text), source);
  assertEquals(source.sampling.timeStepS, 0.5);
  assertEquals(source.joints.map((joint) => joint.jointId), ["joint-arm"]);

  const withLegacyCriteria = structuredClone(sourceValue()) as Record<string, unknown>;
  withLegacyCriteria.criteria = [];
  assertThrowsType(() =>
    parsePrescribedKinematicsCaseSourceText(JSON.stringify(withLegacyCriteria))
  );

  const duplicateUsage = structuredClone(sourceValue()) as unknown as {
    bodies: { partUsageElementId: string }[];
  };
  duplicateUsage.bodies[1]!.partUsageElementId =
    duplicateUsage.bodies[0]!.partUsageElementId;
  assertThrowsType(() => canonicalizePrescribedKinematicsCaseSource(duplicateUsage));

  const collapsedAssembly = structuredClone(sourceValue()) as unknown as {
    assembly: { elementId: string; elementKind: string };
    bodies: { partUsageElementId: string }[];
  };
  collapsedAssembly.assembly.elementId =
    collapsedAssembly.bodies[0]!.partUsageElementId;
  assertThrowsType(() => canonicalizePrescribedKinematicsCaseSource(collapsedAssembly));

  const nonTree = structuredClone(sourceValue()) as unknown as { joints: unknown[] };
  nonTree.joints.push({
    ...sourceValue().joints[0],
    jointId: "joint-loop",
    parentBodyId: "body-head",
    childBodyId: "body-base",
  });
  assertThrowsType(() => canonicalizePrescribedKinematicsCaseSource(nonTree));

  const maximumSampling = canonicalizePrescribedKinematicsCaseSource({
    ...sourceValue(),
    durationS: 10,
    joints: [{
      ...sourceValue().joints[0],
      ramp: { ...sourceValue().joints[0].ramp, endTimeS: 10 },
    }],
    sampling: { timeStepS: 10 / 511 },
  }).source;
  assertEquals(prescribedKinematicsRequiredSampleTimes(maximumSampling).length, 512);
  assertThrowsType(() =>
    canonicalizePrescribedKinematicsCaseSource({
      ...sourceValue(),
      sampling: { timeStepS: 1 / 512 },
    })
  );

  const tooManyBodies = structuredClone(sourceValue()) as unknown as {
    bodies: unknown[];
  };
  tooManyBodies.bodies = Array.from({ length: 17 }, (_, index) => ({
    bodyId: `body-${index}`,
    partUsageElementId: `usage-${index}`,
    zeroPose: pose([0, 0, 0]),
  }));
  assertThrowsType(() => canonicalizePrescribedKinematicsCaseSource(tooManyBodies));
});

Deno.test("prescribed-kinematics source admits PartDefinition and PartUsage assembly contexts and refuses any other kind", () => {
  const nested = canonicalizePrescribedKinematicsCaseSource(sourceValue()).source;
  assertEquals(nested.assembly, {
    elementId: "usage-assembly",
    elementKind: "PartUsage",
  });

  const root = canonicalizePrescribedKinematicsCaseSource(
    sourceValue({
      elementId: "definition-assembly",
      elementKind: "PartDefinition",
    }),
  ).source;
  assertEquals(root.assembly, {
    elementId: "definition-assembly",
    elementKind: "PartDefinition",
  });

  assertThrows(
    () =>
      canonicalizePrescribedKinematicsCaseSource({
        ...sourceValue(),
        assembly: { elementId: "usage-assembly", elementKind: "Package" },
      }),
    TypeError,
    "PartDefinition or PartUsage",
  );
  assertThrows(
    () =>
      canonicalizePrescribedKinematicsCaseSource({
        ...sourceValue(),
        assembly: { elementId: "usage-assembly" },
      }),
    TypeError,
    "elementKind",
  );
  assertThrows(
    () =>
      canonicalizePrescribedKinematicsCaseSource({
        ...sourceValue(),
        assembly: {
          elementId: "usage-assembly",
          elementKind: "PartUsage",
          partUsageElementId: "usage-assembly",
        },
      }),
    TypeError,
    "unsupported field partUsageElementId",
  );
});

Deno.test("prescribed-kinematics source refuses a collapsed assembly context that reuses a body PartUsage", () => {
  assertThrows(
    () =>
      canonicalizePrescribedKinematicsCaseSource({
        ...sourceValue(),
        assembly: { elementId: "usage-base", elementKind: "PartUsage" },
      }),
    TypeError,
    "distinct from every body PartUsage",
  );
  assertThrows(
    () =>
      canonicalizePrescribedKinematicsCaseSource({
        ...sourceValue(),
        assembly: { elementId: "usage-base", elementKind: "PartDefinition" },
      }),
    TypeError,
    "distinct from every body PartUsage",
  );
});

Deno.test("same-file mechanism-source attachments are exhaustive for assembly and every body mapping", async () => {
  const { source, text } = canonicalizePrescribedKinematicsCaseSource(sourceValue());
  const closures = await mechanismClosures(text);
  const sourceClosure = await resolvePrescribedKinematicsSourceClosure({
    closures,
    sourceText: text,
  });
  assertEquals(
    sourceClosure.workspace.attachments.map((attachment) => ({
      elementKind: attachment.elementKind,
      elementId: attachment.elementId,
    })),
    [
      { elementKind: "PartUsage", elementId: "usage-assembly" },
      { elementKind: "PartUsage", elementId: "usage-base" },
      { elementKind: "PartUsage", elementId: "usage-head" },
    ],
  );
  assertEquals(sourceClosure.source, source);

  const foreignSubject = structuredClone(sourceClosure) as unknown as {
    source: { project: { subjectId: string } };
  };
  foreignSubject.source.project.subjectId = "subject-foreign";
  await assertRejects(
    () => sealPrescribedKinematicsCase(foreignSubject as typeof sourceClosure),
    TypeError,
    "subjectId",
  );

  await assertRejects(
    () =>
      resolvePrescribedKinematicsSourceClosure({
        closures: closures.slice(0, 2),
        sourceText: text,
      }),
    TypeError,
    "target set",
  );

  const changedSource = canonicalizePrescribedKinematicsCaseSource({
    ...sourceValue(),
    scope: "A different immediate articulated-arm subassembly.",
  }).text;
  await assertRejects(
    () =>
      resolvePrescribedKinematicsSourceClosure({
        closures,
        sourceText: changedSource,
      }),
    TypeError,
    "byteCount differs",
  );
});

Deno.test("same-file mechanism-source attachments bind a root PartDefinition assembly context in canonical order", async () => {
  const { source, text } = canonicalizePrescribedKinematicsCaseSource(
    sourceValue({
      elementId: "definition-assembly",
      elementKind: "PartDefinition",
    }),
  );
  const closures = await mechanismClosures(text, [
    { elementId: "definition-assembly", elementKind: "PartDefinition" },
    { elementId: "usage-base", elementKind: "PartUsage" },
    { elementId: "usage-head", elementKind: "PartUsage" },
  ]);
  const sourceClosure = await resolvePrescribedKinematicsSourceClosure({
    closures,
    sourceText: text,
  });
  assertEquals(
    sourceClosure.workspace.attachments.map((attachment) => ({
      elementKind: attachment.elementKind,
      elementId: attachment.elementId,
    })),
    [
      { elementKind: "PartDefinition", elementId: "definition-assembly" },
      { elementKind: "PartUsage", elementId: "usage-base" },
      { elementKind: "PartUsage", elementId: "usage-head" },
    ],
  );
  assertEquals(sourceClosure.source, source);
});

Deno.test("mechanism-source attachments refuse a wrong target kind or an inexact attachment set", async () => {
  const nested = canonicalizePrescribedKinematicsCaseSource(sourceValue());
  await assertRejects(
    async () =>
      resolvePrescribedKinematicsSourceClosure({
        closures: await mechanismClosures(nested.text, [
          { elementId: "usage-assembly", elementKind: "PartUsage" },
          { elementId: "usage-base", elementKind: "PartDefinition" },
          { elementId: "usage-head", elementKind: "PartUsage" },
        ]),
        sourceText: nested.text,
      }),
    TypeError,
    "target set",
  );

  const root = canonicalizePrescribedKinematicsCaseSource(
    sourceValue({
      elementId: "definition-assembly",
      elementKind: "PartDefinition",
    }),
  );
  await assertRejects(
    async () =>
      resolvePrescribedKinematicsSourceClosure({
        closures: await mechanismClosures(root.text, [
          { elementId: "definition-assembly", elementKind: "PartUsage" },
          { elementId: "usage-base", elementKind: "PartUsage" },
          { elementId: "usage-head", elementKind: "PartUsage" },
        ]),
        sourceText: root.text,
      }),
    TypeError,
    "target set",
  );
});

Deno.test("decimal time spellings normalize to the same canonical L3/L4 sample tick", async () => {
  const { source, text } = canonicalizePrescribedKinematicsCaseSource({
    ...sourceValue(),
    sampling: { timeStepS: 0.1 },
  });
  assertEquals(prescribedKinematicsRequiredSampleTimes(source)[3], 0.30000000000000004);
  const sealedCase = await sealPrescribedKinematicsCase(
    await resolvePrescribedKinematicsSourceClosure({
      closures: await mechanismClosures(text),
      sourceText: text,
    }),
  );
  const observation = await parsePrescribedKinematicsObservation(
    observationValue(
      sealedCase.fingerprint,
      false,
      await prescribedKinematicsObservationMethod(),
      [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
    ),
    sealedCase,
  );
  assertEquals(observation.samples[3]?.timeS, 0.30000000000000004);
  const observationFingerprint = await fingerprintPrescribedKinematicsObservation(
    observation,
    sealedCase,
  );
  const method = await sealPrescribedKinematicsMethodSheet({
    source: {
      schemaVersion: "prescribed-kinematics-method-sheet-source/1.0",
      id: "method-decimal-tick",
      revision: 1,
      scope: "One decimal sample tick.",
      evidenceBoundary: "No contact, force, or clearance claim.",
      caseFingerprint: sealedCase.fingerprint,
      observationFingerprint,
      criteria: [{
        id: "angle-at-three-tenths",
        kind: "joint-angle",
        jointId: "joint-arm",
        sampleTimeS: 0.3,
        expectedAngleRad: 0,
        toleranceRad: 0.001,
      }],
    },
    sealedCase,
    observation,
  });
  assertEquals(
    (await evaluatePrescribedKinematics({ sealedCase, observation, method })).verdict,
    "pass",
  );
});

Deno.test("tiny schedules do not widen the sample-tick tolerance into an absolute window", async () => {
  const durationS = 1e-15;
  const { text } = canonicalizePrescribedKinematicsCaseSource({
    ...sourceValue(),
    durationS,
    joints: [{
      ...sourceValue().joints[0],
      ramp: { ...sourceValue().joints[0].ramp, endTimeS: durationS },
    }],
    sampling: { timeStepS: durationS / 2 },
  });
  const sealedCase = await sealPrescribedKinematicsCase(
    await resolvePrescribedKinematicsSourceClosure({
      closures: await mechanismClosures(text),
      sourceText: text,
    }),
  );
  const observationMethod = await prescribedKinematicsObservationMethod();
  await assertRejects(
    () =>
      parsePrescribedKinematicsObservation(
        observationValue(
          sealedCase.fingerprint,
          false,
          observationMethod,
          [0, 0.6e-15, durationS],
        ),
        sealedCase,
      ),
    TypeError,
    "sample tick",
  );
});

Deno.test("method criteria refuse an ambiguous residual scalar and an unlabelled tolerance", () => {
  const source = {
    schemaVersion: "prescribed-kinematics-method-sheet-source/1.0",
    id: "method-residuals",
    revision: 1,
    scope: "Prescribed residuals only.",
    evidenceBoundary: "No force or collision claim.",
    caseFingerprint: { algorithm: "sha256", digest: DIGEST },
    observationFingerprint: { algorithm: "sha256", digest: DIGEST },
    criteria: [{
      id: "ambiguous-residual",
      kind: "residual",
      sampleTimeS: 1,
      maximumResidual: 0.0001,
    }],
  };
  assertThrowsType(() => validatePrescribedKinematicsMethodSheetSource(source));
  assertThrowsType(() =>
    validatePrescribedKinematicsMethodSheetSource({
      ...source,
      criteria: [{
        id: "translation-residual",
        kind: "translation-residual",
        jointId: "joint-arm",
        sampleTimeS: 1,
        maximumNorm: 0.0001,
      }],
    })
  );
});

Deno.test("sealed method drives L4; unresolved L3 facts remain unresolved and never expose L5 accept", async () => {
  const { text } = canonicalizePrescribedKinematicsCaseSource(sourceValue());
  const sourceClosure = await resolvePrescribedKinematicsSourceClosure({
    closures: await mechanismClosures(text),
    sourceText: text,
  });
  const sealedCase = await sealPrescribedKinematicsCase(sourceClosure);
  const observation = await parsePrescribedKinematicsObservation(
    observationValue(
      sealedCase.fingerprint,
      true,
      await prescribedKinematicsObservationMethod(),
    ),
    sealedCase,
  );
  const observationFingerprint = await fingerprintPrescribedKinematicsObservation(
    observation,
    sealedCase,
  );
  const methodSource: PrescribedKinematicsMethodSheetSource = {
    schemaVersion: "prescribed-kinematics-method-sheet-source/1.0",
    id: "method-arm",
    revision: 1,
    scope: "Prescribed arm pose and convergence only.",
    evidenceBoundary:
      "No collision, contact, clearance, load, strength, safety, or manufacture claim.",
    caseFingerprint: sealedCase.fingerprint,
    observationFingerprint,
    criteria: [
      {
        id: "pose-head-final",
        kind: "body-pose",
        bodyId: "body-head",
        sampleTimeS: 1,
        expectedPose: pose([0, 0, 0]),
        translationToleranceM: 0.001,
        orientationToleranceRad: 0.001,
      },
      {
        id: "angle-final",
        kind: "joint-angle",
        jointId: "joint-arm",
        sampleTimeS: 1,
        expectedAngleRad: 0.5,
        toleranceRad: 0.001,
      },
      {
        id: "translation-residual-final",
        kind: "translation-residual",
        jointId: "joint-arm",
        sampleTimeS: 1,
        maximumNormM: 0.0001,
      },
      { id: "converged", kind: "convergence" },
    ],
  };
  const recrossed = await validatePrescribedKinematicsMethodSheetSourceAgainstEvidence({
    source: methodSource,
    sealedCase,
    observation,
  });
  assertEquals(recrossed.sealedCase.fingerprint, sealedCase.fingerprint);
  assertEquals(recrossed.observationFingerprint, observationFingerprint);
  await assertRejects(
    () =>
      validatePrescribedKinematicsMethodSheetSourceAgainstEvidence({
        source: {
          ...methodSource,
          observationFingerprint: { algorithm: "sha256", digest: "f".repeat(64) },
        },
        sealedCase,
        observation,
      }),
    TypeError,
    "exact L3 observation",
  );
  const method = await sealPrescribedKinematicsMethodSheet({
    source: methodSource,
    sealedCase,
    observation,
  });
  assertEquals(
    await fingerprintPrescribedKinematicsMethodSheetSource(methodSource),
    method.source.fingerprint,
  );
  assertEquals(method.scope, methodSource.scope);
  assertEquals(method.evidenceBoundary, methodSource.evidenceBoundary);
  const evaluation = await evaluatePrescribedKinematics({
    sealedCase,
    observation,
    method,
  });
  assertEquals(evaluation.verdict, "unresolved");
  assertEquals(
    evaluation.criteria.find((criterion) =>
      criterion.id === "translation-residual-final"
    )?.verdict,
    "unresolved",
  );
  const candidates = await prescribedKinematicsEvaluationCloseoutCandidates({
    evaluation,
    sealedCase,
    observation,
    method,
  });
  assertEquals(candidates.map((candidate) => candidate.consequence), ["reject"]);
  assertEquals(
    candidates[0]?.rejectionDisposition,
    "prescribed-kinematics-review-required",
  );
  assertEquals(candidates[0]?.limitations.clearance, "not_evaluated");
  assertEquals(
    await validatePrescribedKinematicsEvaluationCloseoutCandidate(candidates[0]),
    candidates[0],
  );
  assertEquals(candidates[0]?.scope, methodSource.scope);
  assertEquals(candidates[0]?.evidenceBoundary, methodSource.evidenceBoundary);
  await assertRejects(
    () =>
      validatePrescribedKinematicsEvaluationCloseoutCandidate({
        ...candidates[0],
        scope: "A different method scope.",
      }),
    TypeError,
    "scope",
  );
  const forgedEvaluation = {
    ...evaluation,
    criteria: evaluation.criteria.map((criterion) => ({
      ...criterion,
      verdict: "pass" as const,
    })),
    verdict: "pass" as const,
  } as typeof evaluation;
  await assertRejects(
    () =>
      prescribedKinematicsEvaluationCloseoutCandidates({
        evaluation: forgedEvaluation,
        sealedCase,
        observation,
        method,
      }),
    TypeError,
    "does not match",
  );
});

Deno.test("all observed signed method criteria may offer but never create an L5 accept", async () => {
  const { text } = canonicalizePrescribedKinematicsCaseSource(sourceValue());
  const sealedCase = await sealPrescribedKinematicsCase(
    await resolvePrescribedKinematicsSourceClosure({
      closures: await mechanismClosures(text),
      sourceText: text,
    }),
  );
  const observation = await parsePrescribedKinematicsObservation(
    observationValue(
      sealedCase.fingerprint,
      false,
      await prescribedKinematicsObservationMethod(),
    ),
    sealedCase,
  );
  const observationFingerprint = await fingerprintPrescribedKinematicsObservation(
    observation,
    sealedCase,
  );
  const method = await sealPrescribedKinematicsMethodSheet({
    source: {
      schemaVersion: "prescribed-kinematics-method-sheet-source/1.0",
      id: "method-all-pass",
      revision: 1,
      scope: "Prescribed arm angle only.",
      evidenceBoundary:
        "No contact, clearance, load, strength, safety, or manufacture claim.",
      caseFingerprint: sealedCase.fingerprint,
      observationFingerprint,
      criteria: [{
        id: "angle-final",
        kind: "joint-angle",
        jointId: "joint-arm",
        sampleTimeS: 1,
        expectedAngleRad: 0.5,
        toleranceRad: 0.001,
      }, {
        id: "translation-residual-final",
        kind: "translation-residual",
        jointId: "joint-arm",
        sampleTimeS: 1,
        maximumNormM: 0.0001,
      }, {
        id: "rotation-residual-final",
        kind: "rotation-quaternion-imag-residual",
        jointId: "joint-arm",
        sampleTimeS: 1,
        maximumNorm: 0.0001,
      }],
    },
    sealedCase,
    observation,
  });
  const evaluation = await evaluatePrescribedKinematics({
    sealedCase,
    observation,
    method,
  });
  assertEquals(evaluation.verdict, "pass");
  const candidates = await prescribedKinematicsEvaluationCloseoutCandidates({
    evaluation,
    sealedCase,
    observation,
    method,
  });
  assertEquals(candidates.map((candidate) => candidate.consequence), [
    "accept",
    "reject",
  ]);
  // The returned value remains a candidate, not a human decision or a Thread write.
  assertEquals(
    candidates[0]?.operation.id,
    "decide.accept-prescribed-kinematics-evaluation",
  );
});

function sourceValue(
  assembly: {
    readonly elementId: string;
    readonly elementKind: "PartDefinition" | "PartUsage";
  } = { elementId: "usage-assembly", elementKind: "PartUsage" },
) {
  return {
    schemaVersion: "prescribed-kinematics-case-source/1.0",
    id: "case-arm",
    revision: 1,
    scope: "One immediate two-body articulated arm subassembly.",
    evidenceBoundary:
      "Only prescribed kinematic poses, angles, residuals, and convergence are observable.",
    project: { id: PROJECT_ID, subjectId: "subject-lamp" },
    assembly,
    units: { length: "m", angle: "rad", time: "s" },
    durationS: 1,
    groundBodyId: "body-base",
    bodies: [
      {
        bodyId: "body-base",
        partUsageElementId: "usage-base",
        zeroPose: pose([0, 0, 0]),
      },
      {
        bodyId: "body-head",
        partUsageElementId: "usage-head",
        zeroPose: pose([0, 0, 0]),
      },
    ],
    joints: [{
      jointId: "joint-arm",
      kind: "revolute",
      parentBodyId: "body-base",
      childBodyId: "body-head",
      parentFrame: { ...pose([0, 0, 0]), axis: [0, 0, 1] },
      childFrame: { ...pose([0, 0, 0]), axis: [0, 0, 1] },
      limitRad: { minimum: -1, maximum: 1 },
      ramp: {
        kind: "linear",
        startTimeS: 0,
        endTimeS: 1,
        initialAngleRad: 0,
        finalAngleRad: 0.5,
      },
    }],
    sampling: { timeStepS: 0.5 },
  } as const;
}

function pose(positionM: readonly [number, number, number]) {
  return { positionM, orientationWxyz: [1, 0, 0, 0] as const };
}

async function mechanismClosures(
  sourceText: string,
  targets: readonly {
    readonly elementId: string;
    readonly elementKind: "PartDefinition" | "PartUsage";
  }[] = [
    { elementId: "usage-assembly", elementKind: "PartUsage" },
    { elementId: "usage-base", elementKind: "PartUsage" },
    { elementId: "usage-head", elementKind: "PartUsage" },
  ],
) {
  const sourceDigest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(sourceText),
  );
  const digest = [...new Uint8Array(sourceDigest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  let state = emptyProjectSourceWorkspace(PROJECT_ID);
  state = (await apply(state, {
    projectId: PROJECT_ID,
    mutationId: "module-mechanism",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "module_put",
      moduleId: "module-mechanism",
      slug: "mechanism",
      displayName: "Mechanism",
    },
  })).state;
  state = (await apply(state, {
    projectId: PROJECT_ID,
    mutationId: "file-mechanism",
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "file_put",
      fileId: "file-mechanism",
      moduleId: "module-mechanism",
      logicalName: "arm.kinematics.json",
      role: "mechanism-source",
      dependencies: [],
      resourceRef: sampleAgentResourceReference({
        name: "arm.kinematics.json",
        mimeType: "application/json",
        byteCount: new TextEncoder().encode(sourceText).byteLength,
        fingerprint: { algorithm: "sha256", digest },
        uri: `casys://agent-resource-capture/sha256/${digest}`,
      }),
    },
  })).state;
  for (const [index, target] of targets.entries()) {
    state =
      (await apply(state, attachmentCommand(state, `attachment-${index + 1}`, target)))
        .state;
  }
  return await Promise.all(
    targets.map((_, index) =>
      resolveProjectSourceClosure(state, {
        attachmentId: `attachment-${index + 1}`,
        attachmentRevision: 1,
      })
    ),
  );
}

function attachmentCommand(
  state: ProjectSourceWorkspaceState,
  attachmentId: string,
  target: {
    readonly elementId: string;
    readonly elementKind: "PartDefinition" | "PartUsage";
  },
) {
  return {
    projectId: PROJECT_ID,
    mutationId: attachmentId,
    expectedWorkspaceRevision: state.workspaceRevision,
    mutation: {
      kind: "attachment_put" as const,
      attachmentId,
      fileId: "file-mechanism",
      role: PRESCRIBED_KINEMATICS_SOURCE_ATTACHMENT_ROLE,
      target,
      declaredAgainst: {
        thread: { snapshotId: "thread-lamp", revision: 1, subjectId: "subject-lamp" },
        architecture: {
          artifactId: `architecture-${DIGEST}`,
          fingerprint: { algorithm: "sha256" as const, digest: DIGEST },
          captureSchema: "architecture-capture/4.0" as const,
        },
      },
    },
  };
}

function observationValue(
  caseFingerprint: { algorithm: "sha256"; digest: string },
  unresolvedResidual: boolean,
  method: unknown,
  sampleTimes = [0, 0.5, 1],
) {
  return {
    schemaVersion: "prescribed-kinematics-observation/1.0",
    operation: { id: "verify.run-prescribed-kinematics", version: "1" },
    caseFingerprint,
    method,
    samples: sampleTimes.map((timeS) => ({
      timeS,
      poses: ["body-base", "body-head"].map((bodyId) => ({
        bodyId,
        pose: { status: "observed", value: pose([0, 0, 0]) },
      })),
      jointAngles: [{
        jointId: "joint-arm",
        angleRad: { status: "observed", value: timeS === 1 ? 0.5 : 0 },
      }],
      jointResiduals: [{
        jointId: "joint-arm",
        translationResidualM: unresolvedResidual && timeS === 1
          ? { status: "unresolved", reason: "observability-missing" }
          : { status: "observed", value: [0.00001, 0, 0] },
        rotationQuaternionImagResidual: {
          status: "observed",
          value: [0.000001, 0, 0],
        },
      }],
    })),
    convergence: { status: "observed", value: "converged" },
    limits: {
      collision: "not_evaluated",
      contact: "not_evaluated",
      clearance: "not_evaluated",
      forces: "not_evaluated",
      strength: "not_evaluated",
      safety: "not_evaluated",
      manufacturability: "not_evaluated",
    },
  };
}

function assertThrowsType(action: () => unknown): void {
  try {
    action();
  } catch (error) {
    if (error instanceof TypeError) return;
    throw error;
  }
  throw new Error("Expected TypeError.");
}

async function apply(state: ProjectSourceWorkspaceState, command: unknown) {
  return await applyProjectSourceWorkspaceCommand(state, command);
}
