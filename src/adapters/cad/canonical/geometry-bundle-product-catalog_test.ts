import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { GEOMETRY_CAPTURE_URI_PREFIX } from "../../shared/cas/file-capture-store.ts";
import type { ThreadComponentCatalog } from "../../../domain/thread/thread-component-catalog.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { enrichGenericProductCatalogWithGeometryBundle } from "./geometry-bundle-product-catalog.ts";

const SEALED_AT = "2026-08-08T00:00:00.000Z";
const ARCH_ID = "architecture-a";
const ARCH_DIGEST = "a".repeat(64);

Deno.test("product catalog classifies current geometry-capture/1.2 as assembly-only", async () => {
  const world = await catalogWorld({
    schemaVersion: "geometry-capture/1.2",
    extra: {},
  });
  const catalog = await enrichGenericProductCatalogWithGeometryBundle(
    world.snapshot,
    world.architecture,
    world.captures,
  );
  assertStringIncludes(catalog.rationale, "assembly-only seal");
  assertEquals(
    catalog.components.some((component) =>
      component.bindings.some((binding) => binding.provider === "digital-thread")
    ),
    false,
  );
});

Deno.test("product catalog rejects geometry-capture/1.1 and geometry-capture/2.0", async () => {
  for (const schemaVersion of ["geometry-capture/1.1", "geometry-capture/2.0"]) {
    const world = await catalogWorld({
      schemaVersion,
      extra: schemaVersion === "geometry-capture/2.0"
        ? { sourceScripts: { assembly: {}, partDefinitions: [], providerCalls: [] } }
        : {},
    });
    const catalog = await enrichGenericProductCatalogWithGeometryBundle(
      world.snapshot,
      world.architecture,
      world.captures,
    );
    assertStringIncludes(catalog.rationale, "unsupported");
  }
});

Deno.test("product catalog admits current geometry-capture/2.1 into the bundle path", async () => {
  const world = await catalogWorld({
    schemaVersion: "geometry-capture/2.1",
    extra: {
      draftDigest: "d".repeat(64),
      manifest: { schemaVersion: "geometry-manifest/2.0" },
      architectureBasis: {
        artifactId: ARCH_ID,
        fingerprint: { algorithm: "sha256", digest: ARCH_DIGEST },
        producerRunId: "run:architecture",
      },
      previewProducer: {
        serverId: "build123d-sandbox",
        tool: "build123d_export",
        runId: "preview:bundle",
      },
      sourceScripts: { assembly: {}, partDefinitions: [], providerCalls: [] },
      sourceAnalyses: { assembly: {}, partDefinitions: [] },
    },
  });
  const catalog = await enrichGenericProductCatalogWithGeometryBundle(
    world.snapshot,
    world.architecture,
    world.captures,
  );
  assertEquals(catalog.rationale.includes("unsupported"), false);
  assertEquals(catalog.rationale.includes("assembly-only seal"), false);
});

Deno.test("product catalog admits current geometry-module-capture/1.0 into the target path", async () => {
  const world = await catalogWorld({
    schemaVersion: "geometry-module-capture/1.0",
    extra: {
      draftDigest: "d".repeat(64),
      manifest: { schemaVersion: "geometry-module-manifest/1.0" },
      architectureBasis: {
        artifactId: ARCH_ID,
        fingerprint: { algorithm: "sha256", digest: ARCH_DIGEST },
        producerRunId: "run:architecture",
      },
    },
  });
  const catalog = await enrichGenericProductCatalogWithGeometryBundle(
    world.snapshot,
    world.architecture,
    world.captures,
  );
  assertEquals(catalog.rationale.includes("unsupported"), false);
  assertEquals(catalog.rationale.includes("assembly-only seal"), false);
});

Deno.test("product catalog admits current geometry-part-capture/1.0 into the target path", async () => {
  const world = await catalogWorld({
    schemaVersion: "geometry-part-capture/1.0",
    extra: {
      draftDigest: "d".repeat(64),
      manifest: { schemaVersion: "geometry-part-manifest/1.0" },
      architectureBasis: {
        artifactId: ARCH_ID,
        fingerprint: { algorithm: "sha256", digest: ARCH_DIGEST },
        producerRunId: "run:architecture",
      },
      previewProducer: {
        serverId: "build123d-sandbox",
        tool: "build123d_export",
        runId: "preview:part",
      },
      sourceScript: {},
      sourceAnalysis: {},
    },
  });
  const catalog = await enrichGenericProductCatalogWithGeometryBundle(
    world.snapshot,
    world.architecture,
    world.captures,
  );
  assertEquals(catalog.rationale.includes("unsupported"), false);
  assertEquals(catalog.rationale.includes("assembly-only seal"), false);
});

async function catalogWorld(input: {
  readonly schemaVersion: string;
  readonly extra: Record<string, unknown>;
}): Promise<{
  readonly snapshot: ThreadSnapshot;
  readonly architecture: ThreadComponentCatalog;
  readonly captures: { read(): Promise<string> };
}> {
  const capture = {
    schemaVersion: input.schemaVersion,
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: "run:geometry",
    sealedAt: SEALED_AT,
    ...input.extra,
  };
  const fingerprint = await sha256Fingerprint(capture);
  const primary = geometryPrimary(fingerprint.digest);
  const architecture = architectureCatalog();
  return {
    snapshot: {
      artifacts: [architectureArtifact(), primary],
      changeSet: { changes: [] },
      provenance: [],
      consumptions: [],
    } as unknown as ThreadSnapshot,
    architecture,
    captures: { read: () => Promise.resolve(deterministicJson(capture)) },
  };
}

function geometryPrimary(digest: string): ThreadArtifact {
  return {
    id: `geometry-${digest}`,
    name: "Geometry",
    kind: "cad-model",
    version: digest,
    fingerprint: { algorithm: "sha256", digest },
    uri: `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${digest}`,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "design.write-geometry@1",
      runId: "run:geometry",
    },
    inputArtifactIds: [ARCH_ID],
    freshness: {
      status: "fresh",
      changedAt: SEALED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function architectureArtifact(): ThreadArtifact {
  return {
    id: ARCH_ID,
    name: "Architecture",
    kind: "sysml-model",
    version: ARCH_DIGEST,
    fingerprint: { algorithm: "sha256", digest: ARCH_DIGEST },
    producer: {
      serverId: "digital-thread",
      tool: "model.write-architecture@1",
      runId: "run:architecture",
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: SEALED_AT,
      invalidatedByChangeIds: [],
    },
  };
}

function architectureCatalog(): ThreadComponentCatalog {
  return {
    schemaVersion: "thread-components/1.0",
    authority: "workspace-declared",
    subjectId: "subject",
    rationale: "Architecture catalog.",
    systemViews: {},
    components: [{
      id: "part-1",
      label: "Box",
      kind: "part",
      quantity: 1,
      bindings: [{
        provider: "syson",
        kind: "part-definition",
        id: "sysml.part.box",
        label: "Box",
        evidenceArtifactId: ARCH_ID,
      }, {
        provider: "syson",
        kind: "part-usage",
        id: "sysml.usage.box",
        label: "box",
        evidenceArtifactId: ARCH_ID,
      }],
    }],
  };
}
