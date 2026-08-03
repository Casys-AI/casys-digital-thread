import { sha256Fingerprint } from "../src/domain/deterministic-json.ts";
import type {
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
} from "../src/domain/thread-snapshot.ts";
import { validateThreadSnapshot } from "../src/domain/thread-snapshot-validation.ts";

const DEFAULT_PROOF_PATH =
  "config/correction-proofs/coffee-machine-cm01-v3-drip-tray-height-28-to-30.json";
const BASELINE_AT = "2026-08-03T11:00:00.000Z";
const CORRECTION_AT = "2026-08-03T11:05:00.000Z";
const SUBJECT_ID = "project:coffee-machine-cm01-v3";

interface CorrectionProofCase {
  readonly schemaVersion: "cm01-v3-correction-proof/1.0";
  readonly id: string;
  readonly title: string;
  readonly evidenceBoundary: string;
  readonly source: {
    readonly proofCasePath: string;
    readonly field: "geometry.heightMm";
    readonly beforeValue: number;
    readonly afterValue: number;
    readonly unit: "mm";
  };
  readonly impact: {
    readonly recomputeArtifactRoles: readonly ArtifactRole[];
    readonly unchangedArtifactRoles: readonly ArtifactRole[];
  };
}

type ArtifactRole =
  | "design-input"
  | "cad-plan"
  | "cad-script"
  | "cad-step"
  | "calculix-static-result"
  | "modelica-nominal-result"
  | "erp-bom";

const CORRECTED_PATH_ROLES = [
  "cad-plan",
  "cad-script",
  "cad-step",
  "calculix-static-result",
] as const satisfies readonly ArtifactRole[];
const UNAFFECTED_ROLES = [
  "modelica-nominal-result",
  "erp-bom",
] as const satisfies readonly ArtifactRole[];

export interface CoffeeMachineCm01V3CorrectionLoopFixture {
  readonly proofCase: {
    readonly id: string;
    readonly source: {
      readonly proofCasePath: string;
      readonly field: "geometry.heightMm";
      readonly beforeValue: number;
      readonly afterValue: number;
      readonly unit: "mm";
    };
  };
  /** Immutable historical evidence before the reviewed design correction. */
  readonly before: ThreadSnapshot;
  /** Historical outputs remain explicitly stale; replacements have fresh provenance. */
  readonly after: ThreadSnapshot;
  /** Structurally valid negative control that tries to reuse the old CAD/FEA path. */
  readonly reusedDescendantCandidate: ThreadSnapshot;
  readonly correctionChangeId: string;
  readonly affectedArtifactIds: readonly string[];
  readonly unaffectedArtifactIds: readonly string[];
}

export interface CoffeeMachineCm01V3CorrectionLoopResult {
  readonly status: "verified";
  readonly proofCaseId: string;
  readonly providerCalls: 0;
  readonly before: { readonly snapshotId: string; readonly revision: number };
  readonly after: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly previous: { readonly snapshotId: string; readonly revision: number };
  };
  readonly change: {
    readonly field: "geometry.heightMm";
    readonly beforeValue: number;
    readonly afterValue: number;
    readonly unit: "mm";
  };
  readonly invalidatedArtifactIds: readonly string[];
  readonly recomputedArtifactIds: readonly string[];
  readonly unchangedArtifactIds: readonly string[];
  readonly negativeControl: {
    readonly status: "rejected";
    readonly reason: string;
  };
  readonly note: string;
}

export class ReusedDescendantOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReusedDescendantOutputError";
  }
}

/**
 * Build an in-memory correction fixture from the reviewed V3 DripTray proof
 * case. It deliberately has no MCP client, provider output, or write path.
 *
 * This fixture deliberately does not invoke a CAD or mechanical executor. It
 * proves the evidence contract for a reviewed 28 -> 30 mm correction; it does
 * not pretend that the new geometry ran.
 */
