import { assertEquals } from "@std/assert";
import type { CrossDomainImpactBriefGateReader } from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type {
  CrossDomainImpactDecisionCaptureStore,
  CrossDomainImpactEvaluationCaptureStore,
} from "../../ports/out/impact/cross-domain-impact-capture-store.ts";
import type {
  CrossDomainImpactManifestReader,
  ReopenedCrossDomainImpactManifest,
} from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import type {
  MechanicalPreservationCloseoutFacts,
  MechanicalPreservationCloseoutReader,
} from "../../ports/out/impact/mechanical-preservation-closeout-reader.ts";
import {
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import {
  DESIGN_PREVIEW_GEOMETRY_OPERATION,
  DESIGN_WRITE_GEOMETRY_OPERATION,
} from "../../../domain/cad/canonical/geometry-proposal.ts";
import { DESIGN_EXECUTE_BUILD123D_OPERATION } from "../../../domain/cad/isolated/build123d-execution-proposal.ts";
import { createCrossDomainImpactManifest } from "../../../domain/impact/cross-domain-impact-manifest.ts";
import { DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION } from "../../../domain/fea/evaluation-closeout/static-mechanical-evaluation-closeout-proposal.ts";
import { VERIFY_SEAL_PROOF_CASE_OPERATION } from "../../../domain/fea/seal-case/fea-proof-proposal.ts";
import {
  CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  validateCrossDomainImpactDecisionAdmission,
} from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  type CrossDomainImpactDecisionCapture,
  validateCrossDomainImpactDecisionCapture,
} from "../../../domain/impact/cross-domain-impact-decision-capture.ts";
import { recrossCrossDomainImpactWorkItemClaims } from "../../../domain/impact/cross-domain-impact-decision.ts";
import {
  type CrossDomainImpactEvaluationCapture,
  crossDomainImpactEvaluationCaptureUri,
  validateCrossDomainImpactEvaluationCapture,
} from "../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import { evaluateCrossDomainImpact } from "../../../domain/impact/cross-domain-impact-evaluation.ts";
import { ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-evaluation-proposal.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  impactFingerprint,
  validCrossDomainImpactEvaluationInput,
  validCrossDomainImpactManifestBody,
} from "../../../testing/cross-domain-impact-fixtures.ts";
import {
  MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
  MECHANICAL_PRESERVATION_FEA_TOOL,
  MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL,
  validFeaEvidence,
} from "../../../testing/mechanical-preservation-fixtures.ts";
import { PrepareMechanicalPreservation } from "./prepare-mechanical-preservation.ts";

const AT = "2026-08-22T09:00:00.000Z";
const PROJECT = "project-led-1";
const SUBJECT = "subject-led-1";
const EVAL_RUN = "run-impact-evaluation";
const EVAL_WORK = "work-impact-evaluation";
const DECISION_RUN = "run-impact-decision";
const DECISION_WORK = "work-impact-decision";
const PRESERVATION_RUN = "run-mechanical-preservation";
const PRESERVATION_WORK = "work-mechanical-preservation";
const FEA_RUN = "run-fea-static-proof";
const FEA_WORK = "work-fea-static-proof";
const CLOSEOUT_RUN = "run-evaluation-closeout";
const CLOSEOUT_WORK = "work-evaluation-closeout";
const PROOF_RUN = "run-proof-seal";
const PROOF_WORK = "work-proof-seal";
const GEOMETRY_RUN = "run-geometry";
const GEOMETRY_WORK = "work-geometry";
const EXPORT_RUN = "run-build123d-export";
const GEOMETRY_DIGEST = impactFingerprint("d").digest;
const GEOMETRY_ID = `geometry-${GEOMETRY_DIGEST}`;
const CLOSEOUT_FINGERPRINT = impactFingerprint("3");
const CLOSEOUT_ID = `evaluation-closeout-${CLOSEOUT_FINGERPRINT.digest}`;

function canonicalStepArtifactId(stepDigest: string) {
  return `cad-asset-${GEOMETRY_DIGEST}-definition-0-0-${stepDigest}`;
}

Deno.test("X11 carries FEA forward only with exact current assertion, consumptions and accept closeout", async () => {
  const world = await worldFixture();
  const result = await world.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: world.head.id,
      revision: world.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });
  assertEquals(
    result.status,
    "resolved",
    result.status === "resolved" ? "" : JSON.stringify(result.diagnostics),
  );
  if (result.status !== "resolved") return;
  assertEquals(result.capture.preservation.status, "carried-forward");
  assertEquals(
    result.capture.preservation.feaEvidence?.execution.producer.tool,
    MECHANICAL_PRESERVATION_FEA_TOOL,
  );
  assertEquals(result.capture.limits.solverCalls, "none");
  assertEquals(result.capture.limits.newWorkItems, "none");
});

Deno.test("X11 stays impact-unresolved when a FEA input fingerprint is replaced", async () => {
  const world = await worldFixture();
  const replaced = { algorithm: "sha256" as const, digest: "f".repeat(64) };
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const mutated: ThreadSnapshot = {
    ...raw,
    artifacts: raw.artifacts.map((item) =>
      item.kind === "step" ? { ...item, fingerprint: replaced } : item
    ),
    consumptions: raw.consumptions.map((item) =>
      raw.artifacts.some((artifact) =>
          artifact.kind === "step" && artifact.id === item.artifactId
        )
        ? { ...item, observedFingerprint: replaced }
        : item
    ),
  };
  world.snapshots.set(mutated.id, mutated);
  const result = await world.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: world.head.id,
      revision: world.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.capture.preservation.status, "impact-unresolved");
});

Deno.test("X11 stays impact-unresolved for a wrong FEA producer or expired assertion", async () => {
  const wrongProducer = await worldFixture();
  const raw = JSON.parse(JSON.stringify(wrongProducer.head)) as ThreadSnapshot;
  const producer = {
    serverId: "digital-thread",
    tool: "simulate.run-admitted-modelica@1",
    runId: FEA_RUN,
  };
  const mutated: ThreadSnapshot = {
    ...raw,
    artifacts: raw.artifacts.map((item) =>
      item.producer.runId === FEA_RUN ? { ...item, producer } : item
    ),
    consumptions: raw.consumptions.map((item) =>
      item.consumer.runId === FEA_RUN ? { ...item, consumer: producer } : item
    ),
  };
  wrongProducer.snapshots.set(mutated.id, mutated);
  const wrong = await wrongProducer.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: wrongProducer.head.id,
      revision: wrongProducer.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });
  assertEquals(wrong.status, "resolved");
  if (wrong.status === "resolved") {
    assertEquals(wrong.capture.preservation.status, "impact-unresolved");
  }

  const expiredWorld = await worldFixture();
  const expired = await expiredWorld.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: expiredWorld.head.id,
      revision: expiredWorld.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: "2026-09-21T09:00:00.000Z",
  });
  assertEquals(expired.status, "resolved");
  if (expired.status === "resolved") {
    assertEquals(expired.capture.preservation.status, "impact-unresolved");
  }
});

Deno.test("X11 stays impact-unresolved when closeout JSON is valid but Thread consumptions are missing, mismatched, or extra", async () => {
  const missing = await worldFixture();
  rewriteCloseoutConsumptionIds(missing, (id) => `${id}-forged`);
  await assertNeverCarriedForward(await preserve(missing));

  const extra = await worldFixture();
  addExtraCloseoutConsumption(extra);
  await assertNeverCarriedForward(await preserve(extra));
});

