/**
 * Module-aware proving path for the existing `design.write-geometry@1` sealer.
 *
 * The public operation identity stays `design.write-geometry@1`. This module
 * reopens the signed draft, every named child capture plus its STEP bytes,
 * rebuilds the input bundle, and reopens isolated assembly outputs. A
 * persisted bundle identity is never treated as proof of those bytes. It does
 * not export, dispatch CAD, or register a second sealer.
 */

import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { IsolatedOutputPublicationReader } from "../../../application/ports/out/compile/isolation/isolated-code-runner.ts";
import type {
  IsolatedCodeOutputDeclaration,
  IsolatedCodeOutputReceiptRecord,
} from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "../../../domain/cad/module-assembly/geometry-module-assembly-execution.ts";
import { createGeometryModuleInputBundle } from "../../../domain/cad/module-assembly/geometry-module-input-bundle.ts";
import {
  assertGeometryModuleInputBundleMatchesIdentity,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
  type GeometryModuleCapture,
  type GeometryModuleChild,
  type GeometryModuleDraftCapture,
  GeometryModuleEvidenceError,
  type GeometryModuleInputBundleIdentity,
  type GeometryModuleManifest,
  geometryModuleManifestFromDraft,
  parseGeometryModuleDraftCapture,
  recrossGeometryModuleIsolation,
} from "../../../domain/cad/canonical/geometry-module-evidence.ts";
import {
  type CanonicalGeometryCapture,
  parseCanonicalGeometryCapture,
} from "../../../domain/cad/canonical/geometry-part-capture.ts";
import { GEOMETRY_PART_CAPTURE_SCHEMA } from "../../../domain/cad/canonical/geometry-part-manifest.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../domain/cad/canonical/geometry-proposal.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import {
  GEOMETRY_CAPTURE_URI_PREFIX,
  PART_DEFINITIONS_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";

export const GEOMETRY_MODULE_STRUCTURE_DERIVATION_RATIONALE =
  "The sealed geometry-module capture is derived from the exact part-definitions structure basis.";
export const GEOMETRY_MODULE_STRUCTURE_USE_RATIONALE =
  "The sealer consumed the exact part-definitions capture named by the signed module manifest.";
export const GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE =
  "The module assembly is derived from the exact active child geometry capture reopened by the sealer.";
export const GEOMETRY_MODULE_CHILD_USE_RATIONALE =
  "The module sealer consumed the exact child geometry capture and its authoritative STEP bytes.";
export const GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE =
  "The assembly asset is derived from the exact sealed module capture that names its content fingerprint.";

export interface GeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface GeometryModuleAssemblyOutputValidation {
  validateOutput(
    declaration: IsolatedCodeOutputDeclaration,
    observedBytes: Uint8Array,
  ): Promise<void>;
}

export interface ReviewedGeometryModuleDraft {
  readonly draft: Omit<GeometryModuleDraftCapture, "fingerprint">;
  readonly binaryProducer: ThreadOperationRef;
  readonly assemblyStepBytes: Uint8Array;
  readonly assemblyGlbBytes: Uint8Array;
}

export function isGeometryModuleManifest(
  manifest: { readonly schemaVersion: string },
): manifest is GeometryModuleManifest & {
  readonly components: never;
  readonly artifactHashes?: never;
  readonly scriptHash?: never;
} {
  return manifest.schemaVersion === GEOMETRY_MODULE_MANIFEST_SCHEMA;
}

export function geometryModuleBinaryProducer(
  receipt: GeometryModuleDraftCapture["receipt"],
): ThreadOperationRef {
  return {
    serverId: "digital-thread",
    tool:
      `${GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.id}@${GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE.version}`,
    runId: receipt.runId,
  };
}

export function geometryModuleAssemblyStepArtifactId(
  captureDigest: string,
  stepDigest: string,
): string {
  return `cad-asset-${captureDigest}-module-step-${stepDigest}`;
}

