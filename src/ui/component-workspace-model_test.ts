import { assertEquals, assertStringIncludes } from "@std/assert";
import { exactThreadAssetHref } from "./src/cad/exact-thread-asset.ts";
import {
  buildComponentTree,
  buildSysmlSubtree,
  cadSurfaceCoverage,
  correctionNodesForComponent,
  isDuplicateSealedGlbCopy,
  resolveCadMeshStatus,
  resolveCadSurface,
  resolveSealedAssemblyGeometry,
  sealedAssemblyGeometryBlocker,
  sealedAssemblyGlbAsset,
  sealedGlbPreviewBlocks,
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
  const glbDigest = "5ae73d2321bf164be3ea4085c52ef9a0a4b92ac5cf8d6b5cde6fd93001e20d6f";
  const stepDigest = "9ffb695f17d6f92d8e203143f0d79830754c711fff1656067420a1648e54ba56";
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

Deno.test("a targeted PartDefinition capture resolves its exact STEP and GLB without an assembly claim", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "3".repeat(64);
  const stepDigest = "4".repeat(64);
  const glbDigest = "5".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const step = projectedTargetGeometryBinary(
    captureDigest,
    stepDigest,
    "step",
    "step",
    0,
  );
  const glb = projectedTargetGeometryBinary(
    captureDigest,
    glbDigest,
    "cad-model",
    "glb",
    1,
  );
  snapshot.artifacts.push(capture, step, glb);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, step.id),
    projectedTrace(capture.id, glb.id),
  );
  snapshot.components.components = [{
    id: "usage-arm",
    label: "Arm",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "definition-arm",
      label: "Arm",
      evidenceArtifactId: "architecture-arm",
      status: "verified",
    }, {
      provider: "digital-thread",
      kind: "artifact",
      id: step.id,
      label: "Authoritative STEP: Arm",
      evidenceArtifactId: capture.id,
      status: "verified",
      selection: { kind: "artifact", id: capture.id },
    }],
    preview: {
      provider: "build123d",
      artifactId: glb.id,
      mediaType: "model/gltf-binary",
      url: glb.uri!,
      sha256: glbDigest,
    },
  }];

  const surface = resolveCadSurface(
    snapshot,
    snapshot.components.components[0]!,
  );

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(surface?.scope, "part");
  assertEquals(surface?.representation, "authoritative-step");
  assertEquals(surface?.authoritativeArtifact.id, step.id);
  assertEquals(surface?.presentationArtifact?.id, glb.id);
  assertEquals(surface?.preview?.url, glb.uri);
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 0,
    partSurfaces: 1,
    totalComponents: 1,
  });
  assertEquals(sealedAssemblyGeometryBlocker(snapshot), undefined);
});

