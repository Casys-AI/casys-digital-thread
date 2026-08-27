/**
 * Canonical geometry-module Thread evidence after the existing geometry seal.
 *
 * The capture recrosses the signed manifest, the same input-bundle identity,
 * the isolation receipt, and the produced assembly STEP plus binary GLB. It
 * does not invent a second receipt vocabulary.
 */

import { GEOMETRY_MODULE_CAPTURE_SCHEMA } from "../geometry-module-contract.ts";
import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  safeId,
} from "../../kernel/case-validation.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { IsolatedCodeExecutionReceiptRecord } from "../../compile/isolation/isolated-code-execution.ts";
import type { ProjectSourceClosureLocator } from "../../project-source-workspace/closure.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "./geometry-proposal.ts";
import {
  type CadPlacementAnalysisCaptureLocator,
  digest,
  type GeometryModuleAssetIdentity,
  type GeometryModuleChild,
  type GeometryModuleInputBundleIdentity,
  type GeometryModulePredecessor,
  type GeometryModuleStructureCapture,
  invalid,
  isoDateTime,
  parseAssetIdentity,
  parseChildren,
  parseFingerprint,
  parseInputBundleIdentity,
  parseOptionalSourceClosure,
  parsePlacementAnalysis,
  parsePredecessor,
  parseStructureCapture,
  recrossChildPlacementCaptures,
  sameChildren,
  sameInputBundle,
  sameOptionalPredecessor,
  sameOptionalSourceClosure,
  samePlacementAnalysis,
  sameStructureCapture,
} from "./geometry-module-identities.ts";
import { recrossGeometryModuleIsolation } from "./geometry-module-isolation.ts";
import {
  type GeometryModuleManifest,
  parseGeometryModuleManifest,
} from "./geometry-module-manifest.ts";

export interface GeometryModuleCapture {
  readonly schemaVersion: typeof GEOMETRY_MODULE_CAPTURE_SCHEMA;
  readonly operation: typeof DESIGN_WRITE_GEOMETRY_OPERATION;
  readonly trustedRunId: string;
  readonly draftDigest: string;
  readonly manifest: GeometryModuleManifest;
  readonly architectureBasis: {
    readonly artifactId: string;
    readonly fingerprint: {
      readonly algorithm: "sha256";
      readonly digest: string;
    };
    readonly producerRunId: string;
  };
  readonly structureCapture: GeometryModuleStructureCapture;
  readonly sourceClosure?: ProjectSourceClosureLocator;
  readonly placementAnalysis: CadPlacementAnalysisCaptureLocator;
  readonly children: ReadonlyArray<GeometryModuleChild>;
  readonly predecessor?: GeometryModulePredecessor;
  readonly inputBundle: GeometryModuleInputBundleIdentity;
  readonly receipt: IsolatedCodeExecutionReceiptRecord;
  readonly assemblyStep: GeometryModuleAssetIdentity;
  readonly assemblyGlb: GeometryModuleAssetIdentity;
  readonly sealedAt: string;
}

