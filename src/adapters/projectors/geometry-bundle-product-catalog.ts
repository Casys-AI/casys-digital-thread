/**
 * Read-only Product projection for canonical geometry bundles.
 *
 * This projector never infers CAD identity from a label or a content digest.
 * It rereads the active geometry-capture/2.0, verifies its exact sealed graph,
 * and attaches the seal-owned authoritative STEP artifact id to each exact
 * SysON PartUsage occurrence. When the same signed bundle also includes GLB,
 * that presentation asset follows the identical PartDefinition mapping.
 * Reused PartDefinitions therefore deliberately produce the same CAD binding
 * and preview on more than one occurrence.
 */

import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  assertGeometryBundleManifest,
  encodeGeometryBundleDecisionParameters,
  GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
  GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
  GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE,
  GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE,
  GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE,
  type GeometryBundleExportFormat,
  type GeometryBundleManifest,
  parseGeometryBundleDecisionParameters,
} from "../../domain/platform/geometry-bundle.ts";
import {
  type ThreadComponentBinding,
  type ThreadComponentCatalog,
  type ThreadComponentPreview,
  validateThreadComponentCatalog,
} from "../../domain/thread/thread-component-catalog.ts";
import {
  archivedRefKeys,
  type ContentFingerprint,
  type ThreadArtifact,
  type ThreadOperationRef,
  type ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { GEOMETRY_CAPTURE_URI_PREFIX } from "../captures/file-capture-store.ts";

const GEOMETRY_CAPTURE_SCHEMA = "geometry-capture/1.1" as const;
const GEOMETRY_BUNDLE_CAPTURE_SCHEMA = "geometry-capture/2.0" as const;

export interface GenericGeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

type GeometrySelection =
  | { readonly kind: "absent" }
  | { readonly kind: "retired" }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "one"; readonly artifact: ThreadArtifact };

interface VerifiedGeometryBundle {
  readonly primary: ThreadArtifact;
  readonly manifest: GeometryBundleManifest;
  readonly stepByDefinitionId: ReadonlyMap<string, ThreadArtifact>;
  readonly glbByDefinitionId: ReadonlyMap<string, ThreadArtifact>;
  readonly assemblyStep: ThreadArtifact;
}

class GeometryBundleProjectionError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "GeometryBundleProjectionError";
  }
}

/**
 * Add exact CAD bindings to a catalog already derived from the architecture.
 * Architecture remains visible when CAD is absent or unverifiable; the
 * rationale then explains why no independent PartDefinition binding is made.
 */
export async function enrichGenericProductCatalogWithGeometryBundle(
  snapshot: ThreadSnapshot,
  architectureCatalog: ThreadComponentCatalog,
  captures: GenericGeometryCaptureReader,
): Promise<ThreadComponentCatalog> {
  if (architectureCatalog.components.length === 0) return architectureCatalog;

  const selected = selectGeometryCapture(snapshot);
  if (selected.kind === "absent") {
    return withoutCad(
      architectureCatalog,
      "No active sealed geometry is attached; no PartDefinition CAD binding is claimed.",
    );
  }
  if (selected.kind === "retired") {
    return withoutCad(
      architectureCatalog,
      "The sealed geometry family is explicitly archived; no current PartDefinition CAD binding is claimed.",
    );
  }
  if (selected.kind === "ambiguous") {
    return withoutCad(
      architectureCatalog,
      "Geometry evidence has multiple active capture tips; PartDefinition CAD mapping requires manual lineage review.",
    );
  }

  try {
    const result = await verifyGeometryCapture(
      snapshot,
      architectureCatalog,
      selected.artifact,
      captures,
    );
    if (result.kind === "legacy") {
      return withoutCad(
        architectureCatalog,
        "The active geometry-capture/1.1 is a legacy assembly-only seal; it contains no independent PartDefinition STEP mapping.",
      );
    }
    return attachExactCadBindings(architectureCatalog, result.bundle);
  } catch (error) {
    const reason = error instanceof GeometryBundleProjectionError
      ? error.reason
      : "The active geometry bundle could not be verified.";
    return withoutCad(architectureCatalog, reason);
  }
}

function selectGeometryCapture(snapshot: ThreadSnapshot): GeometrySelection {
  const all = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX)
  );
  if (all.length === 0) return { kind: "absent" };
  const archived = archivedRefKeys(snapshot);
  const active = all.filter((artifact) => !archived.has(`artifact:${artifact.id}`));
  if (active.length === 0) return { kind: "retired" };
  return active.length === 1
    ? { kind: "one", artifact: active[0]! }
    : { kind: "ambiguous" };
}

