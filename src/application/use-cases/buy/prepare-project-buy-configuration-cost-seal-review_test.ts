import { assertEquals } from "@std/assert";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../../../domain/cad/canonical/canonical-write-geometry-step.ts";
import {
  BUY_CANDIDATE_CAPTURE_SCHEMA,
  canonicalBuyCandidateCaptureText,
  validateBuyCandidateCapture,
} from "../../../domain/buy/buy-candidate-capture.ts";
import { computeBuyCostCandidate } from "../../../domain/buy/buy-cost-bundle.ts";
import { selectBuyCostLines } from "../../../domain/buy/buy-cost-selection.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_SITE,
  BUY_FIXTURE_STEP,
  buyCaptureBodyFixture,
  buyConfigurationFixture,
  buyPricingContext,
} from "../../../domain/buy/buy-fixtures.ts";
import {
  BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
  BUY_CAPTURE_CONFIGURATION_COST_TOOL,
} from "../../../domain/buy/buy-operations.ts";
import {
  BUY_SOURCE_CAPTURE_SCHEMA,
  validateBuySourceCaptureEnvelope,
} from "../../../domain/buy/buy-source-capture.ts";
import {
  deterministicJson,
  sha256Fingerprint,
  sha256Hex,
} from "../../../domain/kernel/deterministic-json.ts";
import type { EngineeringProjectSnapshot } from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { PrepareProjectBuyConfigurationCostSealReview } from "./prepare-project-buy-configuration-cost-seal-review.ts";

const AT = "2026-08-15T00:00:00.000Z";
const PROJECT_ID = "reviewed-project-v1";
const SUBJECT_ID = "project:reviewed-project-v1";
const CAPTURE_BASIS = {
  snapshotId: "snapshot.buy.r1",
  revision: 1,
  subjectId: SUBJECT_ID,
};
const SEAL_BASIS = {
  snapshotId: "snapshot.buy.r2",
  revision: 2,
  subjectId: SUBJECT_ID,
};

Deno.test("seal review is ready for the exact capture→seal successor", async () => {
  const fixture = await sealReviewFixture();
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "ready");
  assertEquals(fixture.configuration.basis, CAPTURE_BASIS);
  assertEquals(fixture.command.basis.revision, SEAL_BASIS.revision);
});

Deno.test("seal review refuses a candidate from another project", async () => {
  const fixture = await sealReviewFixture();
  const result = await new PrepareProjectBuyConfigurationCostSealReview(
    {
      get: (id: string) =>
        Promise.resolve(id === fixture.thread.id ? fixture.thread : undefined),
      latest: () => Promise.resolve(fixture.thread),
      save: () => Promise.reject(new Error("must not save")),
    },
    fixture.candidates,
    {
      get: () => fixture.projects.get(PROJECT_ID),
      getRevision: () => Promise.resolve(undefined),
      createInitial: () => Promise.reject(new Error("unused")),
      commit: () => Promise.reject(new Error("unused")),
    },
  ).execute({
    ...fixture.command,
    projectId: "other-project-v1",
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.reason.includes("projectId"), true);
});

Deno.test("seal review refuses a candidate from another subject", async () => {
  const fixture = await sealReviewFixture({
    configuration: buyConfigurationFixture({
      subjectId: "project:foreign-subject",
      basis: {
        snapshotId: CAPTURE_BASIS.snapshotId,
        revision: CAPTURE_BASIS.revision,
        subjectId: "project:foreign-subject",
      },
    }),
  });
  const result = await fixture.review.execute(fixture.command);
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.reason.includes("subject"), true);
});

Deno.test("seal review refuses a stale capture result on a later basis", async () => {
  const fixture = await sealReviewFixture();
  const later = snapshot("snapshot.buy.r3", 3, fixture.thread.artifacts, {
    snapshotId: fixture.thread.id,
    revision: fixture.thread.revision,
  });
  const result = await new PrepareProjectBuyConfigurationCostSealReview(
    {
      get: (id: string) =>
        Promise.resolve(
          id === later.id
            ? later
            : id === fixture.thread.id
            ? fixture.thread
            : undefined,
        ),
      latest: () => Promise.resolve(later),
      save: () => Promise.reject(new Error("must not save")),
    },
    fixture.candidates,
    fixture.projects,
  ).execute({
    ...fixture.command,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: later.id,
      revision: later.revision,
      subjectId: SUBJECT_ID,
    },
  });
  assertEquals(result.status, "unresolved");
  if (result.status !== "unresolved") return;
  assertEquals(result.reason.includes("capture run"), true);
});

