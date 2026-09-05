/**
 * Fixture-specific semantic oracle for the private two-bracket qualification.
 *
 * This is intentionally not part of the generic module-assembly validator:
 * production assembly accepts any closed bundle, while this private fixture
 * must prove that both declared placements survived export. It reuses the
 * reviewed local OCCT reader and never invokes AssemblyIntegrity.
 */

import { loadOcctStepReader } from "../isolated/occt-step-output-validator.ts";

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const GLB_HEADER_BYTES = 12;
const GLB_CHUNK_HEADER_BYTES = 8;
const EXPECTED_TRANSLATION_X_MM = 80;
const TOLERANCE = 1e-3;
const NORMAL_TOLERANCE = 1e-6;
const GLB_JSON_DECODER = new TextDecoder("utf-8", { fatal: true });

export class GeometryModuleAssemblerQualificationOracleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GeometryModuleAssemblerQualificationOracleError";
  }
}

export async function assertTwoBracketQualificationSemantics(
  childStepBytes: Uint8Array,
  stepBytes: Uint8Array,
  glbBytes: Uint8Array,
): Promise<void> {
  const results = await Promise.allSettled([
    assertTwoBracketStepSemantics(childStepBytes, stepBytes),
    assertGlbHasPublishedMeshPrimitives(glbBytes),
  ]);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  if (rejected) throw rejected.reason;
}

/**
 * `occt-import-js` bakes the fixture's Compound locations into mesh positions.
 * Its actual result is a meshless root with one meshless Compound container,
 * followed by exactly two leaf Compounds with one mesh each. It does not
 * expose a transformation matrix.
 */
async function assertTwoBracketStepSemantics(
  childStepBytes: Uint8Array,
  assemblyStepBytes: Uint8Array,
): Promise<void> {
  let childParsed: unknown;
  let assemblyParsed: unknown;
  try {
    const reader = await loadOcctStepReader();
    [childParsed, assemblyParsed] = [
      reader.ReadStepFile(childStepBytes, { linearUnit: "millimeter" }),
      reader.ReadStepFile(assemblyStepBytes, { linearUnit: "millimeter" }),
    ];
  } catch (cause) {
    throw oracleError("STEP semantic oracle could not reopen the publication.", cause);
  }

  try {
    if (
      objectField(childParsed, "success") !== true ||
      objectField(assemblyParsed, "success") !== true
    ) {
      throw new GeometryModuleAssemblerQualificationOracleError(
        "STEP semantic oracle rejected the publication.",
      );
    }
    const childRoot = asRecord(objectField(childParsed, "root"));
    const childMeshes = arrayField(childParsed, "meshes");
    const childGeometry = readStepMesh(
      childMeshes[exactFixtureChildMesh(childRoot, childMeshes.length)],
    );
    const root = asRecord(objectField(assemblyParsed, "root"));
    const meshes = arrayField(assemblyParsed, "meshes");
    const occurrences = exactFixtureOccurrenceMeshes(root, meshes.length);
    const geometry = occurrences.map((index) => readStepMesh(meshes[index]));
    assertSameBracketAtExpectedPlacement(childGeometry, geometry[0]!, {
      x: 0,
      y: 0,
      z: 0,
    });
    assertSameBracketAtExpectedPlacement(childGeometry, geometry[1]!, {
      x: EXPECTED_TRANSLATION_X_MM,
      y: 0,
      z: 0,
    });
  } catch (cause) {
    if (cause instanceof GeometryModuleAssemblerQualificationOracleError) {
      throw cause;
    }
    throw oracleError(
      "STEP semantic oracle could not inspect the fixture geometry.",
      cause,
    );
  }
}

