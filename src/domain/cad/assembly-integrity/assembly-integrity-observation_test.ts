import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import { fingerprintResourceBytes } from "../../compile/source/provider-resource-reader.ts";
import {
  createIsolatedCodeExecutionReceipt,
  createIsolatedOutputPublicationRef,
  fingerprintIsolatedOutputPublicationManifest,
  ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
  isolatedCodeExecutionReceiptRecord,
  validateIsolatedCodeExecutionRequest,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
} from "../geometry-module-contract.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "../module-assembly/geometry-module-assembly-execution.ts";
import { createGeometryModuleInputBundle } from "../module-assembly/geometry-module-input-bundle.ts";
import { parseGeometryModuleCapture } from "../canonical/geometry-module-capture.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
  createAssemblyIntegrityInputBundle,
  parseAssemblyIntegrityInputBundle,
} from "./assembly-integrity-input-bundle.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
  parseAssemblyIntegrityObservation,
  VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-observation.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const C = "c".repeat(64);
const D = "d".repeat(64);

Deno.test("assembly-integrity bundle binds one exact canonical module capture and STEP", async () => {
  const { source, stepBytes } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const reopened = await parseAssemblyIntegrityInputBundle(bundle.bytes.copy());

  assertEquals(reopened.manifest.schemaVersion, ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA);
  assertEquals(
    {
      schemaVersion: reopened.manifest.geometryModule.schemaVersion,
      artifactId: reopened.manifest.geometryModule.artifactId,
      fingerprint: reopened.manifest.geometryModule.fingerprint,
    },
    source.geometryModule,
  );
  assertEquals(reopened.manifest.assemblyStep.byteOffset, 0);
  assertEquals(reopened.manifest.assemblyStep.byteCount, stepBytes.byteLength);
  assertEquals(
    reopened.manifest.occurrences.map((occurrence) => occurrence.usageElementId),
    ["usage-arm", "usage-base"],
  );
  assertEquals(reopened.manifest.method, source.method);
  assertEquals(reopened.assemblyStep.copy(), stepBytes);

  const tampered = bundle.bytes.copy();
  tampered[tampered.byteLength - 1] ^= 1;
  await assertRejects(
    () => parseAssemblyIntegrityInputBundle(tampered),
    TypeError,
    "failed exact rehash",
  );
});

Deno.test("assembly-integrity observations preserve facts without creating a verdict", async () => {
  const { source } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const observation = observedResult(bundle);
  const parsed = parseAssemblyIntegrityObservation(observation, bundle);

  assertEquals(parsed.operation, VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION);
  assertEquals(parsed.importFacts, {
    status: "observed",
    value: { unitSystem: "mm", solidCount: 2 },
  });
  assertEquals(parsed.topology.brepValidity, { status: "observed", value: "valid" });
  assertEquals(parsed.occurrences[0]?.usageElementId, "usage-arm");
  assertEquals(parsed.pairs, [{
    firstUsageElementId: "usage-arm",
    secondUsageElementId: "usage-base",
    linearToleranceMm: 0.01,
    minimumDistanceMm: { status: "observed", value: 1.5 },
    intersectionVolumeMm3: { status: "observed", value: 0 },
    contact: { status: "observed", value: "no-contact" },
  }]);

  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({ ...observation, verdict: "pass" }, bundle),
    TypeError,
    "unsupported field verdict",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        inputBundle: { ...observation.inputBundle, fingerprint: fp(A) },
      }, bundle),
    TypeError,
    "exact packed bundle",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        method: { ...observation.method, version: "2.0.0" },
      }, bundle),
    TypeError,
    "exact bound method",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        pairs: [{
          ...observation.pairs[0],
          firstUsageElementId: "usage-base",
          secondUsageElementId: "usage-arm",
        }],
      }, bundle),
    TypeError,
    "exact canonical pair order",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        occurrences: Array.from({ length: 33 }, () => observation.occurrences[0]),
      }, bundle),
    TypeError,
    "occurrence ceiling",
  );
  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...observation,
        pairs: Array.from({ length: 497 }, () => observation.pairs[0]),
      }, bundle),
    TypeError,
    "pair ceiling",
  );
});

