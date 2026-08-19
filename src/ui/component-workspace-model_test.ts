import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  buildSysmlSubtree,
  cadSurfaceCoverage,
  correctionNodesForComponent,
  resolveCadMeshStatus,
  resolveCadSurface,
  resolveSealedAssemblyGeometry,
  sealedAssemblyGeometryBlocker,
  sealedAssemblyGlbAsset,
} from "./src/thread/component-workspace-model.ts";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import type {
  ThreadArtifact,
  ThreadComponent,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "./src/thread/types.ts";

Deno.test("global CAD resolves by exact URI and preview hash without linking children", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const root: ThreadComponent = {
    id: "generic",
    label: "GenericAssembly GEN-01",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "/exports/generic-product.step",
      label: "GEN-01 STEP assembly",
      evidenceArtifactId: "superseded-run-step",
      status: "unverified",
      reason: "The declared evidence artifact is absent from this revision.",
    }],
    preview: {
      provider: "build123d",
      artifactId: "superseded-run-stl",
      mediaType: "model/stl",
      url: "/api/thread/assets/generic-product.stl",
      sha256: "b".repeat(64),
    },
  };
  const child: ThreadComponent = {
    id: "boiler",
    parentId: root.id,
    label: "Boiler",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "assembly-child",
      id: "boiler",
      label: "build123d child boiler",
      evidenceArtifactId: "current-step",
      status: "verified",
      selection: { kind: "artifact", id: "current-step" },
    }],
  };
  snapshot.components.components = [root, child];
  snapshot.artifacts.push(
    artifact("current-step", "step", "/exports/generic-product.step", "a"),
    artifact("current-stl", "mesh", "/exports/generic-product.stl", "b"),
  );

  const surface = resolveCadSurface(snapshot, root);

  assertEquals(surface?.scope, "assembly");
  assertEquals(surface?.authoritativeArtifact.id, "current-step");
  assertEquals(surface?.preview?.artifactId, "current-stl");
  assertEquals(surface?.inspectionBinding.selection, {
    kind: "artifact",
    id: "current-step",
  });
  assertEquals(resolveCadSurface(snapshot, child), undefined);
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 1,
    partSurfaces: 0,
    totalComponents: 2,
  });
});

Deno.test("global CAD does not resolve from a label or a foreign provider", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const root: ThreadComponent = {
    id: "generic",
    label: "GenericAssembly GEN-01",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "/exports/expected.step",
      label: "Same friendly label",
      evidenceArtifactId: "missing",
      status: "unverified",
    }],
  };
  snapshot.components.components = [root];
  snapshot.artifacts.push({
    ...artifact("foreign-step", "step", "/exports/expected.step", "c"),
    system: "other-cad",
    label: "Same friendly label",
  });

  assertEquals(resolveCadSurface(snapshot, root), undefined);
});

Deno.test("projected r5 geometry resolves from exact capture-to-binary traces", () => {
  const snapshot = minimalSnapshot();
  const captureDigest =
    "39d5a031fcf2ed7926ac7e17fecb7ee7e55587fe5112588814c0d256afdbb04a";
  const glbDigest =
    "5ae73d2321bf164be3ea4085c52ef9a0a4b92ac5cf8d6b5cde6fd93001e20d6f";
  const stepDigest =
    "9ffb695f17d6f92d8e203143f0d79830754c711fff1656067420a1648e54ba56";
  const capture = projectedGeometryCapture(captureDigest);
  const glb = projectedGeometryBinary(
    captureDigest,
    glbDigest,
    "cad-model",
    "glb",
  );
  const step = projectedGeometryBinary(
    captureDigest,
    stepDigest,
    "step",
    "step",
  );
  snapshot.artifacts.push(capture, glb, step);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, glb.id),
    projectedTrace(capture.id, step.id),
  );

  const result = resolveSealedAssemblyGeometry(snapshot);

  assertEquals(result?.captureArtifact.id, capture.id);
  assertEquals(result?.assemblyAssets.map((artifact) => artifact.id), [
    glb.id,
    step.id,
  ]);
  assertEquals(result?.assemblyFormats, ["GLB", "STEP"]);
  assertEquals(result?.independentPartDefinitionGeometryCount, 0);
  assertEquals(result?.legacyPartMeshCount, 0);
  assertEquals(result?.inspectionBinding.selection, {
    kind: "artifact",
    id: capture.id,
  });
  assertEquals(sealedAssemblyGlbAsset(result!)?.id, glb.id);
});

Deno.test("sealed assembly GLB selection accepts the live sha256 fingerprint shape only", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "0".repeat(64);
  const glbDigest = "1".repeat(64);
  const stepDigest = "2".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const glb = projectedGeometryBinary(
    captureDigest,
    glbDigest,
    "cad-model",
    "glb",
  );
  const step = projectedGeometryBinary(
    captureDigest,
    stepDigest,
    "step",
    "step",
  );
  snapshot.artifacts.push(capture, glb, step);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, glb.id),
    projectedTrace(capture.id, step.id),
  );
  const sealed = resolveSealedAssemblyGeometry(snapshot)!;

  assertEquals(glb.fingerprint, `sha256:${glbDigest}`);
  assertEquals(sealedAssemblyGlbAsset(sealed)?.id, glb.id);

  glb.fingerprint = `sha256:${"f".repeat(64)}`;
  assertEquals(sealedAssemblyGlbAsset(sealed), undefined);
});