function exactFixtureChildMesh(
  root: Record<string, unknown>,
  meshCount: number,
): number {
  const rootMeshes = arrayField(root, "meshes");
  const children = arrayField(root, "children");
  if (rootMeshes.length !== 0 || children.length !== 1) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification fixture must expose one referenced bracket mesh.",
    );
  }
  const node = asRecord(children[0]);
  const nodeMeshes = arrayField(node, "meshes");
  if (arrayField(node, "children").length !== 0 || nodeMeshes.length !== 1) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification fixture must expose one referenced bracket mesh.",
    );
  }
  const meshIndex = nodeMeshes[0];
  if (
    typeof meshIndex !== "number" || !Number.isSafeInteger(meshIndex) ||
    meshIndex < 0 || meshIndex >= meshCount
  ) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification fixture references an invalid mesh.",
    );
  }
  return meshIndex;
}

/**
 * The qualification does not accept a generic assembly hierarchy. The pinned
 * fixture reader exposes a single meshless Compound under the root, then the
 * two placed brackets as leaf children with distinct meshes. A fused/arbitrary
 * union or a coincidentally named hierarchy therefore cannot satisfy it.
 */
export function exactFixtureOccurrenceMeshes(
  root: Record<string, unknown>,
  meshCount: number,
): readonly [number, number] {
  const rootMeshes = arrayField(root, "meshes");
  const rootChildren = arrayField(root, "children");
  if (rootMeshes.length !== 0 || rootChildren.length !== 1) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification requires exactly two referenced bracket occurrences in the exact root/container/leaf topology.",
    );
  }
  const container = asRecord(rootChildren[0]);
  const containerMeshes = arrayField(container, "meshes");
  const leaves = arrayField(container, "children");
  if (containerMeshes.length !== 0 || leaves.length !== 2) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification requires exactly two referenced bracket occurrences in the exact root/container/leaf topology.",
    );
  }
  const occurrences = leaves.map((leaf) => {
    const node = asRecord(leaf);
    const nodeMeshes = arrayField(node, "meshes");
    if (arrayField(node, "children").length !== 0 || nodeMeshes.length !== 1) {
      throw new GeometryModuleAssemblerQualificationOracleError(
        "STEP qualification requires exactly two referenced bracket occurrences in the exact root/container/leaf topology.",
      );
    }
    const meshIndex = nodeMeshes[0];
    if (
      typeof meshIndex !== "number" || !Number.isSafeInteger(meshIndex) ||
      meshIndex < 0 || meshIndex >= meshCount
    ) {
      throw new GeometryModuleAssemblerQualificationOracleError(
        "STEP qualification root references an invalid mesh.",
      );
    }
    return meshIndex;
  });

  if (occurrences[0] === occurrences[1]) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification requires two distinct bracket mesh occurrences.",
    );
  }
  return occurrences as [number, number];
}

export interface GeometryModuleAssemblerQualificationTriangulatedMesh {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
  readonly bounds: Bounds;
}

type StepMeshGeometry = GeometryModuleAssemblerQualificationTriangulatedMesh;

interface Bounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
  readonly minZ: number;
  readonly maxZ: number;
}

function readStepMesh(value: unknown): StepMeshGeometry {
  const attributes = objectField(asRecord(value), "attributes");
  const positions = numericArray(
    objectField(asRecord(attributes), "position"),
    "array",
  );
  const indices = integerArray(objectField(asRecord(value), "index"), "array");
  if (
    positions.length < 9 || positions.length % 3 !== 0 ||
    indices.length < 3 || indices.length % 3 !== 0
  ) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification mesh is not a triangulated bracket instance.",
    );
  }
  const vertexCount = positions.length / 3;
  if (indices.some((index) => index < 0 || index >= vertexCount)) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification mesh references an invalid vertex.",
    );
  }
  for (let offset = 0; offset < indices.length; offset += 3) {
    if (
      !triangleHasArea(
        positions,
        indices[offset]!,
        indices[offset + 1]!,
        indices[offset + 2]!,
      )
    ) {
      throw new GeometryModuleAssemblerQualificationOracleError(
        "STEP qualification mesh contains a degenerate triangle.",
      );
    }
  }
  return { positions, indices, bounds: boundsOf(positions) };
}

