/**
 * Recross one exact composite PartDefinition into a review-only module draft.
 *
 * The caller names only project, current Thread basis, target definition and
 * placement locator. The server reopens structure, exact immediate usages,
 * unique active child geometry and authoritative STEP bytes, then runs the
 * fixed module-assembler profile. Nothing is written to Thread.
 */

import type {
  ProjectGeometryModuleExportCommand,
  ProjectGeometryModuleExportErrorCode,
  ProjectGeometryModuleExportResult,
  ProjectGeometryModuleExportUseCase,
} from "../../../ports/in/cad/canonical/project-geometry-module-export.ts";
import { ProjectGeometryModuleExportError } from "../../../ports/in/cad/canonical/project-geometry-module-export.ts";
import type { GeometryDraftAssetStore } from "../../../ports/out/cad/canonical/geometry-draft-asset-store.ts";
import type { GeometryModuleDraftStore } from "../../../ports/out/cad/canonical/geometry-module-evidence-store.ts";
import type { CanonicalAssetReader } from "../../../ports/out/canonical-asset-reader.ts";
import type { CadPlacementArchitectureIndex } from "../../../ports/out/cad/placement/cad-placement-architecture-index.ts";
import {
  type CadPlacementAnalysisCaptureStore,
  CadPlacementAnalysisCaptureStoreError,
} from "../../../ports/out/cad/placement/cad-placement-analysis-capture-store.ts";
import type { GeometryModuleAssemblyExecutionProfileCatalog } from "../../../ports/out/cad/module-assembly/geometry-module-assembly-profile.ts";
import {
  IsolatedCodeExecutionRejectedError,
  type IsolatedCodeRunner,
} from "../../../ports/out/compile/isolation/isolated-code-runner.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import type { ProductStructureTraversal } from "../../../ports/out/product-navigation/product-structure-traversal.ts";
import type { CadPlacementAnalysisCaptureLocator } from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  assertCadPlacementAnalysisCaptureLocatorsEqual,
  validateCadPlacementAnalysisCaptureLocator,
} from "../../../../domain/cad/placement/cad-placement-analysis-capture.ts";
import {
  encodeGeometryModuleDecisionParameters,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_KIND,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleChild,
  type GeometryModuleChildCaptureSchema,
  geometryModuleManifestFromDraft,
  type GeometryModulePredecessor,
  parseGeometryModuleDraftCapture,
} from "../../../../domain/cad/canonical/geometry-module-evidence.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  parseGeometryPartManifest,
} from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import {
  createGeometryModuleInputBundle,
  geometryModuleAssemblyExecutionRequest,
} from "../../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import { isolatedCodeExecutionReceiptRecord } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import {
  parseExactThreadSnapshotBasis,
  selectCurrentThreadTip,
} from "../../../../domain/project/thread-tip.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

export { ProjectGeometryModuleExportError };

const GEOMETRY_CAPTURE_URI_PREFIX = "casys://geometry-capture/sha256/";
const PART_DEFINITIONS_CAPTURE_URI_PREFIX = "casys://part-definitions-capture/";

export interface GeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface StructureCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface ExportProjectGeometryModuleDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly traversal: ProductStructureTraversal;
  readonly architectureIndex: CadPlacementArchitectureIndex;
  readonly partDefinitions: StructureCaptureReader;
  readonly placements: Pick<CadPlacementAnalysisCaptureStore, "reopenLocator">;
  readonly geometryCaptures: GeometryCaptureReader;
  readonly stepAssets: CanonicalAssetReader;
  readonly profiles: GeometryModuleAssemblyExecutionProfileCatalog;
  readonly runner: IsolatedCodeRunner;
  readonly draftStore: Pick<GeometryModuleDraftStore, "save" | "read">;
  readonly draftAssets: GeometryDraftAssetStore;
}