Deno.test("sealed geometry never promotes a legacy mesh to independent part geometry", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "1".repeat(64);
  const step = projectedGeometryBinary(
    captureDigest,
    "2".repeat(64),
    "step",
    "step",
  );
  const mesh = projectedGeometryBinary(
    captureDigest,
    "3".repeat(64),
    "mesh",
    "stl",
  );
  snapshot.artifacts.push(projectedGeometryCapture(captureDigest), step, mesh);
  snapshot.graph.edges.push(
    projectedTrace(`geometry-${captureDigest}`, step.id),
    projectedTrace(`geometry-${captureDigest}`, mesh.id),
  );

  const result = resolveSealedAssemblyGeometry(snapshot);

  assertEquals(result?.independentPartDefinitionGeometryCount, 0);
  assertEquals(result?.legacyPartMeshCount, 1);
});

Deno.test("catalog occurrence count does not inflate one v2 PartDefinition geometry", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "4".repeat(64);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "5".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const definitionStep = projectedV2GeometryBinary(
    captureDigest,
    "a".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 0, fileIndex: 0 },
  );
  snapshot.artifacts.push(
    projectedGeometryCapture(captureDigest),
    assemblyStep,
    definitionStep,
  );
  snapshot.graph.edges.push(
    projectedTrace(`geometry-${captureDigest}`, assemblyStep.id),
    projectedTrace(`geometry-${captureDigest}`, definitionStep.id),
  );
  attachExactV2Catalog(
    snapshot,
    `geometry-${captureDigest}`,
    assemblyStep,
    [definitionStep],
    [2],
  );

  assertEquals(
    resolveSealedAssemblyGeometry(snapshot)
      ?.independentPartDefinitionGeometryCount,
    1,
  );
});

Deno.test("v2 definition assets never inflate sealed assembly assets", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "b".repeat(64);
  const binaries: ThreadArtifact[] = [
    projectedV2GeometryBinary(
      captureDigest,
      "0".repeat(64),
      "step",
      "step",
      { scope: "assembly", formatIndex: 0 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      "1".repeat(64),
      "cad-model",
      "glb",
      { scope: "assembly", formatIndex: 1 },
    ),
  ];
  for (let definitionIndex = 0; definitionIndex < 4; definitionIndex += 1) {
    binaries.push(
      projectedV2GeometryBinary(
        captureDigest,
        (definitionIndex + 2).toString(16).repeat(64),
        "step",
        "step",
        { scope: "definition", definitionIndex, fileIndex: 0 },
      ),
      projectedV2GeometryBinary(
        captureDigest,
        (definitionIndex + 6).toString(16).repeat(64),
        "cad-model",
        "glb",
        { scope: "definition", definitionIndex, fileIndex: 1 },
      ),
    );
  }
  const capture = projectedGeometryCapture(captureDigest);
  snapshot.artifacts.push(capture, ...binaries);
  snapshot.graph.edges.push(
    ...binaries.map((binary) => projectedTrace(capture.id, binary.id)),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    binaries[0]!,
    binaries.filter((binary) =>
      binary.kind === "step" && binary.id.includes("-definition-")
    ),
  );

  const result = resolveSealedAssemblyGeometry(snapshot);

  assertEquals(result?.assemblyAssets.length, 2);
  assertEquals(result?.assemblyFormats, ["STEP", "GLB"]);
  assertEquals(result?.independentPartDefinitionGeometryCount, 4);
  assertEquals(result?.legacyPartMeshCount, 0);
});

Deno.test("exact digital-thread bindings link a PartDefinition STEP without inventing a viewer", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "8".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "9".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const definitionStep = projectedV2GeometryBinary(
    captureDigest,
    "a".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 0, fileIndex: 0 },
  );
  snapshot.artifacts.push(capture, assemblyStep, definitionStep);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, assemblyStep.id),
    projectedTrace(capture.id, definitionStep.id),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    assemblyStep,
    [definitionStep],
    [2],
  );

  const partComponents = snapshot.components.components.filter((component) =>
    component.kind === "part"
  );
  const surfaces = partComponents.map((component) =>
    resolveCadSurface(snapshot, component)
  );
  assertEquals(surfaces.map((surface) => surface?.representation), [
    "authoritative-step",
    "authoritative-step",
  ]);
  assertEquals(surfaces[0]?.authoritativeArtifact.id, definitionStep.id);
  assertEquals(surfaces[0]?.preview, undefined);
  assertEquals(surfaces[0]?.inspectionBinding.selection, {
    kind: "artifact",
    id: definitionStep.id,
  });
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 0,
    partSurfaces: 0,
    totalComponents: 3,
  });

  definitionStep.system = "lookalike-build123d-sandbox";
  assertEquals(
    resolveCadSurface(snapshot, partComponents[0]!),
    undefined,
  );
});