async function verifyGeometryCapture(
  snapshot: ThreadSnapshot,
  catalog: ThreadComponentCatalog,
  primary: ThreadArtifact,
  captures: GenericGeometryCaptureReader,
): Promise<
  | { readonly kind: "legacy" }
  | { readonly kind: "bundle"; readonly bundle: VerifiedGeometryBundle }
> {
  const text = await captures.read(primary.fingerprint);
  if (!text) {
    fail(
      "The active geometry capture is not durably readable; PartDefinition CAD bindings are unavailable.",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(
      "The active geometry capture is not valid JSON; PartDefinition CAD bindings are unavailable.",
    );
  }
  const capture = object(parsed, "geometry capture");
  const observed = await sha256Fingerprint(capture);
  if (!fingerprintsEqual(observed, primary.fingerprint)) {
    fail(
      "The active geometry capture does not match its artifact fingerprint; PartDefinition CAD bindings are unavailable.",
    );
  }
  const schemaVersion = capture.schemaVersion;
  if (
    schemaVersion !== GEOMETRY_CAPTURE_SCHEMA &&
    schemaVersion !== GEOMETRY_BUNDLE_CAPTURE_SCHEMA
  ) {
    fail(
      `The active geometry capture schema ${String(schemaVersion)} is unsupported.`,
    );
  }
  const operation = exactObject(capture.operation, ["id", "version"], "operation");
  if (operation.id !== "design.write-geometry" || operation.version !== "1") {
    fail("The active geometry capture is not design.write-geometry@1 evidence.");
  }
  const trustedRunId = nonEmpty(capture.trustedRunId, "trustedRunId");
  const sealedAt = canonicalInstant(capture.sealedAt, "sealedAt");
  assertExactPrimary(primary, trustedRunId, sealedAt);

  if (schemaVersion === GEOMETRY_CAPTURE_SCHEMA) {
    return { kind: "legacy" };
  }

  assertOnlyKeys(capture, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "draftDigest",
    "manifest",
    "architectureBasis",
    "previewProducer",
    "sourceScripts",
    "sealedAt",
  ], "geometry capture");
  const draftDigest = digest(capture.draftDigest, "draftDigest");
  const manifest = normalizeCompletedManifest(capture.manifest, draftDigest);
  const previewProducer = exactPreviewProducer(capture.previewProducer);
  const architectureArtifact = exactArchitectureArtifact(snapshot, catalog);
  assertArchitectureBasis(
    capture.architectureBasis,
    manifest,
    architectureArtifact,
  );
  await assertCanonicalSources(capture.sourceScripts, manifest);
  assertExactPrimaryInputs(
    snapshot,
    primary,
    architectureArtifact,
    manifest,
    sealedAt,
  );

  const { assemblyStep, stepByDefinitionId, glbByDefinitionId } =
    assertExactBundleArtifacts(
      snapshot,
      primary,
      manifest,
      previewProducer,
      sealedAt,
    );
  assertManifestMatchesCatalog(catalog, manifest);
  return {
    kind: "bundle",
    bundle: {
      primary,
      manifest,
      stepByDefinitionId,
      glbByDefinitionId,
      assemblyStep,
    },
  };
}

function normalizeCompletedManifest(
  value: unknown,
  draftDigest: string,
): GeometryBundleManifest {
  try {
    const manifest = value as GeometryBundleManifest;
    assertGeometryBundleManifest(manifest, { requireCompleted: true });
    const encoded = encodeGeometryBundleDecisionParameters(draftDigest, manifest);
    const normalized = parseGeometryBundleDecisionParameters(
      new Map(encoded.map((parameter) => [parameter.key, parameter.value])),
    );
    if (deterministicJson(normalized.manifest) !== deterministicJson(value)) {
      fail("The geometry bundle manifest is not an exact canonical v2 record.");
    }
    return normalized.manifest;
  } catch (error) {
    if (error instanceof GeometryBundleProjectionError) throw error;
    fail("The geometry bundle manifest is structurally invalid.");
  }
}

function exactArchitectureArtifact(
  snapshot: ThreadSnapshot,
  catalog: ThreadComponentCatalog,
): ThreadArtifact {
  const evidenceIds = new Set(
    catalog.components.flatMap((component) =>
      component.bindings
        .filter((binding) => binding.provider === "syson")
        .map((binding) => binding.evidenceArtifactId)
    ),
  );
  if (evidenceIds.size !== 1) {
    fail("The architecture catalog has no unique SysON evidence artifact.");
  }
  const artifact = snapshot.artifacts.find((candidate) =>
    candidate.id === [...evidenceIds][0]
  );
  if (!artifact) fail("The architecture evidence artifact is absent.");
  return artifact;
}