export class ExportProjectGeometryModule implements ProjectGeometryModuleExportUseCase {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #traversal: ProductStructureTraversal;
  readonly #architectureIndex: CadPlacementArchitectureIndex;
  readonly #partDefinitions: StructureCaptureReader;
  readonly #placements: Pick<CadPlacementAnalysisCaptureStore, "reopenLocator">;
  readonly #geometryCaptures: GeometryCaptureReader;
  readonly #stepAssets: CanonicalAssetReader;
  readonly #profiles: GeometryModuleAssemblyExecutionProfileCatalog;
  readonly #runner: IsolatedCodeRunner;
  readonly #draftStore: Pick<GeometryModuleDraftStore, "save" | "read">;
  readonly #draftAssets: GeometryDraftAssetStore;

  constructor(dependencies: ExportProjectGeometryModuleDependencies) {
    this.#projects = dependencies.projects;
    this.#snapshots = dependencies.snapshots;
    this.#traversal = dependencies.traversal;
    this.#architectureIndex = dependencies.architectureIndex;
    this.#partDefinitions = dependencies.partDefinitions;
    this.#placements = dependencies.placements;
    this.#geometryCaptures = dependencies.geometryCaptures;
    this.#stepAssets = dependencies.stepAssets;
    this.#profiles = dependencies.profiles;
    this.#runner = dependencies.runner;
    this.#draftStore = dependencies.draftStore;
    this.#draftAssets = dependencies.draftAssets;
  }

  async execute(value: unknown): Promise<ProjectGeometryModuleExportResult> {
    let command: ProjectGeometryModuleExportCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw exportError(
        "invalid_request",
        "The geometry-module export request failed exact validation.",
      );
    }

