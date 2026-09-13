import { assertEquals, assertRejects } from "@std/assert";
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
  buyConfigurationDigest,
  buyDocumentaryEstimateFixture,
  buyEstimateSourceRef,
  buyPricingContext,
  buySyntheticEvidenceReference,
  buyTwoLineConfigurationFixture,
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
import type { AgentResourceReference } from "../../../domain/resource/agent-resource-capture.ts";
import { parseAgentResourceEnvelope } from "../../../domain/resource/agent-resource-envelope.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { FileAgentResourceStore } from "../../../adapters/resource/file-agent-resource-store.ts";
import {
  persistAgentResourceText,
  tamperAgentResourceReference,
  testReopenAgentResource,
} from "../../../testing/agent-resource-test-support.ts";
import { PrepareProjectBuyConfigurationCostSealReview } from "./prepare-project-buy-configuration-cost-seal-review.ts";
import { PrepareProjectBuyCostEstimatePreview } from "./prepare-project-buy-cost-estimate-preview.ts";

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
Deno.test("preview reopens captured estimate and evidence and composes V2", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const evidence = await persistAgentResourceText(directory, {
    name: "bracket-sheet.txt",
    mimeType: "text/plain",
    text: "synthetic bracket evidence sheet, never parsed for numbers",
  });
  const configurationDigest = await buyConfigurationDigest(
    buyTwoLineConfigurationFixture(),
  );
  const estimate = buyDocumentaryEstimateFixture(configurationDigest, {
    estimateId: "estimate.synthetic.bracket",
    lines: [{
      configurationLineId: "line.bracket",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [{
        id: "material.bracket",
        nature: "material",
        consumption: {
          operand: "sourced",
          decimal: "1",
          uom: "kg",
          source: buyEstimateSourceRef({
            reference: evidence.reference,
            anchor: "sheet line 1",
          }),
        },
        rate: {
          operand: "assumed",
          decimal: "50.00",
          perUom: "kg",
          currency: "EUR",
          justification: {
            statement: "Synthetic assumed bracket rate.",
            source: buyEstimateSourceRef({
              reference: evidence.reference,
              anchor: "sheet line 2",
            }),
          },
        },
      }],
    }],
  });
  const captured = await persistAgentResourceText(directory, {
    name: "estimate.json",
    mimeType: "application/json",
    text: deterministicJson(estimate),
  });
  const preview = await previewFixture(directory);
  const result = await preview.execute({
    ...preview.command,
    estimateRefs: [captured.reference],
  });
  assertEquals(result.status, "preview");
  if (result.status !== "preview") return;
  assertEquals(result.bundle.lines[0]?.amount, "5.00");
  assertEquals(result.bundle.lines[1]?.unitPrice, "50.00");
  // Independent: bracket 1 x 50.00 = 50.00 per unit, x2 units = 100.00;
  // shared aggregator subtotal 5.00 + 100.00 = 105.00.
  assertEquals(result.bundle.lines[1]?.amount, "100.00");
  assertEquals(result.bundle.totals[0]?.amount, "105.00");
  assertEquals(result.bundle.coverage.status, "complete");
  assertEquals(result.bundle.lines[1]?.provisional, true);
  assertEquals(result.nature, "documentary");
  assertEquals(result.provisional, true);
  assertEquals(result.authority.registeredSeal, "no registered seal executed");
  assertEquals(result.authority.spendingApproval, "none");
  assertEquals(result.authority.qualification, "none");
  assertEquals("decisionParameters" in result, false);
  assertEquals(result.evidence.length, 1);
  assertEquals(result.evidence[0]?.uri, evidence.reference.uri);
  assertEquals(result.evidence[0]?.digest, evidence.reference.fingerprint.digest);
  assertEquals(result.evidence[0]?.byteCount, evidence.reference.byteCount);
  assertEquals(result.evidence[0]?.mimeType, "text/plain");
  assertEquals(result.evidence[0]?.anchors, ["sheet line 1", "sheet line 2"]);
  assertEquals(result.annexes[0]?.assumptions.length, 1);
  assertEquals(
    result.annexes[0]?.estimateSource.inputCaptureUri,
    captured.reference.uri,
  );
  assertEquals(result.limits.maxEstimates, 8);
});