function assertSameBracketAtExpectedPlacement(
  fixture: StepMeshGeometry,
  occurrence: StepMeshGeometry,
  expectedTranslation: Readonly<
    { readonly x: number; readonly y: number; readonly z: number }
  >,
): void {
  assertSameNormalisedTriangulatedGeometry(fixture, occurrence);
  const fixtureBounds = fixture.bounds;
  const occurrenceBounds = occurrence.bounds;
  if (
    !approximately(occurrenceBounds.minX - fixtureBounds.minX, expectedTranslation.x) ||
    !approximately(occurrenceBounds.maxX - fixtureBounds.maxX, expectedTranslation.x) ||
    !approximately(occurrenceBounds.minY - fixtureBounds.minY, expectedTranslation.y) ||
    !approximately(occurrenceBounds.maxY - fixtureBounds.maxY, expectedTranslation.y) ||
    !approximately(occurrenceBounds.minZ - fixtureBounds.minZ, expectedTranslation.z) ||
    !approximately(occurrenceBounds.maxZ - fixtureBounds.maxZ, expectedTranslation.z)
  ) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification does not prove the declared absolute bracket placements.",
    );
  }
}

export function assertSameNormalisedTriangulatedGeometry(
  fixture: StepMeshGeometry,
  occurrence: StepMeshGeometry,
): void {
  const fixtureDimensions = dimensionsOf(fixture.bounds);
  const occurrenceDimensions = dimensionsOf(occurrence.bounds);
  if (
    fixture.positions.length !== occurrence.positions.length ||
    !approximately(fixtureDimensions.x, occurrenceDimensions.x) ||
    !approximately(fixtureDimensions.y, occurrenceDimensions.y) ||
    !approximately(fixtureDimensions.z, occurrenceDimensions.z)
  ) {
    throw sameBracketGeometryError();
  }
  if (
    !stringArraysEqual(
      normalisedVertexMultiset(fixture),
      normalisedVertexMultiset(occurrence),
    )
  ) {
    throw sameBracketGeometryError();
  }
  const fixtureSurface = surfaceInvariant(fixture);
  const occurrenceSurface = surfaceInvariant(occurrence);
  if (
    !approximatelyScaled(fixtureSurface.totalArea, occurrenceSurface.totalArea) ||
    !approximatelyScaled(
      fixtureSurface.absoluteSignedVolume,
      occurrenceSurface.absoluteSignedVolume,
    ) ||
    !samePlanarSurfaceGroups(
      fixtureSurface.planarGroups,
      occurrenceSurface.planarGroups,
    )
  ) {
    throw sameBracketGeometryError();
  }
}

/**
 * STEP re-export may retriangulate a coplanar face. Raw index identity would
 * reject that correct output, so the fixture proof instead binds its exact
 * normalised vertex cloud and surface invariants. Grouping triangle area by
 * canonical plane keeps a changed diagonal neutral but rejects a different
 * surface even when its overall bounds happen to match.
 */
function surfaceInvariant(mesh: StepMeshGeometry): {
  readonly totalArea: number;
  readonly absoluteSignedVolume: number;
  readonly planarGroups: readonly {
    readonly key: string;
    readonly area: number;
    readonly boundaryEdgeLengths: readonly string[];
  }[];
} {
  let totalArea = 0;
  let signedVolume = 0;
  const centre = {
    x: centreX(mesh.bounds),
    y: centreY(mesh.bounds),
    z: centreZ(mesh.bounds),
  };
  const planarGroups = new Map<
    string,
    { area: number; readonly edges: Map<string, string> }
  >();
  for (let offset = 0; offset < mesh.indices.length; offset += 3) {
    const first = mesh.indices[offset]!;
    const second = mesh.indices[offset + 1]!;
    const third = mesh.indices[offset + 2]!;
    const triangle = triangleInvariant(
      mesh.positions,
      first,
      second,
      third,
      centre,
    );
    totalArea += triangle.area;
    signedVolume += triangle.signedVolume;
    const group = planarGroups.get(triangle.planeKey) ?? {
      area: 0,
      edges: new Map<string, string>(),
    };
    group.area += triangle.area;
    for (
      const edge of normalisedTriangleEdges(
        mesh.positions,
        first,
        second,
        third,
        centre,
      )
    ) {
      if (group.edges.has(edge.key)) group.edges.delete(edge.key);
      else group.edges.set(edge.key, edge.length);
    }
    planarGroups.set(triangle.planeKey, group);
  }
  return {
    totalArea,
    absoluteSignedVolume: Math.abs(signedVolume),
    planarGroups: [...planarGroups.entries()]
      .map(([key, group]) => ({
        key,
        area: group.area,
        boundaryEdgeLengths: [...group.edges.values()].sort(),
      }))
      .sort((left, right) => left.key.localeCompare(right.key)),
  };
}

