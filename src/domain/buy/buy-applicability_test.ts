import { assertEquals } from "@std/assert";
import type { ThreadArtifact, ThreadSnapshot } from "../thread/thread-snapshot.ts";
import { DESIGN_WRITE_GEOMETRY_TOOL } from "../cad/canonical/canonical-write-geometry-step.ts";
import {
  buyGeometryApplicability,
  recrossBuyConfigurationThreadBasis,
} from "./buy-applicability.ts";
import {
  BUY_FIXTURE_PARENT,
  BUY_FIXTURE_STEP,
  buyConfigurationFixture,
} from "./buy-fixtures.ts";

const AT = "2026-08-15T00:00:00.000Z";

Deno.test("current STEP matching the bound geometry is current", () => {
  const configuration = buyConfigurationFixture();
  const result = buyGeometryApplicability(
    snapshot([writeGeometryPrimary(), cadAssetStep()]),
    configuration,
  );
  assertEquals(result.status, "current");
});

Deno.test("a newer canonical STEP makes previous Buy evidence historical", () => {
  const configuration = buyConfigurationFixture();
  const newerParent =
    "1111111111111111111111111111111111111111111111111111111111111111";
  const newerStep = "2222222222222222222222222222222222222222222222222222222222222222";
  const result = buyGeometryApplicability(
    snapshot([
      writeGeometryPrimary(),
      cadAssetStep(),
      artifact(
        `geometry-${newerParent}`,
        "cad-model",
        newerParent,
        "application/json",
        DESIGN_WRITE_GEOMETRY_TOOL,
        `casys://geometry-capture/sha256/${newerParent}`,
      ),
      artifact(
        `cad-asset-${newerParent}-target-0-${newerStep}`,
        "step",
        newerStep,
        "model/step",
        "build123d_export",
        `/api/thread/assets/${newerStep}.step`,
      ),
    ]),
    configuration,
  );
  assertEquals(result.status, "historical");
});

Deno.test("wrong STEP identity is refused, not guessed", () => {
  const configuration = buyConfigurationFixture();
  const result = buyGeometryApplicability(snapshot([]), configuration);
  assertEquals(result.status, "refused");
});

Deno.test("configuration basis and subject must match the exact Thread basis", () => {
  const snapshotBasis = snapshot([writeGeometryPrimary(), cadAssetStep()]);
  const matching = recrossBuyConfigurationThreadBasis(
    buyConfigurationFixture(),
    {
      snapshotId: snapshotBasis.id,
      revision: snapshotBasis.revision,
      subjectId: snapshotBasis.subject.id,
    },
  );
  assertEquals(matching.status, "current");
  assertEquals(
    buyGeometryApplicability(snapshotBasis, buyConfigurationFixture()).status,
    "current",
  );

  const stale = recrossBuyConfigurationThreadBasis(
    buyConfigurationFixture({
      basis: {
        snapshotId: "snapshot.buy.prior",
        revision: 1,
        subjectId: "project:reviewed-project-v1",
      },
    }),
    {
      snapshotId: snapshotBasis.id,
      revision: snapshotBasis.revision,
      subjectId: snapshotBasis.subject.id,
    },
  );
  assertEquals(stale.status, "refused");

  const foreign = recrossBuyConfigurationThreadBasis(
    buyConfigurationFixture({
      subjectId: "project:other-subject",
      basis: {
        snapshotId: snapshotBasis.id,
        revision: snapshotBasis.revision,
        subjectId: "project:other-subject",
      },
    }),
    {
      snapshotId: snapshotBasis.id,
      revision: snapshotBasis.revision,
      subjectId: snapshotBasis.subject.id,
    },
  );
  assertEquals(foreign.status, "refused");
});

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