Deno.test("root module STEP and GLB resolve while an unrelated active leaf capture coexists", () => {
  const snapshot = minimalSnapshot();
  const moduleDigest = "a".repeat(64);
  const stepDigest = "b".repeat(64);
  const glbDigest = "c".repeat(64);
  const leafDigest = "d".repeat(64);
  const leafStepDigest = "e".repeat(64);
  const leafGlbDigest = "f".repeat(64);
  const moduleCapture = projectedGeometryCapture(moduleDigest);
  const moduleStep = projectedModuleGeometryBinary(
    moduleDigest,
    stepDigest,
    "step",
    "step",
  );
  const moduleGlb = projectedModuleGeometryBinary(
    moduleDigest,
    glbDigest,
    "cad-model",
    "glb",
  );
  const leafCapture = projectedGeometryCapture(leafDigest);
  const leafStep = projectedTargetGeometryBinary(
    leafDigest,
    leafStepDigest,
    "step",
    "step",
    0,
  );
  const leafGlb = projectedTargetGeometryBinary(
    leafDigest,
    leafGlbDigest,
    "cad-model",
    "glb",
    1,
  );
  snapshot.artifacts.push(
    moduleCapture,
    moduleStep,
    moduleGlb,
    leafCapture,
    leafStep,
    leafGlb,
  );
  snapshot.graph.edges.push(
    projectedTrace(moduleCapture.id, moduleStep.id),
    projectedTrace(moduleCapture.id, moduleGlb.id),
    projectedTrace(leafCapture.id, leafStep.id),
    projectedTrace(leafCapture.id, leafGlb.id),
  );
  const root: ThreadComponent = {
    id: "system-root",
    label: "Module",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: moduleStep.id,
      label: "Authoritative module STEP",
      evidenceArtifactId: moduleCapture.id,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: moduleGlb.id,
      mediaType: "model/gltf-binary",
      url: moduleGlb.uri!,
      sha256: glbDigest,
    },
  };
  const leaf: ThreadComponent = {
    id: "usage-leaf",
    parentId: root.id,
    label: "Leaf",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: leafStep.id,
      label: "Authoritative STEP: Leaf",
      evidenceArtifactId: leafCapture.id,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: leafGlb.id,
      mediaType: "model/gltf-binary",
      url: leafGlb.uri!,
      sha256: leafGlbDigest,
    },
  };
  snapshot.components.components = [root, leaf];

  const surface = resolveCadSurface(snapshot, root);
  const sealed = resolveSealedAssemblyGeometry(snapshot);
  const leafSurface = resolveCadSurface(snapshot, leaf);

  assertEquals(surface?.scope, "assembly");
  assertEquals(surface?.representation, "authoritative-step");
  assertEquals(surface?.authoritativeArtifact.id, moduleStep.id);
  assertEquals(surface?.presentationArtifact?.id, moduleGlb.id);
  assertEquals(surface?.preview?.url, moduleGlb.uri);
  assertEquals(sealed?.captureArtifact.id, moduleCapture.id);
  assertEquals(sealed?.assemblyFormats, ["STEP", "GLB"]);
  assertEquals(sealedAssemblyGlbAsset(sealed!)?.id, moduleGlb.id);
  assertEquals(sealedAssemblyGeometryBlocker(snapshot), undefined);
  assertEquals(leafSurface?.scope, "part");
  assertEquals(leafSurface?.authoritativeArtifact.id, leafStep.id);
  assertEquals(leafSurface?.presentationArtifact?.id, leafGlb.id);
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 1,
    partSurfaces: 1,
    totalComponents: 2,
  });
});

Deno.test("a child module binding is not the product assembly when the root is unbound", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "1".repeat(64);
  const stepDigest = "2".repeat(64);
  const glbDigest = "3".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const step = projectedModuleGeometryBinary(
    captureDigest,
    stepDigest,
    "step",
    "step",
  );
  const glb = projectedModuleGeometryBinary(
    captureDigest,
    glbDigest,
    "cad-model",
    "glb",
  );
  snapshot.artifacts.push(capture, step, glb);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, step.id),
    projectedTrace(capture.id, glb.id),
  );
  const root: ThreadComponent = {
    id: "system-root",
    label: "System",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "syson",
      kind: "part-definition",
      id: "def-system",
      label: "System",
      evidenceArtifactId: "architecture",
      status: "verified",
    }],
  };
  const child: ThreadComponent = {
    id: "usage-module",
    parentId: root.id,
    label: "Child module",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: step.id,
      label: "Authoritative module STEP",
      evidenceArtifactId: capture.id,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: glb.id,
      mediaType: "model/gltf-binary",
      url: glb.uri!,
      sha256: glbDigest,
    },
  };
  snapshot.components.components = [root, child];

  const childSurface = resolveCadSurface(snapshot, child);

  assertEquals(childSurface?.scope, "part");
  assertEquals(childSurface?.authoritativeArtifact.id, step.id);
  assertEquals(childSurface?.presentationArtifact?.id, glb.id);
  assertEquals(resolveCadSurface(snapshot, root), undefined);
  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(cadSurfaceCoverage(snapshot), {
    assemblySurfaces: 0,
    partSurfaces: 1,
    totalComponents: 2,
  });
});