function normalisedTriangleEdges(
  positions: readonly number[],
  first: number,
  second: number,
  third: number,
  centre: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
): readonly { readonly key: string; readonly length: string }[] {
  return [[first, second], [second, third], [third, first]].map(([left, right]) => {
    const firstPoint = normalisedPoint(positions, left!, centre);
    const secondPoint = normalisedPoint(positions, right!, centre);
    const key = firstPoint.key < secondPoint.key
      ? `${firstPoint.key}|${secondPoint.key}`
      : `${secondPoint.key}|${firstPoint.key}`;
    return {
      key,
      length: quantize(
        Math.hypot(
          firstPoint.x - secondPoint.x,
          firstPoint.y - secondPoint.y,
          firstPoint.z - secondPoint.z,
        ),
        TOLERANCE,
      ),
    };
  });
}

function normalisedPoint(
  positions: readonly number[],
  index: number,
  centre: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
): {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
} {
  const x = positions[index * 3]! - centre.x;
  const y = positions[index * 3 + 1]! - centre.y;
  const z = positions[index * 3 + 2]! - centre.z;
  return {
    key: [quantize(x, TOLERANCE), quantize(y, TOLERANCE), quantize(z, TOLERANCE)]
      .join(","),
    x,
    y,
    z,
  };
}

function triangleInvariant(
  positions: readonly number[],
  first: number,
  second: number,
  third: number,
  centre: Readonly<{ readonly x: number; readonly y: number; readonly z: number }>,
): { readonly area: number; readonly signedVolume: number; readonly planeKey: string } {
  const ax = positions[first * 3]!;
  const ay = positions[first * 3 + 1]!;
  const az = positions[first * 3 + 2]!;
  const bx = positions[second * 3]!;
  const by = positions[second * 3 + 1]!;
  const bz = positions[second * 3 + 2]!;
  const cx = positions[third * 3]!;
  const cy = positions[third * 3 + 1]!;
  const cz = positions[third * 3 + 2]!;
  const nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  const ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  const nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const twiceArea = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(twiceArea) || twiceArea === 0) {
    throw sameBracketGeometryError();
  }
  let unitX = nx / twiceArea;
  let unitY = ny / twiceArea;
  let unitZ = nz / twiceArea;
  let distance = unitX * (ax - centre.x) + unitY * (ay - centre.y) +
    unitZ * (az - centre.z);
  if (
    unitX < 0 || (unitX === 0 && unitY < 0) ||
    (unitX === 0 && unitY === 0 && unitZ < 0)
  ) {
    unitX = -unitX;
    unitY = -unitY;
    unitZ = -unitZ;
    distance = -distance;
  }
  return {
    area: twiceArea / 2,
    signedVolume: signedTriangleVolume(
      ax - centre.x,
      ay - centre.y,
      az - centre.z,
      bx - centre.x,
      by - centre.y,
      bz - centre.z,
      cx - centre.x,
      cy - centre.y,
      cz - centre.z,
    ),
    planeKey: [
      quantize(unitX, NORMAL_TOLERANCE),
      quantize(unitY, NORMAL_TOLERANCE),
      quantize(unitZ, NORMAL_TOLERANCE),
      quantize(distance, TOLERANCE),
    ].join(","),
  };
}