export async function createCoffeeMachineCm01V3CorrectionLoopFixture(
  options: { readonly proofPath?: string } = {},
): Promise<CoffeeMachineCm01V3CorrectionLoopFixture> {
  const proofCase = await readCorrectionProofCase(
    options.proofPath ?? DEFAULT_PROOF_PATH,
  );
  await assertSourceValue(proofCase);

  const before = await baselineSnapshot(proofCase);
  const correctionChangeId = `change:${proofCase.id}:geometry-height-30mm`;
  const after = await correctedSnapshot(before, proofCase, correctionChangeId);
  const affectedArtifactIds = [
    "design-input-r1",
    ...affectedArtifacts(before, "design-input-r1"),
  ];
  const unaffectedArtifactIds = ["modelica-nominal-result-r1", "erp-bom-r1"];
  const reusedDescendantCandidate = createReusedDescendantCandidate(
    after,
    affectedArtifactIds,
  );

  return {
    proofCase: {
      id: proofCase.id,
      source: proofCase.source,
    },
    before,
    after,
    reusedDescendantCandidate,
    correctionChangeId,
    affectedArtifactIds,
    unaffectedArtifactIds,
  };
}

/**
 * Verify the bounded historical/stale/recompute contract without executing a
 * provider. The negative control must be rejected by the same policy that
 * checks the corrected fixture.
 */
export async function verifyCoffeeMachineCm01V3CorrectionLoop(
  options: { readonly proofPath?: string } = {},
): Promise<CoffeeMachineCm01V3CorrectionLoopResult> {
  const fixture = await createCoffeeMachineCm01V3CorrectionLoopFixture(options);
  assertCorrectionLoop(fixture);

  let rejection: string | undefined;
  try {
    assertNoReusedDescendantOutputs({
      before: fixture.before,
      after: fixture.reusedDescendantCandidate,
      correctionChangeId: fixture.correctionChangeId,
    });
  } catch (error) {
    if (error instanceof ReusedDescendantOutputError) {
      rejection = error.message;
    } else {
      throw error;
    }
  }
  if (!rejection) {
    throw new Error(
      "The CM-01 V3 correction-loop negative control unexpectedly accepted reused descendants.",
    );
  }

  const freshReplacements = fixture.after.artifacts.filter((artifact) =>
    artifact.id.endsWith("-r2")
  );
  return {
    status: "verified",
    proofCaseId: fixture.proofCase.id,
    providerCalls: 0,
    before: {
      snapshotId: fixture.before.id,
      revision: fixture.before.revision,
    },
    after: {
      snapshotId: fixture.after.id,
      revision: fixture.after.revision,
      previous: fixture.after.previous!,
    },
    change: {
      field: fixture.proofCase.source.field,
      beforeValue: fixture.proofCase.source.beforeValue,
      afterValue: fixture.proofCase.source.afterValue,
      unit: fixture.proofCase.source.unit,
    },
    invalidatedArtifactIds: fixture.affectedArtifactIds,
    recomputedArtifactIds: freshReplacements.map((artifact) => artifact.id),
    unchangedArtifactIds: fixture.unaffectedArtifactIds,
    negativeControl: { status: "rejected", reason: rejection },
    note:
      "In-memory provenance proof only: it does not call a provider, publish a project change, compare new metrics with the V3 golden reference, or make a certification claim.",
  };
}