Deno.test("exact v2 PartDefinition mapping resolves one reusable GLB viewer per selected part", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "7".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "8".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const definitionSteps = [
    projectedV2GeometryBinary(
      captureDigest,
      "9".repeat(64),
      "step",
      "step",
      { scope: "definition", definitionIndex: 0, fileIndex: 0 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      "a".repeat(64),
      "step",
      "step",
      { scope: "definition", definitionIndex: 1, fileIndex: 0 },
    ),
  ];
  const definitionGlbs = [
    projectedV2GeometryBinary(
      captureDigest,
      "b".repeat(64),
      "cad-model",
      "glb",
      { scope: "definition", definitionIndex: 0, fileIndex: 1 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      "c".repeat(64),
      "cad-model",
      "glb",
      { scope: "definition", definitionIndex: 1, fileIndex: 1 },
    ),
  ];
  const binaries = [assemblyStep, ...definitionSteps, ...definitionGlbs];
  snapshot.artifacts.push(capture, ...binaries);
  snapshot.graph.edges.push(
    ...binaries.map((binary) => projectedTrace(capture.id, binary.id)),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    assemblyStep,
    definitionSteps,
    [2, 1],
    definitionGlbs,
  );

  const parts = snapshot.components.components.filter((component) =>
    component.kind === "part"
  );
  const surfaces = parts.map((part) => resolveCadSurface(snapshot, part));
  assertEquals(
    surfaces.map((surface) => surface?.authoritativeArtifact.id),
    [definitionSteps[0]!.id, definitionSteps[0]!.id, definitionSteps[1]!.id],
  );
  assertEquals(
    surfaces.map((surface) => surface?.presentationArtifact?.id),
    [definitionGlbs[0]!.id, definitionGlbs[0]!.id, definitionGlbs[1]!.id],
  );
  assertEquals(
    surfaces.map((surface) => surface?.preview?.mediaType),
    ["model/gltf-binary", "model/gltf-binary", "model/gltf-binary"],
  );
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 0,
    partSurfaces: 3,
    totalComponents: 4,
  });

  // A valid GLB from another signed PartDefinition is still the wrong viewer.
  parts[0]!.preview = {
    ...parts[0]!.preview!,
    artifactId: definitionGlbs[1]!.id,
    url: definitionGlbs[1]!.uri!,
    sha256: "c".repeat(64),
  };
  const mismatched = resolveCadSurface(snapshot, parts[0]!);
  assertEquals(mismatched?.authoritativeArtifact.id, definitionSteps[0]!.id);
  assertEquals(mismatched?.preview, undefined);
});

Deno.test("Product renders exact GLB parts and keeps STEP-only bundles honest", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/component-workspace.tsx", import.meta.url),
  );
  assertStringIncludes(source, "PartDefinition preview · GLB");
  assertStringIncludes(source, "<GltfAssetCanvas");
  assertStringIncludes(source, "Authoritative CAD · STEP");
  assertStringIncludes(source, "Authoritative STEP linked");
  assertStringIncludes(
    source,
    "No exact PartDefinition GLB was published in this bundle",
  );
});

Deno.test("v2 definitions are not deduplicated when exact STEP bytes match", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "d".repeat(64);
  const sharedDefinitionDigest = "e".repeat(64);
  const binaries = [
    projectedV2GeometryBinary(
      captureDigest,
      "f".repeat(64),
      "step",
      "step",
      { scope: "assembly", formatIndex: 0 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      sharedDefinitionDigest,
      "step",
      "step",
      { scope: "definition", definitionIndex: 0, fileIndex: 0 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      sharedDefinitionDigest,
      "step",
      "step",
      { scope: "definition", definitionIndex: 1, fileIndex: 0 },
    ),
  ];
  const capture = projectedGeometryCapture(captureDigest);
  snapshot.artifacts.push(capture, ...binaries);
  snapshot.graph.edges.push(
    ...binaries.map((binary) => projectedTrace(capture.id, binary.id)),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    binaries[0]!,
    [binaries[1]!, binaries[2]!],
  );

  assertEquals(
    resolveSealedAssemblyGeometry(snapshot)
      ?.independentPartDefinitionGeometryCount,
    2,
  );
});

Deno.test("v2 geometry fails closed on discontinuous server-owned file indexes", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "1".repeat(64);
  const binaries = [
    projectedV2GeometryBinary(
      captureDigest,
      "2".repeat(64),
      "step",
      "step",
      { scope: "assembly", formatIndex: 0 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      "3".repeat(64),
      "step",
      "step",
      { scope: "definition", definitionIndex: 0, fileIndex: 0 },
    ),
    projectedV2GeometryBinary(
      captureDigest,
      "4".repeat(64),
      "cad-model",
      "glb",
      { scope: "definition", definitionIndex: 0, fileIndex: 2 },
    ),
  ];
  const capture = projectedGeometryCapture(captureDigest);
  snapshot.artifacts.push(capture, ...binaries);
  snapshot.graph.edges.push(
    ...binaries.map((binary) => projectedTrace(capture.id, binary.id)),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    binaries[0]!,
    [binaries[1]!],
  );

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(
    sealedAssemblyGeometryBlocker(snapshot)?.startsWith(
      "The active geometry capture does not project a complete",
    ),
    true,
  );
});

Deno.test("v2 sealed geometry requires the exact sandbox provider namespace", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "5".repeat(64);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "6".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const definitionStep = projectedV2GeometryBinary(
    captureDigest,
    "7".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 0, fileIndex: 0 },
  );
  assemblyStep.system = "build123d";
  const capture = projectedGeometryCapture(captureDigest);
  snapshot.artifacts.push(capture, assemblyStep, definitionStep);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, assemblyStep.id),
    projectedTrace(capture.id, definitionStep.id),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    assemblyStep,
    [definitionStep],
  );

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
});