Deno.test("assembly-integrity observations retain unresolved and unavailable facts literally", async () => {
  const { source } = await validSource();
  const bundle = await createAssemblyIntegrityInputBundle(source);
  const observation = observedResult(bundle);
  const incomplete = {
    ...observation,
    importFacts: {
      status: "unresolved" as const,
      reason: "observability-missing" as const,
    },
    topology: {
      brepValidity: { status: "unavailable" as const, reason: "unsupported" as const },
      degenerateEntityCount: {
        status: "unavailable" as const,
        reason: "unsupported" as const,
      },
      freeEdgeCount: { status: "unavailable" as const, reason: "unsupported" as const },
      shellCount: { status: "unavailable" as const, reason: "unsupported" as const },
    },
    occurrences: observation.occurrences.map((occurrence) => ({
      ...occurrence,
      target: { status: "unresolved" as const, reason: "identity-missing" as const },
      transform: { status: "unavailable" as const, reason: "unsupported" as const },
    })),
    pairs: observation.pairs.map((pair) => ({
      ...pair,
      minimumDistanceMm: {
        status: "unavailable" as const,
        reason: "unsupported" as const,
      },
      intersectionVolumeMm3: {
        status: "unresolved" as const,
        reason: "observability-missing" as const,
      },
      contact: { status: "unavailable" as const, reason: "unsupported" as const },
    })),
  };
  const parsed = parseAssemblyIntegrityObservation(incomplete, bundle);
  assertEquals(parsed.importFacts.status, "unresolved");
  assertEquals(parsed.topology.brepValidity.status, "unavailable");
  assertEquals(parsed.occurrences[0]?.target.status, "unresolved");
  assertEquals(parsed.pairs[0]?.intersectionVolumeMm3.status, "unresolved");

  assertThrows(
    () =>
      parseAssemblyIntegrityObservation({
        ...incomplete,
        topology: {
          ...incomplete.topology,
          freeEdgeCount: { status: "unavailable", reason: "identity-missing" },
        },
      }, bundle),
    TypeError,
    'must equal "unsupported"',
  );
});

async function validSource() {
  const childArm = step("CHILD ARM");
  const childBase = step("CHILD BASE");
  const assemblyStep = step("ASSEMBLY");
  const assemblyGlb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 1, 2, 3, 4]);
  const childBundle = await createGeometryModuleInputBundle([
    {
      usageElementId: "usage-base",
      partDefinitionElementId: "definition-base",
      placement: { translationMm: [10, 0, 0], rotationDeg: [0, 0, 0] },
      childCapture: {
        schemaVersion: "geometry-part-capture/1.0",
        artifactId: "geometry-part-base",
        fingerprint: fp(C),
      },
      stepBytes: childBase,
    },
    {
      usageElementId: "usage-arm",
      partDefinitionElementId: "definition-arm",
      placement: { translationMm: [0, 0, 0], rotationDeg: [0, 90, 0] },
      childCapture: {
        schemaVersion: "geometry-part-capture/1.0",
        artifactId: "geometry-part-arm",
        fingerprint: fp(D),
      },
      stepBytes: childArm,
    },
  ]);
  const armStepSha = await fingerprintResourceBytes(childArm);
  const baseStepSha = await fingerprintResourceBytes(childBase);
  const assemblyStepSha = await fingerprintResourceBytes(assemblyStep);
  const assemblyGlbSha = await fingerprintResourceBytes(assemblyGlb);
  const runId = "run-module-assembly";
  const outputs = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.map((declaration) => ({
    ...declaration,
    bytes: declaration.role === "assembly.step" ? assemblyStep : assemblyGlb,
    sha256: declaration.role === "assembly.step" ? assemblyStepSha : assemblyGlbSha,
  }));
  const request = await validateIsolatedCodeExecutionRequest({
    schemaVersion: ISOLATED_CODE_EXECUTION_REQUEST_SCHEMA,
    runId,
    producerGeneration: 0,
    profile: GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
    source: { bytes: childBundle.bytes.copy(), sha256: childBundle.fingerprint.digest },
    policy: { id: "isolation-module", version: "1", fingerprint: fp(A) },
    outputs: GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
  });
  const publicationOutputs = outputs.map((output) => ({
    role: output.role,
    basename: output.basename,
    mediaType: output.mediaType,
    format: output.format,
    byteCount: output.bytes.byteLength,
    sha256: output.sha256,
    casUri: `casys://isolated-output/sha256/${output.sha256}`,
  }));
  const publication = await createIsolatedOutputPublicationRef(
    runId,
    0,
    await fingerprintIsolatedOutputPublicationManifest(runId, 0, publicationOutputs),
  );
  const receipt = isolatedCodeExecutionReceiptRecord(
    await createIsolatedCodeExecutionReceipt({
      request,
      runtime: {
        isolationClass: "kernel-isolated",
        imageDigest: fp(A),
        requestedLimits: {
          maxWallTimeMs: 1_000,
          maxCpuTimeMs: 500,
          maxMemoryBytes: 64_000_000,
          maxProcesses: 4,
          maxStdoutBytes: 1_024,
          maxStderrBytes: 1_024,
          maxOutputFileBytes: 1_024,
          maxOutputTotalBytes: 2_048,
        },
        limitAssurance: {
          maxWallTimeMs: "backend-attested",
          maxCpuTimeMs: "unattested",
          maxMemoryBytes: "backend-attested",
          maxProcesses: "unattested",
          maxStdoutBytes: "broker-observed-cap",
          maxStderrBytes: "broker-observed-cap",
          maxOutputFileBytes: "broker-observed-cap",
          maxOutputTotalBytes: "broker-observed-cap",
        },
      },
      termination: { kind: "exited", exitCode: 0, signal: null },
      logs: {
        stdout: { bytes: new Uint8Array(), truncated: false },
        stderr: { bytes: new Uint8Array(), truncated: false },
      },
      outputs: outputs.map((output) => ({
        ...publicationOutputs.find((entry) => entry.role === output.role)!,
        validation: "accepted" as const,
        persistence: "staged-reread-atomic-commit" as const,
        bytes: output.bytes,
      })),
      destruction: { status: "proven", runId, proofFingerprint: fp(B) },
      publication,
    }),
  );
  const children = childBundle.manifest.occurrences.map((occurrence) => ({
    usageElementId: occurrence.usageElementId,
    partDefinitionElementId: occurrence.partDefinitionElementId,
    placement: occurrence.placement,
    placementCapture: fp(B),
    childGeometry: occurrence.childCapture,
    authoritativeStep: {
      fingerprint: fp(
        occurrence.usageElementId === "usage-arm" ? armStepSha : baseStepSha,
      ),
      bytes: occurrence.step.byteCount,
    },
  }));
  const inputBundle = {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: childBundle.fingerprint,
    byteCount: childBundle.bytes.byteLength,
    manifest: childBundle.manifest,
  };
  const manifest = {
    schemaVersion: "geometry-module-manifest/1.0",
    architectureBasis: {
      snapshotId: "architecture-snapshot",
      revision: 1,
      artifactFingerprint: fp(A),
    },
    structureCapture: {
      schemaVersion: "part-definitions-capture/1.0",
      artifactId: `part-definitions-${C}`,
      fingerprint: fp(C),
    },
    target: { partDefinitionElementId: "definition-assembly", label: "Assembly" },
    placementAnalysis: {
      schemaVersion: "cad-placement-analysis-capture-locator/1.0",
      kind: "cad-placement-analysis-capture-locator",
      fingerprint: fp(B),
      byteCount: 1,
      casUri: `casys://cad-placement-analysis-capture/sha256/${B}`,
    },
    children,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    assembly: {
      inputBundle,
      step: { fingerprint: fp(assemblyStepSha) },
      glb: { fingerprint: fp(assemblyGlbSha) },
    },
  };
  const capture = {
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: { id: "design.write-geometry", version: "1" },
    trustedRunId: "run-geometry-module",
    draftDigest: A,
    manifest,
    architectureBasis: {
      artifactId: `architecture-${A}`,
      fingerprint: fp(A),
      producerRunId: "run-architecture",
    },
    structureCapture: manifest.structureCapture,
    placementAnalysis: manifest.placementAnalysis,
    children,
    inputBundle,
    receipt,
    assemblyStep: { fingerprint: fp(assemblyStepSha), bytes: assemblyStep.byteLength },
    assemblyGlb: { fingerprint: fp(assemblyGlbSha), bytes: assemblyGlb.byteLength },
    sealedAt: "2026-08-26T10:00:00.000Z",
  };
  const parsedCapture = await parseGeometryModuleCapture(capture);
  const captureFingerprint = await sha256Fingerprint(parsedCapture);
  return {
    source: {
      geometryModule: {
        schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
        artifactId: `geometry-${captureFingerprint.digest}`,
        fingerprint: captureFingerprint,
      },
      geometryModuleCapture: capture,
      assemblyStepBytes: assemblyStep,
      method: {
        id: "occt-assembly-observer",
        version: "1.0.0",
        linearToleranceMm: 0.01,
      },
    },
    stepBytes: assemblyStep,
  };
}