Deno.test(
  "X11 stays impact-unresolved when an extra verified FEA producer consumption is omitted from the assertion",
  async () => {
    const world = await worldFixture();
    addExtraFeaProducerConsumption(world);
    await assertNeverCarriedForward(await preserve(world));
  },
);

Deno.test("X11 still carries forward when an unrelated accepted closeout names other execution evidence", async () => {
  const world = await worldFixture();
  addUnrelatedAcceptCloseout(world);
  const result = await preserve(world);
  assertEquals(
    result.status,
    "resolved",
    result.status === "resolved" ? "" : JSON.stringify(result.diagnostics),
  );
  if (result.status !== "resolved") return;
  assertEquals(result.capture.preservation.status, "carried-forward");
  assertEquals(
    result.capture.preservation.closeout?.artifact.id,
    CLOSEOUT_ID,
  );
});

Deno.test("X11 stays impact-unresolved when zero or multiple accepted closeouts name the asserted FEA execution", async () => {
  const multiple = await worldFixture();
  addMatchingAcceptCloseout(multiple);
  await assertNeverCarriedForward(await preserve(multiple));

  const none = await worldFixture();
  addUnrelatedAcceptCloseout(none);
  pruneCloseoutInputs(none);
  await assertNeverCarriedForward(await preserve(none));
});

Deno.test("X11 stays impact-unresolved when the STEP producer is isolated or preview rather than the canonical sandbox export", async () => {
  const isolated = await worldFixture();
  rebindCanonicalStepProducer(isolated, DESIGN_EXECUTE_BUILD123D_OPERATION);
  await assertNeverCarriedForward(await preserve(isolated));

  const preview = await worldFixture();
  rebindCanonicalStepProducer(preview, DESIGN_PREVIEW_GEOMETRY_OPERATION);
  await assertNeverCarriedForward(await preserve(preview));
});

Deno.test("X11 stays impact-unresolved when write-geometry attaches the STEP instead of the cad-model", async () => {
  const world = await worldFixture();
  attachGeometryEvidence(world, stepId(world));
  await assertNeverCarriedForward(await preserve(world));
});

Deno.test("X11 stays impact-unresolved when STEP ownership is ambiguous or tampered", async () => {
  const ambiguous = await worldFixture();
  addExtraStepTrace(ambiguous);
  await assertNeverCarriedForward(await preserve(ambiguous));

  const tampered = await worldFixture();
  retargetStepTrace(tampered);
  await assertNeverCarriedForward(await preserve(tampered));
});

Deno.test("X11 does not treat a sibling FEA evidence artifact as the closeout evaluationCapture", async () => {
  const world = await worldFixture();
  addSiblingFeaEvidence(world);
  const result = await preserve(world);
  assertEquals(result.status, "resolved");
  if (result.status !== "resolved") return;
  assertEquals(result.capture.preservation.status, "carried-forward");
  assertEquals(
    result.capture.preservation.feaEvidence?.l4Evaluation.id,
    "mechanical-l4-evaluation",
  );
});

Deno.test("X11 stays impact-unresolved for a nonexistent, foreign, or wrong-operation FEA or closeout run", async () => {
  const missingFea = await worldFixture();
  missingFea.project.agentRuns = missingFea.project.agentRuns.filter((item) =>
    item.id !== FEA_RUN
  );
  await assertNeverCarriedForward(await preserve(missingFea));

  const wrongFea = await worldFixture();
  const feaWork = wrongFea.project.workItems.find((item) => item.id === FEA_WORK)!;
  Object.assign(feaWork.operation!, { id: "simulate.run-admitted-modelica" });
  await assertNeverCarriedForward(await preserve(wrongFea));

  const missingCloseout = await worldFixture();
  missingCloseout.project.agentRuns = missingCloseout.project.agentRuns.filter(
    (item) => item.id !== CLOSEOUT_RUN,
  );
  await assertNeverCarriedForward(await preserve(missingCloseout));

  const missingGeometry = await worldFixture();
  missingGeometry.project.agentRuns = missingGeometry.project.agentRuns.filter(
    (item) => item.id !== GEOMETRY_RUN,
  );
  await assertNeverCarriedForward(await preserve(missingGeometry));

  const wrongGeometry = await worldFixture();
  const geometryWork = wrongGeometry.project.workItems.find((item) =>
    item.id === GEOMETRY_WORK
  )!;
  Object.assign(geometryWork.operation!, {
    id: DESIGN_EXECUTE_BUILD123D_OPERATION.id,
    version: DESIGN_EXECUTE_BUILD123D_OPERATION.version,
  });
  await assertNeverCarriedForward(await preserve(wrongGeometry));
});

Deno.test("X11 stays unresolved when X09, X08 or closeout artifact metadata or inputArtifactIds are tampered", async () => {
  const x09 = await worldFixture();
  tamperArtifact(
    x09,
    (item) =>
      item.producer.tool === "decide.accept-cross-domain-impact@2"
        ? { ...item, name: "Tampered impact decision", version: "tampered" }
        : item,
  );
  const x09Result = await preserve(x09);
  assertEquals(x09Result.status, "unresolved");

  const x08 = await worldFixture();
  tamperArtifact(
    x08,
    (item) =>
      item.producer.tool === "analyze.evaluate-cross-domain-impact@2"
        ? { ...item, uri: "casys://forged/sha256/00", version: "tampered" }
        : item,
  );
  const x08Result = await preserve(x08);
  assertEquals(x08Result.status, "unresolved");

  const closeout = await worldFixture();
  pruneCloseoutInputs(closeout);
  await assertNeverCarriedForward(await preserve(closeout));
});

Deno.test("X11 refuses an absent X09 decision and a mismatched Brief without inventing preservation", async () => {
  const missing = await worldFixture();
  missing.project.agentRuns = missing.project.agentRuns.filter((item) =>
    item.id !== DECISION_RUN
  );
  const absent = await missing.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: missing.head.id,
      revision: missing.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });
  assertEquals(absent.status, "unavailable");

  const briefWorld = await worldFixture();
  briefWorld.brief.brief.id = "other-brief";
  const mismatched = await briefWorld.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: briefWorld.head.id,
      revision: briefWorld.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });
  assertEquals(mismatched.status, "unresolved");
});

async function preserve(world: Awaited<ReturnType<typeof worldFixture>>) {
  return await world.useCase.execute({
    projectId: PROJECT,
    trustedRunId: PRESERVATION_RUN,
    basis: {
      kind: "thread-snapshot",
      snapshotId: world.head.id,
      revision: world.head.revision,
      subjectId: SUBJECT,
    },
    evaluatedAt: AT,
  });
}

function assertNeverCarriedForward(
  result: Awaited<ReturnType<typeof preserve>>,
) {
  if (result.status === "resolved") {
    assertEquals(result.capture.preservation.status, "impact-unresolved");
    return;
  }
  assertEquals(
    result.status === "unavailable" || result.status === "unresolved",
    true,
  );
}

function replaceHead(
  world: Awaited<ReturnType<typeof worldFixture>>,
  next: ThreadSnapshot,
) {
  world.snapshots.set(world.head.id, next);
  (world as { head: ThreadSnapshot }).head = next;
}