Deno.test("v2 sealed geometry rejects an extra traced definition without an exact catalog binding", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "6".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "7".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const signedDefinitionStep = projectedV2GeometryBinary(
    captureDigest,
    "8".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 0, fileIndex: 0 },
  );
  snapshot.artifacts.push(capture, assemblyStep, signedDefinitionStep);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, assemblyStep.id),
    projectedTrace(capture.id, signedDefinitionStep.id),
  );
  attachExactV2Catalog(
    snapshot,
    capture.id,
    assemblyStep,
    [signedDefinitionStep],
  );
  assertEquals(
    resolveSealedAssemblyGeometry(snapshot)
      ?.independentPartDefinitionGeometryCount,
    1,
  );

  const unattestedDefinitionStep = projectedV2GeometryBinary(
    captureDigest,
    "9".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 1, fileIndex: 0 },
  );
  snapshot.artifacts.push(unattestedDefinitionStep);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, unattestedDefinitionStep.id),
  );

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(
    sealedAssemblyGeometryBlocker(snapshot)?.includes("exactly linked"),
    true,
  );
});

Deno.test("multiple active geometry captures require one exact projected supersession tip", () => {
  const snapshot = minimalSnapshot();
  const oldDigest = "6".repeat(64);
  const newDigest = "7".repeat(64);
  for (const digest of [oldDigest, newDigest]) {
    const step = projectedGeometryBinary(
      digest,
      digest === oldDigest ? "8".repeat(64) : "9".repeat(64),
      "step",
      "step",
    );
    snapshot.artifacts.push(projectedGeometryCapture(digest), step);
    snapshot.graph.edges.push(projectedTrace(`geometry-${digest}`, step.id));
  }

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(
    sealedAssemblyGeometryBlocker(snapshot)?.startsWith(
      "Multiple active geometry captures",
    ),
    true,
  );

  snapshot.graph.edges.push({
    id: "geometry-supersession",
    from: { kind: "artifact", id: `geometry-${oldDigest}` },
    to: { kind: "artifact", id: `geometry-${newDigest}` },
    relation: "supersedes",
    rationale: "Projected historical-to-successor direction.",
    origin: "provenance",
  });
  assertEquals(
    resolveSealedAssemblyGeometry(snapshot)?.captureArtifact.id,
    `geometry-${newDigest}`,
  );
  assertEquals(sealedAssemblyGeometryBlocker(snapshot), undefined);
});

Deno.test("a system-only v2 catalog admits the unique definition STEP as the assembly result", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "a".repeat(64);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "b".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const definitionStep = projectedV2GeometryBinary(
    captureDigest,
    "c".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 0, fileIndex: 0 },
  );
  const capture = projectedGeometryCapture(captureDigest);
  snapshot.artifacts.push(capture, assemblyStep, definitionStep);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, assemblyStep.id),
    projectedTrace(capture.id, definitionStep.id),
  );
  snapshot.components.components = [{
    id: "system-root",
    label: "CantileverArm",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: assemblyStep.id,
      label: "Authoritative assembly STEP",
      evidenceArtifactId: capture.id,
      status: "verified",
    }, {
      provider: "syson",
      kind: "part-definition",
      id: "part-def-arm",
      label: "CantileverArm",
      evidenceArtifactId: "architecture-1",
      status: "verified",
    }],
  }];

  const sealed = resolveSealedAssemblyGeometry(snapshot);
  assertEquals(sealed?.captureArtifact.id, capture.id);
  assertEquals(sealed?.independentPartDefinitionGeometryCount, 1);
  assertEquals(sealedAssemblyGeometryBlocker(snapshot), undefined);
});

Deno.test("a system-only catalog still refuses several unsigned definition STEPs", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "d".repeat(64);
  const assemblyStep = projectedV2GeometryBinary(
    captureDigest,
    "e".repeat(64),
    "step",
    "step",
    { scope: "assembly", formatIndex: 0 },
  );
  const firstDefinition = projectedV2GeometryBinary(
    captureDigest,
    "f".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 0, fileIndex: 0 },
  );
  const secondDefinition = projectedV2GeometryBinary(
    captureDigest,
    "1".repeat(64),
    "step",
    "step",
    { scope: "definition", definitionIndex: 1, fileIndex: 0 },
  );
  const capture = projectedGeometryCapture(captureDigest);
  snapshot.artifacts.push(
    capture,
    assemblyStep,
    firstDefinition,
    secondDefinition,
  );
  snapshot.graph.edges.push(
    projectedTrace(capture.id, assemblyStep.id),
    projectedTrace(capture.id, firstDefinition.id),
    projectedTrace(capture.id, secondDefinition.id),
  );
  snapshot.components.components = [{
    id: "system-root",
    label: "System",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: assemblyStep.id,
      label: "Authoritative assembly STEP",
      evidenceArtifactId: capture.id,
      status: "verified",
    }],
  }];

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
});