function signedTriangleVolume(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  return (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) +
    az * (bx * cy - by * cx)) / 6;
}

function normalisedVertexMultiset(mesh: StepMeshGeometry): readonly string[] {
  const centre = {
    x: centreX(mesh.bounds),
    y: centreY(mesh.bounds),
    z: centreZ(mesh.bounds),
  };
  const vertices: string[] = [];
  for (let offset = 0; offset < mesh.positions.length; offset += 3) {
    vertices.push([
      quantize(mesh.positions[offset]! - centre.x, TOLERANCE),
      quantize(mesh.positions[offset + 1]! - centre.y, TOLERANCE),
      quantize(mesh.positions[offset + 2]! - centre.z, TOLERANCE),
    ].join(","));
  }
  return vertices.sort();
}

function samePlanarSurfaceGroups(
  left: readonly {
    readonly key: string;
    readonly area: number;
    readonly boundaryEdgeLengths: readonly string[];
  }[],
  right: readonly {
    readonly key: string;
    readonly area: number;
    readonly boundaryEdgeLengths: readonly string[];
  }[],
): boolean {
  return left.length === right.length &&
    left.every((group, index) =>
      group.key === right[index]!.key &&
      approximatelyScaled(group.area, right[index]!.area) &&
      stringArraysEqual(group.boundaryEdgeLengths, right[index]!.boundaryEdgeLengths)
    );
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

function approximatelyScaled(left: number, right: number): boolean {
  return Math.abs(left - right) <= Math.max(
    TOLERANCE,
    Math.max(Math.abs(left), Math.abs(right)) * 1e-9,
  );
}

function quantize(value: number, precision: number): string {
  return String(Math.round(value / precision));
}

function sameBracketGeometryError(): GeometryModuleAssemblerQualificationOracleError {
  return new GeometryModuleAssemblerQualificationOracleError(
    "STEP qualification does not prove the exact fixture bracket geometry or the same bracket geometry.",
  );
}

function boundsOf(positions: readonly number[]): Bounds {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let offset = 0; offset < positions.length; offset += 3) {
    const x = positions[offset]!;
    const y = positions[offset + 1]!;
    const z = positions[offset + 2]!;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  return { minX, maxX, minY, maxY, minZ, maxZ };
}

function dimensionsOf(
  bounds: Bounds,
): { readonly x: number; readonly y: number; readonly z: number } {
  return {
    x: bounds.maxX - bounds.minX,
    y: bounds.maxY - bounds.minY,
    z: bounds.maxZ - bounds.minZ,
  };
}

function centreX(bounds: Bounds): number {
  return (bounds.minX + bounds.maxX) / 2;
}

function centreY(bounds: Bounds): number {
  return (bounds.minY + bounds.maxY) / 2;
}

function centreZ(bounds: Bounds): number {
  return (bounds.minZ + bounds.maxZ) / 2;
}

/**
 * This deliberately accepts only the GLB shape emitted by the fixed worker:
 * GLB 2.0, one JSON chunk, one non-empty BIN chunk, and one embedded buffer.
 * It is a fixture oracle, not a general-purpose glTF implementation.
 */
function assertGlbHasPublishedMeshPrimitives(bytes: Uint8Array): void {
  try {
    const { document, bin } = readWorkerGlb(bytes);
    const bufferLength = declaredWorkerBufferLength(document, bin);
    const bufferViews = arrayField(document, "bufferViews");
    const accessors = arrayField(document, "accessors");
    const meshIndices = selectedSceneMeshIndices(document);
    let hasNonDegenerateTriangle = false;
    for (const meshIndex of meshIndices) {
      const mesh = indexedRecord(arrayField(document, "meshes"), meshIndex);
      const primitives = arrayField(mesh, "primitives");
      if (primitives.length === 0) throw new TypeError();
      for (const primitive of primitives) {
        const geometry = readGlbPrimitive(
          asRecord(primitive),
          accessors,
          bufferViews,
          bin,
          bufferLength,
        );
        hasNonDegenerateTriangle ||= geometryHasNonDegenerateTriangle(geometry);
      }
    }
    if (!hasNonDegenerateTriangle) throw new TypeError();
  } catch {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "GLB qualification requires a non-empty binary geometry scene.",
    );
  }
}