function rewriteCloseoutConsumptionIds(
  world: Awaited<ReturnType<typeof worldFixture>>,
  rewrite: (id: string) => string,
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const next: ThreadSnapshot = {
    ...raw,
    consumptions: raw.consumptions.map((item) =>
      item.consumer.runId === CLOSEOUT_RUN ? { ...item, id: rewrite(item.id) } : item
    ),
    provenance: raw.provenance.map((link) =>
      link.from.kind === "consumption" &&
        raw.consumptions.some((item) =>
          item.id === link.from.id && item.consumer.runId === CLOSEOUT_RUN
        )
        ? { ...link, from: { ...link.from, id: rewrite(link.from.id) } }
        : link
    ),
  };
  replaceHead(world, next);
}

function addExtraFeaProducerConsumption(
  world: Awaited<ReturnType<typeof worldFixture>>,
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const evidence = raw.artifacts.find((item) => item.id === "mechanical-fea-evidence")!;
  const extraId = "consume-manifest-seal-document-by-mechanical-fea-evidence-omitted";
  const next: ThreadSnapshot = {
    ...raw,
    consumptions: [
      ...raw.consumptions,
      {
        id: extraId,
        artifactId: "manifest-seal-document",
        consumer: evidence.producer,
        observedFingerprint:
          raw.artifacts.find((item) => item.id === "manifest-seal-document")!
            .fingerprint,
        verifiedAt: AT,
        status: "verified",
      },
    ],
    provenance: [
      ...raw.provenance,
      {
        id: `${extraId}-uses`,
        relation: "uses",
        from: { kind: "consumption", id: extraId },
        to: { kind: "artifact", id: "manifest-seal-document" },
        rationale: "Omitted extra consumption by the exact FEA evidence producer.",
      },
    ],
  };
  replaceHead(world, next);
}

function addExtraCloseoutConsumption(
  world: Awaited<ReturnType<typeof worldFixture>>,
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const closeout = raw.artifacts.find((item) => item.id === CLOSEOUT_ID)!;
  const extraId = `consume-manifest-seal-document-by-${CLOSEOUT_ID}-extra`;
  const next: ThreadSnapshot = {
    ...raw,
    consumptions: [
      ...raw.consumptions,
      {
        id: extraId,
        artifactId: "manifest-seal-document",
        consumer: closeout.producer,
        observedFingerprint:
          raw.artifacts.find((item) => item.id === "manifest-seal-document")!
            .fingerprint,
        verifiedAt: AT,
        status: "verified",
      },
    ],
    provenance: [
      ...raw.provenance,
      {
        id: `${extraId}-uses`,
        relation: "uses",
        from: { kind: "consumption", id: extraId },
        to: { kind: "artifact", id: "manifest-seal-document" },
        rationale: "Extra closeout consumption.",
      },
    ],
  };
  replaceHead(world, next);
}

