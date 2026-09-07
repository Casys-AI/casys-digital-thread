/**
 * Trusted registration of exact canonical CAD captures with the provider's
 * existing whole-App geometry session. This is navigation, not a CAD verdict.
 */
import type { EngineeringProjectSnapshot } from "../../domain/project/engineering-project.ts";
import { sha256Hex } from "../../domain/kernel/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  exactGeometryBinaryNavigationArtifacts,
  type GenericGeometryCaptureReader,
} from "../cad/canonical/geometry-bundle-product-catalog.ts";
import { MCP_APP_HOST_MAX_RESOURCE_BYTES } from "../../presentation/workbench/thread/viewer-sessions.ts";
import type { ThreadViewerAppMaterializationCatalogBinding } from "./thread-viewer-app-materializer.ts";
import type { InstalledThreadViewerAppPackage } from "./thread-viewer-app-packages.ts";
import {
  currentViewerRegistrationBasis,
  exactViewerArtifact,
  installedViewerResource,
} from "./thread-viewer-registration-context.ts";

export const GEOMETRY_VIEWER_APP_ID = "io.casys.mcp-build123d.results";
export const GEOMETRY_VIEWER_RESOURCE_URI = "ui://mcp-build123d/results-viewer";
export const GEOMETRY_VIEWER_SESSION_SCHEMA =
  "io.casys.mcp-build123d.recorded-geometry-session/1.0";

export async function buildGeometryViewerBinding(request: {
  readonly project: EngineeringProjectSnapshot;
  readonly thread: ThreadSnapshot;
  readonly artifactId: string;
  readonly captures: GenericGeometryCaptureReader;
  readonly packages: readonly InstalledThreadViewerAppPackage[];
  /** Server-owned canonical asset directory, never an App/session path. */
  readonly assetDirectory: string;
}): Promise<ThreadViewerAppMaterializationCatalogBinding | undefined> {
  const basis = currentViewerRegistrationBasis(request.project, request.thread);
  const primary = exactViewerArtifact(request.thread, request.artifactId);
  if (
    primary.kind !== "cad-model" ||
    primary.producer.serverId !== "digital-thread" ||
    primary.producer.tool !== "design.write-geometry@1"
  ) return undefined;
  const installed = installedViewerResource(
    request.packages,
    GEOMETRY_VIEWER_APP_ID,
    GEOMETRY_VIEWER_RESOURCE_URI,
    GEOMETRY_VIEWER_SESSION_SCHEMA,
  );
  if (!installed) return undefined;
  // Let unreadable/corrupt evidence surface as an error. The navigation helper
  // deliberately represents those failures as no navigation, which is not a
  // sufficient reason for a registrar to discard its last good generation.
  const captureText = await request.captures.read(primary.fingerprint);
  if (captureText === undefined) {
    throw new TypeError("Exact geometry capture is unavailable.");
  }
  // The canonical helper reopens the capture, rehashes it and proves each
  // binary's exact signed identity/publication. A lookalike edge grants none.
  const binaries = await exactGeometryBinaryNavigationArtifacts(
    request.thread,
    primary,
    {
      read: (fingerprint) =>
        fingerprint.digest === primary.fingerprint.digest
          ? Promise.resolve(captureText)
          : request.captures.read(fingerprint),
    },
  );
  const meshes = binaries.filter((artifact) =>
    artifact.mediaType === "model/gltf-binary"
  );
  const assemblies = meshes.filter((artifact) =>
    artifact.id.startsWith(`cad-asset-${primary.fingerprint.digest}-assembly-`)
  );
  const candidates = assemblies.length > 0 ? assemblies : meshes;
  if (candidates.length !== 1) return undefined;
  const mesh = exactViewerArtifact(request.thread, candidates[0]!.id);
  const filename = `${mesh.fingerprint.digest}.glb`;
  if (mesh.uri !== `/api/thread/assets/${filename}`) {
    throw new TypeError("Geometry viewer requires an exact canonical GLB URI.");
  }
  const path = `${request.assetDirectory.replace(/\/$/, "")}/${filename}`;
  const stat = await Deno.stat(path);
  if (!stat.isFile || stat.size === 0 || stat.size > MCP_APP_HOST_MAX_RESOURCE_BYTES) {
    throw new TypeError(
      "Geometry viewer GLB is absent or exceeds the host resource bound.",
    );
  }
  const bytes = await Deno.readFile(path);
  if (
    bytes.byteLength !== stat.size || await sha256Hex(bytes) !== mesh.fingerprint.digest
  ) {
    throw new TypeError(
      "Geometry viewer GLB bytes do not match the canonical artifact.",
    );
  }
  return {
    basis: { ...basis },
    anchor: { kind: "artifact", id: primary.id },
    app: { ...installed.app.app },
    manifest: { uri: installed.app.manifest.uri, path: installed.app.manifest.path },
    resource: { uri: installed.resource.uri, path: installed.resource.path },
    readResources: [{ path, mimeType: "model/gltf-binary" }],
    session: {
      schema: GEOMETRY_VIEWER_SESSION_SCHEMA,
      payload: {
        schemaVersion: GEOMETRY_VIEWER_SESSION_SCHEMA,
        kind: "recorded-canonical-geometry",
        basis: { ...basis },
        anchor: { kind: "artifact", id: primary.id },
        provenance: { canonicalCapture: recordedArtifact(primary) },
        projection: {
          status: "available",
          artifact: recordedArtifact(mesh),
          resourceFingerprint: `sha256:${mesh.fingerprint.digest}`,
        },
      },
    },
  };
}

function recordedArtifact(artifact: ThreadArtifact): Readonly<Record<string, unknown>> {
  return {
    artifactId: artifact.id,
    artifactVersion: artifact.version,
    artifactFingerprint: `sha256:${artifact.fingerprint.digest}`,
    producer: { ...artifact.producer },
  };
}
