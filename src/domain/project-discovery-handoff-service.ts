import {
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "./engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "./engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "./engineering-project-validation.ts";
import { fingerprintsEqual, sha256Fingerprint } from "./deterministic-json.ts";
import type {
  ProjectDiscoveryRevisionStore,
} from "./project-discovery-command-service.ts";
import type { ProjectDiscoverySnapshot } from "./project-discovery.ts";
import type { ContentFingerprint } from "./thread-snapshot.ts";

export interface ProjectDiscoveryHandoffOrigin {
  readonly kind: "human" | "agent";
  readonly actorId: string;
}

/**
 * Explicit human command that turns one already approved discovery into a
 * project shell. It deliberately accepts no SysON, ThreadSnapshot, evidence,
 * phase, decision or run payload.
 */
export interface CreateEngineeringProjectFromDiscoveryCommand {
  readonly commandId: string;
  readonly discoveryId: string;
  /** Exact approved ProjectDiscoverySnapshot revision shown to the human. */
  readonly expectedDiscoveryRevision: number;
  readonly issuedAt: string;
  /** New EngineeringProject identity; this is a create-if-absent CAS target. */
  readonly projectId: string;
  readonly projectName: string;
}

export type ProjectDiscoveryHandoffErrorCode =
  | "discovery_not_found"
  | "project_exists"
  | "stale_discovery_revision"
  | "command_id_conflict"
  | "permission_denied"
  | "invalid_transition"
  | "invalid_input";

export class ProjectDiscoveryHandoffError extends Error {
  readonly httpStatus: 403 | 404 | 409 | 422;

  constructor(
    readonly code: ProjectDiscoveryHandoffErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectDiscoveryHandoffError";
    this.httpStatus = code === "permission_denied"
      ? 403
      : code === "discovery_not_found"
      ? 404
      : code === "project_exists" || code === "stale_discovery_revision" ||
          code === "command_id_conflict"
      ? 409
      : 422;
  }
}

type Clock = () => string;

/**
 * Cross-aggregate handoff boundary.
 *
 * The discovery aggregate is immutable once approved, so creating the initial
 * project is a single create-if-absent operation on the project store. The
 * exact reviewed discovery revision and its approval fingerprint become durable
 * project provenance; no provider is contacted and no technical state exists.
 */
export class ProjectDiscoveryHandoffService {
  constructor(
    private readonly discoveries: ProjectDiscoveryRevisionStore,
    private readonly projects: EngineeringProjectRevisionStore,
    private readonly now: Clock = () => new Date().toISOString(),
  ) {}

  async createEngineeringProject(
    origin: ProjectDiscoveryHandoffOrigin,
    command: CreateEngineeringProjectFromDiscoveryCommand,
  ): Promise<EngineeringProjectSnapshot> {
    assertHumanOrigin(origin);
    const normalized = normalizeCommand(command);
    const requestFingerprint = await sha256Fingerprint({
      type: "project.create-from-discovery",
      origin,
      command: normalized,
    });

    // A completed or uncertain prior request is resolved from the durable
    // project receipt before reading discovery again. Replays stay safe even
    // when the discovery read path is temporarily unavailable.
    const existing = await this.projects.get(normalized.projectId);
    if (existing) {
      const replay = await this.replay(
        existing,
        normalized.commandId,
        requestFingerprint,
      );
      if (replay) return replay;
      throw projectExists(normalized.projectId);
    }

    const discovery = await this.discoveries.get(normalized.discoveryId);
    if (!discovery) {
      throw new ProjectDiscoveryHandoffError(
        "discovery_not_found",
        `Project discovery ${normalized.discoveryId} does not exist.`,
      );
    }
    if (discovery.revision !== normalized.expectedDiscoveryRevision) {
      throw staleDiscovery(
        normalized.discoveryId,
        normalized.expectedDiscoveryRevision,
        discovery.revision,
      );
    }
    const approved = approvedBrief(discovery);
    const canonicalProjectName = requiredTrimmed(
      approved.brief.objective,
      "approved brief objective",
    );
    if (normalized.projectName !== canonicalProjectName) {
      invalidInput(
        "projectName must exactly match the normalized approved brief objective.",
      );
    }
    const appliedAt = requiredIsoDateTime(this.now(), "service clock");
    if (Date.parse(appliedAt) < Date.parse(discovery.generatedAt)) {
      invalidInput("The authoritative service clock moved backwards.");
    }
    if (Date.parse(normalized.issuedAt) > Date.parse(appliedAt)) {
      invalidInput("issuedAt cannot be later than the authoritative service clock.");
    }

    const snapshotId = snapshotIdFor(normalized.projectId, requestFingerprint);
    const initial = validateEngineeringProjectSnapshot({
      // New discovery-born projects use the V2 run-basis contract. Existing
      // V1 CM-01 snapshots stay immutable and are never upgraded in place.
      schemaVersion: "2.0",
      id: snapshotId,
      revision: 1,
      generatedAt: appliedAt,
      project: {
        id: normalized.projectId,
        name: canonicalProjectName,
        // This is a stable project-level identity for a future technical
        // subject, not a SysON element or a claim that a model exists.
        subjectId: `project:${normalized.projectId}`,
        objective: {
          title: canonicalProjectName,
          statement: canonicalProjectName,
        },
      },
      discoveryHandoff: {
        discoveryId: discovery.discoveryId,
        snapshotId: discovery.id,
        revision: discovery.revision,
        briefId: approved.brief.id,
        approvedBriefFingerprint: structuredClone(approved.review.inputFingerprint),
        approvedAt: approved.review.decidedAt,
        approvedBy: {
          id: approved.review.decidedBy.id,
          origin: approved.review.decidedBy.origin,
        },
      },
      threadSnapshots: [],
      phases: [],
      workItems: [],
      agentRuns: [],
      decisions: [],
      approvals: [],
      blockers: [],
      commandReceipts: [{
        commandId: normalized.commandId,
        type: "project.create-from-discovery",
        actor: { id: origin.actorId, origin: "human" },
        issuedAt: normalized.issuedAt,
        appliedAt,
        requestFingerprint,
        resultingSnapshot: { snapshotId, revision: 1 },
      }],
    });
    try {
      return await this.projects.createInitial(initial);
    } catch (error) {
      if (!(error instanceof EngineeringProjectStoreConflictError)) throw error;
      const winner = await this.projects.get(normalized.projectId);
      if (winner) {
        const replay = await this.replay(
          winner,
          normalized.commandId,
          requestFingerprint,
        );
        if (replay) return replay;
        throw projectExists(normalized.projectId);
      }
      throw error;
    }
  }

  private async replay(
    project: EngineeringProjectSnapshot,
    commandId: string,
    fingerprint: ContentFingerprint,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const receipt = project.commandReceipts?.find((item) =>
      item.commandId === commandId
    );
    if (!receipt) return undefined;
    if (!fingerprintsEqual(receipt.requestFingerprint, fingerprint)) {
      throw new ProjectDiscoveryHandoffError(
        "command_id_conflict",
        `Command id ${commandId} was already used for a different request.`,
      );
    }
    if (receipt.type !== "project.create-from-discovery") {
      throw new ProjectDiscoveryHandoffError(
        "command_id_conflict",
        `Command id ${commandId} is not a discovery-to-project handoff receipt.`,
      );
    }
    const result = await this.projects.getRevision(
      project.project.id,
      receipt.resultingSnapshot.revision,
    );
    if (!result || result.id !== receipt.resultingSnapshot.snapshotId) {
      throw new ProjectDiscoveryHandoffError(
        "command_id_conflict",
        `Command id ${commandId} has an invalid immutable result receipt.`,
      );
    }
    return result;
  }
}

function approvedBrief(discovery: ProjectDiscoverySnapshot): {
  brief: NonNullable<ProjectDiscoverySnapshot["brief"]>;
  review: {
    inputFingerprint: ContentFingerprint;
    decidedAt: string;
    decidedBy: { id: string; origin: "human" | "agent" };
  };
} {
  if (
    discovery.status !== "approved" || !discovery.brief || !discovery.review ||
    discovery.review.status !== "approved" ||
    discovery.review.briefId !== discovery.brief.id ||
    !discovery.review.decidedAt || !discovery.review.decidedBy
  ) {
    throw new ProjectDiscoveryHandoffError(
      "invalid_transition",
      `Project discovery ${discovery.discoveryId} has no approved brief to hand off.`,
    );
  }
  if (discovery.review.decidedBy.origin !== "human") {
    throw new ProjectDiscoveryHandoffError(
      "invalid_transition",
      `Project discovery ${discovery.discoveryId} was not approved by a human.`,
    );
  }
  return {
    brief: discovery.brief,
    review: {
      inputFingerprint: discovery.review.inputFingerprint,
      decidedAt: discovery.review.decidedAt,
      decidedBy: discovery.review.decidedBy,
    },
  };
}

function normalizeCommand(
  command: CreateEngineeringProjectFromDiscoveryCommand,
): CreateEngineeringProjectFromDiscoveryCommand {
  nonEmpty(command.commandId, "commandId");
  safeId(command.discoveryId, "discoveryId");
  if (
    !Number.isSafeInteger(command.expectedDiscoveryRevision) ||
    command.expectedDiscoveryRevision < 1
  ) {
    invalidInput("expectedDiscoveryRevision must be a positive safe integer.");
  }
  safeId(command.projectId, "projectId");
  const issuedAt = requiredIsoDateTime(command.issuedAt, "issuedAt");
  return {
    ...command,
    commandId: command.commandId.trim(),
    discoveryId: command.discoveryId.trim(),
    issuedAt,
    projectId: command.projectId.trim(),
    projectName: requiredTrimmed(command.projectName, "projectName"),
  };
}

function assertHumanOrigin(origin: ProjectDiscoveryHandoffOrigin): void {
  nonEmpty(origin.actorId, "origin.actorId");
  if (origin.kind !== "human") {
    throw new ProjectDiscoveryHandoffError(
      "permission_denied",
      "Only a human origin can create an engineering project from discovery.",
    );
  }
}

function snapshotIdFor(
  projectId: string,
  fingerprint: ContentFingerprint,
): string {
  return `${projectId}:project:r1:${fingerprint.digest.slice(0, 16)}`;
}

function requiredIsoDateTime(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    invalidInput(`${name} must be an ISO date-time.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function safeId(value: string, name: string): void {
  nonEmpty(value, name);
  if (!/^[A-Za-z0-9]/.test(value) || value.trim().toLowerCase() === "latest") {
    invalidInput(
      `${name} must begin with an ASCII alphanumeric character and cannot be latest.`,
    );
  }
}

function nonEmpty(value: string | undefined, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    invalidInput(`${name} cannot be empty.`);
  }
}

function requiredTrimmed(value: string, name: string): string {
  nonEmpty(value, name);
  return value.trim();
}

function invalidInput(message: string): never {
  throw new ProjectDiscoveryHandoffError("invalid_input", message);
}

function staleDiscovery(discoveryId: string, expected: number, actual: number): never {
  throw new ProjectDiscoveryHandoffError(
    "stale_discovery_revision",
    `Project discovery ${discoveryId} expected revision ${expected}, current revision is ${actual}.`,
  );
}

function projectExists(projectId: string): ProjectDiscoveryHandoffError {
  return new ProjectDiscoveryHandoffError(
    "project_exists",
    `Engineering project ${projectId} already exists.`,
  );
}