function addUnrelatedAcceptCloseout(
  world: Awaited<ReturnType<typeof worldFixture>>,
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const unrelatedEvidence: ThreadArtifact = {
    id: "unrelated-mechanical-execution",
    name: "Unrelated mechanical execution evidence",
    kind: "evidence",
    version: "1",
    fingerprint: impactFingerprint("4"),
    producer: {
      serverId: "digital-thread",
      tool: MECHANICAL_PRESERVATION_FEA_TOOL,
      runId: "run-unrelated-fea",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  replaceHead(
    world,
    validateThreadSnapshot({
      ...raw,
      artifacts: [...raw.artifacts, unrelatedEvidence],
    }),
  );
  addAcceptCloseout(world, {
    id: "evaluation-closeout-unrelated",
    fingerprint: impactFingerprint("5"),
    runId: "run-unrelated-closeout",
    inputArtifactIds: [unrelatedEvidence.id],
  });
}

function addMatchingAcceptCloseout(
  world: Awaited<ReturnType<typeof worldFixture>>,
) {
  const closeout = world.head.artifacts.find((item) => item.id === CLOSEOUT_ID)!;
  addAcceptCloseout(world, {
    id: "evaluation-closeout-duplicate",
    fingerprint: impactFingerprint("6"),
    runId: "run-duplicate-closeout",
    inputArtifactIds: [...closeout.inputArtifactIds],
  });
}

function addAcceptCloseout(
  world: Awaited<ReturnType<typeof worldFixture>>,
  options: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
    readonly runId: string;
    readonly inputArtifactIds: readonly string[];
  },
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const producer = {
    serverId: "digital-thread",
    tool: MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
    runId: options.runId,
  };
  const byId = new Map(raw.artifacts.map((artifact) => [artifact.id, artifact]));
  const artifact: ThreadArtifact = {
    id: options.id,
    name: "Accepted static-mechanical evaluation closeout",
    kind: "document",
    version: options.fingerprint.digest,
    fingerprint: options.fingerprint,
    uri: `casys://evaluation-closeout-capture/sha256/${options.fingerprint.digest}`,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [...options.inputArtifactIds],
    freshness: fresh(),
  };
  const consumptions = options.inputArtifactIds.map((inputId) => ({
    id: `consume-${inputId}-by-${options.id}`,
    artifactId: inputId,
    consumer: producer,
    observedFingerprint: byId.get(inputId)!.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  }));
  const provenance = options.inputArtifactIds.flatMap((inputId) => [
    {
      id: `${options.id}-derived-from-${inputId}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: options.id },
      to: { kind: "artifact" as const, id: inputId },
      rationale: "Closeout input.",
    },
    {
      id: `consume-${inputId}-by-${options.id}-uses`,
      relation: "uses" as const,
      from: {
        kind: "consumption" as const,
        id: `consume-${inputId}-by-${options.id}`,
      },
      to: { kind: "artifact" as const, id: inputId },
      rationale: "Verified closeout input.",
    },
  ]);
  replaceHead(
    world,
    validateThreadSnapshot({
      ...raw,
      artifacts: [...raw.artifacts, artifact],
      consumptions: [...raw.consumptions, ...consumptions],
      provenance: [...raw.provenance, ...provenance],
    }),
  );
}

function rebindCanonicalStepProducer(
  world: Awaited<ReturnType<typeof worldFixture>>,
  operation: { readonly id: string; readonly version: string },
) {
  const tool = `${operation.id}@${operation.version}`;
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  replaceHead(
    world,
    validateThreadSnapshot({
      ...raw,
      artifacts: raw.artifacts.map((item) =>
        item.kind === "step"
          ? {
            ...item,
            producer: {
              serverId: "digital-thread",
              tool,
              runId: item.producer.runId,
            },
          }
          : item
      ),
    }),
  );
}

function attachGeometryEvidence(
  world: Awaited<ReturnType<typeof worldFixture>>,
  artifactId: string,
) {
  const work = world.project.workItems.find((item) => item.id === GEOMETRY_WORK)!;
  const run = world.project.agentRuns.find((item) => item.id === GEOMETRY_RUN)!;
  Object.assign(work, {
    evidenceRefs: work.evidenceRefs.map((reference) => ({
      ...reference,
      id: artifactId,
    })),
  });
  Object.assign(run, {
    evidenceRefs: run.evidenceRefs.map((reference) => ({
      ...reference,
      id: artifactId,
    })),
  });
}

function addExtraStepTrace(world: Awaited<ReturnType<typeof worldFixture>>) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const step = raw.artifacts.find((item) => item.kind === "step")!;
  replaceHead(
    world,
    validateThreadSnapshot({
      ...raw,
      provenance: [
        ...raw.provenance,
        {
          id: `traces-${step.id}-from-decoy`,
          relation: "traces_to",
          from: { kind: "artifact", id: step.id },
          to: { kind: "artifact", id: GEOMETRY_ID },
          rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
        },
      ],
    }),
  );
}

function retargetStepTrace(world: Awaited<ReturnType<typeof worldFixture>>) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const step = raw.artifacts.find((item) => item.kind === "step")!;
  const decoyDigest = "e".repeat(64);
  const decoyId = `geometry-${decoyDigest}`;
  const decoy: ThreadArtifact = {
    id: decoyId,
    name: "Decoy geometry capture",
    kind: "cad-model",
    version: decoyDigest,
    fingerprint: { algorithm: "sha256", digest: decoyDigest },
    uri: `casys://geometry-capture/sha256/${decoyDigest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
      runId: "run-decoy-geometry",
    },
    inputArtifactIds: [],
    freshness: fresh(),
  };
  replaceHead(
    world,
    validateThreadSnapshot({
      ...raw,
      artifacts: [...raw.artifacts, decoy],
      provenance: raw.provenance.map((link) =>
        link.id === `traces-${step.id}-from-${GEOMETRY_ID}`
          ? {
            ...link,
            id: `traces-${step.id}-from-${decoyId}`,
            to: { kind: "artifact" as const, id: decoyId },
          }
          : link
      ),
    }),
  );
}

function stepId(world: Awaited<ReturnType<typeof worldFixture>>) {
  return world.head.artifacts.find((item) => item.kind === "step")!.id;
}

function addSiblingFeaEvidence(
  world: Awaited<ReturnType<typeof worldFixture>>,
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const l4 = raw.artifacts.find((item) => item.id === "mechanical-l4-evaluation")!;
  const next: ThreadSnapshot = {
    ...raw,
    artifacts: [
      ...raw.artifacts,
      {
        id: "mechanical-sibling-evidence",
        name: "Sibling isolated CalculiX evidence",
        kind: "evidence",
        version: "1",
        fingerprint: impactFingerprint("e"),
        producer: l4.producer,
        inputArtifactIds: [],
        freshness: fresh(),
      },
    ],
  };
  replaceHead(world, next);
}

function pruneCloseoutInputs(
  world: Awaited<ReturnType<typeof worldFixture>>,
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  const closeout = raw.artifacts.find((item) => item.id === CLOSEOUT_ID)!;
  const kept = closeout.inputArtifactIds[0]!;
  const dropped = new Set(closeout.inputArtifactIds.filter((id) => id !== kept));
  const next: ThreadSnapshot = {
    ...raw,
    artifacts: raw.artifacts.map((item) =>
      item.id === CLOSEOUT_ID ? { ...item, inputArtifactIds: [kept] } : item
    ),
    consumptions: raw.consumptions.filter((item) =>
      item.consumer.runId !== CLOSEOUT_RUN || item.artifactId === kept
    ),
    provenance: raw.provenance.filter((link) => {
      if (
        link.relation === "derived_from" &&
        link.from.kind === "artifact" &&
        link.from.id === CLOSEOUT_ID &&
        link.to.kind === "artifact" &&
        dropped.has(link.to.id)
      ) return false;
      if (
        link.relation === "uses" &&
        link.from.kind === "consumption" &&
        raw.consumptions.some((item) =>
          item.id === link.from.id &&
          item.consumer.runId === CLOSEOUT_RUN &&
          dropped.has(item.artifactId)
        )
      ) return false;
      return true;
    }),
  };
  replaceHead(world, next);
}

function tamperArtifact(
  world: Awaited<ReturnType<typeof worldFixture>>,
  rewrite: (
    artifact: ThreadSnapshot["artifacts"][number],
  ) => ThreadSnapshot["artifacts"][number],
) {
  const raw = JSON.parse(JSON.stringify(world.head)) as ThreadSnapshot;
  replaceHead(world, {
    ...raw,
    artifacts: raw.artifacts.map(rewrite),
  });
}

async function preservationEvaluationInput() {
  const body = validCrossDomainImpactManifestBody();
  const evidence = body.independenceAssertions[0]!.evidence;
  const step = body.independenceAssertions[0]!.inspectedConsumptions[0]!;
  const sealedProofId = "mechanical-sealed-proof";
  const l4Id = "mechanical-l4-evaluation";
  body.independenceAssertions = body.independenceAssertions.map((assertion) => ({
    ...assertion,
    inspectedConsumptions: [
      {
        ...step,
        input: {
          ...step.input,
          id: canonicalStepArtifactId(step.input.fingerprint.digest),
        },
      },
      {
        id: `consume-${sealedProofId}-by-${evidence.id}`,
        input: { id: sealedProofId, fingerprint: impactFingerprint("1") },
      },
      {
        id: `consume-${evidence.id}-by-${l4Id}`,
        input: { id: evidence.id, fingerprint: evidence.fingerprint },
      },
    ],
  }));
  const manifest = await createCrossDomainImpactManifest(body);
  const assertion = manifest.independenceAssertions[0]!;
  const input = await validCrossDomainImpactEvaluationInput();
  return {
    ...input,
    manifest,
    project: manifest.project,
    subject: manifest.subject,
    basis: manifest.basis,
    mechanicalEvidence: {
      evidence: assertion.evidence,
      consumptions: assertion.inspectedConsumptions.map((item) => ({
        id: item.id,
        consumerEvidence: assertion.evidence,
        input: item.input,
      })),
    },
  };
}

async function worldFixture(): Promise<{
  readonly useCase: PrepareMechanicalPreservation;
  readonly project: MutableProject;
  readonly head: ThreadSnapshot;
  readonly snapshots: Map<string, ThreadSnapshot>;
  readonly brief: {
    contractVersion: "2.0";
    projectId: string;
    brief: { id: string; revision: number; fingerprint: ContentFingerprint };
    gates: Array<{
      id: string;
      kind: "success-criterion" | "verification-activity";
      fingerprint: ContentFingerprint;
      dependsOnItemIds: readonly string[];
    }>;
  };
}> {
  const evaluationInput = await preservationEvaluationInput();
  const evaluation = await evaluateCrossDomainImpact(evaluationInput);
  const fea = validFeaEvidence(evaluation);
  const evaluationCapture = await evaluationCaptureFixture(evaluationInput, evaluation);
  const evaluationFingerprint = await sha256Fingerprint(evaluationCapture);
  const evaluationId = `cross-domain-impact-evaluation-${evaluationFingerprint.digest}`;
  const r1 = rootSnapshot(evaluationCapture, fea);
  const r2 = evaluationSnapshot(
    r1,
    evaluationCapture,
    evaluationFingerprint,
    evaluationId,
  );
  const decisionCapture = await decisionCaptureFixture(
    evaluationCapture,
    evaluationFingerprint,
    evaluationId,
    r2,
  );
  const decisionFingerprint = await sha256Fingerprint(decisionCapture);
  const r3 = decisionSnapshot(r2, decisionCapture, decisionFingerprint);
  const project = projectFixture(
    r2,
    r3,
    evaluationId,
    decisionFingerprint,
    fea,
  );
  const brief = {
    contractVersion: "2.0" as const,
    projectId: PROJECT,
    brief: {
      id: evaluationCapture.brief.id,
      revision: evaluationCapture.brief.revision,
      fingerprint: evaluationCapture.brief.fingerprint,
    },
    gates: evaluationCapture.brief.gates.map((gate) => ({
      id: gate.gateItemId,
      kind: gate.kind,
      fingerprint: gate.fingerprint,
      dependsOnItemIds: gate.dependsOnItemIds,
    })),
  };
  const snapshots = new Map<string, ThreadSnapshot>([
    [r1.id, r1],
    [r2.id, r2],
    [r3.id, r3],
  ]);
  const evaluationCaptures = new MemoryEvaluationCaptures();
  evaluationCaptures.items.set(evaluationFingerprint.digest, evaluationCapture);
  const decisionCaptures = new MemoryDecisionCaptures();
  decisionCaptures.items.set(decisionFingerprint.digest, decisionCapture);
  const manifests: CrossDomainImpactManifestReader = {
    read: (reference) => {
      if (
        reference.fingerprint.digest !== evaluationCapture.manifest.reference.digest
      ) {
        return Promise.resolve(undefined);
      }
      const reopened: ReopenedCrossDomainImpactManifest = {
        reference,
        uri:
          `casys://cross-domain-impact-manifest/sha256/${reference.fingerprint.digest}`,
        manifest: evaluationInput.manifest,
      };
      return Promise.resolve(reopened);
    },
  };
  const briefGates: CrossDomainImpactBriefGateReader = {
    read: () => Promise.resolve(brief),
  };
  const closeouts: MechanicalPreservationCloseoutReader = {
    read: (fingerprint) => {
      if (fingerprint.digest !== CLOSEOUT_FINGERPRINT.digest) {
        return Promise.resolve(undefined);
      }
      const facts: MechanicalPreservationCloseoutFacts = {
        operation: {
          id: DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.id,
          version: DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION.version,
        },
        trustedRunId: CLOSEOUT_RUN,
        sealedAt: AT,
        consequence: "accept",
        inputs: {
          canonicalStep: {
            id: fea.canonicalStep.id,
            fingerprint: fea.canonicalStep.fingerprint,
            producerRunId: EXPORT_RUN,
          },
          sealedProof: {
            id: fea.sealedProof.id,
            fingerprint: fea.sealedProof.fingerprint,
            producerRunId: PROOF_RUN,
          },
          executionEvidence: {
            id: fea.execution.id,
            fingerprint: fea.execution.fingerprint,
            producerRunId: FEA_RUN,
          },
          evaluationCapture: {
            id: fea.l4Evaluation.id,
            fingerprint: fea.l4Evaluation.fingerprint,
            producerRunId: FEA_RUN,
          },
        },
      };
      return Promise.resolve(facts);
    },
  };
  return {
    useCase: new PrepareMechanicalPreservation({
      projects: { get: () => Promise.resolve(project) },
      snapshots: {
        get: (id) => {
          const value = snapshots.get(id);
          return Promise.resolve(value && structuredClone(value));
        },
      },
      manifests,
      evaluationCaptures,
      decisionCaptures,
      briefGates,
      closeouts,
    }),
    project,
    head: r3,
    snapshots,
    brief,
  };
}

async function evaluationCaptureFixture(
  evaluationInput: Awaited<ReturnType<typeof validCrossDomainImpactEvaluationInput>>,
  evaluation: Awaited<ReturnType<typeof evaluateCrossDomainImpact>>,
): Promise<CrossDomainImpactEvaluationCapture> {
  const branchFacts = evaluationInput.branchReadiness.map((branch) => ({
    branchId: branch.branchId,
    method: {
      reference: branch.method.reference,
      availability: "available" as const,
    },
    joins: branch.joins.map((join) => ({
      reference: join.reference,
      currentness: "current" as const,
    })),
  }));
  const mechanicalEvidence = evaluationInput.mechanicalEvidence!;
  const mechanicalFact = {
    status: "current" as const,
    assertionId: evaluationInput.manifest.independenceAssertions[0]!.id,
    reviewTrigger: evaluationInput.reviewTrigger,
    evidence: mechanicalEvidence.evidence,
    evidenceFreshness: "fresh" as const,
    consumptions: mechanicalEvidence.consumptions,
  };
  const artifactInputs = uniqueReferences([
    { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
    ...branchFacts.flatMap((branch) => [
      branch.method.reference,
      ...branch.joins.map((join) => join.reference),
    ]),
    mechanicalEvidence.evidence,
    ...mechanicalEvidence.consumptions.map((item) => item.input),
  ]).sort((left, right) =>
    `${left.id}:${left.fingerprint.digest}`.localeCompare(
      `${right.id}:${right.fingerprint.digest}`,
    )
  );
  return await validateCrossDomainImpactEvaluationCapture({
    schemaVersion: "cross-domain-impact-evaluation-capture/2.0",
    kind: "cross-domain-impact-evaluation",
    operation: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: EVAL_RUN,
    evaluatedAt: AT,
    manifestSeal: {
      artifact: { id: "manifest-seal-document", fingerprint: impactFingerprint("9") },
      trustedRunId: "run-manifest-seal",
    },
    artifactInputs,
    manifest: {
      id: evaluation.manifest.id,
      fingerprint: evaluation.manifest.fingerprint,
      reference: impactFingerprint("8"),
    },
    brief: {
      id: "brief-impact-evaluation",
      revision: 2,
      fingerprint: impactFingerprint("7"),
      gates: evaluation.gateClaims.map((claim, index) => ({
        gateItemId: claim.gateItemId,
        kind: "success-criterion" as const,
        branchId: claim.branchId,
        role: claim.role,
        fingerprint: impactFingerprint(String(index + 1)),
        dependsOnItemIds: [],
      })).sort((left, right) => left.gateItemId.localeCompare(right.gateItemId)),
    },
    branchFacts,
    mechanicalFact,
    evaluation,
    limits: {
      providerCalls: "none",
      solverCalls: "none",
      gateClaimTransitions: "none",
      workItemInvalidations: "none",
      rerunProposals: "none",
    },
  });
}

async function decisionCaptureFixture(
  evaluationCapture: CrossDomainImpactEvaluationCapture,
  evaluationFingerprint: ContentFingerprint,
  evaluationId: string,
  basis: ThreadSnapshot,
): Promise<CrossDomainImpactDecisionCapture> {
  const workItems = [
    workItem("work-electrical", "gate-electrical", "satisfies"),
    workItem("work-thermal", "gate-thermal", "contributes-to"),
    workItem("work-mechanical", "gate-mechanical", "satisfies"),
  ];
  const workItemClaims = recrossCrossDomainImpactWorkItemClaims(
    workItems,
    evaluationCapture.evaluation.gateClaims.map((claim) => ({
      gateItemId: claim.gateItemId,
      role: claim.role,
      status: claim.status,
    })),
  );
  const snapshotFingerprint = await sha256Fingerprint(basis);
  const admission = validateCrossDomainImpactDecisionAdmission({
    schemaVersion: "cross-domain-impact-decision-admission/2.0",
    consequence: "accept",
    projectId: PROJECT,
    subjectId: SUBJECT,
    basis: {
      snapshotId: basis.id,
      revision: basis.revision,
      fingerprint: snapshotFingerprint,
    },
    brief: {
      id: evaluationCapture.brief.id,
      revision: evaluationCapture.brief.revision,
      fingerprint: evaluationCapture.brief.fingerprint,
    },
    evaluation: {
      capture: { id: evaluationId, fingerprint: evaluationFingerprint },
      trustedRunId: EVAL_RUN,
    },
    manifestSeal: evaluationCapture.manifestSeal.artifact,
    workItemClaims,
    limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  });
  return validateCrossDomainImpactDecisionCapture({
    schemaVersion: "cross-domain-impact-decision-capture/2.0",
    kind: "cross-domain-impact-decision",
    operation: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION,
    trustedRunId: DECISION_RUN,
    decisionId: "decision-impact-decision",
    sealedAt: AT,
    admission,
    evaluationCapture: {
      id: evaluationId,
      fingerprint: evaluationFingerprint,
      uri: crossDomainImpactEvaluationCaptureUri(evaluationFingerprint.digest),
    },
    limits: CROSS_DOMAIN_IMPACT_DECISION_LIMITS,
  });
}

function uniqueReferences<
  T extends {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  },
>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const key = `${item.id}:${item.fingerprint.algorithm}:${item.fingerprint.digest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function pushUniqueArtifact(
  artifacts: ThreadArtifact[],
  artifact: ThreadArtifact,
) {
  if (artifacts.some((item) => item.id === artifact.id)) return;
  artifacts.push(artifact);
}

function rootSnapshot(
  capture: CrossDomainImpactEvaluationCapture,
  fea: ReturnType<typeof validFeaEvidence>,
): ThreadSnapshot {
  const sealedProof: ThreadArtifact = {
    id: fea.sealedProof.id,
    name: "Sealed mechanical proof",
    kind: "document",
    version: "1",
    fingerprint: fea.sealedProof.fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: MECHANICAL_PRESERVATION_PROOF_SEAL_TOOL,
      runId: "run-proof-seal",
    },
    inputArtifactIds: [fea.canonicalStep.id],
    freshness: fresh(),
  };
  const l4Evaluation: ThreadArtifact = {
    id: fea.l4Evaluation.id,
    name: "SysON evaluation of isolated CalculiX evidence",
    kind: "evidence",
    version: "1",
    fingerprint: fea.l4Evaluation.fingerprint,
    producer: {
      serverId: "digital-thread",
      tool: MECHANICAL_PRESERVATION_FEA_TOOL,
      runId: FEA_RUN,
    },
    inputArtifactIds: ["mechanical-fea-evidence"],
    freshness: fresh(),
  };
  const artifacts: ThreadArtifact[] = capture.artifactInputs.map((input) => {
    if (input.id === "mechanical-fea-evidence") {
      return {
        id: input.id,
        name: "Isolated local CalculiX execution evidence",
        kind: "evidence" as const,
        version: "1",
        fingerprint: input.fingerprint,
        producer: {
          serverId: "digital-thread",
          tool: MECHANICAL_PRESERVATION_FEA_TOOL,
          runId: FEA_RUN,
        },
        inputArtifactIds: [fea.sealedProof.id, fea.canonicalStep.id],
        freshness: fresh(),
      };
    }
    if (input.id === fea.canonicalStep.id) {
      return {
        id: input.id,
        name: "Authoritative STEP",
        kind: "step" as const,
        version: input.fingerprint.digest,
        fingerprint: input.fingerprint,
        uri: `/api/thread/assets/${input.fingerprint.digest}.step`,
        mediaType: "model/step",
        producer: {
          serverId: "build123d-sandbox",
          tool: "build123d_export",
          runId: EXPORT_RUN,
        },
        inputArtifactIds: [],
        freshness: fresh(),
      };
    }
    if (input.id === sealedProof.id) return sealedProof;
    if (input.id === l4Evaluation.id) return l4Evaluation;
    return {
      id: input.id,
      name: input.id,
      kind: "document" as const,
      version: "1",
      fingerprint: input.fingerprint,
      producer: {
        serverId: "digital-thread",
        tool: input.id === "manifest-seal-document"
          ? "verify.seal-cross-domain-impact-manifest@2"
          : "recorded-test@1",
        runId: input.id === "manifest-seal-document"
          ? "run-manifest-seal"
          : `run-${input.id}`,
      },
      inputArtifactIds: [],
      freshness: fresh(),
    };
  });
  pushUniqueArtifact(artifacts, {
    id: GEOMETRY_ID,
    name: "Canonical geometry capture",
    kind: "cad-model",
    version: GEOMETRY_DIGEST,
    fingerprint: { algorithm: "sha256", digest: GEOMETRY_DIGEST },
    uri: `casys://geometry-capture/sha256/${GEOMETRY_DIGEST}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
      runId: GEOMETRY_RUN,
    },
    inputArtifactIds: [],
    freshness: fresh(),
  });
  pushUniqueArtifact(artifacts, sealedProof);
  pushUniqueArtifact(artifacts, l4Evaluation);
  artifacts.push({
    id: CLOSEOUT_ID,
    name: "Accepted static-mechanical evaluation closeout",
    kind: "document",
    version: CLOSEOUT_FINGERPRINT.digest,
    fingerprint: CLOSEOUT_FINGERPRINT,
    uri: `casys://evaluation-closeout-capture/sha256/${CLOSEOUT_FINGERPRINT.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: MECHANICAL_PRESERVATION_CLOSEOUT_ACCEPT_TOOL,
      runId: CLOSEOUT_RUN,
    },
    inputArtifactIds: [
      fea.canonicalStep.id,
      fea.sealedProof.id,
      fea.execution.id,
      fea.l4Evaluation.id,
    ],
    freshness: fresh(),
  });
  const seal = artifacts.find((artifact) => artifact.id === "manifest-seal-document")!;
  const evidence = artifacts.find((artifact) =>
    artifact.id === "mechanical-fea-evidence"
  )!;
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const consumptions: ThreadSnapshot["consumptions"][number][] = [];
  const provenance: ThreadProvenanceLink[] = [{
    id: "provenance-change-manifest-seal",
    relation: "changes",
    from: { kind: "change", id: "change-manifest-seal" },
    to: { kind: "artifact", id: seal.id },
    rationale: "Manifest seal document.",
  }];
  for (const artifact of artifacts) {
    for (const inputId of artifact.inputArtifactIds) {
      const input = byId.get(inputId)!;
      const consumptionId =
        artifact.id === evidence.id && inputId === fea.canonicalStep.id
          ? "mechanical-consumption-step"
          : `consume-${inputId}-by-${artifact.id}`;
      consumptions.push({
        id: consumptionId,
        artifactId: inputId,
        consumer: artifact.producer,
        observedFingerprint: input.fingerprint,
        verifiedAt: AT,
        status: "verified" as const,
      });
      provenance.push({
        id: `${artifact.id}-derived-from-${inputId}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: inputId },
        rationale: "Exact inspected FEA input.",
      });
      provenance.push({
        id: `${consumptionId}-uses`,
        relation: "uses",
        from: { kind: "consumption", id: consumptionId },
        to: { kind: "artifact", id: inputId },
        rationale: "Verified consumer fingerprint.",
      });
    }
  }
  const geometry = artifacts.find((artifact) => artifact.id === GEOMETRY_ID)!;
  const step = artifacts.find((artifact) => artifact.id === fea.canonicalStep.id)!;
  const binaryConsumptionId = `consume-${geometry.id}-by-${step.id}`;
  consumptions.push({
    id: binaryConsumptionId,
    artifactId: geometry.id,
    consumer: geometry.producer,
    observedFingerprint: geometry.fingerprint,
    verifiedAt: AT,
    status: "verified",
  });
  provenance.push({
    id: `traces-${step.id}-from-${geometry.id}`,
    relation: "traces_to",
    from: { kind: "artifact", id: step.id },
    to: { kind: "artifact", id: geometry.id },
    rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
  });
  provenance.push({
    id: `uses-${binaryConsumptionId}`,
    relation: "uses",
    from: { kind: "consumption", id: binaryConsumptionId },
    to: { kind: "artifact", id: geometry.id },
    rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  });
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: "thread-preservation-r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: SUBJECT,
      name: "Preservation subject",
      kind: "system",
      version: "r1",
      modelArtifactId: seal.id,
    },
    freshness: fresh(),
    changeSet: {
      id: "changes-preservation-r1",
      name: "FEA and manifest seal",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [{
        id: "change-manifest-seal",
        kind: "created",
        target: { kind: "artifact", id: seal.id },
        summary: "Manifest seal document.",
        afterFingerprint: seal.fingerprint,
      }],
    },
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance,
    proposedActions: [],
  });
}