    const project = await this.#projects.get(command.projectId);
    if (!project || project.project.id !== command.projectId) {
      throw exportError("unavailable", "The named project is unavailable.");
    }

    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      throw exportError(
        "unavailable",
        "The project has no unique current Thread basis.",
      );
    }
    if (!basesEqual(tip.basis, command.basis)) {
      throw exportError(
        "basis_mismatch",
        "The current Thread basis is not the named command basis.",
      );
    }

    const snapshot = await this.#snapshots.get(command.basis.snapshotId);
    if (
      !snapshot ||
      snapshot.id !== command.basis.snapshotId ||
      snapshot.revision !== command.basis.revision ||
      snapshot.subject.id !== command.basis.subjectId
    ) {
      throw exportError(
        "unavailable",
        "The named Thread snapshot could not be reopened at the command basis.",
      );
    }

    const structure = await this.#traversal.open(snapshot);
    if (!structure) {
      throw exportError(
        "unavailable",
        "The current Thread architecture could not be reopened.",
      );
    }
    const architecture = {
      artifactId: structure.architectureArtifactId,
      fingerprint: structure.architectureFingerprint,
    };
    const facts = await this.#architectureIndex.open(architecture);
    if (!facts) {
      throw exportError(
        "unavailable",
        "The current architecture navigation index could not be reopened.",
      );
    }

    const targetRecord = structure.element(command.partDefinitionElementId);
    if (
      !targetRecord ||
      targetRecord.label.trim() === "" ||
      !structure.hasDefinition(command.partDefinitionElementId)
    ) {
      throw exportError(
        "unavailable",
        "The named composite PartDefinition is not on the current architecture.",
      );
    }
    const immediateUsageIds = [...facts.immediateUsageIds(
      command.partDefinitionElementId,
    )];
    if (immediateUsageIds.length === 0) {
      throw exportError(
        "unresolved",
        "The named PartDefinition has no immediate PartUsage children.",
      );
    }

    const scope = immediateUsageIds.map((usageElementId) => {
      const typed = facts.typedDefinitionId(usageElementId) ??
        structure.typedDefinition(usageElementId)?.element.elementId;
      if (!typed) {
        throw exportError(
          "unresolved",
          "An immediate PartUsage has no exact typed PartDefinition.",
        );
      }
      return { usageElementId, partDefinitionElementId: typed };
    });
    scope.sort((left, right) =>
      left.usageElementId < right.usageElementId
        ? -1
        : left.usageElementId > right.usageElementId
        ? 1
        : 0
    );

    const structureCapture = await this.#reopenStructureCapture(
      snapshot,
      architecture.artifactId,
    );

    let placement;
    try {
      placement = await this.#placements.reopenLocator(command.placementAnalysis);
    } catch (cause) {
      if (
        cause instanceof CadPlacementAnalysisCaptureStoreError &&
        cause.code === "capture_absent"
      ) {
        throw exportError(
          "unavailable",
          "The named placement analysis capture is unavailable.",
        );
      }
      throw exportError(
        "unresolved",
        "The named placement analysis capture could not be recrossed.",
      );
    }
    try {
      assertCadPlacementAnalysisCaptureLocatorsEqual(
        command.placementAnalysis,
        placement.locator,
        "$geometryModuleExport.placementAnalysis",
      );
    } catch (cause) {
      if (cause instanceof TypeError) {
        throw exportError(
          "unresolved",
          "The reopened placement locator is not the named locator.",
        );
      }
      throw cause;
    }
    recrossPlacement(placement.document, {
      targetId: command.partDefinitionElementId,
      basis: command.basis,
      architecture,
      scope,
    });

    const children = await this.#resolveChildren(
      snapshot,
      scope,
      placement.document.placements,
      command.placementAnalysis.fingerprint,
    );
    const predecessor = await this.#resolvePredecessor(
      snapshot,
      command.partDefinitionElementId,
    );

    const bundle = await createGeometryModuleInputBundle(
      children.map((child) => ({
        usageElementId: child.row.usageElementId,
        partDefinitionElementId: child.row.partDefinitionElementId,
        placement: child.row.placement,
        childCapture: child.row.childGeometry,
        stepBytes: child.stepBytes,
      })),
    );

    const profile = await this.#profiles.initial();
    const runId = await moduleExportRunId(command);
    let receipt;
    try {
      receipt = await this.#runner.run(geometryModuleAssemblyExecutionRequest({
        profile,
        bundle,
        runId,
        producerGeneration: 0,
      }));
    } catch (cause) {
      if (cause instanceof IsolatedCodeExecutionRejectedError) {
        throw exportError(
          "isolated_failure",
          "The isolated module-assembler run was rejected.",
        );
      }
      throw exportError(
        "isolated_failure",
        "The isolated module-assembler run failed.",
      );
    }

    const stepOutput = receipt.outputs.find((output) =>
      output.role === "assembly.step"
    );
    const glbOutput = receipt.outputs.find((output) => output.role === "assembly.glb");
    if (!stepOutput || !glbOutput) {
      throw exportError(
        "isolated_failure",
        "The isolated receipt does not name assembly STEP and GLB.",
      );
    }
    const persistedStep = await this.#draftAssets.persist(stepOutput.bytes.copy());
    const persistedGlb = await this.#draftAssets.persist(glbOutput.bytes.copy());
    if (
      persistedStep.fingerprint.digest !== stepOutput.sha256 ||
      persistedStep.byteCount !== stepOutput.byteCount ||
      persistedGlb.fingerprint.digest !== glbOutput.sha256 ||
      persistedGlb.byteCount !== glbOutput.byteCount
    ) {
      throw exportError(
        "isolated_failure",
        "Persisted assembly bytes do not match the isolated receipt.",
      );
    }

    const unsignedDraft = {
      schemaVersion: GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
      kind: GEOMETRY_MODULE_DRAFT_KIND,
      architectureBasis: {
        snapshotId: snapshot.id,
        revision: snapshot.revision,
        artifactFingerprint: architecture.fingerprint,
      },
      structureCapture,
      target: {
        partDefinitionElementId: command.partDefinitionElementId,
        label: targetRecord.label,
      },
      ...(predecessor === undefined ? {} : { predecessor }),
      placementAnalysis: command.placementAnalysis,
      children: children.map((child) => child.row),
      unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
      placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
      inputBundle: {
        schemaVersion: bundle.manifest.schemaVersion,
        fingerprint: bundle.fingerprint,
        byteCount: bundle.bytes.byteLength,
        manifest: bundle.manifest,
      },
      receipt: isolatedCodeExecutionReceiptRecord(receipt),
      assemblyStep: {
        fingerprint: persistedStep.fingerprint,
        bytes: persistedStep.byteCount,
      },
      assemblyGlb: {
        fingerprint: persistedGlb.fingerprint,
        bytes: persistedGlb.byteCount,
      },
    };
    await parseGeometryModuleDraftCapture(unsignedDraft);
    const persisted = await this.#draftStore.save(unsignedDraft);
    const reread = await this.#draftStore.read(persisted.fingerprint);
    if (!reread) {
      throw exportError(
        "unavailable",
        "The geometry-module draft could not be reread after save.",
      );
    }
    await parseGeometryModuleDraftCapture(reread);
    const manifest = geometryModuleManifestFromDraft(reread);
    const decisionParameters = encodeGeometryModuleDecisionParameters(
      persisted.fingerprint.digest,
      manifest,
    );

    return deepFreeze({
      draftDigest: persisted.fingerprint.digest,
      target: {
        partDefinitionElementId: command.partDefinitionElementId,
        label: targetRecord.label,
        files: [
          {
            format: "step" as const,
            name: "assembly.step",
            bytes: persistedStep.byteCount,
            digest: persistedStep.fingerprint.digest,
          },
          {
            format: "gltf" as const,
            name: "assembly.glb",
            bytes: persistedGlb.byteCount,
            digest: persistedGlb.fingerprint.digest,
          },
        ],
      },
      decisionParameters,
      grants: "none",
    });
  }

  async #reopenStructureCapture(
    snapshot: ThreadSnapshot,
    architectureArtifactId: string,
  ): Promise<{
    readonly schemaVersion: typeof GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA;
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  }> {
    const archived = archivedRefKeys(snapshot);
    const candidates = snapshot.artifacts.filter((artifact) =>
      artifact.kind === "sysml-model" &&
      artifact.id === `part-definitions-${artifact.fingerprint.digest}` &&
      artifact.uri?.startsWith(PART_DEFINITIONS_CAPTURE_URI_PREFIX) &&
      artifact.inputArtifactIds.includes(architectureArtifactId) &&
      !archived.has(`artifact:${artifact.id}`)
    );
    if (candidates.length === 0) {
      throw exportError(
        "unavailable",
        "The current part-definitions structure capture is unavailable.",
      );
    }
    if (candidates.length > 1) {
      throw exportError(
        "unresolved",
        "More than one active part-definitions structure capture is on the current Thread.",
      );
    }
    const artifact = candidates[0]!;
    const text = await this.#partDefinitions.read(artifact.fingerprint);
    if (!text) {
      throw exportError(
        "unavailable",
        "The part-definitions structure capture could not be reopened.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      if (deterministicJson(parsed) !== text) throw new TypeError("non-canonical");
    } catch {
      throw exportError(
        "unresolved",
        "The part-definitions structure capture is not canonical JSON.",
      );
    }
    const observed = await sha256Fingerprint(parsed);
    if (!fingerprintsEqual(observed, artifact.fingerprint)) {
      throw exportError(
        "unresolved",
        "The part-definitions structure capture failed exact rehash.",
      );
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      (parsed as { schemaVersion?: unknown }).schemaVersion !==
        GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA
    ) {
      throw exportError(
        "unresolved",
        "The reopened structure capture is not part-definitions-capture/1.0.",
      );
    }
    return {
      schemaVersion: GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA,
      artifactId: artifact.id,
      fingerprint: artifact.fingerprint,
    };
  }

  async #resolveChildren(
    snapshot: ThreadSnapshot,
    scope: readonly {
      readonly usageElementId: string;
      readonly partDefinitionElementId: string;
    }[],
    placements: readonly {
      readonly usageElementId: string;
      readonly partDefinitionElementId: string;
      readonly placement: {
        readonly translationMm: readonly [number, number, number];
        readonly rotationDeg: readonly [number, number, number];
      };
    }[],
    placementCapture: ContentFingerprint,
  ): Promise<
    readonly {
      readonly row: GeometryModuleChild;
      readonly stepBytes: Uint8Array;
    }[]
  > {
    const byUsage = new Map(
      placements.map((entry) => [entry.usageElementId, entry] as const),
    );
    const uniqueTargets = [
      ...new Set(
        scope.map((item) => item.partDefinitionElementId),
      ),
    ];
    const resolved = new Map<string, {
      readonly childGeometry: {
        readonly schemaVersion: GeometryModuleChildCaptureSchema;
        readonly artifactId: string;
        readonly fingerprint: ContentFingerprint;
      };
      readonly stepBytes: Uint8Array;
      readonly stepFingerprint: ContentFingerprint;
    }>();
    for (const targetId of uniqueTargets) {
      resolved.set(
        targetId,
        await this.#resolveUniqueChildCapture(snapshot, targetId),
      );
    }
    return scope.map((item) => {
      const placement = byUsage.get(item.usageElementId);
      const child = resolved.get(item.partDefinitionElementId);
      if (!placement || !child) {
        throw exportError(
          "unresolved",
          "Immediate child coverage is incomplete after recross.",
        );
      }
      return {
        row: {
          usageElementId: item.usageElementId,
          partDefinitionElementId: item.partDefinitionElementId,
          placement: {
            translationMm: placement.placement.translationMm,
            rotationDeg: placement.placement.rotationDeg,
          },
          placementCapture,
          childGeometry: child.childGeometry,
          authoritativeStep: {
            fingerprint: child.stepFingerprint,
            bytes: child.stepBytes.byteLength,
          },
        },
        stepBytes: child.stepBytes,
      };
    });
  }

  async #resolveUniqueChildCapture(
    snapshot: ThreadSnapshot,
    targetId: string,
  ): Promise<{
    readonly childGeometry: {
      readonly schemaVersion: GeometryModuleChildCaptureSchema;
      readonly artifactId: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly stepBytes: Uint8Array;
    readonly stepFingerprint: ContentFingerprint;
  }> {
    const archived = archivedRefKeys(snapshot);
    const matching: ThreadArtifact[] = [];
    for (const artifact of snapshot.artifacts) {
      if (
        artifact.kind !== "cad-model" ||
        !artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
      ) {
        continue;
      }
      const extracted = await this.#extractChildGeometry(artifact);
      if (!extracted || extracted.targetId !== targetId) continue;
      if (archived.has(`artifact:${artifact.id}`)) continue;
      matching.push(artifact);
    }
    if (matching.length === 0) {
      throw exportError(
        "unavailable",
        "No unique active canonical child geometry capture exists for an immediate target.",
      );
    }
    if (matching.length > 1) {
      throw exportError(
        "unresolved",
        "More than one active canonical child geometry capture exists for an immediate target.",
      );
    }
    const artifact = matching[0]!;
    const extracted = await this.#extractChildGeometry(artifact);
    if (!extracted) {
      throw exportError(
        "unavailable",
        "The unique child geometry capture could not be reopened.",
      );
    }
    const stepBytes = await this.#reopenAuthoritativeStep(extracted.stepDigest);
    return {
      childGeometry: {
        schemaVersion: extracted.schemaVersion,
        artifactId: artifact.id,
        fingerprint: artifact.fingerprint,
      },
      stepBytes,
      stepFingerprint: {
        algorithm: "sha256",
        digest: extracted.stepDigest,
      },
    };
  }

  async #extractChildGeometry(
    artifact: ThreadArtifact,
  ): Promise<
    | {
      readonly schemaVersion: GeometryModuleChildCaptureSchema;
      readonly targetId: string;
      readonly stepDigest: string;
    }
    | undefined
  > {
    const digest = artifact.fingerprint.digest;
    if (
      artifact.fingerprint.algorithm !== "sha256" ||
      !isCanonicalDigest(digest) ||
      artifact.id !== `geometry-${digest}` ||
      artifact.uri !== `${GEOMETRY_CAPTURE_URI_PREFIX}${digest}`
    ) {
      return undefined;
    }
    let text: string | undefined;
    try {
      text = await this.#geometryCaptures.read(artifact.fingerprint);
    } catch {
      return undefined;
    }
    if (!text) return undefined;
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      if (deterministicJson(parsed) !== text) return undefined;
    } catch {
      return undefined;
    }
    const observed = await sha256Fingerprint(parsed);
    if (!fingerprintsEqual(observed, artifact.fingerprint)) return undefined;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (record.schemaVersion === GEOMETRY_PART_CAPTURE_SCHEMA) {
      try {
        const manifest = parseGeometryPartManifest(record.manifest, {
          requireCompleted: true,
        });
        const step = manifest.target.files?.find((file) => file.format === "step");
        if (!step) return undefined;
        return {
          schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
          targetId: manifest.target.partDefinitionElementId,
          stepDigest: step.fingerprint.digest,
        };
      } catch {
        return undefined;
      }
    }
    if (record.schemaVersion === GEOMETRY_MODULE_CAPTURE_SCHEMA) {
      const target = childModuleTarget(record.manifest);
      const step = childModuleStep(record.assemblyStep);
      if (!target || !step) return undefined;
      return {
        schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
        targetId: target,
        stepDigest: step,
      };
    }
    return undefined;
  }

  async #reopenAuthoritativeStep(digest: string): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await this.#stepAssets.read(digest);
    } catch (cause) {
      if (errorCode(cause) === "integrity_mismatch") {
        throw exportError(
          "asset_digest_mismatch",
          "A child STEP failed integrity verification.",
        );
      }
      throw exportError(
        "unavailable",
        "A child authoritative STEP could not be reopened.",
      );
    }
    const observed = await fingerprintResourceBytes(bytes);
    if (observed !== digest) {
      throw exportError(
        "asset_digest_mismatch",
        "A child STEP digest does not match the reopened bytes.",
      );
    }
    return bytes;
  }

  async #resolvePredecessor(
    snapshot: ThreadSnapshot,
    targetId: string,
  ): Promise<GeometryModulePredecessor | undefined> {
    const archived = archivedRefKeys(snapshot);
    const matching: GeometryModulePredecessor[] = [];
    for (const artifact of snapshot.artifacts) {
      if (
        artifact.kind !== "cad-model" ||
        !artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) ||
        archived.has(`artifact:${artifact.id}`)
      ) {
        continue;
      }
      const extracted = await this.#extractChildGeometry(artifact);
      if (
        !extracted ||
        extracted.schemaVersion !== GEOMETRY_MODULE_CAPTURE_SCHEMA ||
        extracted.targetId !== targetId
      ) {
        continue;
      }
      matching.push({
        schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
        artifactId: artifact.id,
        fingerprint: artifact.fingerprint,
        partDefinitionElementId: targetId,
      });
    }
    if (matching.length === 0) return undefined;
    if (matching.length > 1) {
      throw exportError(
        "unresolved",
        "More than one active same-target geometry-module predecessor exists.",
      );
    }
    return matching[0];
  }
}

