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
  type IsolatedOutputPublicationReader,
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
  geometryModuleManifestFromDraft,
  type GeometryModulePredecessor,
  type GeometryModuleStructureCapture,
  parseGeometryModuleDraftCapture,
} from "../../../../domain/cad/canonical/geometry-module-evidence.ts";
import {
  type CanonicalGeometryCapture,
  parseCanonicalGeometryCapture,
} from "../../../../domain/cad/canonical/geometry-part-capture.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../../domain/cad/canonical/geometry-proposal.ts";
import {
  createGeometryModuleInputBundle,
  geometryModuleAssemblyExecutionRequest,
} from "../../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  type IsolatedCodeExecutionReceipt,
  isolatedCodeExecutionReceiptRecord,
  type IsolatedCodeExecutionRequest,
  isolatedCodeOutputManifestsEqual,
  isolatedCodeRefsEqual,
  runtimeAttestationsEqual,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { fingerprintResourceBytes } from "../../../../domain/compile/source/provider-resource-reader.ts";
import {
  deepFreeze,
  exactRecord,
  nonEmptyText,
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
import { PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA } from "../../../../domain/project-source-workspace/types.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";

export { ProjectGeometryModuleExportError };

const GEOMETRY_CAPTURE_URI_PREFIX = "casys://geometry-capture/sha256/";
const DESIGN_WRITE_GEOMETRY_TOOL =
  `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`;

export interface GeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface StructureCaptureOpen {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface StructureCaptureArchitecture {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
}

/**
 * Validated structure projection. The adapter owns CAS text, canonical JSON,
 * rehash, exact part-definitions identity and architecture recross.
 */
export interface StructureCaptureReader {
  reopen(
    identity: StructureCaptureOpen,
    architecture: StructureCaptureArchitecture,
  ): Promise<GeometryModuleStructureCapture | undefined>;
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
  readonly publications: IsolatedOutputPublicationReader;
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
  readonly #publications: IsolatedOutputPublicationReader;
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
    this.#publications = dependencies.publications;
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
    const facts = await this.#architectureIndex.open({
      thread: {
        snapshotId: command.basis.snapshotId,
        revision: command.basis.revision,
        subjectId: command.basis.subjectId,
      },
      architecture: {
        captureSchema: PROJECT_SOURCE_ATTACHMENT_CAPTURE_SCHEMA,
        artifactId: architecture.artifactId,
        fingerprint: architecture.fingerprint,
      },
    });
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
      architecture,
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

    const geometryPrimaries = await this.#loadExactGeometryPrimaries(snapshot);
    const children = this.#resolveChildren(
      geometryPrimaries,
      scope,
      placement.document.placements,
      command.placementAnalysis.fingerprint,
    );
    const predecessor = resolvePredecessor(
      geometryPrimaries,
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
    const request = geometryModuleAssemblyExecutionRequest({
      profile,
      bundle,
      runId,
      producerGeneration: 0,
    });
    const receipt = await this.#resolveOrRunGenerationZero(request, profile);

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
    architecture: StructureCaptureArchitecture,
  ): Promise<GeometryModuleStructureCapture> {
    const archived = archivedRefKeys(snapshot);
    const candidates = snapshot.artifacts.filter((artifact) =>
      artifact.kind === "sysml-model" &&
      artifact.fingerprint.algorithm === "sha256" &&
      isCanonicalDigest(artifact.fingerprint.digest) &&
      artifact.id === `part-definitions-${artifact.fingerprint.digest}` &&
      artifact.inputArtifactIds.includes(architecture.artifactId) &&
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
    let projection: GeometryModuleStructureCapture | undefined;
    try {
      projection = await this.#partDefinitions.reopen(
        {
          artifactId: artifact.id,
          fingerprint: artifact.fingerprint,
          uri: artifact.uri ?? "",
        },
        architecture,
      );
    } catch {
      throw exportError(
        "unresolved",
        "The part-definitions structure capture could not be recrossed.",
      );
    }
    if (!projection) {
      throw exportError(
        "unavailable",
        "The part-definitions structure capture could not be reopened.",
      );
    }
    if (
      projection.schemaVersion !== GEOMETRY_MODULE_STRUCTURE_CAPTURE_SCHEMA ||
      projection.artifactId !== artifact.id ||
      !fingerprintsEqual(projection.fingerprint, artifact.fingerprint)
    ) {
      throw exportError(
        "unresolved",
        "The reopened structure projection is not the named Thread artifact.",
      );
    }
    return projection;
  }

  #resolveChildren(
    primaries: readonly CanonicalGeometryPrimary[],
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
  ): readonly {
    readonly row: GeometryModuleChild;
    readonly stepBytes: Uint8Array;
  }[] {
    const byUsage = new Map(
      placements.map((entry) => [entry.usageElementId, entry] as const),
    );
    const uniqueTargets = [
      ...new Set(
        scope.map((item) => item.partDefinitionElementId),
      ),
    ];
    const resolved = new Map<string, CanonicalGeometryPrimary>();
    for (const targetId of uniqueTargets) {
      resolved.set(targetId, uniquePrimaryForTarget(primaries, targetId));
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
          childGeometry: {
            schemaVersion: child.capture.schemaVersion,
            artifactId: child.artifact.id,
            fingerprint: child.artifact.fingerprint,
          },
          authoritativeStep: {
            fingerprint: child.step.fingerprint,
            bytes: child.step.bytes,
          },
        },
        stepBytes: child.stepBytes,
      };
    });
  }

  async #loadExactGeometryPrimaries(
    snapshot: ThreadSnapshot,
  ): Promise<readonly CanonicalGeometryPrimary[]> {
    const archived = archivedRefKeys(snapshot);
    const primaries: CanonicalGeometryPrimary[] = [];
    for (const artifact of snapshot.artifacts) {
      if (!isCanonicalGeometryPrimaryCandidate(artifact)) continue;
      if (archived.has(`artifact:${artifact.id}`)) continue;
      if (!isExactCanonicalGeometryPrimary(artifact)) {
        throw exportError(
          "unresolved",
          "An active canonical geometry primary has a divergent Thread identity.",
        );
      }
      primaries.push(await this.#consumeCanonicalGeometryPrimary(artifact));
    }
    return primaries;
  }

  async #consumeCanonicalGeometryPrimary(
    artifact: ThreadArtifact,
  ): Promise<CanonicalGeometryPrimary> {
    let text: string | undefined;
    try {
      text = await this.#geometryCaptures.read(artifact.fingerprint);
    } catch {
      throw exportError(
        "unavailable",
        "A canonical child geometry capture could not be reopened.",
      );
    }
    if (!text) {
      throw exportError(
        "unavailable",
        "A canonical child geometry capture could not be reopened.",
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
      if (deterministicJson(parsed) !== text) {
        throw new TypeError("non-canonical");
      }
    } catch {
      throw exportError(
        "unresolved",
        "A canonical child geometry capture is not canonical JSON.",
      );
    }
    const observed = await sha256Fingerprint(parsed);
    if (!fingerprintsEqual(observed, artifact.fingerprint)) {
      throw exportError(
        "unresolved",
        "A canonical child geometry capture failed exact rehash.",
      );
    }
    let capture: CanonicalGeometryCapture;
    try {
      capture = await parseCanonicalGeometryCapture(parsed);
    } catch {
      throw exportError(
        "unresolved",
        "A canonical child geometry capture could not be parsed.",
      );
    }
    if (
      artifact.producer.serverId !== "digital-thread" ||
      artifact.producer.tool !== DESIGN_WRITE_GEOMETRY_TOOL ||
      artifact.producer.runId !== capture.trustedRunId
    ) {
      throw exportError(
        "unresolved",
        "A canonical child geometry producer is not the trusted design.write-geometry@1 run.",
      );
    }
    if (artifact.freshness.status !== "fresh") {
      throw exportError(
        "unresolved",
        "A canonical child geometry capture is not fresh.",
      );
    }
    const targetId = canonicalGeometryTargetId(capture);
    const step = canonicalGeometryStep(capture);
    const stepBytes = await this.#reopenAuthoritativeStep(step);
    return { artifact, capture, targetId, step, stepBytes };
  }

  async #reopenAuthoritativeStep(
    step: {
      readonly fingerprint: ContentFingerprint;
      readonly bytes: number;
    },
  ): Promise<Uint8Array> {
    let bytes: Uint8Array;
    try {
      bytes = await this.#stepAssets.read(step.fingerprint.digest);
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
    if (
      observed !== step.fingerprint.digest ||
      bytes.byteLength !== step.bytes
    ) {
      throw exportError(
        "asset_digest_mismatch",
        "A child STEP digest or byteCount does not match the reopened bytes.",
      );
    }
    return bytes;
  }

  async #resolveOrRunGenerationZero(
    request: IsolatedCodeExecutionRequest,
    profile: Awaited<
      ReturnType<GeometryModuleAssemblyExecutionProfileCatalog["initial"]>
    >,
  ): Promise<IsolatedCodeExecutionReceipt> {
    let resolution;
    try {
      resolution = await this.#publications.resolvePublicationByRunId(
        request.runId,
        0,
      );
    } catch {
      throw exportError(
        "isolated_failure",
        "The generation-zero module-assembly publication could not be resolved safely.",
      );
    }
    if (resolution.status === "outcome-unknown") {
      throw exportError(
        "isolated_failure",
        "The generation-zero module-assembly publication outcome is unknown; no redispatch occurs.",
      );
    }
    if (resolution.status === "published") {
      let receipt: IsolatedCodeExecutionReceipt | undefined;
      try {
        receipt = await this.#publications.readReceipt(resolution.ref);
      } catch {
        throw exportError(
          "isolated_failure",
          "The published generation-zero module-assembly receipt could not be reopened.",
        );
      }
      if (
        !receipt ||
        deterministicJson(isolatedCodeExecutionReceiptRecord(receipt)) !==
          deterministicJson(resolution.receipt)
      ) {
        throw exportError(
          "isolated_failure",
          "The published generation-zero module-assembly receipt is unavailable or divergent.",
        );
      }
      await assertReceiptMatchesAssemblyContext(receipt, request, profile);
      return receipt;
    }
    try {
      const receipt = await this.#runner.run(request);
      await assertReceiptMatchesAssemblyContext(receipt, request, profile);
      return receipt;
    } catch (cause) {
      if (cause instanceof ProjectGeometryModuleExportError) throw cause;
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
  }
}

