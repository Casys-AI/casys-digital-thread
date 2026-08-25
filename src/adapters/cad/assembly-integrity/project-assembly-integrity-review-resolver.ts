/**
 * Server-owned reopening for the public assembly-integrity review.
 *
 * This adapter selects only the project's exact current Thread basis and the
 * closed observer profile. It reuses the lower exact input reopener for the
 * primary module and sibling STEP. It neither dispatches an observer nor
 * creates a plan, decision, run, capture, verdict, or gate claim.
 */

import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  AssemblyIntegrityInputResolver,
} from "../../../application/ports/out/cad/assembly-integrity/exact-assembly-integrity-input-resolver.ts";
import type {
  AssemblyIntegrityObserverProfileCatalog,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-observer.ts";
import type {
  AssemblyIntegrityReviewExistingWork,
  AssemblyIntegrityReviewResolution,
  AssemblyIntegrityReviewResolutionRequest,
  AssemblyIntegrityReviewResolver,
} from "../../../application/ports/out/cad/assembly-integrity/assembly-integrity-review-resolver.ts";
import {
  validateAssemblyIntegrityObservationAdmission,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observation-proposal.ts";
import { VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION } from "../../../domain/cad/assembly-integrity/assembly-integrity-observation.ts";
import {
  sameAssemblyIntegrityObserverProfileRef,
  validateAssemblyIntegrityObserverProfile,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-observer-profile.ts";
import { deepFreeze } from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
} from "../../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringOperationRef,
  EngineeringProjectChange,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  currentApprovedAssemblyIntegrityVerificationGateIds,
} from "../../../domain/cad/assembly-integrity/assembly-integrity-verification-authority.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import { approvedBriefBasisForProject } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";

/** A durable reread is preferred when the configured snapshot store supports it. */
export interface AssemblyIntegrityReviewSnapshotStore
  extends Pick<ThreadSnapshotStore, "get"> {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface ProjectAssemblyIntegrityReviewResolverOptions {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: AssemblyIntegrityReviewSnapshotStore;
  /** Lower-level exact primary-module and sibling-STEP reopener. */
  readonly inputs: AssemblyIntegrityInputResolver;
  /** Closed, server-owned factual profile catalogue. */
  readonly profiles: AssemblyIntegrityObserverProfileCatalog;
}

type ReviewResolutionFailure =
  | { readonly status: "unavailable"; readonly code: string; readonly message: string }
  | { readonly status: "unresolved"; readonly code: string; readonly message: string };

/**
 * Reopens one public review request into the exact future observation
 * admission. The selected profile is passed unchanged to the lower resolver;
 * no current/default profile is substituted after review.
 */
export class ProjectAssemblyIntegrityReviewResolver
  implements AssemblyIntegrityReviewResolver {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #snapshots: AssemblyIntegrityReviewSnapshotStore;
  readonly #inputs: AssemblyIntegrityInputResolver;
  readonly #profiles: AssemblyIntegrityObserverProfileCatalog;

  constructor(options: ProjectAssemblyIntegrityReviewResolverOptions) {
    this.#projects = options.projects;
    this.#snapshots = options.snapshots;
    this.#inputs = options.inputs;
    this.#profiles = options.profiles;
  }

  async resolve(
    request: AssemblyIntegrityReviewResolutionRequest,
  ): Promise<AssemblyIntegrityReviewResolution> {
    const project = await this.#readProject(request);
    if (isFailure(project)) return failed(project);

    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unresolved(tip.diagnostic.code, tip.diagnostic.message);
    }
    // This comparison intentionally precedes any snapshot read. A historical
    // basis must never be quietly treated as current just because it exists.
    if (deterministicJson(tip.basis) !== deterministicJson(request.basis)) {
      return unresolved(
        "basis-not-current",
        "The named Thread basis is not the project's exact unique current tip.",
      );
    }
    if (tip.basis.subjectId !== project.project.subjectId) {
      return unresolved(
        "basis-subject-mismatch",
        "The project's current Thread basis is foreign to its subject.",
      );
    }

    const snapshot = await this.#readSnapshot(request.basis);
    if (isFailure(snapshot)) return failed(snapshot);

    try {
      await assertThreadSnapshotLineageIntact(snapshot, this.#snapshots);
    } catch {
      return unresolved(
        "snapshot-lineage-invalid",
        "The exact current Thread basis failed lineage recrossing.",
      );
    }

    let existingWork: AssemblyIntegrityReviewExistingWork | undefined;
    try {
      existingWork = selectExistingWork(project, request);
    } catch {
      return unresolved(
        "planned-observation-invalid",
        "A structurally matching planned observation leaf is not eligible for an MRTR proposal.",
      );
    }

    let profile;
    try {
      profile = await validateAssemblyIntegrityObserverProfile(
        await this.#profiles.initial(),
      );
      // Kept explicit so a future profile grammar cannot silently reintroduce
      // an opaque runtime into this review/dispatch path.
      if (profile.configuredRuntime.kind !== "image-digest") {
        throw new TypeError("The observer runtime is not an immutable image digest.");
      }
    } catch {
      return unavailable(
        "observer-profile-unavailable",
        "The server-owned assembly-integrity observer profile is unavailable or not immutable.",
      );
    }

    let reopened;
    try {
      reopened = await this.#inputs.resolve({
        basis: {
          snapshotId: request.basis.snapshotId,
          revision: request.basis.revision,
          subjectId: request.basis.subjectId,
        },
        snapshot,
        geometryModule: {
          schemaVersion: "geometry-module-capture/1.0",
          artifactId: request.geometryModule.artifactId,
          fingerprint: request.geometryModule.fingerprint,
        },
        observerProfile: {
          profile: profile.profile,
          fingerprint: profile.profileFingerprint,
        },
      });
    } catch {
      return unresolved(
        "assembly-input-unresolved",
        "The exact primary geometry module and sibling assembly STEP could not be reopened.",
        request.geometryModule.artifactId,
      );
    }
    if (!reopenedMatchesRequest(reopened, request, profile)) {
      return unresolved(
        "assembly-input-mismatch",
        "The reopened observation input or profile diverged from the reviewed exact identity.",
        request.geometryModule.artifactId,
      );
    }

    try {
      const admission = validateAssemblyIntegrityObservationAdmission({
        schemaVersion: "assembly-integrity-observation-admission/1.0",
        operation: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION,
        projectId: request.projectId,
        basis: request.basis,
        geometryModule: request.geometryModule,
        observer: {
          profile: {
            id: profile.profile.id,
            version: profile.profile.version,
            fingerprint: profile.profileFingerprint,
          },
          method: profile.method,
          configuredRuntime: profile.configuredRuntime,
        },
      });
      return deepFreeze({
        status: "resolved" as const,
        admission,
        expectedProjectRevision: project.revision,
        ...(existingWork === undefined ? {} : { existingWork }),
      });
    } catch {
      return unresolved(
        "observation-admission-invalid",
        "The server-owned assembly-integrity observation admission was not exact.",
        request.geometryModule.artifactId,
      );
    }
  }

  async #readProject(
    request: AssemblyIntegrityReviewResolutionRequest,
  ): Promise<EngineeringProjectSnapshot | ReviewResolutionFailure> {
    let raw: EngineeringProjectSnapshot | undefined;
    try {
      raw = await this.#projects.get(request.projectId);
    } catch {
      return {
        status: "unavailable",
        code: "project-read-failed",
        message: "The engineering project could not be reread.",
      };
    }
    if (!raw) {
      return {
        status: "unavailable",
        code: "project-not-found",
        message: "The exact engineering project is unavailable.",
      };
    }
    let project: EngineeringProjectSnapshot;
    try {
      project = validateEngineeringProjectSnapshot(raw);
    } catch {
      return {
        status: "unresolved",
        code: "project-invalid",
        message: "The engineering project failed closed validation.",
      };
    }
    if (project.project.id !== request.projectId) {
      return {
        status: "unresolved",
        code: "project-mismatch",
        message: "The project reader returned a foreign project identity.",
      };
    }
    return project;
  }

  async #readSnapshot(
    basis: EngineeringThreadSnapshotBasis,
  ): Promise<ThreadSnapshot | ReviewResolutionFailure> {
    let raw: ThreadSnapshot | undefined;
    try {
      raw = this.#snapshots.getFresh === undefined
        ? await this.#snapshots.get(basis.snapshotId)
        : await this.#snapshots.getFresh(basis.snapshotId);
    } catch {
      return {
        status: "unavailable",
        code: "snapshot-read-failed",
        message: "The exact current Thread snapshot could not be reread.",
      };
    }
    if (!raw) {
      return {
        status: "unavailable",
        code: "snapshot-not-found",
        message: "The exact current Thread snapshot is unavailable.",
      };
    }
    let snapshot: ThreadSnapshot;
    try {
      snapshot = validateThreadSnapshot(raw);
    } catch {
      return {
        status: "unresolved",
        code: "snapshot-invalid",
        message: "The exact current Thread snapshot failed closed validation.",
      };
    }
    if (
      snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      return {
        status: "unresolved",
        code: "snapshot-mismatch",
        message: "The snapshot reader returned a stale or foreign Thread identity.",
      };
    }
    return snapshot;
  }
}