export async function parseGeometryModuleCapture(
  value: unknown,
): Promise<GeometryModuleCapture> {
  const root = closedRecord(
    value,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "structureCapture",
      "sourceClosure",
      "placementAnalysis",
      "children",
      "predecessor",
      "inputBundle",
      "receipt",
      "assemblyStep",
      "assemblyGlb",
      "sealedAt",
    ],
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "structureCapture",
      "children",
      "inputBundle",
      "receipt",
      "assemblyStep",
      "assemblyGlb",
      "sealedAt",
    ],
    "$geometryModuleCapture",
  );
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_CAPTURE_SCHEMA,
    "$geometryModuleCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$geometryModuleCapture.operation",
  );
  literalValue(
    operation.id,
    DESIGN_WRITE_GEOMETRY_OPERATION.id,
    "$geometryModuleCapture.operation.id",
  );
  literalValue(
    operation.version,
    DESIGN_WRITE_GEOMETRY_OPERATION.version,
    "$geometryModuleCapture.operation.version",
  );
  const manifest = parseGeometryModuleManifest(root.manifest, {
    requireCompleted: true,
  });
  const architectureBasis = exactRecord(
    root.architectureBasis,
    ["artifactId", "fingerprint", "producerRunId"],
    "$geometryModuleCapture.architectureBasis",
  );
  const architectureFingerprint = parseFingerprint(
    architectureBasis.fingerprint,
    "$geometryModuleCapture.architectureBasis.fingerprint",
  );
  const architectureArtifactId = safeId(
    architectureBasis.artifactId,
    "$geometryModuleCapture.architectureBasis.artifactId",
  );
  if (architectureArtifactId !== `architecture-${architectureFingerprint.digest}`) {
    invalid(
      "invalid_identity",
      "$geometryModuleCapture.architectureBasis.artifactId must be architecture-<digest>.",
    );
  }
  if (
    !fingerprintsEqual(
      architectureFingerprint,
      manifest.architectureBasis.artifactFingerprint,
    )
  ) {
    invalid(
      "unresolved",
      "Module capture architecture fingerprint must equal the signed architecture fingerprint.",
    );
  }
  const structureCapture = parseStructureCapture(
    root.structureCapture,
    "$geometryModuleCapture.structureCapture",
  );
  if (!sameStructureCapture(structureCapture, manifest.structureCapture)) {
    invalid(
      "unresolved",
      "Module capture structure capture must equal the signed manifest structure capture.",
    );
  }
  const sourceClosure = parseOptionalSourceClosure(
    root.sourceClosure,
    "$geometryModuleCapture.sourceClosure",
  );
  if (!sameOptionalSourceClosure(sourceClosure, manifest.sourceClosure)) {
    invalid(
      "unresolved",
      "Module capture source-closure must equal the signed manifest source-closure.",
    );
  }
  const children = parseChildren(root.children, "$geometryModuleCapture.children");
  if (!sameChildren(children, manifest.children)) {
    invalid(
      "unresolved",
      "Module capture children must equal the signed immediate-child table.",
    );
  }
  const placementAnalysis = parsePlacementAnalysis(
    root.placementAnalysis,
    "$geometryModuleCapture.placementAnalysis",
  );
  recrossChildPlacementCaptures(children, placementAnalysis);
  if (!samePlacementAnalysis(placementAnalysis, manifest.placementAnalysis)) {
    invalid(
      "unresolved",
      "Module capture placement analysis must equal the signed manifest placement analysis.",
    );
  }
  const predecessor = root.predecessor === undefined ? undefined : parsePredecessor(
    root.predecessor,
    manifest.target.partDefinitionElementId,
    "$geometryModuleCapture.predecessor",
  );
  if (!sameOptionalPredecessor(predecessor, manifest.predecessor)) {
    invalid(
      "unresolved",
      "Module capture predecessor must equal the signed same-target predecessor.",
    );
  }
  const inputBundle = parseInputBundleIdentity(
    root.inputBundle,
    children,
    "$geometryModuleCapture.inputBundle",
  );
  if (
    manifest.assembly === undefined ||
    !sameInputBundle(inputBundle, manifest.assembly.inputBundle)
  ) {
    invalid(
      "unresolved",
      "$geometryModuleCapture.inputBundle must equal the signed input-bundle identity.",
    );
  }
  const assemblyStep = parseAssetIdentity(
    root.assemblyStep,
    "$geometryModuleCapture.assemblyStep",
  );
  const assemblyGlb = parseAssetIdentity(
    root.assemblyGlb,
    "$geometryModuleCapture.assemblyGlb",
  );
  if (
    !fingerprintsEqual(assemblyStep.fingerprint, manifest.assembly.step.fingerprint) ||
    !fingerprintsEqual(assemblyGlb.fingerprint, manifest.assembly.glb.fingerprint)
  ) {
    invalid(
      "unresolved",
      "Module capture assembly assets must equal the signed STEP and GLB fingerprints.",
    );
  }
  const receipt = await recrossGeometryModuleIsolation(
    inputBundle,
    root.receipt,
    assemblyStep,
    assemblyGlb,
    "$geometryModuleCapture",
  );
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$geometryModuleCapture.trustedRunId"),
    draftDigest: digest(root.draftDigest, "$geometryModuleCapture.draftDigest"),
    manifest,
    architectureBasis: {
      artifactId: architectureArtifactId,
      fingerprint: architectureFingerprint,
      producerRunId: safeId(
        architectureBasis.producerRunId,
        "$geometryModuleCapture.architectureBasis.producerRunId",
      ),
    },
    structureCapture,
    ...(sourceClosure === undefined ? {} : { sourceClosure }),
    placementAnalysis,
    children,
    ...(predecessor === undefined ? {} : { predecessor }),
    inputBundle,
    receipt,
    assemblyStep,
    assemblyGlb,
    sealedAt: isoDateTime(root.sealedAt, "$geometryModuleCapture.sealedAt"),
  });
}