async function assertReceiptMatchesAssemblyContext(
  receipt: IsolatedCodeExecutionReceipt,
  request: IsolatedCodeExecutionRequest,
  profile: Awaited<
    ReturnType<GeometryModuleAssemblyExecutionProfileCatalog["initial"]>
  >,
): Promise<void> {
  let record;
  try {
    record = await validateIsolatedCodeExecutionReceiptRecord(
      isolatedCodeExecutionReceiptRecord(receipt),
    );
  } catch {
    throw exportError(
      "isolated_failure",
      "The module-assembly receipt failed exact validation.",
    );
  }
  if (
    record.runId !== request.runId ||
    record.producerGeneration !== 0 ||
    record.publication.ref.runId !== request.runId ||
    record.publication.ref.producerGeneration !== 0 ||
    !isolatedCodeRefsEqual(record.profile, request.profile) ||
    record.sourceSha256 !== request.source.sha256 ||
    !isolatedCodeRefsEqual(record.policy, request.policy) ||
    !isolatedCodeOutputManifestsEqual(record.outputs, request.outputs) ||
    !runtimeAttestationsEqual(record.runtime, profile.runtime) ||
    record.termination.kind !== "exited" ||
    record.termination.exitCode !== 0 ||
    record.termination.signal !== null ||
    record.destruction.status !== profile.minimumDestructionAssurance ||
    record.destruction.runId !== request.runId
  ) {
    throw exportError(
      "isolated_failure",
      "The module-assembly receipt differs from the exact generation-zero request and profile context.",
    );
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
    partDefinitionElementId: nonEmptyText(
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

interface CanonicalGeometryPrimary {
  readonly artifact: ThreadArtifact;
  readonly capture: CanonicalGeometryCapture;
  readonly targetId: string;
  readonly step: {
    readonly fingerprint: ContentFingerprint;
    readonly bytes: number;
  };
  readonly stepBytes: Uint8Array;
}

function isExactCanonicalGeometryPrimary(artifact: ThreadArtifact): boolean {
  const digest = artifact.fingerprint.digest;
  return artifact.kind === "cad-model" &&
    artifact.fingerprint.algorithm === "sha256" &&
    isCanonicalDigest(digest) &&
    artifact.id === `geometry-${digest}` &&
    artifact.version === digest &&
    artifact.uri === `${GEOMETRY_CAPTURE_URI_PREFIX}${digest}` &&
    artifact.mediaType === "application/json";
}

function isCanonicalGeometryPrimaryCandidate(artifact: ThreadArtifact): boolean {
  return artifact.kind === "cad-model" &&
    (
      artifact.uri?.startsWith("casys://geometry-capture/") === true ||
      (
        artifact.producer.serverId === "digital-thread" &&
        artifact.producer.tool === DESIGN_WRITE_GEOMETRY_TOOL
      )
    );
}

function canonicalGeometryTargetId(capture: CanonicalGeometryCapture): string {
  return capture.schemaVersion === GEOMETRY_MODULE_CAPTURE_SCHEMA
    ? capture.manifest.target.partDefinitionElementId
    : capture.sourceScript.partDefinitionElementId;
}

function canonicalGeometryStep(capture: CanonicalGeometryCapture): {
  readonly fingerprint: ContentFingerprint;
  readonly bytes: number;
} {
  return capture.schemaVersion === GEOMETRY_MODULE_CAPTURE_SCHEMA
    ? capture.assemblyStep
    : capture.sourceScript.authoritativeStep;
}

function uniquePrimaryForTarget(
  primaries: readonly CanonicalGeometryPrimary[],
  targetId: string,
): CanonicalGeometryPrimary {
  const matching = primaries.filter((item) => item.targetId === targetId);
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
  return matching[0]!;
}

function resolvePredecessor(
  primaries: readonly CanonicalGeometryPrimary[],
  targetId: string,
): GeometryModulePredecessor | undefined {
  const matching = primaries.filter((item) => item.targetId === targetId);
  if (matching.length === 0) return undefined;
  if (matching.length > 1) {
    throw exportError(
      "unresolved",
      "More than one active same-target canonical geometry predecessor exists.",
    );
  }
  const primary = matching[0]!;
  return {
    schemaVersion: primary.capture.schemaVersion,
    artifactId: primary.artifact.id,
    fingerprint: primary.artifact.fingerprint,
    partDefinitionElementId: targetId,
  };
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