function selectExistingWork(
  project: EngineeringProjectSnapshot,
  request: AssemblyIntegrityReviewResolutionRequest,
): AssemblyIntegrityReviewExistingWork | undefined {
  const expectedOperation = observationOperation(request);
  const matches = project.workItems.filter((work) =>
    work.operation !== undefined &&
    deterministicJson(work.operation) === deterministicJson(expectedOperation)
  );
  if (matches.length === 0) return undefined;

  // A lifecycle leaf is a revision no later item names as predecessor. A
  // successor revision is therefore eligible itself; only its historical
  // predecessor is excluded. Filter first, then refuse competing current
  // leaves rather than letting array order choose one.
  const candidates = matches.filter((work) =>
    work.status === "waiting-for-decision" &&
    work.decisionIds.length === 1 &&
    !project.workItems.some((candidate) => candidate.predecessorRevisionId === work.id)
  );
  if (candidates.length !== 1) {
    throw new TypeError(
      "The reviewed observation identity has no unique current lifecycle leaf.",
    );
  }

  const work = candidates[0]!;
  const decisionId = work.decisionIds[0]!;
  const decisions = project.decisions.filter((candidate) =>
    candidate.id === decisionId
  );
  if (decisions.length !== 1) {
    throw new TypeError("The matching work item does not resolve to one decision.");
  }
  const decision = decisions[0]!;
  if (
    decision.phaseId !== work.phaseId ||
    (decision.status !== "required" && decision.status !== "rejected")
  ) {
    throw new TypeError(
      "The matching decision is not proposal-ready in the work phase.",
    );
  }

  const changes = (project.planChanges ?? []).filter((change) =>
    change.workItemIds.includes(work.id)
  );
  if (changes.length !== 1) {
    throw new TypeError("The matching work item is not owned by one project change.");
  }
  const change = changes[0]!;
  assertExactChange(change, work, decisionId, project, request);

  const gateClaims = parseCurrentContributesToClaims(project, work);
  return deepFreeze({
    phaseId: work.phaseId,
    workItemId: work.id,
    decision: {
      id: decision.id,
      title: decision.title,
      question: decision.question,
    },
    gateClaims,
  });
}