function readWorkerGlb(
  bytes: Uint8Array,
): { readonly document: Record<string, unknown>; readonly bin: Uint8Array } {
  if (bytes.byteLength < GLB_HEADER_BYTES) throw new TypeError();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    view.getUint32(0, true) !== GLB_MAGIC ||
    view.getUint32(4, true) !== GLB_VERSION ||
    view.getUint32(8, true) !== bytes.byteLength
  ) {
    throw new TypeError();
  }
  const chunks: { readonly type: number; readonly data: Uint8Array }[] = [];
  let offset = GLB_HEADER_BYTES;
  while (offset < bytes.byteLength) {
    if (offset + GLB_CHUNK_HEADER_BYTES > bytes.byteLength) throw new TypeError();
    const length = view.getUint32(offset, true);
    const type = view.getUint32(offset + 4, true);
    const start = offset + GLB_CHUNK_HEADER_BYTES;
    const end = start + length;
    if (length % 4 !== 0 || end > bytes.byteLength) throw new TypeError();
    chunks.push({ type, data: bytes.subarray(start, end) });
    offset = end;
  }
  if (
    offset !== bytes.byteLength || chunks.length !== 2 ||
    chunks[0]!.type !== GLB_JSON_CHUNK || chunks[1]!.type !== GLB_BIN_CHUNK ||
    chunks[0]!.data.byteLength === 0 || chunks[1]!.data.byteLength === 0
  ) {
    throw new TypeError();
  }
  const document = asRecord(JSON.parse(GLB_JSON_DECODER.decode(chunks[0]!.data)));
  if (
    objectField(document, "asset") === undefined ||
    objectField(objectField(document, "asset"), "version") !== "2.0"
  ) {
    throw new TypeError();
  }
  return { document, bin: chunks[1]!.data };
}

function declaredWorkerBufferLength(
  document: Record<string, unknown>,
  bin: Uint8Array,
): number {
  const buffers = arrayField(document, "buffers");
  if (buffers.length !== 1) throw new TypeError();
  const buffer = asRecord(buffers[0]);
  if (Object.hasOwn(buffer, "uri")) throw new TypeError();
  const byteLength = nonNegativeInteger(objectField(buffer, "byteLength"));
  if (byteLength === 0 || paddedLength(byteLength) !== bin.byteLength) {
    throw new TypeError();
  }
  return byteLength;
}

function selectedSceneMeshIndices(document: Record<string, unknown>): Set<number> {
  const scenes = arrayField(document, "scenes");
  const scene = nonNegativeInteger(objectField(document, "scene"));
  if (scene !== 0 || scenes.length !== 1) throw new TypeError();
  const nodes = arrayField(document, "nodes");
  const rootNodes = arrayField(asRecord(scenes[scene]), "nodes");
  if (rootNodes.length === 0) throw new TypeError();
  const queue = [...rootNodes];
  const visited = new Set<number>();
  const meshes = new Set<number>();
  while (queue.length > 0) {
    const nodeIndex = nonNegativeInteger(queue.shift());
    if (nodeIndex >= nodes.length || visited.has(nodeIndex)) throw new TypeError();
    visited.add(nodeIndex);
    const node = indexedRecord(nodes, nodeIndex);
    if (Object.hasOwn(node, "mesh")) {
      const mesh = nonNegativeInteger(objectField(node, "mesh"));
      if (mesh >= arrayField(document, "meshes").length) throw new TypeError();
      meshes.add(mesh);
    }
    if (Object.hasOwn(node, "children")) queue.push(...arrayField(node, "children"));
  }
  if (meshes.size === 0) throw new TypeError();
  return meshes;
}