async function sealReviewFixture(
  options: { readonly configuration?: ReturnType<typeof buyConfigurationFixture> } = {},
) {
  const configuration = options.configuration ?? buyConfigurationFixture();
  const envelope = await sourceEnvelope();
  const configurationDigest = (await sha256Fingerprint(configuration)).digest;
  const bundle = computeBuyCostCandidate({
    configuration,
    configurationDigest,
    captures: [envelope],
    authorizedSiteId: BUY_FIXTURE_SITE,
    pricingContext: buyPricingContext(),
    selections: selectBuyCostLines(configuration, [envelope]),
  });
  const bundleDigest = (await sha256Fingerprint(bundle)).digest;
  const candidate = await validateBuyCandidateCapture({
    schemaVersion: BUY_CANDIDATE_CAPTURE_SCHEMA,
    kind: "buy.configuration-cost-candidate",
    operation: BUY_CAPTURE_CONFIGURATION_COST_OPERATION,
    trustedRunId: "run.buy-capture",
    decisionId: "decision.buy-capture",
    configurationDigest,
    bundleDigest,
    configuration,
    bundle,
    sourceCaptures: [envelope],
    capturedAt: AT,
  });
  const text = canonicalBuyCandidateCaptureText(candidate);
  const fingerprint = await sha256Fingerprint(candidate);
  const artifact: ThreadArtifact = {
    id: `buy-cost-candidate-${fingerprint.digest}`,
    name: "Buy cost candidate",
    kind: "document",
    version: fingerprint.digest,
    fingerprint,
    uri:
      `casys://buy-configuration-cost-candidate-capture/sha256/${fingerprint.digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: BUY_CAPTURE_CONFIGURATION_COST_TOOL,
      runId: "run.buy-capture",
    },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
  const thread = snapshot(SEAL_BASIS.snapshotId, SEAL_BASIS.revision, [
    writeGeometryPrimary(),
    cadAssetStep(),
    artifact,
  ], {
    snapshotId: CAPTURE_BASIS.snapshotId,
    revision: CAPTURE_BASIS.revision,
  });
  const project = {
    agentRuns: [{
      id: "run.buy-capture",
      workItemId: "work.buy-capture",
      status: "completed",
      basis: { kind: "thread-snapshot" as const, ...CAPTURE_BASIS },
      resultSnapshot: SEAL_BASIS,
    }],
    workItems: [{
      id: "work.buy-capture",
      operation: {
        id: BUY_CAPTURE_CONFIGURATION_COST_OPERATION.id,
        version: "1",
      },
    }],
  } as unknown as EngineeringProjectSnapshot;
  const candidates = {
    read: (value: { readonly digest: string }) =>
      Promise.resolve(value.digest === fingerprint.digest ? text : undefined),
  };
  const projects = {
    get: (projectId: string) =>
      Promise.resolve(projectId === PROJECT_ID ? project : undefined),
    getRevision: () => Promise.resolve(undefined),
    createInitial: () => Promise.reject(new Error("unused")),
    commit: () => Promise.reject(new Error("unused")),
  };
  const review = new PrepareProjectBuyConfigurationCostSealReview(
    {
      get: (id: string) => Promise.resolve(id === thread.id ? thread : undefined),
      latest: () => Promise.resolve(thread),
      save: () => Promise.reject(new Error("must not save")),
    },
    candidates,
    projects,
  );
  return {
    review,
    candidates,
    projects,
    thread,
    configuration,
    command: {
      projectId: PROJECT_ID,
      basis: { kind: "thread-snapshot" as const, ...SEAL_BASIS },
      candidateArtifactId: artifact.id,
      candidateFingerprint: fingerprint,
    },
  };
}

async function sourceEnvelope() {
  const body = buyCaptureBodyFixture();
  const canonicalText = deterministicJson(body);
  const digest = await sha256Hex(new TextEncoder().encode(canonicalText));
  return validateBuySourceCaptureEnvelope({
    schemaVersion: BUY_SOURCE_CAPTURE_SCHEMA,
    capture: body,
    canonicalText,
    fingerprint: `sha256:${digest}`,
    byteCount: new TextEncoder().encode(canonicalText).byteLength,
  });
}

function snapshot(
  id: string,
  revision: number,
  artifacts: readonly ThreadArtifact[],
  previous?: { readonly snapshotId: string; readonly revision: number },
): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id,
    revision,
    generatedAt: AT,
    subject: {
      id: SUBJECT_ID,
      name: "Buy",
      kind: "system",
      version: `r${revision}`,
      modelArtifactId: "artifact.brief",
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: `change-set.buy.r${revision}`,
      name: "Buy",
      status: "applied",
      createdAt: AT,
      appliedAt: AT,
      changes: [],
    },
    artifacts,
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
    ...(previous ? { previous } : {}),
  };
}

function cadAssetStep(): ThreadArtifact {
  return artifact(
    `cad-asset-${BUY_FIXTURE_PARENT}-target-0-${BUY_FIXTURE_STEP}`,
    "step",
    BUY_FIXTURE_STEP,
    "model/step",
    "build123d_export",
    `/api/thread/assets/${BUY_FIXTURE_STEP}.step`,
  );
}

function writeGeometryPrimary(): ThreadArtifact {
  return artifact(
    `geometry-${BUY_FIXTURE_PARENT}`,
    "cad-model",
    BUY_FIXTURE_PARENT,
    "application/json",
    DESIGN_WRITE_GEOMETRY_TOOL,
    `casys://geometry-capture/sha256/${BUY_FIXTURE_PARENT}`,
  );
}

function artifact(
  id: string,
  kind: ThreadArtifact["kind"],
  digest: string,
  mediaType: string,
  tool: string,
  uri: string,
): ThreadArtifact {
  return {
    id,
    name: id,
    kind,
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri,
    mediaType,
    producer: { serverId: "digital-thread", tool, runId: "run.geometry" },
    inputArtifactIds: [],
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
  };
}