function evaluationSnapshot(
  previous: ThreadSnapshot,
  capture: CrossDomainImpactEvaluationCapture,
  fingerprint: ContentFingerprint,
  evaluationId: string,
): ThreadSnapshot {
  const producer = {
    serverId: "digital-thread",
    tool: "analyze.evaluate-cross-domain-impact@2",
    runId: EVAL_RUN,
  } as const;
  const artifact: ThreadArtifact = {
    id: evaluationId,
    name: "Cross-domain impact evaluation",
    kind: "document",
    version: fingerprint.digest,
    fingerprint,
    uri: crossDomainImpactEvaluationCaptureUri(fingerprint.digest),
    mediaType: "application/json",
    producer,
    inputArtifactIds: capture.artifactInputs.map((item) => item.id),
    freshness: fresh(),
  };
  const consumptions = capture.artifactInputs.map((upstream) => ({
    id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:consume:${upstream.id}`,
    artifactId: upstream.id,
    consumer: producer,
    observedFingerprint: upstream.fingerprint,
    verifiedAt: AT,
    status: "verified" as const,
  }));
  const applied = applyThreadSnapshotExtensionIfNew(previous, {
    id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}`,
    name: "Capture impact evaluation",
    subjectId: previous.subject.id,
    capturedAt: AT,
    artifacts: [artifact],
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: capture.artifactInputs.flatMap((upstream) => [
      {
        id:
          `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:derived-from:${upstream.id}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifact.id },
        to: { kind: "artifact" as const, id: upstream.id },
        rationale: "Evaluation reread.",
      },
      {
        id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:uses:${upstream.id}`,
        relation: "uses" as const,
        from: {
          kind: "consumption" as const,
          id: `analyze-evaluate-cross-domain-impact-${EVAL_RUN}:consume:${upstream.id}`,
        },
        to: { kind: "artifact" as const, id: upstream.id },
        rationale: "Verified evaluation input.",
      },
    ]),
    proposedActions: [],
  }, { appliedAt: AT });
  return validateThreadSnapshot(applied.snapshot);
}

function decisionSnapshot(
  previous: ThreadSnapshot,
  capture: CrossDomainImpactDecisionCapture,
  fingerprint: ContentFingerprint,
): ThreadSnapshot {
  const producer = {
    serverId: "digital-thread",
    tool: "decide.accept-cross-domain-impact@2",
    runId: DECISION_RUN,
  } as const;
  const artifact: ThreadArtifact = {
    id: `cross-domain-impact-decision-${fingerprint.digest}`,
    name: "Cross-domain impact decision",
    kind: "document",
    version: fingerprint.digest,
    fingerprint,
    uri: `casys://cross-domain-impact-decision-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer,
    inputArtifactIds: [capture.evaluationCapture.id],
    freshness: fresh(),
  };
  const consumptionId =
    `decide-accept-cross-domain-impact-${DECISION_RUN}:consume:${capture.evaluationCapture.id}`;
  const applied = applyThreadSnapshotExtensionIfNew(previous, {
    id: `decide-accept-cross-domain-impact-${DECISION_RUN}`,
    name: "Accept impact decision",
    subjectId: previous.subject.id,
    capturedAt: AT,
    artifacts: [artifact],
    consumptions: [{
      id: consumptionId,
      artifactId: capture.evaluationCapture.id,
      consumer: producer,
      observedFingerprint: capture.evaluationCapture.fingerprint,
      verifiedAt: AT,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id:
          `decide-accept-cross-domain-impact-${DECISION_RUN}:derived-from:${capture.evaluationCapture.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: capture.evaluationCapture.id },
        rationale: "Decision reread.",
      },
      {
        id:
          `decide-accept-cross-domain-impact-${DECISION_RUN}:uses:${capture.evaluationCapture.id}`,
        relation: "uses",
        from: { kind: "consumption", id: consumptionId },
        to: { kind: "artifact", id: capture.evaluationCapture.id },
        rationale: "Verified evaluation document.",
      },
    ],
    proposedActions: [],
  }, { appliedAt: AT });
  return validateThreadSnapshot(applied.snapshot);
}