Deno.test("an incomplete active geometry projection is a motivated blocker", () => {
  const snapshot = minimalSnapshot();
  const digest = "c".repeat(64);
  snapshot.artifacts.push(projectedGeometryCapture(digest));

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(
    sealedAssemblyGeometryBlocker(snapshot),
    "The active geometry capture does not project a complete, exactly linked assembly STEP and asset set. Product will not infer a result from labels or timestamps.",
  );
});

Deno.test("component revisions require an explicit catalog anchor", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  snapshot.components.components = [dripTray];
  snapshot.graph.nodes.push({
    id: "graph:change:drip-tray-height",
    ref: { kind: "change", id: "drip-tray-height" },
    entityKind: "change",
    label: "Raise DripTray to 30 mm",
    system: "digital-thread",
    freshness: "fresh",
    summary: "recorded correction",
    recordedAt: "2026-08-03T12:00:00.000Z",
    affectedComponentId: dripTray.id,
  }, {
    id: "graph:change:unanchored",
    ref: { kind: "change", id: "unanchored" },
    entityKind: "change",
    label: "Unanchored correction",
    system: "digital-thread",
    freshness: "fresh",
    summary: "recorded correction",
    recordedAt: "2026-08-03T12:01:00.000Z",
  });

  assertEquals(
    correctionNodesForComponent(snapshot, dripTray).map((node) => node.ref.id),
    ["drip-tray-height"],
  );
});

// ── @3 per-part mesh resolution ───────────────────────────────────────────────

Deno.test("per-part mesh binding resolves via resolveCadSurface as a part surface with preview", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const meshArtifactId = "generic-product-v3-cad-r3-" + "a".repeat(64) +
    "-mesh-drip-tray";
  const meshArtifact: ThreadArtifact = {
    id: meshArtifactId,
    label: "GEN-01 30 mm drip-tray presentation STL",
    kind: "mesh",
    system: "build123d",
    revision: "a".repeat(64),
    freshness: "fresh",
    fingerprint: "sha256:" + "a".repeat(64),
    uri:
      "generic-semantic-cad-r3-capture://test#generic-product-v3-r3-drip-tray.stl",
    producedBy: "build123d_export",
    dependsOn: [],
  };
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "generic-v3:generic-product",
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshArtifactId,
      label: "GEN-01 30 mm drip-tray presentation STL",
      evidenceArtifactId: meshArtifactId,
      status: "verified",
      selection: { kind: "artifact", id: meshArtifactId },
    }],
    preview: {
      provider: "build123d",
      artifactId: meshArtifactId,
      mediaType: "model/stl",
      url: "/api/thread/assets/generic-product-v3-r3-drip-tray.stl",
      sha256: "a".repeat(64),
    },
  };
  snapshot.components.components = [dripTray];
  snapshot.artifacts.push(meshArtifact);

  const surface = resolveCadSurface(snapshot, dripTray);
  assertEquals(surface?.scope, "part");
  assertEquals(surface?.authoritativeArtifact.id, meshArtifactId);
  assertEquals(surface?.preview?.artifactId, meshArtifactId);
  assertEquals(surface?.preview?.url, dripTray.preview!.url);
});

Deno.test("resolveCadMeshStatus distinguishes preview-ready from not-exported from no-binding", () => {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  const meshArtifactId = "generic-product-v3-cad-r3-" + "b".repeat(64) +
    "-mesh-drip-tray";
  const meshArtifact: ThreadArtifact = {
    id: meshArtifactId,
    label: "GEN-01 30 mm drip-tray presentation STL",
    kind: "mesh",
    system: "build123d",
    revision: "b".repeat(64),
    freshness: "fresh",
    fingerprint: "sha256:" + "b".repeat(64),
    uri:
      "generic-semantic-cad-r3-capture://test#generic-product-v3-r3-drip-tray.stl",
    producedBy: "build123d_export",
    dependsOn: [],
  };

  // Component with build123d artifact binding AND a valid preview — ready
  const partWithPreview: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: meshArtifactId,
      label: "mesh",
      evidenceArtifactId: meshArtifactId,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: meshArtifactId,
      mediaType: "model/stl",
      url: "/api/thread/assets/generic-product-v3-r3-drip-tray.stl",
      sha256: "b".repeat(64),
    },
  };

  // Component with binding but no preview (operation not yet run)
  const partWithBinding: ThreadComponent = {
    id: "generic-v3:boiler",
    label: "Boiler",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "build123d",
      kind: "artifact",
      id: "boiler-step",
      label: "Boiler STEP",
      evidenceArtifactId: "boiler-step",
      status: "unverified",
      reason: "Evidence artifact absent.",
    }],
  };

  // Component with no build123d binding
  const partNoBind: ThreadComponent = {
    id: "generic-v3:enclosure",
    label: "Enclosure",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "enc-def",
      label: "Enclosure",
      evidenceArtifactId: "arch",
      status: "unverified",
    }],
  };

  snapshot.components.components = [
    partWithPreview,
    partWithBinding,
    partNoBind,
  ];
  snapshot.artifacts.push(meshArtifact);

  assertEquals(
    resolveCadMeshStatus(snapshot, partWithPreview),
    "preview-ready",
  );
  assertEquals(resolveCadMeshStatus(snapshot, partWithBinding), "not-exported");
  assertEquals(resolveCadMeshStatus(snapshot, partNoBind), "no-binding");
});