function assertArchitectureBasis(
  value: unknown,
  manifest: GeometryBundleManifest,
  artifact: ThreadArtifact,
): void {
  const basis = exactObject(
    value,
    ["artifactId", "fingerprint", "producerRunId"],
    "architectureBasis",
  );
  const fingerprint = exactFingerprint(
    basis.fingerprint,
    "architectureBasis.fingerprint",
  );
  if (
    basis.artifactId !== artifact.id ||
    basis.producerRunId !== artifact.producer.runId ||
    !fingerprintsEqual(fingerprint, artifact.fingerprint) ||
    !fingerprintsEqual(manifest.architectureBasis.artifactFingerprint, fingerprint)
  ) {
    fail(
      "The geometry bundle is not bound to the catalog's exact architecture artifact.",
    );
  }
}

async function assertCanonicalSources(
  value: unknown,
  manifest: GeometryBundleManifest,
): Promise<void> {
  const sources = exactObject(
    value,
    ["assembly", "partDefinitions", "providerCalls"],
    "sourceScripts",
  );
  const assembly = exactObject(
    sources.assembly,
    ["script", "scriptHash"],
    "sourceScripts.assembly",
  );
  const assemblyScript = nonEmpty(assembly.script, "sourceScripts.assembly.script");
  const assemblyHash = exactFingerprint(
    assembly.scriptHash,
    "sourceScripts.assembly.scriptHash",
  );
  if (
    !manifest.scriptHash ||
    !fingerprintsEqual(assemblyHash, manifest.scriptHash)
  ) {
    fail("The canonical assembly source hash is not the signed assembly hash.");
  }

  const definitions = array(
    sources.partDefinitions,
    "sourceScripts.partDefinitions",
  );
  if (definitions.length !== manifest.partDefinitions.length) {
    fail("Canonical PartDefinition sources do not cover the signed definitions.");
  }
  const normalizedDefinitions = definitions.map((raw, index) => {
    const source = exactObject(
      raw,
      ["elementId", "script", "scriptHash"],
      `sourceScripts.partDefinitions[${index}]`,
    );
    const signed = manifest.partDefinitions[index]!;
    const scriptHash = exactFingerprint(
      source.scriptHash,
      `sourceScripts.partDefinitions[${index}].scriptHash`,
    );
    if (
      source.elementId !== signed.elementId ||
      !signed.scriptHash ||
      !fingerprintsEqual(scriptHash, signed.scriptHash)
    ) {
      fail("Canonical PartDefinition source identity or hash is not exact.");
    }
    return {
      elementId: signed.elementId,
      script: nonEmpty(
        source.script,
        `sourceScripts.partDefinitions[${index}].script`,
      ),
      scriptHash,
    };
  });
  const calls = array(sources.providerCalls, "sourceScripts.providerCalls");
  if (calls.length !== manifest.partDefinitions.length + 1) {
    fail("Canonical provider provenance is not the signed N+1 sequence.");
  }
  const expectedCallIdentity = [
    {
      ordinal: 0,
      role: "assembly" as const,
      scriptHash: assemblyHash,
      formats: manifest.exportFormats,
      names: manifest.artifactHashes!.assemblyFiles.map((file) => file.name),
    },
    ...manifest.partDefinitions.map((definition, index) => ({
      ordinal: index + 1,
      role: "part-definition" as const,
      partDefinitionElementId: definition.elementId,
      scriptHash: definition.scriptHash!,
      formats: manifest.partExportFormats,
      names: definition.files!.map((file) => file.name),
    })),
  ];
  calls.forEach((raw, index) => {
    const expected = expectedCallIdentity[index]!;
    const allowed = expected.role === "assembly"
      ? ["ordinal", "role", "exportName", "scriptHash", "formats"]
      : [
        "ordinal",
        "role",
        "partDefinitionElementId",
        "exportName",
        "scriptHash",
        "formats",
      ];
    const call = exactObject(raw, allowed, `sourceScripts.providerCalls[${index}]`);
    const exportName = nonEmpty(
      call.exportName,
      `sourceScripts.providerCalls[${index}].exportName`,
    );
    const formats = stringArray(
      call.formats,
      `sourceScripts.providerCalls[${index}].formats`,
    );
    if (
      call.ordinal !== expected.ordinal ||
      call.role !== expected.role ||
      ("partDefinitionElementId" in expected &&
        call.partDefinitionElementId !== expected.partDefinitionElementId) ||
      !fingerprintsEqual(
        exactFingerprint(
          call.scriptHash,
          `sourceScripts.providerCalls[${index}].scriptHash`,
        ),
        expected.scriptHash,
      ) ||
      deterministicJson(formats) !== deterministicJson(expected.formats) ||
      expected.names.some((name) => name !== exportName)
    ) {
      fail("Canonical provider provenance diverges from the exact N+1 bundle plan.");
    }
  });

  // The capture fingerprint authenticates the record, while these hashes prove
  // that its retained editable source bytes are the bytes the operator signed.
  for (
    const [script, expected] of [
      [assemblyScript, assemblyHash] as const,
      ...normalizedDefinitions.map((source) =>
        [source.script, source.scriptHash] as const
      ),
    ]
  ) {
    const observed = await textFingerprint(script);
    if (!fingerprintsEqual(observed, expected)) {
      fail("A canonical geometry source does not match its signed SHA-256.");
    }
  }
}

