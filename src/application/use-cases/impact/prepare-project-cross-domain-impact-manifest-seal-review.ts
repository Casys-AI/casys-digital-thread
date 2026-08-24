/**
 * Provider-free reread and recross for a cross-domain impact-manifest seal.
 *
 * This use case does not evaluate a branch, mutate a gate claim, call a solver
 * or provider, or infer independence. It only establishes whether a closed
 * manifest, its named Thread lineage, declared mechanical evidence, and the
 * approved Brief V2 can be reread as the exact facts a human could review.
 */

import type {
  ProjectCrossDomainImpactManifestSealReviewCommand,
  ProjectCrossDomainImpactManifestSealReviewDiagnostic,
  ProjectCrossDomainImpactManifestSealReviewResult,
  ProjectCrossDomainImpactManifestSealReviewUseCase,
} from "../../ports/in/impact/project-cross-domain-impact-manifest-seal-review.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactBriefGateReader } from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type { CrossDomainImpactManifestReader } from "../../ports/out/impact/cross-domain-impact-manifest-reader.ts";
import type {
  CrossDomainImpactThreadLineage,
  CrossDomainImpactThreadLineageReader,
} from "../../ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import { CrossDomainImpactThreadLineageReadError } from "../../ports/out/impact/cross-domain-impact-thread-lineage-reader.ts";
import {
  CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
  type CrossDomainImpactManifestSealAdmission,
  encodeCrossDomainImpactManifestSealAdmission,
  parseCrossDomainImpactManifestSealParameters,
} from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { recrossCrossDomainImpactManifestGateMap } from "../../../domain/impact/cross-domain-impact-decision.ts";
import { validateCrossDomainImpactManifest } from "../../../domain/impact/cross-domain-impact-manifest.ts";
import { validateContentFingerprint } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type { CrossDomainImpactManifestSealBriefGate } from "../../../domain/impact/cross-domain-impact-manifest-proposal.ts";
import { canonicalizeBriefGateDependsOnItemIds } from "../../../domain/project/project-brief.ts";

export interface PrepareProjectCrossDomainImpactManifestSealReviewDependencies {
  readonly manifests: CrossDomainImpactManifestReader;
  readonly lineage: CrossDomainImpactThreadLineageReader;
  readonly briefGates: CrossDomainImpactBriefGateReader;
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
}

/**
 * Stable review result code. These are intentionally only unavailable or
 * unresolved states; they are never engineering pass/fail states.
 */
type ReviewCode =
  | "invalid_request"
  | "manifest_unavailable"
  | "lineage_unavailable"
  | "brief_unavailable"
  | "manifest_mismatch"
  | "lineage_mismatch"
  | "brief_not_v2"
  | "brief_gate_unresolved"
  | "mechanical_evidence_unresolved"
  | "project_unavailable"
  | "work_item_claim_unresolved";