function projectFixture(
  evaluationBasis: ThreadSnapshot,
  head: ThreadSnapshot,
  evaluationId: string,
  decisionFingerprint: ContentFingerprint,
  fea: ReturnType<typeof validFeaEvidence>,
): MutableProject {
  const decisionId = `cross-domain-impact-decision-${decisionFingerprint.digest}`;
  const r1 = {
    snapshotId: evaluationBasis.previous!.snapshotId,
    revision: evaluationBasis.previous!.revision,
    subjectId: SUBJECT,
  };
  const evalOp = {
    id: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: ANALYZE_EVALUATE_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  const decisionOp = {
    id: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id,
    version: DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version,
    bindings: [{ name: "approvedBrief", source: { kind: "approved-brief" as const } }],
  };
  return {
    schemaVersion: "4.0",
    id: "project-preservation-r1",
    revision: 3,
    generatedAt: AT,
    project: {
      id: PROJECT,
      name: "Preservation project",
      subjectId: SUBJECT,
      objective: { title: "Preserve", statement: "Preserve mechanics." },
    },
    threadSnapshots: [
      {
        snapshotId: evaluationBasis.previous?.snapshotId ?? "thread-preservation-r1",
        revision: 1,
        subjectId: SUBJECT,
      },
      {
        snapshotId: evaluationBasis.id,
        revision: evaluationBasis.revision,
        subjectId: SUBJECT,
      },
      { snapshotId: head.id, revision: head.revision, subjectId: SUBJECT },
    ],
    phases: [{
      id: "phase-preservation",
      name: "Impact",
      order: 1,
      description: "Preserve",
      workItemIds: [
        EVAL_WORK,
        DECISION_WORK,
        PRESERVATION_WORK,
        "work-mechanical",
        FEA_WORK,
        CLOSEOUT_WORK,
        PROOF_WORK,
        GEOMETRY_WORK,
      ],
      requiredDecisionIds: [],
      evidenceRefs: [{
        snapshotId: head.id,
        snapshotRevision: head.revision,
        kind: "artifact",
        id: decisionId,
      }],
    }],
    workItems: [
      {
        id: EVAL_WORK,
        activityId: `activity:${EVAL_WORK}`,
        phaseId: "phase-preservation",
        title: "Evaluate",
        description: "Evaluate",
        kind: "review",
        operation: evalOp,
        status: "completed",
        owner: "agent",
        dependsOnWorkItemIds: [],
        evidenceRefs: [{
          snapshotId: evaluationBasis.id,
          snapshotRevision: evaluationBasis.revision,
          kind: "artifact",
          id: evaluationId,
        }],
        decisionIds: [],
        blockerIds: [],
      },
      {
        id: DECISION_WORK,
        activityId: `activity:${DECISION_WORK}`,
        phaseId: "phase-preservation",
        title: "Decide",
        description: "Decide",
        kind: "review",
        operation: decisionOp,
        status: "completed",
        owner: "human",
        dependsOnWorkItemIds: [EVAL_WORK],
        evidenceRefs: [{
          snapshotId: head.id,
          snapshotRevision: head.revision,
          kind: "artifact",
          id: decisionId,
        }],
        decisionIds: [],
        blockerIds: [],
      },
      {
        id: PRESERVATION_WORK,
        activityId: `activity:${PRESERVATION_WORK}`,
        phaseId: "phase-preservation",
        title: "Preserve",
        description: "Preserve",
        kind: "review" as const,
        operation: {
          id: "analyze.evaluate-mechanical-preservation",
          version: "2",
          bindings: [{
            name: "approvedBrief",
            source: { kind: "approved-brief" as const },
          }],
        },
        status: "in-progress" as const,
        owner: "agent" as const,
        dependsOnWorkItemIds: [DECISION_WORK],
        evidenceRefs: [],
        decisionIds: [],
        blockerIds: [],
      },
      workItem("work-mechanical", "gate-mechanical", "satisfies"),
      producerWork(
        FEA_WORK,
        { id: "verify.run-fea-static-proof", version: "3" },
        r1,
        [fea.execution.id, fea.l4Evaluation.id],
      ),
      producerWork(
        CLOSEOUT_WORK,
        DECIDE_ACCEPT_EVALUATION_CLOSEOUT_OPERATION,
        r1,
        [CLOSEOUT_ID],
      ),
      producerWork(
        PROOF_WORK,
        VERIFY_SEAL_PROOF_CASE_OPERATION,
        r1,
        [fea.sealedProof.id],
      ),
      producerWork(
        GEOMETRY_WORK,
        DESIGN_WRITE_GEOMETRY_OPERATION,
        r1,
        [GEOMETRY_ID],
      ),
    ],
    agentRuns: [
      {
        id: EVAL_RUN,
        workItemId: EVAL_WORK,
        status: "completed",
        summary: "Evaluated",
        queuedAt: AT,
        startedAt: AT,
        completedAt: AT,
        basis: {
          kind: "thread-snapshot" as const,
          snapshotId: evaluationBasis.previous!.snapshotId,
          revision: evaluationBasis.previous!.revision,
          subjectId: SUBJECT,
        },
        resultSnapshot: {
          snapshotId: evaluationBasis.id,
          revision: evaluationBasis.revision,
          subjectId: SUBJECT,
        },
        evidenceRefs: [{
          snapshotId: evaluationBasis.id,
          snapshotRevision: evaluationBasis.revision,
          kind: "artifact",
          id: evaluationId,
        }],
      },
      {
        id: DECISION_RUN,
        workItemId: DECISION_WORK,
        status: "completed",
        summary: "Decided",
        queuedAt: AT,
        startedAt: AT,
        completedAt: AT,
        basis: {
          kind: "thread-snapshot" as const,
          snapshotId: evaluationBasis.id,
          revision: evaluationBasis.revision,
          subjectId: SUBJECT,
        },
        resultSnapshot: {
          snapshotId: head.id,
          revision: head.revision,
          subjectId: SUBJECT,
        },
        evidenceRefs: [{
          snapshotId: head.id,
          snapshotRevision: head.revision,
          kind: "artifact",
          id: decisionId,
        }],
      },
      {
        id: PRESERVATION_RUN,
        workItemId: PRESERVATION_WORK,
        status: "running" as const,
        summary: "Preserve",
        queuedAt: AT,
        startedAt: AT,
        basis: {
          kind: "thread-snapshot" as const,
          snapshotId: head.id,
          revision: head.revision,
          subjectId: SUBJECT,
        },
        evidenceRefs: [],
      },
      producerRun(FEA_RUN, FEA_WORK, r1, [fea.execution.id, fea.l4Evaluation.id]),
      producerRun(CLOSEOUT_RUN, CLOSEOUT_WORK, r1, [CLOSEOUT_ID]),
      producerRun(PROOF_RUN, PROOF_WORK, r1, [fea.sealedProof.id]),
      producerRun(GEOMETRY_RUN, GEOMETRY_WORK, r1, [GEOMETRY_ID]),
    ],
    decisions: [],
    approvals: [],
    blockers: [],
    commandReceipts: [],
  } as unknown as MutableProject;
}

function producerWork(
  id: string,
  operation: { readonly id: string; readonly version: string },
  snapshot: { snapshotId: string; revision: number; subjectId: string },
  artifactIds: readonly string[],
) {
  return {
    id,
    phaseId: "phase-preservation",
    title: id,
    description: id,
    kind: "verify" as const,
    operation: {
      id: operation.id,
      version: operation.version,
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: artifactIds.map((artifactId) => ({
      snapshotId: snapshot.snapshotId,
      snapshotRevision: snapshot.revision,
      kind: "artifact" as const,
      id: artifactId,
    })),
    decisionIds: [],
    blockerIds: [],
  };
}

function producerRun(
  id: string,
  workItemId: string,
  snapshot: { snapshotId: string; revision: number; subjectId: string },
  artifactIds: readonly string[],
) {
  const evidenceRefs = artifactIds.map((artifactId) => ({
    snapshotId: snapshot.snapshotId,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as const,
    id: artifactId,
  }));
  return {
    id,
    workItemId,
    status: "completed" as const,
    summary: id,
    queuedAt: AT,
    startedAt: AT,
    completedAt: AT,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: snapshot.snapshotId,
      revision: snapshot.revision,
      subjectId: snapshot.subjectId,
    },
    resultSnapshot: {
      snapshotId: snapshot.snapshotId,
      revision: snapshot.revision,
      subjectId: snapshot.subjectId,
    },
    evidenceRefs,
  };
}

function workItem(
  id: string,
  gateItemId: string,
  role: "satisfies" | "contributes-to",
) {
  return {
    id,
    activityId: `activity:${id}`,
    phaseId: "phase-preservation",
    title: id,
    description: id,
    kind: "verify" as const,
    operation: {
      id: "verify.run-fea-static-proof",
      version: "3",
      bindings: [{
        name: "approvedBrief",
        source: { kind: "approved-brief" as const },
      }],
    },
    status: "completed" as const,
    owner: "agent" as const,
    dependsOnWorkItemIds: [],
    evidenceRefs: [],
    decisionIds: [],
    blockerIds: [],
    gateClaims: [{ gateItemId, role, status: "current" as const }],
  };
}

class MemoryEvaluationCaptures implements CrossDomainImpactEvaluationCaptureStore {
  readonly items = new Map<string, CrossDomainImpactEvaluationCapture>();
  save() {
    return Promise.reject(new Error("evaluation capture save is not used"));
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.items.get(fingerprint.digest));
  }
}

class MemoryDecisionCaptures implements CrossDomainImpactDecisionCaptureStore {
  readonly items = new Map<string, CrossDomainImpactDecisionCapture>();
  save() {
    return Promise.reject(new Error("decision capture save is not used"));
  }
  read(fingerprint: ContentFingerprint) {
    return Promise.resolve(this.items.get(fingerprint.digest));
  }
}

type MutableProject = EngineeringProjectSnapshot & {
  revision: number;
  agentRuns: Array<EngineeringProjectSnapshot["agentRuns"][number]>;
  workItems: Array<EngineeringProjectSnapshot["workItems"][number]>;
};

function fresh() {
  return { status: "fresh" as const, changedAt: AT, invalidatedByChangeIds: [] };
}