function assertExactChange(
  change: EngineeringProjectChange,
  work: EngineeringWorkItem,
  decisionId: string,
  project: EngineeringProjectSnapshot,
  request: AssemblyIntegrityReviewResolutionRequest,
): void {
  if (
    count(change.workItemIds, work.id) !== 1 ||
    count(change.decisionIds, decisionId) !== 1 ||
    !threadBasisRefEquals(change.baseSnapshot, request.basis)
  ) {
    throw new TypeError(
      "The matching project change diverges from the exact planned leaf.",
    );
  }
  const currentApprovedBrief = approvedBriefBasisForProject(project);
  if (
    change.approvedBriefBasis === undefined ||
    deterministicJson(change.approvedBriefBasis) !==
      deterministicJson(currentApprovedBrief)
  ) {
    throw new TypeError(
      "The matching project change does not retain the current approved brief basis.",
    );
  }
}

function count(values: readonly string[], expected: string): number {
  return values.filter((value) => value === expected).length;
}

function parseCurrentContributesToClaims(
  project: EngineeringProjectSnapshot,
  work: EngineeringWorkItem,
): AssemblyIntegrityReviewExistingWork["gateClaims"] {
  const claims = work.gateClaims ?? [];
  if (claims.length === 0) return deepFreeze([]);
  const gateIds = new Set(
    currentApprovedAssemblyIntegrityVerificationGateIds(project),
  );
  const seen = new Set<string>();
  const parsed = claims.map((claim) => {
    if (
      claim.role !== "contributes-to" || claim.status !== "current" ||
      seen.has(claim.gateItemId)
    ) {
      throw new TypeError(
        "Observation gate claims must remain unique contributes-to/current links.",
      );
    }
    seen.add(claim.gateItemId);
    if (!gateIds.has(claim.gateItemId)) {
      throw new TypeError(
        "Observation gate claims must name a current approved V2 assembly-integrity verification activity.",
      );
    }
    return {
      gateItemId: claim.gateItemId,
      role: "contributes-to" as const,
      status: "current" as const,
    };
  });
  return deepFreeze(parsed);
}