function observedResult(
  bundle: Awaited<ReturnType<typeof createAssemblyIntegrityInputBundle>>,
) {
  return {
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_SCHEMA,
    operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
    inputBundle: {
      schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
      fingerprint: bundle.fingerprint,
      byteCount: bundle.bytes.byteLength,
    },
    method: bundle.manifest.method,
    importFacts: {
      status: "observed" as const,
      value: { unitSystem: "mm", solidCount: 2 },
    },
    topology: {
      brepValidity: { status: "observed" as const, value: "valid" as const },
      degenerateEntityCount: { status: "observed" as const, value: 0 },
      freeEdgeCount: { status: "observed" as const, value: 0 },
      shellCount: { status: "observed" as const, value: 1 },
    },
    occurrences: bundle.manifest.occurrences.map((occurrence) => ({
      usageElementId: occurrence.usageElementId,
      target: {
        status: "observed" as const,
        value: { partDefinitionElementId: occurrence.partDefinitionElementId },
      },
      transform: {
        status: "observed" as const,
        value: {
          expectedPlacement: occurrence.expectedPlacement,
          observedPlacement: occurrence.expectedPlacement,
        },
      },
    })),
    pairs: [{
      firstUsageElementId: bundle.manifest.occurrences[0]!.usageElementId,
      secondUsageElementId: bundle.manifest.occurrences[1]!.usageElementId,
      linearToleranceMm: bundle.manifest.method.linearToleranceMm,
      minimumDistanceMm: { status: "observed" as const, value: 1.5 },
      intersectionVolumeMm3: { status: "observed" as const, value: 0 },
      contact: { status: "observed" as const, value: "no-contact" as const },
    }],
  };
}

function fp(digest: string) {
  return { algorithm: "sha256" as const, digest };
}

function step(marker: string): Uint8Array {
  return new TextEncoder().encode(
    `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n/* ${marker} */\nENDSEC;\nEND-ISO-10303-21;\n`,
  );
}