Deno.test("module binaries fail closed on the wrong tool, system, id, URI, or trace", () => {
  const assertClosed = (
    mutate: (fixture: ReturnType<typeof moduleAssemblyFixture>) => void,
  ) => {
    const fixture = moduleAssemblyFixture();
    mutate(fixture);
    assertEquals(resolveCadSurface(fixture.snapshot, fixture.root), undefined);
    assertEquals(resolveSealedAssemblyGeometry(fixture.snapshot), undefined);
  };

  assertClosed(({ step }) => {
    step.producedBy = "build123d-module-assembler-v1@1";
  });
  assertClosed(({ step }) => {
    step.producedBy = "lookalike-module-assembler-v1@1.0.0";
  });
  assertClosed(({ step }) => {
    step.system = "build123d-sandbox";
  });
  assertClosed(({ step, root }) => {
    const wrongId = `cad-asset-${"a".repeat(64)}-assembly-0-${"b".repeat(64)}`;
    step.id = wrongId;
    root.bindings[0]!.id = wrongId;
  });
  assertClosed(({ step }) => {
    step.uri = `/exports/module-${"b".repeat(64)}.step`;
  });
  assertClosed(({ snapshot, capture, step }) => {
    snapshot.graph.edges.push({
      ...projectedTrace(capture.id, step.id),
      id: "duplicate-module-trace",
    });
  });
});