export class PrepareProjectCrossDomainImpactManifestSealReview
  implements ProjectCrossDomainImpactManifestSealReviewUseCase {
  readonly #manifests: CrossDomainImpactManifestReader;
  readonly #lineage: CrossDomainImpactThreadLineageReader;
  readonly #briefGates: CrossDomainImpactBriefGateReader;
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;

  constructor(
    dependencies: PrepareProjectCrossDomainImpactManifestSealReviewDependencies,
  ) {
    this.#manifests = dependencies.manifests;
    this.#lineage = dependencies.lineage;
    this.#briefGates = dependencies.briefGates;
    this.#projects = dependencies.projects;
  }

  async execute(
    value: unknown,
  ): Promise<ProjectCrossDomainImpactManifestSealReviewResult> {
    let command: ProjectCrossDomainImpactManifestSealReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      return unresolved(
        "invalid_request",
        "The impact-manifest review request is not an exact opaque identity.",
      );
    }

    let reopened;
    try {
      reopened = await this.#manifests.read(command.manifestRef);
    } catch {
      return unavailable(
        "manifest_unavailable",
        "The exact cross-domain impact manifest is unavailable.",
      );
    }
    if (!reopened) {
      return unavailable(
        "manifest_unavailable",
        "The exact cross-domain impact manifest is unavailable.",
      );
    }
    if (
      !fingerprintsEqual(
        reopened.reference.fingerprint,
        command.manifestRef.fingerprint,
      )
    ) {
      return unresolved(
        "manifest_mismatch",
        "The reopened manifest does not match the requested content address.",
      );
    }

    let manifest;
    try {
      manifest = await validateCrossDomainImpactManifest(reopened.manifest);
    } catch {
      return unresolved(
        "manifest_mismatch",
        "The reopened manifest is not a closed exact manifest.",
      );
    }
    if (manifest.project.id !== command.projectId) {
      return unresolved(
        "manifest_mismatch",
        "The reopened manifest belongs to another project.",
      );
    }

    let project;
    try {
      project = await this.#projects.get(command.projectId);
    } catch {
      return unavailable(
        "project_unavailable",
        "The exact engineering project is unavailable.",
      );
    }
    if (!project || project.project.id !== command.projectId) {
      return unavailable(
        "project_unavailable",
        "The exact engineering project is unavailable.",
      );
    }
    try {
      recrossCrossDomainImpactManifestGateMap(project.workItems, manifest.gateMap);
    } catch (error) {
      return unresolved(
        "work_item_claim_unresolved",
        error instanceof Error
          ? error.message
          : "The exact manifest gateMap does not recross current work-item gate claims.",
      );
    }

    let lineage: CrossDomainImpactThreadLineage | undefined;
    try {
      lineage = await this.#lineage.read({ projectId: command.projectId, manifest });
    } catch (error) {
      if (error instanceof CrossDomainImpactThreadLineageReadError) {
        return error.status === "unavailable"
          ? unavailable("lineage_unavailable", error.message)
          : unresolved("lineage_mismatch", error.message);
      }
      return unavailable(
        "lineage_unavailable",
        "The exact project and Thread lineage cannot be reopened.",
      );
    }
    if (!lineage) {
      return unavailable(
        "lineage_unavailable",
        "The exact project and Thread lineage cannot be reopened.",
      );
    }
    const lineageIssue = recrossLineage(manifest, lineage);
    if (lineageIssue) return unresolved(lineageIssue.code, lineageIssue.message);

    let brief;
    try {
      brief = await this.#briefGates.read(command.projectId);
    } catch {
      return unavailable(
        "brief_unavailable",
        "The current approved project brief is unavailable.",
      );
    }
    if (!brief) {
      return unavailable(
        "brief_unavailable",
        "The current approved project brief is unavailable.",
      );
    }
    if (brief.projectId !== command.projectId || brief.contractVersion !== "2.0") {
      return unresolved(
        "brief_not_v2",
        "Impact-manifest sealing requires the current approved Brief V2 with explicit gate dependencies.",
      );
    }

    let gates: readonly CrossDomainImpactManifestSealBriefGate[];
    try {
      gates = recrossBriefGates(manifest, brief);
    } catch {
      return unresolved(
        "brief_gate_unresolved",
        "The approved Brief V2 does not provide the exact declared gate identities and dependencies.",
      );
    }
    const evidenceIssue = recrossMechanicalEvidence(manifest, lineage);
    if (evidenceIssue) return unresolved(evidenceIssue.code, evidenceIssue.message);

    try {
      const admission: CrossDomainImpactManifestSealAdmission = {
        schemaVersion: CROSS_DOMAIN_IMPACT_MANIFEST_SEAL_ADMISSION_SCHEMA,
        manifest: {
          schemaVersion: manifest.schemaVersion,
          id: manifest.id,
          revision: manifest.revision,
          fingerprint: manifest.fingerprint,
          reference: reopened.reference.fingerprint,
          uri: reopened.uri,
        },
        project: lineage.project,
        subject: lineage.subject,
        basis: {
          snapshotId: lineage.basis.snapshotId,
          revision: lineage.basis.revision,
          fingerprint: lineage.basis.fingerprint,
        },
        brief: {
          contractVersion: "2.0",
          id: brief.brief.id,
          revision: brief.brief.revision,
          fingerprint: brief.brief.fingerprint,
          gates,
        },
        sourceAnchors: lineage.sourceAnchors,
        mechanicalEvidence: lineage.mechanicalEvidence,
      };
      const decisionParameters = encodeCrossDomainImpactManifestSealAdmission(
        admission,
      );
      const parsed = parseCrossDomainImpactManifestSealParameters(decisionParameters);
      const canonical = encodeCrossDomainImpactManifestSealAdmission(parsed);
      if (deterministicJson(canonical) !== deterministicJson(decisionParameters)) {
        throw new TypeError("Impact-manifest MRTR grammar replay is not canonical.");
      }
      return deepFreeze({
        status: "resolved",
        admission: parsed,
        decisionParameters: canonical,
        diagnostics: [],
      });
    } catch {
      return unresolved(
        "manifest_mismatch",
        "The recrossed impact-manifest review cannot form a closed canonical MRTR record.",
      );
    }
  }
}

function parseCommand(
  value: unknown,
): ProjectCrossDomainImpactManifestSealReviewCommand {
  const root = exactRecord(
    value,
    ["projectId", "manifestRef"],
    "$impactManifestSealReview",
  );
  const manifestRef = exactRecord(
    root.manifestRef,
    ["fingerprint"],
    "$impactManifestSealReview.manifestRef",
  );
  return deepFreeze({
    projectId: safeId(root.projectId, "$impactManifestSealReview.projectId"),
    manifestRef: {
      fingerprint: validateContentFingerprint(
        manifestRef.fingerprint,
        "$impactManifestSealReview.manifestRef.fingerprint",
      ),
    },
  });
}

