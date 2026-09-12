import { assertEquals } from "@std/assert";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../../../domain/cad/canonical/canonical-write-geometry-step.ts";
import { COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY } from "../../../domain/capability/engineering-capability.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_RESOURCE,
  BUY_FIXTURE_SITE,
  BUY_FIXTURE_STEP,
  buyConfigurationFixture,
  buyPricingContext,
} from "../../../domain/buy/buy-fixtures.ts";
import { BUY_SOURCE_INSTANCE_KIND } from "../../../domain/buy/buy-source-capture.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { PrepareProjectBuyConfigurationCostCaptureReview } from "./prepare-project-buy-configuration-cost-capture-review.ts";

const AT = "2026-08-15T00:00:00.000Z";

Deno.test("capture review refuses a configuration bound to another snapshot", async () => {
  const matching = buyConfigurationFixture();
  const stale = buyConfigurationFixture({
    basis: {
      snapshotId: "snapshot.buy.prior",
      revision: 1,
      subjectId: matching.subjectId,
    },
  });
  const ready = await reviewFor(matching).execute(command());
  assertEquals(ready.status, "ready");

  const refused = await reviewFor(stale).execute(command());
  assertEquals(refused.status, "unresolved");
  if (refused.status !== "unresolved") return;
  assertEquals(refused.reason.includes("Thread basis"), true);
});

Deno.test("capture review refuses a configuration from another project", async () => {
  const refused = await reviewFor(
    buyConfigurationFixture({ projectId: "other-project-v1" }),
  ).execute(command());
  assertEquals(refused.status, "unresolved");
  if (refused.status !== "unresolved") return;
  assertEquals(refused.reason.includes("projectId"), true);
});

Deno.test(
  "capture review refuses supplied parent geometry that does not match the configuration",
  async () => {
    const matching = buyConfigurationFixture();
    const ready = await reviewFor(matching).execute(command());
    assertEquals(ready.status, "ready");

    const wrongId = await reviewFor(matching).execute({
      ...command(),
      geometryArtifactId: "geometry-other-parent",
    });
    assertEquals(wrongId.status, "unresolved");
    if (wrongId.status !== "unresolved") return;
    assertEquals(wrongId.reason.includes("parent geometry"), true);

    const wrongFingerprint = await reviewFor(matching).execute({
      ...command(),
      geometryArtifactFingerprint: "0".repeat(64),
    });
    assertEquals(wrongFingerprint.status, "unresolved");
    if (wrongFingerprint.status !== "unresolved") return;
    assertEquals(wrongFingerprint.reason.includes("parent geometry"), true);
  },
);

function reviewFor(configuration: ReturnType<typeof buyConfigurationFixture>) {
  const thread = snapshot([writeGeometryPrimary(), cadAssetStep()]);
  return new PrepareProjectBuyConfigurationCostCaptureReview(
    {
      get: (id: string) => Promise.resolve(id === thread.id ? thread : undefined),
      latest: () => Promise.resolve(thread),
      save: () => Promise.reject(new Error("must not save")),
    },
    {
      read: () => Promise.resolve(deterministicJson(configuration)),
    },
    {
      resolve: () =>
        Promise.resolve({
          status: "qualified",
          binding: {
            capability: COMMERCE_READ_ERPNEXT_BUY_SOURCE_CAPABILITY,
            qualification: "qualified",
            sourceInstance: {
              kind: BUY_SOURCE_INSTANCE_KIND,
              siteId: BUY_FIXTURE_SITE,
            },
            adapter: {
              id: "erpnext-buy-capture-fixture",
              version: "0.0.0-fixture",
            },
          },
        }),
    },
  );
}

function command() {
  return {
    projectId: "reviewed-project-v1",
    basis: {
      kind: "thread-snapshot" as const,
      snapshotId: "snapshot.buy.r1",
      revision: 1,
      subjectId: "project:reviewed-project-v1",
    },
    configurationResourceUri:
      `casys://agent-resource-capture/sha256/${BUY_FIXTURE_RESOURCE}`,
    configurationResourceDigest: BUY_FIXTURE_RESOURCE,
    geometryArtifactId: `geometry-${BUY_FIXTURE_PARENT}`,
    geometryArtifactFingerprint: BUY_FIXTURE_PARENT,
    documents: [{ doctype: "Item Price" as const, name: "ITEM-PRICE-SYNTHETIC-001" }],
    pricing: buyPricingContext(),
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

function snapshot(artifacts: ThreadArtifact[]): ThreadSnapshot {
  return {
    schemaVersion: "1.0",
    id: "snapshot.buy.r1",
    revision: 1,
    generatedAt: AT,
    subject: {
      id: "project:reviewed-project-v1",
      name: "Buy",
      kind: "system",
      version: "r1",
      modelArtifactId: "artifact.brief",
    },
    freshness: { status: "fresh", changedAt: AT, invalidatedByChangeIds: [] },
    changeSet: {
      id: "change-set.buy",
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
  };
}