/** Verify the corrected snapshot carries no fresh historical descendant output. */
export function assertNoReusedDescendantOutputs(input: {
  readonly before: ThreadSnapshot;
  readonly after: ThreadSnapshot;
  readonly correctionChangeId: string;
}): void {
  validateThreadSnapshot(input.before);
  validateThreadSnapshot(input.after);

  const root = input.before.artifacts.find((artifact) =>
    artifact.id === "design-input-r1"
  );
  if (!root) throw new Error("Correction fixture has no design-input-r1 artifact.");
  const affected = [root.id, ...affectedArtifacts(input.before, root.id)];
  const afterById = new Map(
    input.after.artifacts.map((artifact) => [artifact.id, artifact]),
  );

  for (const historicalId of affected) {
    const historical = afterById.get(historicalId);
    if (!historical) {
      throw new ReusedDescendantOutputError(
        `Correction snapshot must retain historical artifact ${historicalId}.`,
      );
    }
    if (historical.freshness.status === "fresh") {
      throw new ReusedDescendantOutputError(
        `Refusing to reuse descendant output ${historicalId} after design input geometry.heightMm changed.`,
      );
    }
    if (
      !historical.freshness.invalidatedByChangeIds.includes(input.correctionChangeId)
    ) {
      throw new ReusedDescendantOutputError(
        `Historical artifact ${historicalId} is not explicitly invalidated by ${input.correctionChangeId}.`,
      );
    }

    const replacements = input.after.provenance
      .filter((link) =>
        link.relation === "supersedes" && link.to.kind === "artifact" &&
        link.to.id === historicalId && link.from.kind === "artifact"
      )
      .map((link) => afterById.get(link.from.id))
      .filter((artifact): artifact is ThreadArtifact => artifact !== undefined);
    if (replacements.length !== 1) {
      throw new ReusedDescendantOutputError(
        `Historical artifact ${historicalId} must have exactly one fresh replacement provenance edge.`,
      );
    }
    const replacement = replacements[0]!;
    if (replacement.freshness.status !== "fresh") {
      throw new ReusedDescendantOutputError(
        `Replacement ${replacement.id} for ${historicalId} is not fresh.`,
      );
    }
    if (replacement.producer.runId === historical.producer.runId) {
      throw new ReusedDescendantOutputError(
        `Replacement ${replacement.id} reuses producer run ${historical.producer.runId}.`,
      );
    }
    for (const upstreamId of replacement.inputArtifactIds) {
      if (affected.includes(upstreamId)) {
        throw new ReusedDescendantOutputError(
          `Replacement ${replacement.id} still consumes invalidated artifact ${upstreamId}.`,
        );
      }
      const upstream = afterById.get(upstreamId);
      if (!upstream || upstream.freshness.status !== "fresh") {
        throw new ReusedDescendantOutputError(
          `Replacement ${replacement.id} must consume a fresh replacement input, not ${upstreamId}.`,
        );
      }
    }
  }
}

export function assertCorrectionLoop(
  fixture: CoffeeMachineCm01V3CorrectionLoopFixture,
): void {
  const before = validateThreadSnapshot(fixture.before);
  const after = validateThreadSnapshot(fixture.after);
  if (
    after.previous?.snapshotId !== before.id ||
    after.previous.revision !== before.revision ||
    after.revision !== before.revision + 1
  ) {
    throw new Error(
      "Correction snapshot does not retain an exact immutable predecessor.",
    );
  }
  assertNoReusedDescendantOutputs({
    before,
    after,
    correctionChangeId: fixture.correctionChangeId,
  });

  for (const artifactId of fixture.unaffectedArtifactIds) {
    const historical = before.artifacts.find((artifact) => artifact.id === artifactId);
    const current = after.artifacts.find((artifact) => artifact.id === artifactId);
    if (!historical || !current) {
      throw new Error(`Expected unaffected artifact ${artifactId} is missing.`);
    }
    if (
      current.freshness.status !== "fresh" ||
      current.fingerprint.digest !== historical.fingerprint.digest ||
      current.producer.runId !== historical.producer.runId
    ) {
      throw new Error(
        `Unrelated artifact ${artifactId} must stay fresh and must not be recomputed by the DripTray correction.`,
      );
    }
  }
}