// ── SysML sub-tree model ──────────────────────────────────────────────────────

Deno.test("buildSysmlSubtree returns the parent assembly as root and correct siblings for a part", () => {
  const snapshot = minimalSnapshot();
  const assembly: ThreadComponent = {
    id: "generic-v3:generic-product",
    label: "GenericAssembly",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-generic-product",
      label: "GenericAssembly",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "generic-v3:generic-product",
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-drip-tray",
      label: "DripTray",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  const boiler: ThreadComponent = {
    id: "generic-v3:boiler",
    label: "Boiler",
    kind: "part",
    quantity: 1,
    parentId: "generic-v3:generic-product",
    bindings: [],
  };
  snapshot.components.components = [assembly, dripTray, boiler];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(subtree.root.id, "generic-v3:generic-product");
  assertEquals(subtree.root.isCurrent, false);
  assertEquals(subtree.selected.id, "generic-v3:drip-tray");
  assertEquals(subtree.selected.isCurrent, true);
  assertEquals(subtree.selected.elementId, "sysml-drip-tray");
  assertEquals(subtree.siblings.length, 1);
  assertEquals(subtree.siblings[0]?.id, "generic-v3:boiler");
});

Deno.test("buildSysmlSubtree returns the assembly itself as root and selected when the assembly is selected", () => {
  const snapshot = minimalSnapshot();
  const assembly: ThreadComponent = {
    id: "generic-v3:generic-product",
    label: "GenericAssembly",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-generic-product",
      label: "GenericAssembly",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  snapshot.components.components = [assembly];

  const subtree = buildSysmlSubtree(snapshot, assembly);

  assertEquals(subtree.root.id, "generic-v3:generic-product");
  assertEquals(subtree.root.isCurrent, true);
  assertEquals(subtree.selected.id, "generic-v3:generic-product");
  assertEquals(subtree.siblings.length, 0);
});

Deno.test("buildSysmlSubtree anchors requirements by exact SysON element identity", () => {
  const snapshot = minimalSnapshot();
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    parentId: "generic-v3:generic-product",
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "sysml-drip-tray-def",
      label: "DripTray",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  snapshot.components.components = [dripTray];
  snapshot.requirements = [
    {
      id: "req-displacement",
      label: "DripTray displacement",
      source: "syson · sysml-drip-tray-def",
      sourceElementId: "sysml-drip-tray-def",
      expression: "displacement ≤ 1 mm",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for DripTray.",
    },
    {
      id: "req-stress",
      label: "DripTray stress",
      source: "syson · sysml-drip-tray-def",
      sourceElementId: "sysml-drip-tray-def",
      expression: "von_mises ≤ 150 MPa",
      status: "unresolved",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for DripTray.",
    },
    {
      id: "req-boiler",
      label: "Boiler pressure",
      source: "syson · sysml-boiler-def",
      sourceElementId: "sysml-boiler-def",
      expression: "pressure ≤ 15 bar",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale:
        "Fixture requirement for Boiler, must not appear for DripTray.",
    },
  ];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(subtree.anchoredRequirements.length, 2);
  assertEquals(subtree.anchoredRequirements[0]?.id, "req-displacement");
  assertEquals(subtree.anchoredRequirements[1]?.id, "req-stress");
});

Deno.test("buildSysmlSubtree never treats a prefix SysML identity as an anchor", () => {
  const snapshot = minimalSnapshot();
  const component: ThreadComponent = {
    id: "component-1",
    label: "Target",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "id-1",
      label: "Target",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  snapshot.components.components = [component];
  snapshot.requirements = [{
    id: "req-id-1",
    label: "Exact",
    source: "syson · id-1",
    sourceElementId: "id-1",
    expression: "value <= 1",
    status: "pass",
    observationIds: [],
    violationIds: [],
    rationale: "Exact anchor.",
  }, {
    id: "req-id-10",
    label: "Prefix only",
    source: "syson · id-10",
    sourceElementId: "id-10",
    expression: "value <= 1",
    status: "pass",
    observationIds: [],
    violationIds: [],
    rationale: "Different element.",
  }];

  const subtree = buildSysmlSubtree(snapshot, component);

  assertEquals(
    subtree.anchoredRequirements.map((requirement) => requirement.id),
    [
      "req-id-1",
    ],
  );
});

Deno.test("buildSysmlSubtree never binds legacy sensitivity labels to a component", () => {
  const snapshot = minimalSnapshot();
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  snapshot.components.components = [dripTray];
  snapshot.observations = [
    {
      id: "obs-sensitivity-disp",
      label: "DripTray displacement sensitivity (size-z)",
      value: -0.008,
      unit: "mm/mm",
      display: "-0.008 mm/mm",
      sourceArtifactId: "fea-artifact",
      requirementIds: [],
      freshness: "fresh",
      measuredAt: "2026-08-04T10:00:00.000Z",
    },
    {
      id: "obs-sensitivity-stress",
      label: "DripTray von Mises sensitivity (size-z)",
      value: -0.036,
      unit: "MPa/mm",
      display: "-0.036 MPa/mm",
      sourceArtifactId: "fea-artifact",
      requirementIds: [],
      freshness: "fresh",
      measuredAt: "2026-08-04T10:00:00.000Z",
    },
    {
      id: "obs-mass",
      label: "DripTray mass",
      value: 0.042,
      unit: "kg",
      display: "42 g",
      sourceArtifactId: "cad-artifact",
      requirementIds: [],
      freshness: "fresh",
      measuredAt: "2026-08-04T10:00:00.000Z",
    },
  ];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(subtree.sensitivityRecords, []);
});

Deno.test("an unbound canonical sensitivity stays out of the component facet", () => {
  const snapshot = minimalSnapshot();
  const selected: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  snapshot.components.components = [selected];
  snapshot.observations = [{
    id: "misleading-observation",
    label: "DripTray invented sensitivity (size-z)",
    value: 999,
    unit: "mm/mm",
    display: "999 mm/mm",
    sourceArtifactId: "unrelated",
    requirementIds: [],
    freshness: "fresh",
    measuredAt: "2026-08-04T10:00:00.000Z",
  }];
  snapshot.graph.nodes.push(
    {
      id: "graph:analysis-node:driver",
      ref: { kind: "analysis-node", id: "driver" },
      entityKind: "analysis-node",
      label: "size-z",
      system: "thread",
      freshness: "fresh",
      summary: "parameter · thread",
      analysis: {
        semanticRef: { domain: "thread", kind: "parameter", id: "size-z" },
      },
    },
    {
      id: "graph:analysis-node:response",
      ref: { kind: "analysis-node", id: "response" },
      entityKind: "analysis-node",
      label: "assembly_max_displacement",
      system: "calculix",
      freshness: "fresh",
      summary: "metric · calculix",
      analysis: {
        semanticRef: {
          domain: "calculix",
          kind: "metric",
          id: "assembly_max_displacement",
        },
      },
    },
  );
  snapshot.graph.edges.push({
    id: "assertion:local-sensitivity",
    from: { kind: "analysis-node", id: "driver" },
    to: { kind: "analysis-node", id: "response" },
    relation: "measured-local-sensitivity",
    rationale: "Measured by a reviewed forward finite difference.",
    origin: "analysis",
    analysis: {
      assertionId: "assertion:local-sensitivity",
      epistemicBasis: "observed",
      assertedBy: { kind: "server", id: "digital-thread", version: "1" },
      evidence: [{ id: "capture", fingerprint: "a".repeat(64) }],
      scope: {
        kind: "local-neighborhood",
        parameter: { domain: "thread", kind: "parameter", id: "size-z" },
        basisFingerprint: "a".repeat(64),
        lower: { value: 29, unit: "mm" },
        upper: { value: 31, unit: "mm" },
      },
      measurement: {
        method: "forward-finite-difference",
        basePoint: { value: 30, unit: "mm" },
        perturbationStep: { value: 1, unit: "mm" },
        responseAtBase: { value: 0.1, unit: "mm" },
        responseAtPerturbed: { value: 0.092, unit: "mm" },
        derivative: { value: -0.008, unit: "mm/mm" },
      },
    },
  });

  const subtree = buildSysmlSubtree(snapshot, selected);

  assertEquals(subtree.sensitivityRecords, []);
});

Deno.test("a canonical sensitivity is not shown for a different selected component", () => {
  const snapshot = minimalSnapshot();
  const dripTray: ThreadComponent = {
    id: "generic-v3:drip-tray",
    label: "DripTray",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  const boiler: ThreadComponent = {
    id: "generic-v3:boiler",
    label: "Boiler",
    kind: "part",
    quantity: 1,
    bindings: [],
  };
  snapshot.components.components = [dripTray, boiler];
  snapshot.graph.nodes.push(
    analysisNode("driver", "parameter", "size-z"),
    analysisNode("response", "metric", "assembly_max_displacement"),
  );
  snapshot.graph.edges.push(
    measuredSensitivityEdge("driver", "response"),
  );

  assertEquals(buildSysmlSubtree(snapshot, boiler).sensitivityRecords, []);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function minimalSnapshot(): ThreadWorkbenchSnapshot {
  const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  snapshot.components.components = [];
  snapshot.requirements = [];
  snapshot.observations = [];
  return snapshot;
}

function analysisNode(
  id: string,
  kind: "component" | "parameter" | "metric",
  semanticId: string,
): ThreadGraphNode {
  const domain = kind === "metric" ? "calculix" as const : "thread" as const;
  return {
    id: `graph:analysis-node:${id}`,
    ref: { kind: "analysis-node", id },
    entityKind: "analysis-node",
    label: semanticId,
    system: domain,
    freshness: "fresh",
    summary: `${kind} · ${domain}`,
    analysis: { semanticRef: { domain, kind, id: semanticId } },
  };
}

function measuredSensitivityEdge(
  parameterNodeId: string,
  responseNodeId: string,
): ThreadGraphEdge {
  return {
    id: "assertion:local-sensitivity",
    from: { kind: "analysis-node", id: parameterNodeId },
    to: { kind: "analysis-node", id: responseNodeId },
    relation: "measured-local-sensitivity",
    rationale: "Measured by a reviewed forward finite difference.",
    origin: "analysis",
    analysis: {
      assertionId: "assertion:local-sensitivity",
      epistemicBasis: "observed",
      assertedBy: { kind: "server", id: "digital-thread", version: "1" },
      evidence: [{ id: "capture", fingerprint: "a".repeat(64) }],
      scope: {
        kind: "local-neighborhood",
        parameter: { domain: "thread", kind: "parameter", id: "size-z" },
        basisFingerprint: "a".repeat(64),
        lower: { value: 29, unit: "mm" },
        upper: { value: 31, unit: "mm" },
      },
      measurement: {
        method: "forward-finite-difference",
        basePoint: { value: 30, unit: "mm" },
        perturbationStep: { value: 1, unit: "mm" },
        responseAtBase: { value: 0.1, unit: "mm" },
        responseAtPerturbed: { value: 0.092, unit: "mm" },
        derivative: { value: -0.008, unit: "mm/mm" },
      },
    },
  };
}

function artifact(
  id: string,
  kind: string,
  uri: string,
  digestCharacter: string,
): ThreadArtifact {
  return {
    id,
    label: id,
    kind,
    system: "build123d",
    revision: digestCharacter.repeat(64),
    freshness: "fresh",
    fingerprint: `sha256:${digestCharacter.repeat(64)}`,
    uri,
    producedBy: "build123d_export",
    dependsOn: [],
  };
}

function projectedGeometryCapture(digest: string): ThreadArtifact {
  return {
    id: `geometry-${digest}`,
    label: "Geometry capture",
    kind: "cad-model",
    system: "digital-thread",
    revision: digest,
    freshness: "fresh",
    fingerprint: `sha256:${digest}`,
    uri: `casys://geometry-capture/sha256/${digest}`,
    dependsOn: [],
  };
}

function projectedGeometryBinary(
  captureDigest: string,
  assetDigest: string,
  kind: string,
  extension: string,
): ThreadArtifact {
  const prefix = kind === "mesh" ? "mesh" : "cad-asset";
  return {
    id: `${prefix}-${captureDigest}-${assetDigest}`,
    label: `${extension.toUpperCase()} geometry asset`,
    kind,
    system: "build123d-sandbox",
    revision: assetDigest,
    freshness: "fresh",
    fingerprint: `sha256:${assetDigest}`,
    uri: `/api/thread/assets/${assetDigest}.${extension}`,
    dependsOn: [],
  };
}

function projectedV2GeometryBinary(
  captureDigest: string,
  assetDigest: string,
  kind: string,
  extension: string,
  identity:
    | { scope: "assembly"; formatIndex: number }
    | { scope: "definition"; definitionIndex: number; fileIndex: number },
): ThreadArtifact {
  const identitySegment = identity.scope === "assembly"
    ? `assembly-${identity.formatIndex}`
    : `definition-${identity.definitionIndex}-${identity.fileIndex}`;
  return {
    id: `cad-asset-${captureDigest}-${identitySegment}-${assetDigest}`,
    label: `${extension.toUpperCase()} geometry asset`,
    kind,
    system: "build123d-sandbox",
    revision: assetDigest,
    freshness: "fresh",
    fingerprint: `sha256:${assetDigest}`,
    uri: `/api/thread/assets/${assetDigest}.${extension}`,
    dependsOn: [],
  };
}

function projectedTrace(fromId: string, toId: string) {
  return {
    id: `trace-${fromId}-${toId}`,
    from: { kind: "artifact" as const, id: fromId },
    to: { kind: "artifact" as const, id: toId },
    relation: "traces_to" as const,
    rationale: "Exact projected trace from capture to binary.",
    origin: "provenance" as const,
  };
}

function attachExactV2Catalog(
  snapshot: ThreadWorkbenchSnapshot,
  captureArtifactId: string,
  assemblyStep: ThreadArtifact,
  definitionSteps: readonly ThreadArtifact[],
  occurrenceCounts: readonly number[] = definitionSteps.map(() => 1),
  definitionGlbs: readonly (ThreadArtifact | undefined)[] = [],
): void {
  const binding = (artifact: ThreadArtifact) => ({
    provider: "digital-thread" as const,
    kind: "artifact" as const,
    id: artifact.id,
    label: "Authoritative STEP",
    evidenceArtifactId: captureArtifactId,
    status: "verified" as const,
    selection: { kind: "artifact" as const, id: captureArtifactId },
  });
  snapshot.components.components = [
    {
      id: "system-root",
      label: "System",
      kind: "assembly",
      quantity: 1,
      bindings: [binding(assemblyStep)],
    },
    ...definitionSteps.flatMap((step, definitionIndex) =>
      Array.from(
        { length: occurrenceCounts[definitionIndex] ?? 1 },
        (_, occurrenceIndex) => ({
          id: `usage-${definitionIndex}-${occurrenceIndex}`,
          parentId: "system-root",
          label: `Part ${definitionIndex + 1}.${occurrenceIndex + 1}`,
          kind: "part" as const,
          quantity: 1,
          bindings: [binding(step)],
          ...(definitionGlbs[definitionIndex]
            ? {
              preview: {
                provider: "build123d" as const,
                artifactId: definitionGlbs[definitionIndex]!.id,
                mediaType: "model/gltf-binary" as const,
                url: definitionGlbs[definitionIndex]!.uri!,
                sha256: definitionGlbs[definitionIndex]!.fingerprint!.replace(
                  "sha256:",
                  "",
                ),
              },
            }
            : {}),
        }),
      )
    ),
  ];
}