Deno.test("legacy targeted PartDefinition validation stays exact after module classification", () => {
  const snapshot = minimalSnapshot();
  const captureDigest = "3".repeat(64);
  const stepDigest = "4".repeat(64);
  const glbDigest = "5".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const step = projectedTargetGeometryBinary(
    captureDigest,
    stepDigest,
    "step",
    "step",
    0,
  );
  const glb = projectedTargetGeometryBinary(
    captureDigest,
    glbDigest,
    "cad-model",
    "glb",
    1,
  );
  snapshot.artifacts.push(capture, step, glb);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, step.id),
    projectedTrace(capture.id, glb.id),
  );
  snapshot.components.components = [{
    id: "usage-arm",
    label: "Arm",
    kind: "part",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: step.id,
      label: "Authoritative STEP: Arm",
      evidenceArtifactId: capture.id,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: glb.id,
      mediaType: "model/gltf-binary",
      url: glb.uri!,
      sha256: glbDigest,
    },
  }];

  const surface = resolveCadSurface(
    snapshot,
    snapshot.components.components[0]!,
  );

  assertEquals(resolveSealedAssemblyGeometry(snapshot), undefined);
  assertEquals(surface?.scope, "part");
  assertEquals(surface?.authoritativeArtifact.id, step.id);
  assertEquals(surface?.presentationArtifact?.id, glb.id);
  assertEquals(sealedAssemblyGeometryBlocker(snapshot), undefined);

  step.system = "digital-thread";
  step.producedBy = "build123d-module-assembler-v1@1.0.0";
  assertEquals(
    resolveCadSurface(snapshot, snapshot.components.components[0]!),
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

Deno.test("duplicate GLB copies collapse only when both blocks share the same sha256", () => {
  const digest = "a".repeat(64);
  const assembly = projectedV2GeometryBinary(
    "b".repeat(64),
    digest,
    "cad-model",
    "glb",
    { scope: "assembly", formatIndex: 1 },
  );
  const preview = {
    provider: "build123d" as const,
    artifactId: "definition-glb",
    mediaType: "model/gltf-binary" as const,
    url: `/api/thread/assets/${digest}.glb`,
    sha256: digest,
  };

  assertEquals(sealedGlbPreviewBlocks(assembly, preview), {
    assembly,
    definition: undefined,
  });

  const otherPreview = { ...preview, sha256: "c".repeat(64) };
  assertEquals(sealedGlbPreviewBlocks(assembly, otherPreview), {
    assembly,
    definition: otherPreview,
  });
  assertEquals(isDuplicateSealedGlbCopy(digest, [digest]), true);
  assertEquals(isDuplicateSealedGlbCopy(digest, ["c".repeat(64)]), false);
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

Deno.test("exactThreadAssetHref admits matching relative STEP and GLB URIs", () => {
  const digest = "a".repeat(64);
  const fingerprint = `sha256:${digest}`;
  const stepUri = `/api/thread/assets/${digest}.step`;
  const glbUri = `/api/thread/assets/${digest}.glb`;
  assertEquals(exactThreadAssetHref(stepUri, fingerprint, "step"), stepUri);
  assertEquals(exactThreadAssetHref(glbUri, fingerprint, "glb"), glbUri);
});

Deno.test("exactThreadAssetHref rejects absent, bare, mismatched, or widened identities", () => {
  const digest = "a".repeat(64);
  const fingerprint = `sha256:${digest}`;
  const stepUri = `/api/thread/assets/${digest}.step`;
  const glbUri = `/api/thread/assets/${digest}.glb`;
  assertEquals(exactThreadAssetHref(stepUri, undefined, "step"), undefined);
  assertEquals(exactThreadAssetHref(stepUri, digest, "step"), undefined);
  assertEquals(
    exactThreadAssetHref(stepUri, `sha256:${digest.toUpperCase()}`, "step"),
    undefined,
  );
  assertEquals(exactThreadAssetHref(undefined, fingerprint, "step"), undefined);
  assertEquals(
    exactThreadAssetHref(
      `https://evil.example/api/thread/assets/${digest}.step`,
      fingerprint,
      "step",
    ),
    undefined,
  );
  assertEquals(
    exactThreadAssetHref(
      `https://localhost/api/thread/assets/${digest}.step`,
      fingerprint,
      "step",
    ),
    undefined,
  );
  assertEquals(
    exactThreadAssetHref(
      `/api/thread/assets/${"b".repeat(64)}.step`,
      fingerprint,
      "step",
    ),
    undefined,
  );
  assertEquals(exactThreadAssetHref(glbUri, fingerprint, "step"), undefined);
  assertEquals(exactThreadAssetHref(stepUri, fingerprint, "glb"), undefined);
  assertEquals(
    exactThreadAssetHref(
      `/api/thread/assets/${digest.toUpperCase()}.step`,
      fingerprint,
      "step",
    ),
    undefined,
  );
  assertEquals(
    exactThreadAssetHref(`${stepUri}?download=1`, fingerprint, "step"),
    undefined,
  );
  assertEquals(
    exactThreadAssetHref(`${stepUri}#fragment`, fingerprint, "step"),
    undefined,
  );
  assertEquals(
    exactThreadAssetHref(`${stepUri}.bak`, fingerprint, "step"),
    undefined,
  );
});

Deno.test("Product CAD opens exact STEP and GLB as accessible GET links", async () => {
  const product = await Deno.readTextFile(
    new URL("./src/thread/component-workspace.tsx", import.meta.url),
  );
  const links = await Deno.readTextFile(
    new URL("./src/cad/thread-asset-open-links.tsx", import.meta.url),
  );
  assertStringIncludes(product, 'from "../cad/thread-asset-open-links.tsx"');
  assertStringIncludes(product, "<ThreadAssetOpenLinks");
  assertStringIncludes(links, "{`Open ${format}`}");
  assertStringIncludes(links, 'target="_blank"');
  assertStringIncludes(links, 'rel="noreferrer"');
  assertStringIncludes(links, "aria-label={`Open ${format} for ${subject}`}");
  assertStringIncludes(links, "Open CAD assets for ${subject}");
  assertEquals(links.includes('method="POST"'), false);
  assertEquals(links.includes('method: "POST"'), false);
  assertEquals(links.includes("download="), false);
  assertEquals(links.includes("fetch("), false);
  assertEquals(product.includes('method="POST"'), false);
  assertEquals(product.includes('method: "POST"'), false);
  assertEquals(product.includes("download="), false);
  assertEquals(product.includes("fetch("), false);
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
      "The active geometry capture does not project an exactly linked",
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
    "The active geometry capture does not project an exactly linked assembly or targeted PartDefinition STEP and asset set. Product will not infer a result from labels or timestamps.",
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
    uri: "generic-semantic-cad-r3-capture://test#generic-product-v3-r3-drip-tray.stl",
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
    uri: "generic-semantic-cad-r3-capture://test#generic-product-v3-r3-drip-tray.stl",
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

Deno.test("buildSysmlSubtree anchors requirements by exact target PartDefinition, not RequirementUsage", () => {
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
    }, {
      provider: "syson",
      kind: "part-usage",
      id: "sysml-drip-tray-usage",
      label: "dripTray",
      evidenceArtifactId: "arch",
      status: "verified",
    }],
  };
  snapshot.components.components = [dripTray];
  snapshot.requirements = [
    {
      id: "req-displacement",
      label: "DripTray displacement",
      source: "syson · requirement-usage:displacement",
      sourceElementId: "requirement-usage:displacement",
      targetElementId: "sysml-drip-tray-def",
      expression: "displacement ≤ 1 mm",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for DripTray.",
    },
    {
      id: "req-stress",
      label: "DripTray stress",
      source: "syson · requirement-usage:stress",
      sourceElementId: "requirement-usage:stress",
      targetElementId: "sysml-drip-tray-def",
      expression: "von_mises ≤ 150 MPa",
      status: "unresolved",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for DripTray.",
    },
    {
      id: "req-boiler",
      label: "Boiler pressure",
      source: "syson · requirement-usage:boiler",
      sourceElementId: "requirement-usage:boiler",
      targetElementId: "sysml-boiler-def",
      expression: "pressure ≤ 15 bar",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "Fixture requirement for Boiler, must not appear for DripTray.",
    },
    {
      id: "req-first-binding-decoy",
      label: "Must not join via first SysON binding",
      source: "syson · sysml-drip-tray-usage",
      sourceElementId: "sysml-drip-tray-usage",
      expression: "value <= 1",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "sourceElementId is a PartUsage, not a target.",
    },
  ];

  const subtree = buildSysmlSubtree(snapshot, dripTray);

  assertEquals(
    subtree.anchoredRequirements.map((requirement) => requirement.id),
    ["req-displacement", "req-stress"],
  );
});

Deno.test(
  "buildSysmlSubtree never lets a contradictory constrained_by edge override targetElementId",
  () => {
    const snapshot = minimalSnapshot();
    const dripTray: ThreadComponent = {
      id: "generic-v3:drip-tray",
      label: "DripTray",
      kind: "part",
      quantity: 1,
      bindings: [{
        provider: "syson",
        kind: "part-definition",
        id: "sysml-drip-tray-def",
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
      bindings: [{
        provider: "syson",
        kind: "part-definition",
        id: "sysml-boiler-def",
        label: "Boiler",
        evidenceArtifactId: "arch",
        status: "verified",
      }],
    };
    snapshot.components.components = [dripTray, boiler];
    snapshot.requirements = [{
      id: "req-displacement",
      label: "DripTray displacement",
      source: "syson · requirement-usage:displacement",
      sourceElementId: "requirement-usage:displacement",
      targetElementId: "sysml-drip-tray-def",
      expression: "displacement ≤ 1 mm",
      status: "pass",
      observationIds: [],
      violationIds: [],
      rationale: "Exact target is DripTray.",
    }];
    snapshot.graph.edges.push({
      id: "edge-contradictory",
      from: { kind: "part-definition", id: "sysml-boiler-def" },
      to: { kind: "requirement", id: "req-displacement" },
      relation: "constrained_by",
      rationale: "Contradictory edge must not override targetElementId.",
      origin: "structure",
    });

    assertEquals(
      buildSysmlSubtree(snapshot, dripTray).anchoredRequirements.map((item) => item.id),
      ["req-displacement"],
    );
    assertEquals(
      buildSysmlSubtree(snapshot, boiler).anchoredRequirements,
      [],
    );
  },
);

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
    source: "syson · requirement-usage:1",
    sourceElementId: "requirement-usage:1",
    targetElementId: "id-1",
    expression: "value <= 1",
    status: "pass",
    observationIds: [],
    violationIds: [],
    rationale: "Exact anchor.",
  }, {
    id: "req-id-10",
    label: "Prefix only",
    source: "syson · requirement-usage:10",
    sourceElementId: "requirement-usage:10",
    targetElementId: "id-10",
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

function projectedModuleGeometryBinary(
  captureDigest: string,
  assetDigest: string,
  kind: "step" | "cad-model",
  extension: "step" | "glb",
): ThreadArtifact {
  const role = extension === "step" ? "module-step" : "module-glb";
  return {
    id: `cad-asset-${captureDigest}-${role}-${assetDigest}`,
    label: `${extension.toUpperCase()} module geometry asset`,
    kind,
    system: "digital-thread",
    revision: assetDigest,
    freshness: "fresh",
    fingerprint: `sha256:${assetDigest}`,
    uri: `/api/thread/assets/${assetDigest}.${extension}`,
    producedBy: "build123d-module-assembler-v1@1.0.0",
    dependsOn: [],
  };
}

function moduleAssemblyFixture(): {
  snapshot: ThreadWorkbenchSnapshot;
  root: ThreadComponent;
  capture: ThreadArtifact;
  step: ThreadArtifact;
  glb: ThreadArtifact;
} {
  const snapshot = minimalSnapshot();
  const captureDigest = "a".repeat(64);
  const stepDigest = "b".repeat(64);
  const glbDigest = "c".repeat(64);
  const capture = projectedGeometryCapture(captureDigest);
  const step = projectedModuleGeometryBinary(
    captureDigest,
    stepDigest,
    "step",
    "step",
  );
  const glb = projectedModuleGeometryBinary(
    captureDigest,
    glbDigest,
    "cad-model",
    "glb",
  );
  snapshot.artifacts.push(capture, step, glb);
  snapshot.graph.edges.push(
    projectedTrace(capture.id, step.id),
    projectedTrace(capture.id, glb.id),
  );
  const root: ThreadComponent = {
    id: "system-root",
    label: "Module",
    kind: "assembly",
    quantity: 1,
    bindings: [{
      provider: "digital-thread",
      kind: "artifact",
      id: step.id,
      label: "Authoritative module STEP",
      evidenceArtifactId: capture.id,
      status: "verified",
    }],
    preview: {
      provider: "build123d",
      artifactId: glb.id,
      mediaType: "model/gltf-binary",
      url: glb.uri!,
      sha256: glbDigest,
    },
  };
  snapshot.components.components = [root];
  return { snapshot, root, capture, step, glb };
}

function projectedTargetGeometryBinary(
  captureDigest: string,
  assetDigest: string,
  kind: string,
  extension: string,
  fileIndex: number,
): ThreadArtifact {
  return {
    id: `cad-asset-${captureDigest}-target-${fileIndex}-${assetDigest}`,
    label: `${extension.toUpperCase()} targeted geometry asset`,
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

Deno.test("the product tree nests on declared parentId and never loses a component", () => {
  const component = (
    id: string,
    parentId?: string,
  ): ThreadComponent => ({
    id,
    label: id,
    kind: "part",
    quantity: 1,
    ...(parentId === undefined ? {} : { parentId }),
    bindings: [],
  });
  const catalog = {
    ...GENERIC_THREAD_FIXTURE.components,
    components: [
      component("root"),
      component("child", "root"),
      // Parent absent du catalogue : le composant doit remonter à la racine.
      // Le masquer ferait passer un catalogue incomplet pour complet.
      component("orphan", "missing-parent"),
    ],
  };

  const tree = buildComponentTree(catalog);
  assertEquals(tree.map((node) => node.id), ["root", "orphan"]);
  assertEquals(tree[0]?.children.map((node) => node.id), ["child"]);
});

Deno.test("a cyclic parentId is cut instead of rendering forever", () => {
  const catalog = {
    ...GENERIC_THREAD_FIXTURE.components,
    components: [
      {
        id: "a",
        label: "a",
        kind: "part" as const,
        quantity: 1,
        parentId: "b",
        bindings: [],
      },
      {
        id: "b",
        label: "b",
        kind: "part" as const,
        quantity: 1,
        parentId: "a",
        bindings: [],
      },
    ],
  };

  // Deux composants parents l'un de l'autre : aucun n'est racine, donc l'arbre
  // est vide — mais la projection doit rendre, pas boucler.
  assertEquals(buildComponentTree(catalog).length, 0);
});