Deno.test("fake, missing, or invented references yield no usable costs", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const preview = await previewFixture(directory);
  const missing: AgentResourceReference = {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${"9".repeat(64)}`,
    name: "missing.json",
    mimeType: "application/json",
    representation: "text",
    byteCount: 64,
    fingerprint: { algorithm: "sha256", digest: "9".repeat(64) },
  };
  const absent = await preview.execute({
    ...preview.command,
    estimateRefs: [missing],
  });
  assertEquals(absent.status, "unresolved");
  assertEquals("bundle" in absent, false);
  const evidence = await persistAgentResourceText(directory, {
    name: "sheet.txt",
    mimeType: "text/plain",
    text: "synthetic evidence",
  });
  const tampered = tamperAgentResourceReference(evidence.reference, {
    uri: `casys://agent-resource-capture/sha256/${"8".repeat(64)}`,
  });
  await assertRejects(
    () => preview.execute({ ...preview.command, estimateRefs: [tampered] }),
    TypeError,
    "uri digest does not match",
  );
});

Deno.test("non-canonical, foreign-byte, wrong-MIME estimate bytes are refused", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const preview = await previewFixture(directory);
  const configurationDigest = await buyConfigurationDigest(
    buyTwoLineConfigurationFixture(),
  );
  const pretty = JSON.stringify(
    buyDocumentaryEstimateFixture(configurationDigest),
    null,
    2,
  );
  const stored = await persistAgentResourceText(directory, {
    name: "estimate.json",
    mimeType: "application/json",
    text: pretty,
  });
  const nonCanonical = await preview.execute({
    ...preview.command,
    estimateRefs: [stored.reference],
  });
  assertEquals(nonCanonical.status, "unresolved");
  assertEquals("bundle" in nonCanonical, false);
  const png = await persistAgentResourceText(directory, {
    name: "estimate.png",
    mimeType: "image/png",
    text: "synthetic binary payload marker, refused by MIME allowlist",
  });
  const wrongMime = await preview.execute({
    ...preview.command,
    estimateRefs: [png.reference],
  });
  assertEquals(wrongMime.status, "unresolved");
  const store = new FileAgentResourceStore(directory);
  const invalid = await store.save(
    parseAgentResourceEnvelope({
      name: "broken.json",
      mimeType: "application/json",
      blob: "/w==",
    }),
  );
  const badUtf8 = await preview.execute({
    ...preview.command,
    estimateRefs: [invalid.reference],
  });
  assertEquals(badUtf8.status, "unavailable");
});

Deno.test("uncaptured evidence named by an estimate blocks usable costs", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const preview = await previewFixture(directory);
  const configurationDigest = await buyConfigurationDigest(
    buyTwoLineConfigurationFixture(),
  );
  const ghost: AgentResourceReference = {
    schemaVersion: "agent-resource-capture/1.0",
    uri: `casys://agent-resource-capture/sha256/${"7".repeat(64)}`,
    name: "ghost.txt",
    mimeType: "text/plain",
    representation: "text",
    byteCount: 16,
    fingerprint: { algorithm: "sha256", digest: "7".repeat(64) },
  };
  const estimate = buyDocumentaryEstimateFixture(configurationDigest, {
    lines: [{
      configurationLineId: "line.bracket",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [{
        id: "material.bracket",
        nature: "material",
        consumption: {
          operand: "sourced",
          decimal: "1",
          uom: "kg",
          source: buyEstimateSourceRef({ reference: ghost }),
        },
        rate: {
          operand: "sourced",
          decimal: "50.00",
          perUom: "kg",
          currency: "EUR",
          source: buyEstimateSourceRef({ reference: ghost }),
        },
      }],
    }],
  });
  const captured = await persistAgentResourceText(directory, {
    name: "estimate.json",
    mimeType: "application/json",
    text: deterministicJson(estimate),
  });
  const result = await preview.execute({
    ...preview.command,
    estimateRefs: [captured.reference],
  });
  assertEquals(result.status, "unresolved");
  assertEquals("bundle" in result, false);
});