function assertExactPrimaryInputs(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  architecture: ThreadArtifact,
  manifest: GeometryBundleManifest,
  sealedAt: string,
): void {
  const expected = [
    architecture.id,
    ...(manifest.predecessor ? [manifest.predecessor.artifactId] : []),
  ];
  if (deterministicJson(primary.inputArtifactIds) !== deterministicJson(expected)) {
    fail(
      "The geometry capture artifact has non-exact architecture/predecessor inputs.",
    );
  }
  assertExactArchitectureAttestation(
    snapshot,
    primary,
    architecture,
    sealedAt,
  );
  if (manifest.predecessor) {
    const matches = snapshot.artifacts.filter((artifact) =>
      artifact.id === manifest.predecessor!.artifactId &&
      fingerprintsEqual(artifact.fingerprint, manifest.predecessor!.fingerprint)
    );
    if (
      matches.length !== 1 ||
      !archivedRefKeys(snapshot).has(`artifact:${manifest.predecessor.artifactId}`)
    ) {
      fail("The geometry bundle predecessor is absent, inexact, or still active.");
    }
    assertPredecessorFamilyArchived(snapshot, matches[0]!);
    for (const relation of ["derived_from", "supersedes"] as const) {
      const links = snapshot.provenance.filter((link) =>
        link.relation === relation && link.from.kind === "artifact" &&
        link.from.id === primary.id && link.to.kind === "artifact" &&
        link.to.id === manifest.predecessor!.artifactId
      );
      const expectedId = relation === "derived_from"
        ? `derived-from-geometry-${primary.fingerprint.digest}`
        : `supersedes-geometry-${primary.fingerprint.digest}`;
      const expectedRationale = relation === "derived_from"
        ? GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE
        : GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE;
      if (
        links.length !== 1 || links[0]!.id !== expectedId ||
        links[0]!.rationale !== expectedRationale
      ) {
        fail(`The geometry bundle has no unique ${relation} predecessor edge.`);
      }
    }
    const predecessorConsumptionId =
      `consume-geometry-${manifest.predecessor.artifactId}-by-${primary.id}`;
    const predecessorConsumptions = snapshot.consumptions.filter((consumption) =>
      consumption.id === predecessorConsumptionId &&
      consumption.artifactId === manifest.predecessor!.artifactId &&
      deterministicJson(consumption.consumer) === deterministicJson(primary.producer) &&
      fingerprintsEqual(
        consumption.observedFingerprint,
        manifest.predecessor!.fingerprint,
      ) && consumption.status === "verified" && consumption.verifiedAt === sealedAt
    );
    const predecessorUses = snapshot.provenance.filter((link) =>
      link.relation === "uses" && link.from.kind === "consumption" &&
      link.from.id === predecessorConsumptionId && link.to.kind === "artifact" &&
      link.to.id === manifest.predecessor!.artifactId
    );
    if (
      predecessorConsumptions.length !== 1 || predecessorUses.length !== 1 ||
      predecessorUses[0]!.id !== `uses-${predecessorConsumptionId}` ||
      predecessorUses[0]!.rationale !== GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE
    ) {
      fail("The geometry bundle predecessor consumption is not exact.");
    }
  }
}