async function baselineSnapshot(
  proofCase: CorrectionProofCase,
): Promise<ThreadSnapshot> {
  const path = await correctedPathArtifacts(
    1,
    proofCase.source.beforeValue,
    BASELINE_AT,
  );
  const artifacts = [...path, ...await unaffectedArtifacts(1, BASELINE_AT)];
  const consumptions = chainConsumptions(path);
  const changes = artifacts.map((artifact) => ({
    id: `create:${artifact.id}`,
    kind: "created" as const,
    target: { kind: "artifact" as const, id: artifact.id },
    summary: `Capture ${artifact.name}.`,
    afterFingerprint: artifact.fingerprint,
  }));
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${SUBJECT_ID}:r1:drip-tray-height-28mm`,
    revision: 1,
    generatedAt: BASELINE_AT,
    subject: {
      id: SUBJECT_ID,
      name: "CoffeeMachine CM-01 V3",
      kind: "system",
      version: "drip-tray-height-28mm",
      modelArtifactId: artifactId("design-input", 1),
    },
    freshness: fresh(BASELINE_AT),
    changeSet: {
      id: "cm01-v3-drip-tray-height-baseline",
      name: "Capture the reviewed 28 mm DripTray design input and bounded evidence.",
      status: "applied",
      createdAt: BASELINE_AT,
      appliedAt: BASELINE_AT,
      changes,
    },
    artifacts,
    consumptions,
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...changes.map((change) => changeLink(change.id, change.target.id)),
      ...consumptions.map(consumptionLink),
      ...derivationLinks(path),
    ],
    proposedActions: [],
  });
}

async function correctedSnapshot(
  before: ThreadSnapshot,
  proofCase: CorrectionProofCase,
  correctionChangeId: string,
): Promise<ThreadSnapshot> {
  const affectedIds = [
    "design-input-r1",
    ...affectedArtifacts(before, "design-input-r1"),
  ];
  const historical = before.artifacts.map((artifact) =>
    affectedIds.includes(artifact.id)
      ? stale(artifact, correctionChangeId, CORRECTION_AT)
      : structuredClone(artifact)
  );
  const old = byId(before.artifacts);
  const replacements = await correctedPathArtifacts(
    2,
    proofCase.source.afterValue,
    CORRECTION_AT,
  );
  const design = replacements[0]!;
  const consumptions = chainConsumptions(replacements);
  const change = {
    id: correctionChangeId,
    kind: "modified" as const,
    target: { kind: "artifact" as const, id: design.id },
    summary: "Change the reviewed DripTray height from 28 mm to 30 mm.",
    beforeFingerprint: old.get("design-input-r1")!.fingerprint,
    afterFingerprint: design.fingerprint,
  };
  return validateThreadSnapshot({
    schemaVersion: "1.0",
    id: `${SUBJECT_ID}:r2:drip-tray-height-30mm`,
    revision: 2,
    previous: { snapshotId: before.id, revision: before.revision },
    generatedAt: CORRECTION_AT,
    subject: {
      ...before.subject,
      version: "drip-tray-height-30mm",
      modelArtifactId: design.id,
    },
    freshness: staleSnapshot(correctionChangeId),
    changeSet: {
      id: "cm01-v3-drip-tray-height-30mm",
      name: "Apply the reviewed DripTray height correction.",
      status: "applied",
      createdAt: CORRECTION_AT,
      appliedAt: CORRECTION_AT,
      changes: [change],
    },
    artifacts: [...historical, ...replacements],
    consumptions: [...before.consumptions, ...consumptions],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      ...before.provenance.filter((link) => link.relation !== "changes"),
      changeLink(change.id, design.id),
      ...consumptions.map(consumptionLink),
      ...derivationLinks(replacements),
      ...replacements.map((replacement) =>
        supersedesLink(
          replacement.id,
          replacement.id.replace("-r2", "-r1"),
        )
      ),
    ],
    proposedActions: [],
  });
}

async function correctedPathArtifacts(
  revision: 1 | 2,
  heightMm: number,
  at: string,
): Promise<ThreadArtifact[]> {
  const design = await artifact({
    id: artifactId("design-input", revision),
    role: "design-input",
    name: `Reviewed DripTray height input (${heightMm} mm)`,
    kind: "document",
    producer: producerFor("design-input", revision),
    inputArtifacts: [],
    designHeightMm: heightMm,
    at,
  });
  const artifacts = [design];
  for (const role of CORRECTED_PATH_ROLES) {
    const upstream = artifacts.at(-1)!;
    artifacts.push(
      await artifact({
        id: artifactId(role, revision),
        role,
        name: artifactName(role, heightMm),
        kind: artifactKind(role),
        producer: producerFor(role, revision),
        inputArtifacts: [upstream],
        designHeightMm: heightMm,
        at,
      }),
    );
  }
  return artifacts;
}

async function unaffectedArtifacts(
  revision: 1 | 2,
  at: string,
): Promise<ThreadArtifact[]> {
  return await Promise.all(UNAFFECTED_ROLES.map((role) =>
    artifact({
      id: artifactId(role, revision),
      role,
      name: artifactName(role),
      kind: artifactKind(role),
      producer: producerFor(role, revision),
      inputArtifacts: [],
      at,
    })
  ));
}

function artifactId(role: ArtifactRole, revision: 1 | 2): string {
  return `${role}-r${revision}`;
}

function artifactName(role: ArtifactRole, heightMm?: number): string {
  switch (role) {
    case "cad-plan":
      return `CM-01 CAD plan from ${heightMm} mm DripTray height`;
    case "cad-script":
      return `CM-01 build123d script from ${heightMm} mm DripTray height`;
    case "cad-step":
      return `CM-01 STEP export from ${heightMm} mm DripTray height`;
    case "calculix-static-result":
      return `CM-01 DripTray static result from the ${heightMm} mm STEP`;
    case "modelica-nominal-result":
      return "CM-01 nominal thermal result";
    case "erp-bom":
      return "CM-01 observed ERPNext BOM";
    case "design-input":
      return `Reviewed DripTray height input (${heightMm} mm)`;
  }
}

function artifactKind(role: ArtifactRole): ThreadArtifact["kind"] {
  switch (role) {
    case "cad-plan":
    case "design-input":
      return "document";
    case "cad-script":
      return "script";
    case "cad-step":
      return "step";
    case "calculix-static-result":
    case "modelica-nominal-result":
      return "solver-result";
    case "erp-bom":
      return "bom";
  }
}

function producerFor(
  role: ArtifactRole,
  revision: 1 | 2,
): ThreadOperationRef {
  switch (role) {
    case "design-input":
      return operation(
        "digital-thread",
        "resolve_reviewed_design_input",
        `cm01-v3-r${revision}`,
      );
    case "cad-plan":
    case "cad-script":
      return operation(
        "digital-thread",
        "compile_coffee_machine_cm01_semantic_cad_plan",
        `cm01-v3-cad-r${revision}`,
      );
    case "cad-step":
      return operation("build123d", "build123d_export", `cm01-v3-cad-r${revision}`);
    case "calculix-static-result":
      return operation(
        "calculix",
        "calculix_solve_static",
        `cm01-v3-calculix-r${revision}`,
      );
    case "modelica-nominal-result":
      return operation(
        "modelica",
        "modelica_simulate",
        `cm01-v3-modelica-r${revision}`,
      );
    case "erp-bom":
      return operation("erpnext", "erpnext_bom_get", `cm01-v3-erp-r${revision}`);
  }
}

function createReusedDescendantCandidate(
  corrected: ThreadSnapshot,
  affectedIds: readonly string[],
): ThreadSnapshot {
  const removed = new Set(
    ["cad-plan-r2", "cad-script-r2", "cad-step-r2", "calculix-static-result-r2"],
  );
  const artifacts = corrected.artifacts
    .filter((artifact) => !removed.has(artifact.id))
    .map((artifact) =>
      affectedIds.includes(artifact.id) && artifact.id !== "design-input-r1"
        ? { ...artifact, freshness: fresh(CORRECTION_AT) }
        : structuredClone(artifact)
    );
  const consumptions = corrected.consumptions.filter((consumption) =>
    !["cm01-v3-cad-r2", "cm01-v3-calculix-r2"].includes(consumption.consumer.runId)
  );
  const consumptionIds = new Set(consumptions.map((consumption) => consumption.id));
  const provenance = corrected.provenance.filter((link) =>
    !removed.has(link.from.id) && !removed.has(link.to.id) &&
    (link.from.kind !== "consumption" || consumptionIds.has(link.from.id))
  );
  return validateThreadSnapshot({
    ...structuredClone(corrected),
    artifacts,
    consumptions,
    provenance,
  });
}

function affectedArtifacts(snapshot: ThreadSnapshot, rootId: string): string[] {
  const affected: string[] = [];
  const discovered = new Set([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const upstreamId = queue.shift()!;
    for (const artifact of snapshot.artifacts) {
      if (
        !artifact.inputArtifactIds.includes(upstreamId) || discovered.has(artifact.id)
      ) {
        continue;
      }
      discovered.add(artifact.id);
      affected.push(artifact.id);
      queue.push(artifact.id);
    }
  }
  return affected;
}

async function artifact(input: {
  readonly id: string;
  readonly role: ArtifactRole;
  readonly name: string;
  readonly kind: ThreadArtifact["kind"];
  readonly producer: ThreadOperationRef;
  readonly inputArtifacts: readonly ThreadArtifact[];
  readonly designHeightMm?: number;
  readonly at: string;
}): Promise<ThreadArtifact> {
  const fingerprint = await sha256Fingerprint({
    fixture: "coffee-machine-cm01-v3-drip-tray-height-correction",
    role: input.role,
    ...(input.designHeightMm === undefined
      ? {}
      : { designHeightMm: input.designHeightMm }),
    inputFingerprints: input.inputArtifacts.map((artifact) => artifact.fingerprint),
    producer: input.producer,
  });
  return {
    id: input.id,
    name: input.name,
    kind: input.kind,
    version: fingerprint.digest.slice(0, 12),
    fingerprint,
    producer: input.producer,
    inputArtifactIds: input.inputArtifacts.map((artifact) => artifact.id),
    freshness: fresh(input.at),
  };
}

function chainConsumptions(
  artifacts: readonly ThreadArtifact[],
): ThreadArtifactConsumption[] {
  return artifacts.flatMap((artifact) =>
    artifact.inputArtifactIds.map((upstreamId) => {
      const upstream = artifacts.find((candidate) => candidate.id === upstreamId);
      if (!upstream) {
        throw new Error(`Fixture artifact ${artifact.id} has no input ${upstreamId}.`);
      }
      return {
        id: `consume:${upstream.id}:by:${artifact.id}`,
        artifactId: upstream.id,
        consumer: artifact.producer,
        observedFingerprint: upstream.fingerprint,
        verifiedAt: artifact.freshness.changedAt,
        status: "verified" as const,
      };
    })
  );
}

function derivationLinks(artifacts: readonly ThreadArtifact[]): ThreadProvenanceLink[] {
  return artifacts.flatMap((artifact) =>
    artifact.inputArtifactIds.map((upstreamId) => ({
      id: `derived:${artifact.id}:from:${upstreamId}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: artifact.id },
      to: { kind: "artifact" as const, id: upstreamId },
      rationale: `${artifact.name} was produced from the exact upstream artifact.`,
    }))
  );
}