Deno.test("stale candidate basis and ERP/estimate collision are refused", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const evidence = await persistAgentResourceText(directory, {
    name: "sheet.txt",
    mimeType: "text/plain",
    text: "synthetic evidence",
  });
  const preview = await previewFixture(directory);
  const later = snapshot("snapshot.buy.r3", 3, preview.thread.artifacts, {
    snapshotId: preview.thread.id,
    revision: preview.thread.revision,
  });
  const staleSnapshots = {
    get: (id: string) =>
      Promise.resolve(
        id === later.id ? later : id === preview.thread.id ? preview.thread : undefined,
      ),
    latest: () => Promise.resolve(later),
    save: () => Promise.reject(new Error("must not save")),
  };
  const stale = await new PrepareProjectBuyCostEstimatePreview(
    preview.seal(staleSnapshots),
    preview.candidates,
    testReopenAgentResource(directory),
  ).execute({
    ...preview.command,
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: later.id,
      revision: later.revision,
      subjectId: SUBJECT_ID,
    },
    estimateRefs: [evidence.reference],
  });
  assertEquals(stale.status, "unresolved");
  assertEquals("bundle" in stale, false);
  const configurationDigest = await buyConfigurationDigest(
    buyTwoLineConfigurationFixture(),
  );
  const colliding = buyDocumentaryEstimateFixture(configurationDigest, {
    lines: [{
      configurationLineId: "line.fastener",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [{
        id: "material.bar",
        nature: "material",
        consumption: {
          operand: "sourced",
          decimal: "1",
          uom: "kg",
          source: buyEstimateSourceRef({ reference: evidence.reference }),
        },
        rate: {
          operand: "sourced",
          decimal: "9.00",
          perUom: "kg",
          currency: "EUR",
          source: buyEstimateSourceRef({ reference: evidence.reference }),
        },
      }],
    }],
  });
  const captured = await persistAgentResourceText(directory, {
    name: "estimate.json",
    mimeType: "application/json",
    text: deterministicJson(colliding),
  });
  const collision = await preview.execute({
    ...preview.command,
    estimateRefs: [captured.reference],
  });
  assertEquals(collision.status, "unresolved");
  assertEquals("bundle" in collision, false);
});

Deno.test("preview refuses a non-sha256 candidate fingerprint before reads", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const preview = await previewFixture(directory);
  const refs = [buySyntheticEvidenceReference()];
  await assertRejects(
    () =>
      preview.execute({
        ...preview.command,
        candidateFingerprint: { algorithm: "md5", digest: "0".repeat(32) },
        estimateRefs: refs,
      }),
    TypeError,
    "candidateFingerprint.algorithm must be sha256",
  );
  await assertRejects(
    () =>
      preview.execute({
        ...preview.command,
        candidateFingerprint: { algorithm: "sha256", digest: "not-hex" },
        estimateRefs: refs,
      }),
    TypeError,
    "candidateFingerprint.digest must be lowercase sha256 hex",
  );
});

Deno.test("unknown estimate terms exclude the line without completing it", async () => {
  const directory = await Deno.makeTempDir({ prefix: "buy-estimate-preview-" });
  const evidence = await persistAgentResourceText(directory, {
    name: "sheet.txt",
    mimeType: "text/plain",
    text: "synthetic evidence",
  });
  const preview = await previewFixture(directory);
  const configurationDigest = await buyConfigurationDigest(
    buyTwoLineConfigurationFixture(),
  );
  const estimate = buyDocumentaryEstimateFixture(configurationDigest, {
    lines: [{
      configurationLineId: "line.bracket",
      quantityBasis: "per-configuration-unit",
      productUom: "Nos",
      terms: [{
        id: "energy.unknown",
        nature: "other",
        consumption: { operand: "unknown" },
        rate: {
          operand: "sourced",
          decimal: "0.30",
          perUom: "kWh",
          currency: "EUR",
          source: buyEstimateSourceRef({ reference: evidence.reference }),
        },
      }],
    }],
  });
  const captured = await persistAgentResourceText(directory, {
    name: "estimate.json",
    mimeType: "application/json",
    text: deterministicJson(estimate),
  });
  const result = await preview.execute({
    ...preview.command,
    estimateRefs: [captured.reference],
  });
  assertEquals(result.status, "preview");
  if (result.status !== "preview") return;
  assertEquals(result.annexes[0]?.lines[0]?.unitCost, undefined);
  assertEquals(result.bundle.lines[1]?.amount, undefined);
  assertEquals(result.bundle.coverage.excludedLineIds, ["line.bracket"]);
  assertEquals(result.bundle.totals[0]?.amount, "5.00");
  assertEquals(result.bundle.coverage.status, "partial");
});

async function previewFixture(directory: string) {
  const configuration = buyTwoLineConfigurationFixture();
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
  const seal = (
    snapshots = {
      get: (id: string) => Promise.resolve(id === thread.id ? thread : undefined),
      latest: () => Promise.resolve(thread),
      save: () => Promise.reject(new Error("must not save")),
    },
  ) =>
    new PrepareProjectBuyConfigurationCostSealReview(
      snapshots,
      candidates,
      projects,
    );
  const preview = new PrepareProjectBuyCostEstimatePreview(
    seal(),
    candidates,
    testReopenAgentResource(directory),
  );
  return {
    execute: (command: unknown) => preview.execute(command),
    seal,
    candidates,
    thread,
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