function observationOperation(
  request: AssemblyIntegrityReviewResolutionRequest,
): EngineeringOperationRef {
  return deepFreeze({
    id: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.id,
    version: VERIFY_OBSERVE_ASSEMBLY_INTEGRITY_OPERATION.version,
    bindings: [{
      name: "geometryModule",
      source: {
        kind: "thread-entity",
        reference: {
          snapshotId: request.basis.snapshotId,
          snapshotRevision: request.basis.revision,
          kind: "artifact",
          id: request.geometryModule.artifactId,
        },
      },
    }],
  });
}

function reopenedMatchesRequest(
  reopened: Awaited<ReturnType<AssemblyIntegrityInputResolver["resolve"]>>,
  request: AssemblyIntegrityReviewResolutionRequest,
  profile: Awaited<ReturnType<AssemblyIntegrityObserverProfileCatalog["initial"]>>,
): boolean {
  return (
    reopened.basis.snapshotId === request.basis.snapshotId &&
    reopened.basis.revision === request.basis.revision &&
    reopened.basis.subjectId === request.basis.subjectId &&
    reopened.geometryModule.artifactId === request.geometryModule.artifactId &&
    fingerprintsEqual(
      reopened.geometryModule.fingerprint,
      request.geometryModule.fingerprint,
    ) &&
    sameAssemblyIntegrityObserverProfileRef(
      reopened.profile.profile,
      profile.profile,
    ) &&
    fingerprintsEqual(
      reopened.profile.profileFingerprint,
      profile.profileFingerprint,
    ) &&
    sameAssemblyIntegrityObserverProfileRef(
      reopened.observerProfile.profile,
      profile.profile,
    ) &&
    fingerprintsEqual(
      reopened.observerProfile.fingerprint,
      profile.profileFingerprint,
    ) &&
    deterministicJson(reopened.profile.configuredRuntime) ===
      deterministicJson(profile.configuredRuntime)
  );
}

function threadBasisRefEquals(
  left: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  },
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

function isFailure(
  value: EngineeringProjectSnapshot | ThreadSnapshot | ReviewResolutionFailure,
): value is ReviewResolutionFailure {
  return "status" in value &&
    (value.status === "unavailable" || value.status === "unresolved");
}

function failed(failure: ReviewResolutionFailure): AssemblyIntegrityReviewResolution {
  return failure.status === "unavailable"
    ? unavailable(failure.code, failure.message)
    : unresolved(failure.code, failure.message);
}

function unavailable(
  code: string,
  message: string,
  artifactId: string | null = null,
): AssemblyIntegrityReviewResolution {
  return deepFreeze({
    status: "unavailable" as const,
    diagnostics: [{ code, artifactId, message }],
  });
}

function unresolved(
  code: string,
  message: string,
  artifactId: string | null = null,
): AssemblyIntegrityReviewResolution {
  return deepFreeze({
    status: "unresolved" as const,
    diagnostics: [{ code, artifactId, message }],
  });
}