function consumptionLink(consumption: ThreadArtifactConsumption): ThreadProvenanceLink {
  return {
    id: `uses:${consumption.id}`,
    relation: "uses",
    from: { kind: "consumption", id: consumption.id },
    to: { kind: "artifact", id: consumption.artifactId },
    rationale:
      "The downstream producer independently observed the upstream fingerprint.",
  };
}

function changeLink(changeId: string, artifactId: string): ThreadProvenanceLink {
  return {
    id: `changes:${changeId}:${artifactId}`,
    relation: "changes",
    from: { kind: "change", id: changeId },
    to: { kind: "artifact", id: artifactId },
    rationale: "The immutable snapshot records this artifact change.",
  };
}

function supersedesLink(
  replacementId: string,
  historicalId: string,
): ThreadProvenanceLink {
  return {
    id: `supersedes:${replacementId}:${historicalId}`,
    relation: "supersedes",
    from: { kind: "artifact", id: replacementId },
    to: { kind: "artifact", id: historicalId },
    rationale: "The corrected run supersedes this invalidated historical artifact.",
  };
}

function stale(
  artifact: ThreadArtifact,
  correctionChangeId: string,
  at: string,
): ThreadArtifact {
  return {
    ...structuredClone(artifact),
    freshness: {
      status: "stale",
      changedAt: at,
      reason:
        "A reviewed DripTray height correction invalidated this downstream evidence.",
      invalidatedByChangeIds: [correctionChangeId],
    },
  };
}