interface GlbPrimitiveGeometry {
  readonly positions: readonly number[];
  readonly indices: readonly number[];
}

function readGlbPrimitive(
  primitive: Record<string, unknown>,
  accessors: readonly unknown[],
  bufferViews: readonly unknown[],
  bin: Uint8Array,
  bufferLength: number,
): GlbPrimitiveGeometry {
  if (Object.hasOwn(primitive, "mode") && objectField(primitive, "mode") !== 4) {
    throw new TypeError();
  }
  const attributes = asRecord(objectField(primitive, "attributes"));
  const positionAccessor = nonNegativeInteger(objectField(attributes, "POSITION"));
  const indexAccessor = nonNegativeInteger(objectField(primitive, "indices"));
  const positions = readGlbAccessor(
    accessors,
    bufferViews,
    bin,
    bufferLength,
    positionAccessor,
    { componentType: 5126, type: "VEC3" },
  );
  const indices = readGlbAccessor(
    accessors,
    bufferViews,
    bin,
    bufferLength,
    indexAccessor,
    { componentType: [5121, 5123, 5125], type: "SCALAR" },
  );
  if (positions.count < 3 || indices.count < 3 || indices.count % 3 !== 0) {
    throw new TypeError();
  }
  const positionValues = Array.from(
    { length: positions.count * 3 },
    (_value, index) => positions.read(index),
  );
  if (!positionValues.every(Number.isFinite)) throw new TypeError();
  const indexValues = Array.from(
    { length: indices.count },
    (_value, index) => indices.read(index),
  );
  if (
    indexValues.some((index) =>
      !Number.isSafeInteger(index) || index >= positions.count
    )
  ) {
    throw new TypeError();
  }
  return { positions: positionValues, indices: indexValues };
}

function readGlbAccessor(
  accessors: readonly unknown[],
  bufferViews: readonly unknown[],
  bin: Uint8Array,
  bufferLength: number,
  accessorIndex: number,
  expected: Readonly<{
    readonly componentType: number | readonly number[];
    readonly type: "VEC3" | "SCALAR";
  }>,
): { readonly count: number; readonly read: (index: number) => number } {
  const accessor = indexedRecord(accessors, accessorIndex);
  if (Object.hasOwn(accessor, "sparse")) throw new TypeError();
  const componentType = nonNegativeInteger(objectField(accessor, "componentType"));
  const accepted = Array.isArray(expected.componentType)
    ? expected.componentType.includes(componentType)
    : componentType === expected.componentType;
  if (
    !accepted || objectField(accessor, "type") !== expected.type ||
    objectField(accessor, "normalized") === true
  ) {
    throw new TypeError();
  }
  const count = nonNegativeInteger(objectField(accessor, "count"));
  const accessorOffset = optionalNonNegativeInteger(accessor, "byteOffset");
  const bufferViewIndex = nonNegativeInteger(objectField(accessor, "bufferView"));
  const bufferView = indexedRecord(bufferViews, bufferViewIndex);
  if (nonNegativeInteger(objectField(bufferView, "buffer")) !== 0) {
    throw new TypeError();
  }
  const viewOffset = optionalNonNegativeInteger(bufferView, "byteOffset");
  const viewLength = nonNegativeInteger(objectField(bufferView, "byteLength"));
  if (viewLength === 0 || viewOffset + viewLength > bufferLength) throw new TypeError();
  const componentBytes = componentByteLength(componentType);
  const componentCount = expected.type === "VEC3" ? 3 : 1;
  const elementBytes = componentBytes * componentCount;
  const stride = Object.hasOwn(bufferView, "byteStride")
    ? nonNegativeInteger(objectField(bufferView, "byteStride"))
    : elementBytes;
  if (stride < elementBytes || accessorOffset + elementBytes > viewLength) {
    throw new TypeError();
  }
  const finalByte = viewOffset + accessorOffset + (count - 1) * stride + elementBytes;
  if (count === 0 || finalByte > viewOffset + viewLength || finalByte > bufferLength) {
    throw new TypeError();
  }
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const start = viewOffset + accessorOffset;
  return {
    count,
    read(index) {
      const offset = start + Math.floor(index / componentCount) * stride +
        (index % componentCount) * componentBytes;
      return readGlbComponent(view, offset, componentType);
    },
  };
}