function assertExactArchitectureAttestation(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  architecture: ThreadArtifact,
  sealedAt: string,
): void {
  const expectedConsumptionId = `consume-arch-${architecture.id}-by-${primary.id}`;
  const architectureConsumptions = snapshot.consumptions.filter((consumption) =>
    consumption.artifactId === architecture.id &&
    deterministicJson(consumption.consumer) === deterministicJson(primary.producer)
  );
  if (architectureConsumptions.length !== 1) {
    fail("The geometry bundle architecture consumption is missing or ambiguous.");
  }
  const consumption = architectureConsumptions[0]!;
  if (
    consumption.id !== expectedConsumptionId ||
    !fingerprintsEqual(consumption.observedFingerprint, architecture.fingerprint) ||
    consumption.status !== "verified" || consumption.verifiedAt !== sealedAt
  ) {
    fail("The geometry bundle architecture consumption metadata is not exact.");
  }

  const uses = snapshot.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === expectedConsumptionId && link.to.kind === "artifact" &&
    link.to.id === architecture.id
  );
  if (
    uses.length !== 1 || uses[0]!.id !== `uses-${expectedConsumptionId}` ||
    uses[0]!.rationale !== GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE
  ) {
    fail("The geometry bundle architecture uses attestation is not exact.");
  }

  const derived = snapshot.provenance.filter((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === architecture.id
  );
  if (
    derived.length !== 1 ||
    derived[0]!.id !==
      `derived-from-architecture-${primary.fingerprint.digest}` ||
    derived[0]!.rationale !== GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE
  ) {
    fail("The geometry bundle architecture derivation is not exact.");
  }
}

function assertExactPrimary(
  primary: ThreadArtifact,
  trustedRunId: string,
  sealedAt: string,
): void {
  const digestValue = primary.fingerprint.digest;
  if (
    primary.id !== `geometry-${digestValue}` ||
    primary.version !== digestValue ||
    primary.uri !== `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${digestValue}` ||
    primary.mediaType !== "application/json" ||
    primary.producer.serverId !== "digital-thread" ||
    primary.producer.tool !== "design.write-geometry@1" ||
    primary.producer.runId !== trustedRunId ||
    primary.freshness.status !== "fresh" ||
    primary.freshness.changedAt !== sealedAt ||
    primary.freshness.invalidatedByChangeIds.length !== 0
  ) {
    fail("The active geometry capture artifact metadata is not exact.");
  }
}

function assertExactBundleArtifacts(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  manifest: GeometryBundleManifest,
  producer: ThreadOperationRef,
  sealedAt: string,
): {
  readonly assemblyStep: ThreadArtifact;
  readonly stepByDefinitionId: ReadonlyMap<string, ThreadArtifact>;
  readonly glbByDefinitionId: ReadonlyMap<string, ThreadArtifact>;
} {
  assertExactActiveBundleFamily(snapshot, primary, manifest);
  const assemblyArtifacts = manifest.artifactHashes!.assemblyFiles.map((file, index) =>
    requireExactBinary(
      snapshot,
      primary,
      file,
      `cad-asset-${primary.fingerprint.digest}-assembly-${index}-${file.fingerprint.digest}`,
      `${file.format.toUpperCase()}: ${file.name}`,
      producer,
      sealedAt,
      "assembly",
    )
  );
  const assemblySteps = assemblyArtifacts.filter((_, index) =>
    manifest.artifactHashes!.assemblyFiles[index]!.format === "step"
  );
  if (assemblySteps.length !== 1) {
    fail(
      "The geometry bundle does not expose exactly one authoritative assembly STEP.",
    );
  }

  const stepByDefinitionId = new Map<string, ThreadArtifact>();
  const glbByDefinitionId = new Map<string, ThreadArtifact>();
  manifest.partDefinitions.forEach((definition, definitionIndex) => {
    const artifacts = definition.files!.map((file, fileIndex) =>
      requireExactBinary(
        snapshot,
        primary,
        file,
        `cad-asset-${primary.fingerprint.digest}-definition-${definitionIndex}-${fileIndex}-${file.fingerprint.digest}`,
        `${
          file.format === "step" ? "Authoritative STEP" : file.format.toUpperCase()
        }: ${definition.label}`,
        producer,
        sealedAt,
        "part-definition",
      )
    );
    const steps = artifacts.filter((_, index) =>
      definition.files![index]!.format === "step"
    );
    if (steps.length !== 1) {
      fail(
        `PartDefinition ${definition.elementId} does not expose exactly one authoritative STEP.`,
      );
    }
    stepByDefinitionId.set(definition.elementId, steps[0]!);
    const glbs = artifacts.filter((_, index) =>
      definition.files![index]!.format === "gltf"
    );
    if (manifest.partExportFormats.includes("gltf")) {
      if (glbs.length !== 1) {
        fail(
          `PartDefinition ${definition.elementId} does not expose exactly one reviewed GLB.`,
        );
      }
      glbByDefinitionId.set(definition.elementId, glbs[0]!);
    } else if (glbs.length !== 0) {
      fail(
        `PartDefinition ${definition.elementId} exposes an unsigned GLB format.`,
      );
    }
  });
  return {
    assemblyStep: assemblySteps[0]!,
    stepByDefinitionId,
    glbByDefinitionId,
  };
}