function fresh(at: string) {
  return { status: "fresh" as const, changedAt: at, invalidatedByChangeIds: [] };
}

function staleSnapshot(correctionChangeId: string) {
  return {
    status: "stale" as const,
    changedAt: CORRECTION_AT,
    reason:
      "The snapshot retains invalidated historical CAD and CalculiX evidence beside fresh replacements.",
    invalidatedByChangeIds: [correctionChangeId],
  };
}

function operation(
  serverId: string,
  tool: string,
  runId: string,
): ThreadOperationRef {
  return { serverId, tool, runId };
}

function byId(
  artifacts: readonly ThreadArtifact[],
): Map<string, ThreadArtifact> {
  return new Map(artifacts.map((artifact) => [artifact.id, artifact]));
}

async function readCorrectionProofCase(path: string): Promise<CorrectionProofCase> {
  const raw = JSON.parse(await Deno.readTextFile(path));
  const root = record(raw, "$proof");
  exact(root.schemaVersion, "cm01-v3-correction-proof/1.0", "$proof.schemaVersion");
  const source = record(root.source, "$proof.source");
  const impact = record(root.impact, "$proof.impact");
  const proofCase: CorrectionProofCase = {
    schemaVersion: "cm01-v3-correction-proof/1.0",
    id: nonEmptyString(root.id, "$proof.id"),
    title: nonEmptyString(root.title, "$proof.title"),
    evidenceBoundary: nonEmptyString(root.evidenceBoundary, "$proof.evidenceBoundary"),
    source: {
      proofCasePath: nonEmptyString(
        source.proofCasePath,
        "$proof.source.proofCasePath",
      ),
      field: exact(
        source.field,
        "geometry.heightMm",
        "$proof.source.field",
      ),
      beforeValue: finiteNumber(source.beforeValue, "$proof.source.beforeValue"),
      afterValue: finiteNumber(source.afterValue, "$proof.source.afterValue"),
      unit: exact(source.unit, "mm", "$proof.source.unit"),
    },
    impact: {
      recomputeArtifactRoles: artifactRoles(
        impact.recomputeArtifactRoles,
        "$proof.impact.recomputeArtifactRoles",
      ),
      unchangedArtifactRoles: artifactRoles(
        impact.unchangedArtifactRoles,
        "$proof.impact.unchangedArtifactRoles",
      ),
    },
  };
  if (proofCase.source.beforeValue === proofCase.source.afterValue) {
    throw new Error("$proof.source must change the reviewed design value.");
  }
  assertExactImpact(proofCase);
  return proofCase;
}