function geometryHasNonDegenerateTriangle(geometry: GlbPrimitiveGeometry): boolean {
  for (let offset = 0; offset < geometry.indices.length; offset += 3) {
    if (
      triangleHasArea(
        geometry.positions,
        geometry.indices[offset]!,
        geometry.indices[offset + 1]!,
        geometry.indices[offset + 2]!,
      )
    ) return true;
  }
  return false;
}

function triangleHasArea(
  positions: readonly number[],
  first: number,
  second: number,
  third: number,
): boolean {
  if (first === second || second === third || first === third) return false;
  const ax = positions[first * 3]!;
  const ay = positions[first * 3 + 1]!;
  const az = positions[first * 3 + 2]!;
  const bx = positions[second * 3]!;
  const by = positions[second * 3 + 1]!;
  const bz = positions[second * 3 + 2]!;
  const cx = positions[third * 3]!;
  const cy = positions[third * 3 + 1]!;
  const cz = positions[third * 3 + 2]!;
  const abx = bx - ax;
  const aby = by - ay;
  const abz = bz - az;
  const acx = cx - ax;
  const acy = cy - ay;
  const acz = cz - az;
  const areaSquared = (aby * acz - abz * acy) ** 2 +
    (abz * acx - abx * acz) ** 2 +
    (abx * acy - aby * acx) ** 2;
  return Number.isFinite(areaSquared) && areaSquared > 0;
}

function componentByteLength(componentType: number): number {
  switch (componentType) {
    case 5121:
      return 1;
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      throw new TypeError();
  }
}

function readGlbComponent(
  view: DataView,
  offset: number,
  componentType: number,
): number {
  switch (componentType) {
    case 5121:
      return view.getUint8(offset);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      throw new TypeError();
  }
}

function numericArray(value: unknown, name: string): number[] {
  const values = arrayField(value, name);
  if (!values.every((entry) => typeof entry === "number" && Number.isFinite(entry))) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification mesh has non-finite coordinates.",
    );
  }
  return values as number[];
}

function integerArray(value: unknown, name: string): number[] {
  const values = arrayField(value, name);
  if (
    !values.every((entry) => typeof entry === "number" && Number.isSafeInteger(entry))
  ) {
    throw new GeometryModuleAssemblerQualificationOracleError(
      "STEP qualification mesh has invalid triangle indices.",
    );
  }
  return values as number[];
}

function indexedRecord(
  values: readonly unknown[],
  index: number,
): Record<string, unknown> {
  if (index >= values.length) throw new TypeError();
  return asRecord(values[index]);
}

function nonNegativeInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new TypeError();
  }
  return value;
}

function optionalNonNegativeInteger(
  value: Record<string, unknown>,
  name: string,
): number {
  return Object.hasOwn(value, name) ? nonNegativeInteger(objectField(value, name)) : 0;
}

function paddedLength(value: number): number {
  return Math.ceil(value / 4) * 4;
}

function objectField(value: unknown, name: string): unknown {
  return Reflect.get(asRecord(value), name);
}

function arrayField(value: unknown, name: string): unknown[] {
  const field = objectField(value, name);
  if (!Array.isArray(field)) throw new TypeError();
  return field;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError();
  }
  return value as Record<string, unknown>;
}

function approximately(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE;
}

function oracleError(
  message: string,
  cause: unknown,
): GeometryModuleAssemblerQualificationOracleError {
  return new GeometryModuleAssemblerQualificationOracleError(
    `${message} ${cause instanceof Error ? cause.message : ""}`.trim(),
  );
}