function parseCommand(value: unknown): ProjectGeometryModuleExportCommand {
  const root = exactRecord(
    value,
    ["projectId", "basis", "partDefinitionElementId", "placementAnalysis"],
    "$geometryModuleExport",
  );
  return {
    projectId: safeId(root.projectId, "$geometryModuleExport.projectId"),
    basis: parseExactThreadSnapshotBasis(root.basis, "$geometryModuleExport.basis"),
    partDefinitionElementId: safeId(
      root.partDefinitionElementId,
      "$geometryModuleExport.partDefinitionElementId",
    ),
    placementAnalysis: validateCadPlacementAnalysisCaptureLocator(
      root.placementAnalysis,
      "$geometryModuleExport.placementAnalysis",
    ),
  };
}

function recrossPlacement(
  document: {
    readonly owner: { readonly elementId: string };
    readonly declaredAgainst: {
      readonly thread: {
        readonly snapshotId: string;
        readonly revision: number;
        readonly subjectId: string;
      };
      readonly architecture: {
        readonly artifactId: string;
        readonly fingerprint: ContentFingerprint;
      };
    };
    readonly placements: readonly {
      readonly usageElementId: string;
      readonly partDefinitionElementId: string;
    }[];
  },
  expected: {
    readonly targetId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly architecture: {
      readonly artifactId: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly scope: readonly {
      readonly usageElementId: string;
      readonly partDefinitionElementId: string;
    }[];
  },
): void {
  if (document.owner.elementId !== expected.targetId) {
    throw exportError(
      "unresolved",
      "The placement analysis owner is not the named composite PartDefinition.",
    );
  }
  if (
    document.declaredAgainst.thread.snapshotId !== expected.basis.snapshotId ||
    document.declaredAgainst.thread.revision !== expected.basis.revision ||
    document.declaredAgainst.thread.subjectId !== expected.basis.subjectId
  ) {
    throw exportError(
      "unresolved",
      "The placement analysis Thread basis is not the current command basis.",
    );
  }
  if (
    document.declaredAgainst.architecture.artifactId !==
      expected.architecture.artifactId ||
    !fingerprintsEqual(
      document.declaredAgainst.architecture.fingerprint,
      expected.architecture.fingerprint,
    )
  ) {
    throw exportError(
      "unresolved",
      "The placement analysis architecture basis is not the current architecture.",
    );
  }
  const expectedKeys = new Set(
    expected.scope.map((item) =>
      `${item.usageElementId}\0${item.partDefinitionElementId}`
    ),
  );
  const observedKeys = new Set(
    document.placements.map((item) =>
      `${item.usageElementId}\0${item.partDefinitionElementId}`
    ),
  );
  if (expectedKeys.size !== observedKeys.size) {
    throw exportError(
      "unresolved",
      "Placement coverage is not the exact immediate PartUsage scope.",
    );
  }
  for (const key of expectedKeys) {
    if (!observedKeys.has(key)) {
      throw exportError(
        "unresolved",
        "Placement coverage is not the exact immediate PartUsage scope.",
      );
    }
  }
}

function basesEqual(
  left: EngineeringThreadSnapshotBasis,
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left.kind === right.kind &&
    left.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

async function moduleExportRunId(
  command: ProjectGeometryModuleExportCommand,
): Promise<string> {
  const fingerprint = await sha256Fingerprint({
    projectId: command.projectId,
    basis: command.basis,
    partDefinitionElementId: command.partDefinitionElementId,
    placementAnalysis: command.placementAnalysis,
  });
  return `geom-mod-export-${fingerprint.digest}`;
}

function childModuleTarget(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const target = (value as { target?: unknown }).target;
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    return undefined;
  }
  const id = (target as { partDefinitionElementId?: unknown }).partDefinitionElementId;
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function childModuleStep(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const fingerprint = (value as { fingerprint?: unknown }).fingerprint;
  if (!fingerprint || typeof fingerprint !== "object" || Array.isArray(fingerprint)) {
    return undefined;
  }
  const digest = (fingerprint as { digest?: unknown }).digest;
  return typeof digest === "string" && isCanonicalDigest(digest) ? digest : undefined;
}

function isCanonicalDigest(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function errorCode(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function exportError(
  code: ProjectGeometryModuleExportErrorCode,
  message: string,
): ProjectGeometryModuleExportError {
  return new ProjectGeometryModuleExportError(code, message);
}

export type { CadPlacementAnalysisCaptureLocator };