async function assertSourceValue(proofCase: CorrectionProofCase): Promise<void> {
  const source = record(
    JSON.parse(await Deno.readTextFile(proofCase.source.proofCasePath)),
    "$proofCase",
  );
  const geometry = record(source.geometry, "$proofCase.geometry");
  const observed = finiteNumber(geometry.heightMm, "$proofCase.geometry.heightMm");
  if (observed !== proofCase.source.beforeValue) {
    throw new Error(
      `Correction proof expects ${proofCase.source.field}=${proofCase.source.beforeValue}, observed ${observed} in ${proofCase.source.proofCasePath}.`,
    );
  }
}

function assertExactImpact(proofCase: CorrectionProofCase): void {
  const recompute = [
    "cad-plan",
    "cad-script",
    "cad-step",
    "calculix-static-result",
  ];
  const unchanged = ["modelica-nominal-result", "erp-bom"];
  if (
    proofCase.impact.recomputeArtifactRoles.join("\u0000") !==
      recompute.join("\u0000") ||
    proofCase.impact.unchangedArtifactRoles.join("\u0000") !== unchanged.join("\u0000")
  ) {
    throw new Error(
      "The CM-01 V3 correction proof must recompute only CAD and CalculiX while leaving Modelica and ERP evidence unchanged.",
    );
  }
}

function artifactRoles(value: unknown, path: string): readonly ArtifactRole[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty array.`);
  }
  const allowed = new Set<ArtifactRole>([
    "design-input",
    "cad-plan",
    "cad-script",
    "cad-step",
    "calculix-static-result",
    "modelica-nominal-result",
    "erp-bom",
  ]);
  return value.map((item, index) => {
    const role = nonEmptyString(item, `${path}[${index}]`) as ArtifactRole;
    if (!allowed.has(role)) {
      throw new Error(`${path}[${index}] is not a known artifact role.`);
    }
    return role;
  });
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${path} must be a non-empty string.`);
  }
  return value;
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function exact<T extends string | number>(
  value: unknown,
  expected: T,
  path: string,
): T {
  if (value !== expected) {
    throw new Error(`${path} must equal ${JSON.stringify(expected)}.`);
  }
  return expected;
}

if (import.meta.main) {
  const proofPath = Deno.args.find((value) => value.startsWith("--proof="))?.slice(
    "--proof=".length,
  );
  console.log(
    JSON.stringify(
      await verifyCoffeeMachineCm01V3CorrectionLoop({ proofPath }),
      null,
      2,
    ),
  );
}