export function geometryModuleAssemblyGlbArtifactId(
  captureDigest: string,
  glbDigest: string,
): string {
  return `cad-asset-${captureDigest}-module-glb-${glbDigest}`;
}

export function geometryModuleStructureConsumptionId(
  structureId: string,
  primaryId: string,
): string {
  return `consume-structure-${structureId}-by-${primaryId}`;
}

export function geometryModulePrimaryInputIds(options: {
  readonly architectureId: string;
  readonly structureId: string;
  readonly childPrimaryIds: readonly string[];
  readonly predecessorId?: string;
}): readonly string[] {
  const childPrimaryIds = [...new Set(options.childPrimaryIds)];
  return [
    options.architectureId,
    options.structureId,
    ...childPrimaryIds,
    ...(options.predecessorId === undefined ? [] : [options.predecessorId]),
  ];
}

export function requireStructureCaptureArtifact(
  base: ThreadSnapshot,
  structure: GeometryModuleManifest["structureCapture"],
): ThreadArtifact {
  const archived = archivedRefKeys(base);
  const matches = base.artifacts.filter((artifact) =>
    artifact.id === structure.artifactId &&
    fingerprintsEqual(artifact.fingerprint, structure.fingerprint)
  );
  if (matches.length === 0) {
    throw moduleTransition(
      "geometry_module_structure_missing: the signed part-definitions structure basis is absent.",
    );
  }
  if (matches.length > 1) {
    throw moduleTransition(
      "geometry_module_structure_ambiguous: the signed part-definitions structure basis is not unique.",
    );
  }
  const artifact = matches[0]!;
  const digest = artifact.fingerprint.digest;
  if (
    archived.has(`artifact:${artifact.id}`) ||
    artifact.id !== `part-definitions-${digest}` ||
    artifact.version !== digest ||
    artifact.kind !== "sysml-model" ||
    artifact.uri !== `${PART_DEFINITIONS_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    artifact.mediaType !== "application/json"
  ) {
    throw moduleTransition(
      "geometry_module_structure_mismatch: the part-definitions structure basis identity is not exact.",
    );
  }
  return artifact;
}

export async function loadReviewedGeometryModuleDraft(
  draftRecord: unknown,
  manifest: GeometryModuleManifest,
  options: {
    readonly base: ThreadSnapshot;
    readonly geometryCaptures: GeometryCaptureReader;
    readonly publications: IsolatedOutputPublicationReader;
    readonly outputValidator: GeometryModuleAssemblyOutputValidation;
    readonly canonicalDirectory: string;
  },
): Promise<ReviewedGeometryModuleDraft> {
  let unsigned: Omit<GeometryModuleDraftCapture, "fingerprint">;
  try {
    unsigned = await parseGeometryModuleDraftCapture(draftRecord);
  } catch (error) {
    throw moduleTransition(
      `Geometry module draft admission contract mismatch: ${detail(error)}`,
    );
  }
  const reconstructed = geometryModuleManifestFromDraft(unsigned);
  if (deterministicJson(reconstructed) !== deterministicJson(manifest)) {
    throw moduleTransition(
      "geometry_module_manifest_mismatch: the signed module MRTR manifest is not exactly reconstructible from the draft.",
    );
  }
  if (manifest.assembly === undefined) {
    throw moduleTransition(
      "geometry_module_bundle_mismatch: the signed module manifest is incomplete.",
    );
  }
  const rebuiltInputBundle = await reopenGeometryModuleChildrenAndBundle(
    unsigned,
    options.base,
    options.geometryCaptures,
    options.canonicalDirectory,
    manifest.assembly.inputBundle,
  );
  await recrossGeometryModuleIsolation(
    rebuiltInputBundle,
    unsigned.receipt,
    unsigned.assemblyStep,
    unsigned.assemblyGlb,
    "$geometryModuleSeal.rebuiltInputBundle",
  );
  const outputs = await reopenGeometryModuleAssemblyOutputs(
    unsigned,
    options.publications,
    options.outputValidator,
  );
  return {
    draft: unsigned,
    binaryProducer: geometryModuleBinaryProducer(unsigned.receipt),
    assemblyStepBytes: outputs.step,
    assemblyGlbBytes: outputs.glb,
  };
}

export async function reopenGeometryModuleChildrenAndBundle(
  draft: Omit<GeometryModuleDraftCapture, "fingerprint">,
  base: ThreadSnapshot,
  geometryCaptures: GeometryCaptureReader,
  canonicalDirectory: string,
  signedInputBundle: GeometryModuleInputBundleIdentity = draft.inputBundle,
): Promise<GeometryModuleInputBundleIdentity> {
  const occurrences = [];
  for (const child of draft.children) {
    const stepBytes = await reopenExactChildAuthoritativeStep(
      child,
      base,
      geometryCaptures,
      canonicalDirectory,
    );
    occurrences.push({
      usageElementId: child.usageElementId,
      partDefinitionElementId: child.partDefinitionElementId,
      placement: {
        translationMm: [...child.placement.translationMm] as [
          number,
          number,
          number,
        ],
        rotationDeg: [...child.placement.rotationDeg] as [number, number, number],
      },
      childCapture: child.childGeometry,
      stepBytes,
    });
  }
  let rebuilt;
  try {
    rebuilt = await createGeometryModuleInputBundle(occurrences);
  } catch (error) {
    throw moduleTransition(
      `geometry_module_bundle_mismatch: rebuilt input bundle is invalid: ${
        detail(error)
      }`,
    );
  }
  try {
    assertGeometryModuleInputBundleMatchesIdentity(
      rebuilt,
      draft.inputBundle,
      "$geometryModuleDraft.inputBundle",
    );
    assertGeometryModuleInputBundleMatchesIdentity(
      rebuilt,
      signedInputBundle,
      "$geometryModuleManifest.assembly.inputBundle",
    );
  } catch (error) {
    if (error instanceof GeometryModuleEvidenceError) {
      throw moduleTransition(
        "geometry_module_bundle_mismatch: rebuilt input bundle from reopened child STEP bytes does not match the persisted identity.",
      );
    }
    throw error;
  }
  return {
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    fingerprint: rebuilt.fingerprint,
    byteCount: rebuilt.bytes.byteLength,
    manifest: rebuilt.manifest,
  };
}

export async function reopenGeometryModuleAssemblyOutputs(
  draft: Omit<GeometryModuleDraftCapture, "fingerprint">,
  publications: IsolatedOutputPublicationReader,
  outputValidator: GeometryModuleAssemblyOutputValidation,
): Promise<{ readonly step: Uint8Array; readonly glb: Uint8Array }> {
  const ref = draft.receipt.publication.ref;
  const stepMember = requireReceiptOutput(draft, "assembly.step");
  const glbMember = requireReceiptOutput(draft, "assembly.glb");
  const step = await readPublishedAssemblyOutput(
    publications,
    ref,
    stepMember,
    draft.assemblyStep,
    "assembly STEP",
  );
  const glb = await readPublishedAssemblyOutput(
    publications,
    ref,
    glbMember,
    draft.assemblyGlb,
    "assembly GLB",
  );
  try {
    await outputValidator.validateOutput(declarationOf(stepMember), step);
    await outputValidator.validateOutput(declarationOf(glbMember), glb);
  } catch (error) {
    throw moduleTransition(
      `geometry_module_output_invalid: isolated assembly outputs failed the registered format validators: ${
        detail(error)
      }`,
    );
  }
  return { step, glb };
}

export function geometryModuleCaptureRecord(options: {
  readonly runId: string;
  readonly draftDigest: string;
  readonly manifest: GeometryModuleManifest;
  readonly capturedAt: string;
  readonly architectureArtifact: ThreadArtifact;
  readonly draft: Omit<GeometryModuleDraftCapture, "fingerprint">;
}): GeometryModuleCapture {
  const { runId, draftDigest, manifest, capturedAt, architectureArtifact, draft } =
    options;
  return {
    schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: runId,
    draftDigest,
    manifest,
    architectureBasis: {
      artifactId: architectureArtifact.id,
      fingerprint: architectureArtifact.fingerprint,
      producerRunId: architectureArtifact.producer.runId,
    },
    structureCapture: draft.structureCapture,
    ...(draft.sourceClosure === undefined
      ? {}
      : { sourceClosure: draft.sourceClosure }),
    placementAnalysis: draft.placementAnalysis,
    children: draft.children,
    ...(draft.predecessor === undefined ? {} : { predecessor: draft.predecessor }),
    inputBundle: draft.inputBundle,
    receipt: draft.receipt,
    assemblyStep: draft.assemblyStep,
    assemblyGlb: draft.assemblyGlb,
    sealedAt: capturedAt,
  };
}

export function geometryModuleAssemblyArtifacts(options: {
  readonly captureDigest: string;
  readonly primaryId: string;
  readonly manifest: GeometryModuleManifest;
  readonly producer: ThreadOperationRef;
  readonly freshness: ThreadArtifact["freshness"];
}): readonly ThreadArtifact[] {
  const assembly = options.manifest.assembly;
  if (assembly === undefined) {
    throw new TypeError("Completed module manifest requires assembly fingerprints.");
  }
  const stepDigest = assembly.step.fingerprint.digest;
  const glbDigest = assembly.glb.fingerprint.digest;
  return [
    {
      id: geometryModuleAssemblyStepArtifactId(options.captureDigest, stepDigest),
      name: `Authoritative STEP: ${options.manifest.target.label}`,
      kind: "step",
      version: stepDigest,
      fingerprint: assembly.step.fingerprint,
      uri: `/api/thread/assets/${stepDigest}.step`,
      mediaType: "model/step",
      producer: options.producer,
      inputArtifactIds: [options.primaryId],
      freshness: options.freshness,
    },
    {
      id: geometryModuleAssemblyGlbArtifactId(options.captureDigest, glbDigest),
      name: `GLB: ${options.manifest.target.label}`,
      kind: "cad-model",
      version: glbDigest,
      fingerprint: assembly.glb.fingerprint,
      uri: `/api/thread/assets/${glbDigest}.glb`,
      mediaType: "model/gltf-binary",
      producer: options.producer,
      inputArtifactIds: [options.primaryId],
      freshness: options.freshness,
    },
  ];
}

export function geometryModuleStructureAttestation(options: {
  readonly primaryId: string;
  readonly captureDigest: string;
  readonly structure: ThreadArtifact;
  readonly sealProducer: ThreadOperationRef;
  readonly capturedAt: string;
}): {
  readonly consumption: ThreadArtifactConsumption;
  readonly provenance: ReadonlyArray<{
    readonly id: string;
    readonly relation: "derived_from" | "uses";
    readonly from: { readonly kind: "artifact" | "consumption"; readonly id: string };
    readonly to: { readonly kind: "artifact"; readonly id: string };
    readonly rationale: string;
  }>;
} {
  const consumptionId = geometryModuleStructureConsumptionId(
    options.structure.id,
    options.primaryId,
  );
  return {
    consumption: {
      id: consumptionId,
      artifactId: options.structure.id,
      consumer: options.sealProducer,
      observedFingerprint: options.structure.fingerprint,
      verifiedAt: options.capturedAt,
      status: "verified",
    },
    provenance: [
      {
        id: `derived-from-structure-${options.captureDigest}`,
        relation: "derived_from",
        from: { kind: "artifact", id: options.primaryId },
        to: { kind: "artifact", id: options.structure.id },
        rationale: GEOMETRY_MODULE_STRUCTURE_DERIVATION_RATIONALE,
      },
      {
        id: `uses-${consumptionId}`,
        relation: "uses",
        from: { kind: "consumption", id: consumptionId },
        to: { kind: "artifact", id: options.structure.id },
        rationale: GEOMETRY_MODULE_STRUCTURE_USE_RATIONALE,
      },
    ],
  };
}

export async function promoteReopenedModuleAsset(options: {
  readonly captureFp: ContentFingerprint;
  readonly assetFingerprint: ContentFingerprint;
  readonly bytes: Uint8Array;
  readonly extension: "step" | "glb";
  readonly geometryCaptures: GeometryCaptureReader;
  readonly canonicalDirectory: string;
}): Promise<string | undefined> {
  const captureText = await options.geometryCaptures.read(options.captureFp);
  if (!captureText) {
    throw moduleTransition(
      "Canonical geometry-module capture disappeared before binary promotion.",
    );
  }
  const capture = JSON.parse(captureText) as GeometryModuleCapture;
  const observed = await sha256Fingerprint(capture);
  if (!fingerprintsEqual(observed, options.captureFp)) {
    throw moduleTransition(
      "Canonical geometry-module capture changed before binary promotion.",
    );
  }
  const named = options.extension === "step"
    ? capture.assemblyStep
    : capture.assemblyGlb;
  if (!fingerprintsEqual(named.fingerprint, options.assetFingerprint)) {
    throw moduleTransition(
      `Canonical geometry-module capture does not name the ${options.extension} assembly asset.`,
    );
  }
  if (
    named.bytes !== options.bytes.byteLength ||
    await fingerprintResourceBytes(options.bytes) !== options.assetFingerprint.digest
  ) {
    throw moduleTransition(
      "geometry_module_output_digest_mismatch: promoted assembly bytes no longer match the sealed identity.",
    );
  }
  const destination =
    `${options.canonicalDirectory}/${options.assetFingerprint.digest}.${options.extension}`;
  const existing = await readOptionalFile(destination);
  if (
    existing && existing.byteLength === options.bytes.byteLength &&
    await fingerprintResourceBytes(existing) === options.assetFingerprint.digest
  ) {
    return undefined;
  }
  await Deno.mkdir(options.canonicalDirectory, { recursive: true });
  const temporary = `${options.canonicalDirectory}/.${crypto.randomUUID()}.tmp`;
  await Deno.writeFile(temporary, options.bytes, { createNew: true });
  try {
    await Deno.rename(temporary, destination);
  } catch (error) {
    await Deno.remove(temporary).catch(() => undefined);
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  const persisted = await readOptionalFile(destination);
  if (
    !persisted ||
    persisted.byteLength !== options.bytes.byteLength ||
    await fingerprintResourceBytes(persisted) !== options.assetFingerprint.digest
  ) {
    throw moduleTransition(
      "Canonical geometry-module assembly asset failed its post-copy SHA-256 verification.",
    );
  }
  return destination;
}

export async function rollbackPromotedCanonicalAssets(
  paths: readonly string[],
): Promise<void> {
  for (const path of paths) {
    await Deno.remove(path).catch(() => undefined);
  }
}

async function reopenExactChildAuthoritativeStep(
  child: GeometryModuleChild,
  base: ThreadSnapshot,
  geometryCaptures: GeometryCaptureReader,
  canonicalDirectory: string,
): Promise<Uint8Array> {
  const archived = archivedRefKeys(base);
  const named = base.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
    artifact.id === child.childGeometry.artifactId &&
    fingerprintsEqual(artifact.fingerprint, child.childGeometry.fingerprint)
  );
  if (named.length === 0) {
    throw moduleTransition(
      `geometry_module_child_missing: child capture ${child.childGeometry.artifactId} is not on the current Thread basis.`,
    );
  }
  if (named.length > 1) {
    throw moduleTransition(
      `geometry_module_child_ambiguous: child capture ${child.childGeometry.artifactId} is not unique.`,
    );
  }
  const artifact = named[0]!;
  if (archived.has(`artifact:${artifact.id}`)) {
    throw moduleTransition(
      `geometry_module_child_superseded: child capture ${artifact.id} is archived and cannot authorize a parent module seal.`,
    );
  }
  assertCanonicalGeometryPrimaryIdentity(artifact);
  const record = await readExactGeometryCaptureRecord(artifact, geometryCaptures);
  if (record.schemaVersion !== child.childGeometry.schemaVersion) {
    throw moduleTransition(
      `geometry_module_child_missing: child capture ${artifact.id} is not the named capture family.`,
    );
  }
  const capture = await parseExactCanonicalGeometryCapture(record);
  const sameTarget = await collectActiveSameFamilyTarget(
    base,
    geometryCaptures,
    child.childGeometry.schemaVersion,
    child.partDefinitionElementId,
  );
  if (sameTarget.length > 1) {
    throw moduleTransition(
      `geometry_module_child_ambiguous: more than one active ${child.childGeometry.schemaVersion} capture exists for ${child.partDefinitionElementId}.`,
    );
  }
  if (sameTarget.length === 0 || sameTarget[0]!.id !== artifact.id) {
    throw moduleTransition(
      `geometry_module_child_superseded: named child ${artifact.id} is not the unique active capture for ${child.partDefinitionElementId}.`,
    );
  }
  const step = authoritativeStepFromChildCapture(capture, child);
  const bytes = await readOptionalFile(
    `${canonicalDirectory}/${step.digest}.step`,
  );
  if (!bytes) {
    throw moduleTransition(
      `geometry_module_child_missing: authoritative STEP for child ${artifact.id} is not durably readable.`,
    );
  }
  if (
    bytes.byteLength !== step.bytes ||
    await fingerprintResourceBytes(bytes) !== step.digest
  ) {
    throw moduleTransition(
      `geometry_module_bundle_mismatch: reopened STEP bytes for child ${artifact.id} do not match the named digest and byte count.`,
    );
  }
  return bytes;
}

async function collectActiveSameFamilyTarget(
  base: ThreadSnapshot,
  geometryCaptures: GeometryCaptureReader,
  schemaVersion: string,
  partDefinitionElementId: string,
): Promise<ThreadArtifact[]> {
  const archived = archivedRefKeys(base);
  const matches: ThreadArtifact[] = [];
  for (const artifact of base.artifacts) {
    if (
      artifact.kind !== "cad-model" ||
      !artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) ||
      archived.has(`artifact:${artifact.id}`)
    ) {
      continue;
    }
    const record = await readExactGeometryCaptureRecord(artifact, geometryCaptures);
    if (record.schemaVersion !== schemaVersion) continue;
    const capture = await parseExactCanonicalGeometryCapture(record);
    const targetId = capture.manifest.target.partDefinitionElementId;
    if (targetId === partDefinitionElementId) matches.push(artifact);
  }
  return matches;
}

function authoritativeStepFromChildCapture(
  capture: CanonicalGeometryCapture,
  child: GeometryModuleChild,
): { readonly digest: string; readonly bytes: number } {
  if (capture.schemaVersion === GEOMETRY_PART_CAPTURE_SCHEMA) {
    const step = capture.sourceScript.authoritativeStep;
    if (
      !fingerprintsEqual(step.fingerprint, child.authoritativeStep.fingerprint) ||
      step.bytes !== child.authoritativeStep.bytes
    ) {
      throw moduleTransition(
        `geometry_module_bundle_mismatch: child part capture STEP identity does not match the signed child table.`,
      );
    }
    if (
      capture.manifest.target.partDefinitionElementId !==
        child.partDefinitionElementId
    ) {
      throw moduleTransition(
        `geometry_module_child_missing: child part capture does not name ${child.partDefinitionElementId}.`,
      );
    }
    return { digest: step.fingerprint.digest, bytes: step.bytes };
  }
  if (
    capture.manifest.target.partDefinitionElementId !==
      child.partDefinitionElementId ||
    !fingerprintsEqual(
      capture.assemblyStep.fingerprint,
      child.authoritativeStep.fingerprint,
    ) ||
    capture.assemblyStep.bytes !== child.authoritativeStep.bytes
  ) {
    throw moduleTransition(
      "geometry_module_bundle_mismatch: child module capture STEP identity does not match the signed child table.",
    );
  }
  return {
    digest: capture.assemblyStep.fingerprint.digest,
    bytes: capture.assemblyStep.bytes,
  };
}

async function parseExactCanonicalGeometryCapture(
  record: Record<string, unknown>,
): Promise<CanonicalGeometryCapture> {
  try {
    return await parseCanonicalGeometryCapture(record);
  } catch (error) {
    throw moduleTransition(
      `geometry_module_child_missing: canonical capture failed exact replay: ${
        detail(error)
      }`,
    );
  }
}

function requireReceiptOutput(
  draft: Omit<GeometryModuleDraftCapture, "fingerprint">,
  role: "assembly.step" | "assembly.glb",
): IsolatedCodeOutputReceiptRecord {
  const expected = GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.find((item) =>
    item.role === role
  );
  const member = draft.receipt.outputs.find((item) => item.role === role);
  if (!expected || !member) {
    throw moduleTransition(
      `geometry_module_output_digest_mismatch: receipt is missing ${role}.`,
    );
  }
  return member;
}

async function readPublishedAssemblyOutput(
  publications: IsolatedOutputPublicationReader,
  ref: GeometryModuleDraftCapture["receipt"]["publication"]["ref"],
  member: IsolatedCodeOutputReceiptRecord,
  asset: GeometryModuleDraftCapture["assemblyStep"],
  name: string,
): Promise<Uint8Array> {
  let published: Uint8Array | undefined;
  try {
    published = await publications.readPublishedObject(ref, member);
  } catch (error) {
    throw moduleTransition(
      `geometry_module_output_digest_mismatch: ${name} could not be reopened behind its publication gate: ${
        detail(error)
      }`,
    );
  }
  if (!published) {
    throw moduleTransition(
      `geometry_module_output_digest_mismatch: ${name} is not available behind its publication gate.`,
    );
  }
  const digest = await fingerprintResourceBytes(published);
  if (
    digest !== member.sha256 || published.byteLength !== member.byteCount ||
    digest !== asset.fingerprint.digest || published.byteLength !== asset.bytes
  ) {
    throw moduleTransition(
      `geometry_module_output_digest_mismatch: reopened ${name} bytes do not match the draft/receipt identity.`,
    );
  }
  return published;
}

function declarationOf(
  member: IsolatedCodeOutputReceiptRecord,
): IsolatedCodeOutputDeclaration {
  return {
    role: member.role,
    basename: member.basename,
    mediaType: member.mediaType,
    format: member.format,
  };
}

function assertCanonicalGeometryPrimaryIdentity(artifact: ThreadArtifact): void {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.id !== `geometry-${digest}` ||
    artifact.version !== digest ||
    artifact.uri !== `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !==
      `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}` ||
    artifact.producer.runId.trim() === ""
  ) {
    throw moduleTransition(
      "geometry_module_child_missing: active geometry artifact identity is not canonical.",
    );
  }
}

async function readExactGeometryCaptureRecord(
  artifact: ThreadArtifact,
  geometryCaptures: GeometryCaptureReader,
): Promise<Record<string, unknown>> {
  const text = await geometryCaptures.read(artifact.fingerprint);
  if (!text) {
    throw moduleTransition(
      `geometry_module_child_missing: capture ${artifact.id} is not durably readable.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw moduleTransition(
      `geometry_module_child_missing: capture ${artifact.id} is not JSON.`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw moduleTransition(
      `geometry_module_child_missing: capture ${artifact.id} is not an object.`,
    );
  }
  const observed = await sha256Fingerprint(parsed);
  if (!fingerprintsEqual(observed, artifact.fingerprint)) {
    throw moduleTransition(
      `geometry_module_child_missing: capture ${artifact.id} hash is not exact.`,
    );
  }
  return parsed as Record<string, unknown>;
}

async function readOptionalFile(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

function moduleTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function detail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_MANIFEST_SCHEMA,
};