function recrossLineage(
  manifest: Awaited<ReturnType<typeof validateCrossDomainImpactManifest>>,
  lineage: CrossDomainImpactThreadLineage,
): { code: ReviewCode; message: string } | undefined {
  if (
    lineage.project.id !== manifest.project.id ||
    !fingerprintsEqual(lineage.project.fingerprint, manifest.project.fingerprint) ||
    lineage.subject.id !== manifest.subject.id ||
    !fingerprintsEqual(lineage.subject.fingerprint, manifest.subject.fingerprint) ||
    lineage.basis.projectId !== manifest.basis.projectId ||
    lineage.basis.subjectId !== manifest.basis.subjectId ||
    lineage.basis.snapshotId !== manifest.basis.snapshotId ||
    lineage.basis.revision !== manifest.basis.revision ||
    !fingerprintsEqual(lineage.basis.fingerprint, manifest.basis.fingerprint)
  ) {
    return {
      code: "lineage_mismatch",
      message:
        "The reopened project, subject, or Thread basis is not the exact manifest lineage.",
    };
  }
  if (
    deterministicJson(lineage.sourceAnchors) !==
      deterministicJson(manifest.sourceAnchors)
  ) {
    return {
      code: "lineage_mismatch",
      message: "The reopened Thread source anchors are not the exact manifest anchors.",
    };
  }
  return undefined;
}

function recrossBriefGates(
  manifest: Awaited<ReturnType<typeof validateCrossDomainImpactManifest>>,
  brief: NonNullable<Awaited<ReturnType<CrossDomainImpactBriefGateReader["read"]>>>,
): readonly CrossDomainImpactManifestSealBriefGate[] {
  const gates = manifest.gateMap.map((mapping) => {
    const gate = brief.gates.find((candidate) => candidate.id === mapping.gateItemId);
    if (
      !gate ||
      (gate.kind !== "success-criterion" && gate.kind !== "verification-activity") ||
      gate.dependsOnItemIds === undefined
    ) {
      throw new TypeError("Missing explicit Brief V2 gate dependency declaration.");
    }
    const dependencies = canonicalizeBriefGateDependsOnItemIds(gate.dependsOnItemIds);
    return {
      gateItemId: mapping.gateItemId,
      kind: gate.kind,
      branchId: mapping.branchId,
      role: mapping.role,
      fingerprint: gate.fingerprint,
      dependsOnItemIds: dependencies,
    };
  });
  if (new Set(gates.map((gate) => gate.gateItemId)).size !== gates.length) {
    throw new TypeError("Manifest gate mappings are not exact.");
  }
  return [...gates].sort((left, right) =>
    left.gateItemId.localeCompare(right.gateItemId)
  );
}

function recrossMechanicalEvidence(
  manifest: Awaited<ReturnType<typeof validateCrossDomainImpactManifest>>,
  lineage: CrossDomainImpactThreadLineage,
): { code: ReviewCode; message: string } | undefined {
  const expected = manifest.independenceAssertions;
  if (lineage.mechanicalEvidence.length !== expected.length) {
    return {
      code: "mechanical_evidence_unresolved",
      message:
        "Declared mechanical evidence cannot be reread exactly for every independence assertion.",
    };
  }
  for (const assertion of expected) {
    const actual = lineage.mechanicalEvidence.find((candidate) =>
      candidate.assertionId === assertion.id
    );
    if (
      !actual ||
      actual.evidence.id !== assertion.evidence.id ||
      !fingerprintsEqual(actual.evidence.fingerprint, assertion.evidence.fingerprint) ||
      actual.evidenceFreshness !== "fresh" ||
      actual.consumptions.length !== assertion.inspectedConsumptions.length
    ) {
      return {
        code: "mechanical_evidence_unresolved",
        message:
          "Declared mechanical evidence is unavailable, stale, or not an exact recross.",
      };
    }
    for (const inspected of assertion.inspectedConsumptions) {
      const consumption = actual.consumptions.find((candidate) =>
        candidate.id === inspected.id
      );
      if (
        !consumption ||
        consumption.input.id !== inspected.input.id ||
        !fingerprintsEqual(
          consumption.input.fingerprint,
          inspected.input.fingerprint,
        ) ||
        consumption.consumerEvidence.id !== actual.evidence.id ||
        !fingerprintsEqual(
          consumption.consumerEvidence.fingerprint,
          actual.evidence.fingerprint,
        )
      ) {
        return {
          code: "mechanical_evidence_unresolved",
          message:
            "Declared mechanical evidence consumption is not an exact current Thread recross.",
        };
      }
    }
  }
  return undefined;
}

function unavailable(
  code: ReviewCode,
  message: string,
): ProjectCrossDomainImpactManifestSealReviewResult {
  return deepFreeze({
    status: "unavailable",
    diagnostics: [diagnostic(code, message)],
  });
}

function unresolved(
  code: ReviewCode,
  message: string,
): ProjectCrossDomainImpactManifestSealReviewResult {
  return deepFreeze({ status: "unresolved", diagnostics: [diagnostic(code, message)] });
}

function diagnostic(
  code: ReviewCode,
  message: string,
): ProjectCrossDomainImpactManifestSealReviewDiagnostic {
  return { code, message };
}