/**
 * The manifest is authoritative for the complete active binary family. A
 * binary may be absent because it was archived, or an unreviewed extra may
 * trace to the capture under an arbitrary id; both cases make the Product CAD
 * projection unavailable rather than silently projecting a partial family.
 */
function assertExactActiveBundleFamily(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  manifest: GeometryBundleManifest,
): void {
  const digest = primary.fingerprint.digest;
  const expectedIds = new Set<string>([primary.id]);
  manifest.artifactHashes!.assemblyFiles.forEach((file, index) => {
    expectedIds.add(
      `cad-asset-${digest}-assembly-${index}-${file.fingerprint.digest}`,
    );
  });
  manifest.partDefinitions.forEach((definition, definitionIndex) => {
    definition.files!.forEach((file, fileIndex) => {
      expectedIds.add(
        `cad-asset-${digest}-definition-${definitionIndex}-${fileIndex}-${file.fingerprint.digest}`,
      );
    });
  });

  const archived = archivedRefKeys(snapshot);
  const exactTraceFamilyIds = new Set(
    snapshot.provenance.filter((link) =>
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.to.kind === "artifact" && link.to.id === primary.id
    ).map((link) => link.from.id),
  );
  const activeFamily = snapshot.artifacts.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`) &&
    (artifact.id === primary.id ||
      artifact.id.startsWith(`cad-asset-${digest}-`) ||
      artifact.id.startsWith(`mesh-${digest}-`) ||
      exactTraceFamilyIds.has(artifact.id))
  );
  const activeIds = new Set(activeFamily.map((artifact) => artifact.id));
  if (
    activeFamily.length !== expectedIds.size || activeIds.size !== expectedIds.size ||
    [...expectedIds].some((id) => !activeIds.has(id)) ||
    [...activeIds].some((id) => !expectedIds.has(id))
  ) {
    fail(
      "The active geometry binary family is incomplete or contains an unreviewed extra artifact.",
    );
  }
}

/**
 * A successor is current only when every artifact in the predecessor's sealed
 * binary family remains historical. Checking the predecessor capture alone is
 * insufficient: removing one binary's archive entry would otherwise make an
 * old CAD asset active again while Product continued to expose the successor.
 */
function assertPredecessorFamilyArchived(
  snapshot: ThreadSnapshot,
  predecessor: ThreadArtifact,
): void {
  const digest = predecessor.fingerprint.digest;
  const traceFamilyIds = new Set(
    snapshot.provenance.filter((link) =>
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.to.kind === "artifact" && link.to.id === predecessor.id
    ).map((link) => link.from.id),
  );
  const family = snapshot.artifacts.filter((artifact) =>
    artifact.id === predecessor.id ||
    artifact.id.startsWith(`cad-asset-${digest}-`) ||
    artifact.id.startsWith(`mesh-${digest}-`) ||
    traceFamilyIds.has(artifact.id)
  );
  const archived = archivedRefKeys(snapshot);
  if (
    family.length === 0 ||
    family.some((artifact) => !archived.has(`artifact:${artifact.id}`))
  ) {
    fail("The geometry bundle predecessor binary family is not fully archived.");
  }
}

function requireExactBinary(
  snapshot: ThreadSnapshot,
  primary: ThreadArtifact,
  file: {
    readonly format: GeometryBundleExportFormat;
    readonly fingerprint: ContentFingerprint;
  },
  id: string,
  name: string,
  producer: ThreadOperationRef,
  sealedAt: string,
  scope: "assembly" | "part-definition",
): ThreadArtifact {
  if (archivedRefKeys(snapshot).has(`artifact:${id}`)) {
    fail(`The sealed geometry binary ${id} is archived.`);
  }
  const matches = snapshot.artifacts.filter((artifact) => artifact.id === id);
  if (matches.length !== 1) {
    fail(`The sealed geometry binary ${id} is missing or ambiguous.`);
  }
  const artifact = matches[0]!;
  const extension = file.format === "gltf" ? "glb" : file.format;
  const mediaType = file.format === "step"
    ? "model/step"
    : file.format === "gltf"
    ? "model/gltf-binary"
    : "model/stl";
  const kind = file.format === "step"
    ? "step"
    : file.format === "stl" && scope === "part-definition"
    ? "mesh"
    : "cad-model";
  if (
    artifact.name !== name ||
    artifact.kind !== kind ||
    artifact.version !== file.fingerprint.digest ||
    !fingerprintsEqual(artifact.fingerprint, file.fingerprint) ||
    artifact.uri !== `/api/thread/assets/${file.fingerprint.digest}.${extension}` ||
    artifact.mediaType !== mediaType ||
    deterministicJson(artifact.producer) !== deterministicJson(producer) ||
    artifact.inputArtifactIds.length !== 0 ||
    artifact.freshness.status !== "fresh" ||
    artifact.freshness.changedAt !== sealedAt ||
    artifact.freshness.invalidatedByChangeIds.length !== 0
  ) {
    fail(`The sealed geometry binary ${id} metadata is not exact.`);
  }
  const traces = snapshot.provenance.filter((link) =>
    link.relation === "traces_to" &&
    link.from.kind === "artifact" && link.from.id === artifact.id &&
    link.to.kind === "artifact" && link.to.id === primary.id
  );
  if (
    traces.length !== 1 ||
    traces[0]!.id !== `traces-${artifact.id}-from-${primary.id}` ||
    traces[0]!.rationale !== GEOMETRY_BINARY_TRACE_RATIONALE
  ) {
    fail(`The sealed geometry binary ${id} has no unique trace to its capture.`);
  }
  const consumptionId = `consume-${primary.id}-by-${artifact.id}`;
  const consumptions = snapshot.consumptions.filter((consumption) =>
    consumption.id === consumptionId && consumption.artifactId === primary.id &&
    deterministicJson(consumption.consumer) === deterministicJson(primary.producer) &&
    fingerprintsEqual(consumption.observedFingerprint, primary.fingerprint) &&
    consumption.status === "verified" && consumption.verifiedAt === sealedAt
  );
  const uses = snapshot.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === consumptionId && link.to.kind === "artifact" &&
    link.to.id === primary.id
  );
  if (
    consumptions.length !== 1 || uses.length !== 1 ||
    uses[0]!.id !== `uses-${consumptionId}` ||
    uses[0]!.rationale !== GEOMETRY_BINARY_CAPTURE_USE_RATIONALE
  ) {
    fail(`The sealed geometry binary ${id} publication consumption is not exact.`);
  }
  return artifact;
}

function assertManifestMatchesCatalog(
  catalog: ThreadComponentCatalog,
  manifest: GeometryBundleManifest,
): void {
  const catalogOccurrences = catalog.components.filter((component) =>
    component.kind === "part"
  ).map((component) => {
    const usage = exactBinding(component.bindings, "part-usage", component.id);
    const definition = exactBinding(
      component.bindings,
      "part-definition",
      component.id,
    );
    return { component, usage, definition };
  });
  // The catalog expands occurrence paths. Reusing a parent PartDefinition
  // repeats its child PartUsage on multiple paths, while the signed placement
  // remains local to the owning definition and appears once in the manifest.
  const catalogDefinitionByUsage = new Map<string, string>();
  for (const { usage, definition } of catalogOccurrences) {
    const existing = catalogDefinitionByUsage.get(usage.id);
    if (existing !== undefined && existing !== definition.id) {
      fail("One SysON PartUsage identity maps to conflicting PartDefinitions.");
    }
    catalogDefinitionByUsage.set(usage.id, definition.id);
  }
  const occurrenceByUsage = new Map(
    manifest.occurrences.map((occurrence) => [occurrence.usageElementId, occurrence]),
  );
  if (catalogDefinitionByUsage.size !== occurrenceByUsage.size) {
    fail(
      "The geometry bundle does not cover the projected SysON PartUsage identities.",
    );
  }
  for (const [usageId, definitionId] of catalogDefinitionByUsage) {
    const occurrence = occurrenceByUsage.get(usageId);
    if (!occurrence || occurrence.partDefinitionElementId !== definitionId) {
      fail(
        "The geometry bundle PartUsage to PartDefinition mapping diverges from SysON.",
      );
    }
  }
}

function attachExactCadBindings(
  catalog: ThreadComponentCatalog,
  bundle: VerifiedGeometryBundle,
): ThreadComponentCatalog {
  const components = catalog.components.map((component) => {
    if (component.kind === "assembly") {
      return {
        ...component,
        bindings: [
          ...component.bindings,
          cadBinding(
            bundle.assemblyStep,
            "Authoritative assembly STEP",
            bundle.primary.id,
          ),
        ],
      };
    }
    const definition = exactBinding(
      component.bindings,
      "part-definition",
      component.id,
    );
    const step = bundle.stepByDefinitionId.get(definition.id);
    if (!step) {
      fail(`No authoritative STEP is mapped to PartDefinition ${definition.id}.`);
    }
    return {
      ...component,
      bindings: [
        ...component.bindings,
        cadBinding(step, `Authoritative STEP: ${definition.label}`, bundle.primary.id),
      ],
      preview: bundle.glbByDefinitionId.has(definition.id)
        ? glbPreview(bundle.glbByDefinitionId.get(definition.id)!)
        : undefined,
    };
  });
  const presentationRationale = bundle.glbByDefinitionId.size > 0
    ? " Reviewed GLB presentation assets are attached through that same exact PartDefinition mapping; STEP remains authoritative."
    : " No PartDefinition presentation asset is claimed when the signed bundle does not include GLB.";
  return validateThreadComponentCatalog({
    ...catalog,
    rationale:
      "This Product Structure is derived from the exact architecture capture and " +
      "the unique active geometry-capture/2.0. Each PartUsage maps by signed element " +
      "identity to its PartDefinition and authoritative STEP; labels are never joins." +
      presentationRationale,
    components,
  });
}

function glbPreview(artifact: ThreadArtifact): ThreadComponentPreview {
  if (
    artifact.mediaType !== "model/gltf-binary" ||
    !artifact.uri?.endsWith(".glb")
  ) {
    fail(`The reviewed PartDefinition GLB ${artifact.id} is not browser-safe.`);
  }
  return {
    provider: "build123d",
    artifactId: artifact.id,
    mediaType: "model/gltf-binary",
    url: artifact.uri,
    sha256: artifact.fingerprint.digest,
  };
}

function cadBinding(
  artifact: ThreadArtifact,
  label: string,
  evidenceArtifactId: string,
): ThreadComponentBinding {
  return {
    provider: "digital-thread",
    kind: "artifact",
    id: artifact.id,
    label,
    evidenceArtifactId,
  };
}

function exactBinding(
  bindings: readonly ThreadComponentBinding[],
  kind: "part-definition" | "part-usage",
  componentId: string,
): ThreadComponentBinding {
  const matches = bindings.filter((binding) =>
    binding.provider === "syson" && binding.kind === kind
  );
  if (matches.length !== 1) {
    fail(`Component ${componentId} has no unique SysON ${kind} binding.`);
  }
  return matches[0]!;
}

function withoutCad(
  catalog: ThreadComponentCatalog,
  reason: string,
): ThreadComponentCatalog {
  return {
    ...catalog,
    rationale: `${catalog.rationale} ${reason}`,
  };
}

function exactPreviewProducer(value: unknown): ThreadOperationRef {
  const producer = exactObject(
    value,
    ["serverId", "tool", "runId"],
    "previewProducer",
  );
  if (
    producer.serverId !== "build123d-sandbox" ||
    producer.tool !== "build123d_export"
  ) {
    fail("The geometry bundle preview producer is not build123d-sandbox.");
  }
  return {
    serverId: "build123d-sandbox",
    tool: "build123d_export",
    runId: nonEmpty(producer.runId, "previewProducer.runId"),
  };
}

function exactFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactObject(value, ["algorithm", "digest"], path);
  if (fingerprint.algorithm !== "sha256") fail(`${path}.algorithm must be sha256.`);
  return { algorithm: "sha256", digest: digest(fingerprint.digest, `${path}.digest`) };
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  const result = object(value, path);
  assertOnlyKeys(result, keys, path);
  return result;
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail(`${path} must be an array.`);
  return value;
}

function stringArray(value: unknown, path: string): readonly string[] {
  return array(value, path).map((item, index) => nonEmpty(item, `${path}[${index}]`));
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (deterministicJson(actual) !== deterministicJson(wanted)) {
    fail(`${path} contains missing or unexpected fields.`);
  }
}

function nonEmpty(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    fail(`${path} must be a non-empty string.`);
  }
  return value;
}

function digest(value: unknown, path: string): string {
  const result = nonEmpty(value, path);
  if (!/^[a-f0-9]{64}$/.test(result)) fail(`${path} must be a lowercase SHA-256.`);
  return result;
}

function canonicalInstant(value: unknown, path: string): string {
  const result = nonEmpty(value, path);
  if (new Date(result).toISOString() !== result) {
    fail(`${path} must be a canonical UTC instant.`);
  }
  return result;
}

async function textFingerprint(text: string): Promise<ContentFingerprint> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(hash)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  };
}

function fail(reason: string): never {
  throw new GeometryBundleProjectionError(reason);
}
