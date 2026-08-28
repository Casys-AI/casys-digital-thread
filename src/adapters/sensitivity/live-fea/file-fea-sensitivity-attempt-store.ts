/**
 * Durable WAL for analyze.run-fea-sensitivity@1.
 *
 * CAD slots remain a separate isolated-code lifecycle. Recorded CalculiX
 * slots are intentionally monotone: idle → prepared → dispatched →
 * readback-recorded → captured, or a known terminal rejected state. A
 * prepared/dispatched slot is never reset to idle: the same request id is
 * recovered through provider readback, never by dispatching a second solve.
 */

import {
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { validateIsolatedCodeOutputValidationRejection } from "../../../domain/compile/isolation/isolated-code-execution.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  replaceAttemptFileDurably,
  writeNewAttemptFileDurably,
} from "../../shared/wal/durable-attempt-file-writes.ts";

export const FEA_SENSITIVITY_ATTEMPT_SCHEMA = "fea-sensitivity-attempt/2.0" as const;

export class FeaSensitivityOutcomeUnknownError extends Error {
  constructor(detail: string) {
    super(
      `The FEA sensitivity outcome is unknown and will not be retried automatically: ${detail}`,
    );
    this.name = "FeaSensitivityOutcomeUnknownError";
  }
}

export class FeaSensitivityIllegalTransitionError extends Error {
  constructor(readonly from: string, readonly to: string) {
    super(`Illegal FEA sensitivity WAL transition: ${from} → ${to}.`);
    this.name = "FeaSensitivityIllegalTransitionError";
  }
}

export type SensitivityPhase = "base" | "stepped";

export interface FeaSensitivityRuntimeAttestation {
  readonly operationalCapabilityFingerprint: ContentFingerprint;
  readonly binding: { readonly id: string; readonly version: string };
  readonly material: {
    readonly unitId: string;
    readonly materialId: string;
    readonly imageDigest: string;
  };
  readonly launchGroup: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
}

export type SensitivityCadSlot =
  | { readonly status: "idle" }
  | {
    readonly status: "dispatched";
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
  }
  | {
    readonly status: "published";
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
    readonly stepSha256: string;
    readonly stepBytes: number;
  }
  | {
    readonly status: "output-validation-rejected";
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
    readonly observation: {
      readonly role: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
    readonly destruction: {
      readonly status: "proven";
      readonly runId: string;
      readonly proofFingerprint: ContentFingerprint;
    };
  };

interface SensitivityPreparedSolve {
  readonly preparedAt: string;
  readonly stepSha256: string;
  readonly stepBytes: number;
  readonly requestId: string;
}

interface SensitivityDispatchedSolve extends SensitivityPreparedSolve {
  readonly dispatchedAt: string;
  readonly providerRunId: string;
  readonly requestSha256: string;
}

export type SensitivitySolveSlot =
  | { readonly status: "idle" }
  | ({ readonly status: "prepared" } & SensitivityPreparedSolve)
  | ({ readonly status: "dispatched" } & SensitivityDispatchedSolve)
  | ({
    readonly status: "readback-recorded";
    readonly readbackFp: string;
    readonly canonicalReadbackText: string;
  } & SensitivityDispatchedSolve)
  | ({
    readonly status: "captured";
    readonly readbackFp: string;
    readonly canonicalReadbackText: string;
    readonly captureFp: string;
    readonly canonicalSolveCaptureText: string;
  } & SensitivityDispatchedSolve)
  | ({
    readonly status: "rejected";
    readonly rejectedAt: string;
    readonly reason: string;
    readonly dispatchedAt: string | null;
    readonly providerRunId: string | null;
    readonly requestSha256: string | null;
  } & SensitivityPreparedSolve);

export interface FeaSensitivityAttempt {
  readonly schemaVersion: typeof FEA_SENSITIVITY_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly planDigest: string;
  /** Actual server-resolved capability identity, never a provider assertion. */
  readonly runtime: FeaSensitivityRuntimeAttestation;
  readonly cad: {
    readonly base: SensitivityCadSlot;
    readonly stepped: SensitivityCadSlot;
  };
  readonly solves: {
    readonly base: SensitivitySolveSlot;
    readonly stepped: SensitivitySolveSlot;
  };
  readonly status: "in-progress" | "completed";
  readonly snapshot?: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
}

export class FileFeaSensitivityAttemptStore {
  constructor(
    private readonly directory = "state/local/fea-sensitivity-attempts",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<FeaSensitivityAttempt | undefined> {
    try {
      return parseAttempt(
        JSON.parse(await Deno.readTextFile(this.#path(projectId, runId))),
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async prepare(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly planDigest: string;
    readonly runtime: FeaSensitivityRuntimeAttestation;
  }): Promise<FeaSensitivityAttempt> {
    const runtime = parseRuntime(input.runtime);
    const existing = await this.read(input.projectId, input.runId);
    if (existing) {
      if (
        existing.planDigest !== sha256(input.planDigest, "$prepare.planDigest") ||
        deterministicJson(existing.runtime) !== deterministicJson(runtime)
      ) {
        throw new FeaSensitivityOutcomeUnknownError(
          "planDigest or resolved capability runtime differs from the existing WAL",
        );
      }
      return existing;
    }
    const attempt: FeaSensitivityAttempt = {
      schemaVersion: FEA_SENSITIVITY_ATTEMPT_SCHEMA,
      projectId: safeId(input.projectId, "$prepare.projectId"),
      runId: safeId(input.runId, "$prepare.runId"),
      planDigest: sha256(input.planDigest, "$prepare.planDigest"),
      runtime,
      cad: { base: { status: "idle" }, stepped: { status: "idle" } },
      solves: { base: { status: "idle" }, stepped: { status: "idle" } },
      status: "in-progress",
    };
    await Deno.mkdir(this.directory, { recursive: true });
    await writeNewAttemptFileDurably(
      this.#path(input.projectId, input.runId),
      `${deterministicJson(attempt)}\n`,
      this.directory,
      "FEA sensitivity WAL write made no progress.",
    );
    return attempt;
  }

  async markCadDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly executionRunId: string;
    readonly dispatchedAt: string;
    readonly sourceSha256: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.cad[input.phase];
    if (slot.status === "published") return current;
    if (slot.status === "output-validation-rejected") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "dispatched");
    }
    if (slot.status === "dispatched") {
      throw new FeaSensitivityOutcomeUnknownError(
        `cad.${input.phase} is dispatched without a published STEP`,
      );
    }
    return await this.#replace(current, {
      ...current,
      cad: {
        ...current.cad,
        [input.phase]: {
          status: "dispatched",
          executionRunId: safeId(input.executionRunId, "$cad.executionRunId"),
          dispatchedAt: nonEmptyText(input.dispatchedAt, "$cad.dispatchedAt"),
          sourceSha256: sha256(input.sourceSha256, "$cad.sourceSha256"),
        },
      },
    });
  }

  async markCadPublished(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly stepSha256: string;
    readonly stepBytes: number;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.cad[input.phase];
    if (slot.status === "published") return current;
    if (slot.status !== "dispatched") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "published");
    }
    return await this.#replace(current, {
      ...current,
      cad: {
        ...current.cad,
        [input.phase]: {
          ...slot,
          status: "published",
          stepSha256: sha256(input.stepSha256, "$cad.stepSha256"),
          stepBytes: positiveInteger(input.stepBytes, "$cad.stepBytes"),
        },
      },
    });
  }

  async markCadOutputValidationRejected(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly observation: {
      readonly role: string;
      readonly byteCount: number;
      readonly sha256: string;
    };
    readonly destruction: {
      readonly status: "proven";
      readonly runId: string;
      readonly proofFingerprint: ContentFingerprint;
    };
    readonly registeredRoles: readonly string[];
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.cad[input.phase];
    const observation = validateIsolatedCodeOutputValidationRejection(
      input.observation,
    );
    if (!input.registeredRoles.includes(observation.role)) {
      throw new FeaSensitivityIllegalTransitionError(
        observation.role,
        "registered-output-role",
      );
    }
    if (slot.status === "idle" || slot.status === "published") {
      throw new FeaSensitivityIllegalTransitionError(
        slot.status,
        "output-validation-rejected",
      );
    }
    const destruction = validateProvenDestruction(
      input.destruction,
      slot.executionRunId,
    );
    const next: SensitivityCadSlot = {
      status: "output-validation-rejected",
      executionRunId: slot.executionRunId,
      dispatchedAt: slot.dispatchedAt,
      sourceSha256: slot.sourceSha256,
      observation,
      destruction,
    };
    if (slot.status === "output-validation-rejected") {
      if (deterministicJson(slot) === deterministicJson(next)) return current;
      throw new FeaSensitivityIllegalTransitionError(
        slot.status,
        "output-validation-rejected",
      );
    }
    return await this.#replace(current, {
      ...current,
      cad: { ...current.cad, [input.phase]: next },
    });
  }

  async markSolvePrepared(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly preparedAt: string;
    readonly stepSha256: string;
    readonly stepBytes: number;
    readonly requestId: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const prepared = solvePrepared(input);
    const slot = current.solves[input.phase];
    if (slot.status === "idle") {
      return await this.#replace(current, {
        ...current,
        solves: {
          ...current.solves,
          [input.phase]: { status: "prepared", ...prepared },
        },
      });
    }
    assertSamePrepared(slot, prepared, `solve.${input.phase}`);
    return current;
  }

  async markSolveDispatched(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly dispatchedAt: string;
    readonly providerRunId: string;
    readonly requestSha256: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    if (slot.status === "prepared") {
      return await this.#replace(current, {
        ...current,
        solves: {
          ...current.solves,
          [input.phase]: {
            ...slot,
            status: "dispatched",
            dispatchedAt: nonEmptyText(input.dispatchedAt, "$solve.dispatchedAt"),
            providerRunId: safeId(input.providerRunId, "$solve.providerRunId"),
            requestSha256: sha256(input.requestSha256, "$solve.requestSha256"),
          },
        },
      });
    }
    if (slot.status === "dispatched") {
      if (
        slot.dispatchedAt === input.dispatchedAt &&
        slot.providerRunId === input.providerRunId &&
        slot.requestSha256 === input.requestSha256
      ) return current;
    }
    throw new FeaSensitivityIllegalTransitionError(slot.status, "dispatched");
  }

  async markSolveReadbackRecorded(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly readbackFp: string;
    readonly canonicalReadbackText: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    const readbackFp = sha256(input.readbackFp, "$solve.readbackFp");
    const canonicalReadbackText = nonEmptyText(
      input.canonicalReadbackText,
      "$solve.canonicalReadbackText",
    );
    if (slot.status === "readback-recorded") {
      if (
        slot.readbackFp === readbackFp &&
        slot.canonicalReadbackText === canonicalReadbackText
      ) return current;
      throw new FeaSensitivityIllegalTransitionError(slot.status, "readback-recorded");
    }
    if (slot.status !== "dispatched") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "readback-recorded");
    }
    return await this.#replace(current, {
      ...current,
      solves: {
        ...current.solves,
        [input.phase]: {
          ...slot,
          status: "readback-recorded",
          readbackFp,
          canonicalReadbackText,
        },
      },
    });
  }

  async markSolveCaptured(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly captureFp: string;
    readonly canonicalSolveCaptureText: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    const captureFp = sha256(input.captureFp, "$solve.captureFp");
    const canonicalSolveCaptureText = nonEmptyText(
      input.canonicalSolveCaptureText,
      "$solve.canonicalSolveCaptureText",
    );
    if (slot.status === "captured") {
      if (
        slot.captureFp === captureFp &&
        slot.canonicalSolveCaptureText === canonicalSolveCaptureText
      ) return current;
      throw new FeaSensitivityIllegalTransitionError(slot.status, "captured");
    }
    if (slot.status !== "readback-recorded") {
      throw new FeaSensitivityIllegalTransitionError(slot.status, "captured");
    }
    return await this.#replace(current, {
      ...current,
      solves: {
        ...current.solves,
        [input.phase]: {
          ...slot,
          status: "captured",
          captureFp,
          canonicalSolveCaptureText,
        },
      },
    });
  }

  async markSolveRejected(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly phase: SensitivityPhase;
    readonly rejectedAt: string;
    readonly reason: string;
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    const slot = current.solves[input.phase];
    if (slot.status !== "prepared" && slot.status !== "dispatched") {
      if (slot.status === "rejected") return current;
      throw new FeaSensitivityIllegalTransitionError(slot.status, "rejected");
    }
    return await this.#replace(current, {
      ...current,
      solves: {
        ...current.solves,
        [input.phase]: {
          status: "rejected",
          preparedAt: slot.preparedAt,
          stepSha256: slot.stepSha256,
          stepBytes: slot.stepBytes,
          requestId: slot.requestId,
          rejectedAt: nonEmptyText(input.rejectedAt, "$solve.rejectedAt"),
          reason: nonEmptyText(input.reason, "$solve.reason"),
          dispatchedAt: slot.status === "dispatched" ? slot.dispatchedAt : null,
          providerRunId: slot.status === "dispatched" ? slot.providerRunId : null,
          requestSha256: slot.status === "dispatched" ? slot.requestSha256 : null,
        },
      },
    });
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly snapshot: FeaSensitivityAttempt["snapshot"];
  }): Promise<FeaSensitivityAttempt> {
    const current = await this.#required(input.projectId, input.runId);
    if (current.status === "completed") return current;
    if (
      current.solves.base.status !== "captured" ||
      current.solves.stepped.status !== "captured"
    ) {
      throw new FeaSensitivityIllegalTransitionError("in-progress", "completed");
    }
    return await this.#replace(current, {
      ...current,
      status: "completed",
      snapshot: input.snapshot,
    });
  }

  async #required(projectId: string, runId: string): Promise<FeaSensitivityAttempt> {
    const attempt = await this.read(projectId, runId);
    if (!attempt) throw new FeaSensitivityIllegalTransitionError("absent", "update");
    return attempt;
  }

  async #replace(
    current: FeaSensitivityAttempt,
    next: FeaSensitivityAttempt,
  ): Promise<FeaSensitivityAttempt> {
    await replaceAttemptFileDurably(
      this.#path(current.projectId, current.runId),
      `${deterministicJson(next)}\n`,
      this.directory,
      "FEA sensitivity WAL write made no progress.",
    );
    return next;
  }

  #path(projectId: string, runId: string): string {
    const safe = `${projectId}__${runId}`.replaceAll(/[^A-Za-z0-9._-]/g, "_");
    return `${this.directory.replace(/\/$/, "")}/${safe}.json`;
  }
}

function solvePrepared(input: {
  readonly preparedAt: string;
  readonly stepSha256: string;
  readonly stepBytes: number;
  readonly requestId: string;
}): SensitivityPreparedSolve {
  return {
    preparedAt: nonEmptyText(input.preparedAt, "$solve.preparedAt"),
    stepSha256: sha256(input.stepSha256, "$solve.stepSha256"),
    stepBytes: positiveInteger(input.stepBytes, "$solve.stepBytes"),
    requestId: safeId(input.requestId, "$solve.requestId"),
  };
}

function assertSamePrepared(
  slot: Exclude<SensitivitySolveSlot, { readonly status: "idle" }>,
  prepared: SensitivityPreparedSolve,
  path: string,
): void {
  if (
    slot.stepSha256 !== prepared.stepSha256 ||
    slot.stepBytes !== prepared.stepBytes || slot.requestId !== prepared.requestId
  ) {
    throw new FeaSensitivityOutcomeUnknownError(
      `${path} has a different prepared request identity.`,
    );
  }
}

function parseAttempt(value: unknown): FeaSensitivityAttempt {
  const root = exactRecord(value, [
    "schemaVersion",
    "projectId",
    "runId",
    "planDigest",
    "runtime",
    "cad",
    "solves",
    "status",
    ...(value && typeof value === "object" && "snapshot" in value ? ["snapshot"] : []),
  ], "$feaSensitivityAttempt");
  literalValue(
    root.schemaVersion,
    FEA_SENSITIVITY_ATTEMPT_SCHEMA,
    "$feaSensitivityAttempt.schemaVersion",
  );
  if (root.status !== "in-progress" && root.status !== "completed") {
    throw new TypeError("$feaSensitivityAttempt.status is not a known state.");
  }
  return {
    schemaVersion: FEA_SENSITIVITY_ATTEMPT_SCHEMA,
    projectId: safeId(root.projectId, "$feaSensitivityAttempt.projectId"),
    runId: safeId(root.runId, "$feaSensitivityAttempt.runId"),
    planDigest: sha256(root.planDigest, "$feaSensitivityAttempt.planDigest"),
    runtime: parseRuntime(root.runtime),
    cad: parseCadPair(root.cad),
    solves: parseSolvePair(root.solves),
    status: root.status,
    ...(root.snapshot === undefined ? {} : { snapshot: parseSnapshot(root.snapshot) }),
  };
}

function parseRuntime(value: unknown): FeaSensitivityRuntimeAttestation {
  const root = exactRecord(value, [
    "operationalCapabilityFingerprint",
    "binding",
    "material",
    "launchGroup",
  ], "$feaSensitivityAttempt.runtime");
  const binding = exactRecord(
    root.binding,
    ["id", "version"],
    "$feaSensitivityAttempt.runtime.binding",
  );
  const material = exactRecord(
    root.material,
    ["unitId", "materialId", "imageDigest"],
    "$feaSensitivityAttempt.runtime.material",
  );
  const group = exactRecord(
    root.launchGroup,
    ["id", "version", "fingerprint"],
    "$feaSensitivityAttempt.runtime.launchGroup",
  );
  return {
    operationalCapabilityFingerprint: parseFingerprint(
      root.operationalCapabilityFingerprint,
      "$feaSensitivityAttempt.runtime.operationalCapabilityFingerprint",
    ),
    binding: {
      id: safeId(binding.id, "$feaSensitivityAttempt.runtime.binding.id"),
      version: nonEmptyText(
        binding.version,
        "$feaSensitivityAttempt.runtime.binding.version",
      ),
    },
    material: {
      unitId: safeId(material.unitId, "$feaSensitivityAttempt.runtime.material.unitId"),
      materialId: safeId(
        material.materialId,
        "$feaSensitivityAttempt.runtime.material.materialId",
      ),
      imageDigest: sha256(
        material.imageDigest,
        "$feaSensitivityAttempt.runtime.material.imageDigest",
      ),
    },
    launchGroup: {
      id: safeId(group.id, "$feaSensitivityAttempt.runtime.launchGroup.id"),
      version: nonEmptyText(
        group.version,
        "$feaSensitivityAttempt.runtime.launchGroup.version",
      ),
      fingerprint: parseFingerprint(
        group.fingerprint,
        "$feaSensitivityAttempt.runtime.launchGroup.fingerprint",
      ),
    },
  };
}

function parseCadPair(value: unknown): FeaSensitivityAttempt["cad"] {
  const pair = exactRecord(value, ["base", "stepped"], "$feaSensitivityAttempt.cad");
  return {
    base: parseCadSlot(pair.base, "base"),
    stepped: parseCadSlot(pair.stepped, "stepped"),
  };
}

function parseCadSlot(value: unknown, phase: string): SensitivityCadSlot {
  const path = `$feaSensitivityAttempt.cad.${phase}`;
  const root = record(value, path);
  if (root.status === "idle") {
    exactRecord(root, ["status"], path);
    return { status: "idle" };
  }
  if (root.status === "dispatched") {
    const slot = exactRecord(root, [
      "status",
      "executionRunId",
      "dispatchedAt",
      "sourceSha256",
    ], path);
    return {
      status: "dispatched",
      executionRunId: safeId(slot.executionRunId, `${path}.executionRunId`),
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      sourceSha256: sha256(slot.sourceSha256, `${path}.sourceSha256`),
    };
  }
  if (root.status === "published") {
    const slot = exactRecord(root, [
      "status",
      "executionRunId",
      "dispatchedAt",
      "sourceSha256",
      "stepSha256",
      "stepBytes",
    ], path);
    return {
      status: "published",
      executionRunId: safeId(slot.executionRunId, `${path}.executionRunId`),
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      sourceSha256: sha256(slot.sourceSha256, `${path}.sourceSha256`),
      stepSha256: sha256(slot.stepSha256, `${path}.stepSha256`),
      stepBytes: positiveInteger(slot.stepBytes, `${path}.stepBytes`),
    };
  }
  if (root.status === "output-validation-rejected") {
    const slot = exactRecord(root, [
      "status",
      "executionRunId",
      "dispatchedAt",
      "sourceSha256",
      "observation",
      "destruction",
    ], path);
    const executionRunId = safeId(slot.executionRunId, `${path}.executionRunId`);
    return {
      status: "output-validation-rejected",
      executionRunId,
      dispatchedAt: nonEmptyText(slot.dispatchedAt, `${path}.dispatchedAt`),
      sourceSha256: sha256(slot.sourceSha256, `${path}.sourceSha256`),
      observation: validateIsolatedCodeOutputValidationRejection(
        slot.observation,
        `${path}.observation`,
      ),
      destruction: validateProvenDestruction(slot.destruction, executionRunId),
    };
  }
  throw new TypeError(`${path}.status is unknown.`);
}

function parseSolvePair(value: unknown): FeaSensitivityAttempt["solves"] {
  const pair = exactRecord(value, ["base", "stepped"], "$feaSensitivityAttempt.solves");
  return {
    base: parseSolveSlot(pair.base, "base"),
    stepped: parseSolveSlot(pair.stepped, "stepped"),
  };
}

function parseSolveSlot(value: unknown, phase: string): SensitivitySolveSlot {
  const path = `$feaSensitivityAttempt.solves.${phase}`;
  const root = record(value, path);
  if (root.status === "idle") {
    exactRecord(root, ["status"], path);
    return { status: "idle" };
  }
  const prepared = parsePrepared(root, path);
  if (root.status === "prepared") {
    exactRecord(
      root,
      ["status", "preparedAt", "stepSha256", "stepBytes", "requestId"],
      path,
    );
    return { status: "prepared", ...prepared };
  }
  if (root.status === "dispatched") {
    const dispatched = parseDispatched(root, path, prepared);
    return { status: "dispatched", ...dispatched };
  }
  if (root.status === "readback-recorded") {
    const dispatched = parseDispatched(root, path, prepared);
    const slot = exactRecord(root, [
      "status",
      "preparedAt",
      "stepSha256",
      "stepBytes",
      "requestId",
      "dispatchedAt",
      "providerRunId",
      "requestSha256",
      "readbackFp",
      "canonicalReadbackText",
    ], path);
    return {
      status: "readback-recorded",
      ...dispatched,
      readbackFp: sha256(slot.readbackFp, `${path}.readbackFp`),
      canonicalReadbackText: nonEmptyText(
        slot.canonicalReadbackText,
        `${path}.canonicalReadbackText`,
      ),
    };
  }
  if (root.status === "captured") {
    const dispatched = parseDispatched(root, path, prepared);
    const slot = exactRecord(root, [
      "status",
      "preparedAt",
      "stepSha256",
      "stepBytes",
      "requestId",
      "dispatchedAt",
      "providerRunId",
      "requestSha256",
      "readbackFp",
      "canonicalReadbackText",
      "captureFp",
      "canonicalSolveCaptureText",
    ], path);
    return {
      status: "captured",
      ...dispatched,
      readbackFp: sha256(slot.readbackFp, `${path}.readbackFp`),
      canonicalReadbackText: nonEmptyText(
        slot.canonicalReadbackText,
        `${path}.canonicalReadbackText`,
      ),
      captureFp: sha256(slot.captureFp, `${path}.captureFp`),
      canonicalSolveCaptureText: nonEmptyText(
        slot.canonicalSolveCaptureText,
        `${path}.canonicalSolveCaptureText`,
      ),
    };
  }
  if (root.status === "rejected") {
    const slot = exactRecord(root, [
      "status",
      "preparedAt",
      "stepSha256",
      "stepBytes",
      "requestId",
      "rejectedAt",
      "reason",
      "dispatchedAt",
      "providerRunId",
      "requestSha256",
    ], path);
    return {
      status: "rejected",
      ...prepared,
      rejectedAt: nonEmptyText(slot.rejectedAt, `${path}.rejectedAt`),
      reason: nonEmptyText(slot.reason, `${path}.reason`),
      dispatchedAt: nullableText(slot.dispatchedAt, `${path}.dispatchedAt`),
      providerRunId: nullableSafeId(slot.providerRunId, `${path}.providerRunId`),
      requestSha256: nullableSha256(slot.requestSha256, `${path}.requestSha256`),
    };
  }
  throw new TypeError(`${path}.status is unknown.`);
}

function parsePrepared(
  value: Record<string, unknown>,
  path: string,
): SensitivityPreparedSolve {
  return {
    preparedAt: nonEmptyText(value.preparedAt, `${path}.preparedAt`),
    stepSha256: sha256(value.stepSha256, `${path}.stepSha256`),
    stepBytes: positiveInteger(value.stepBytes, `${path}.stepBytes`),
    requestId: safeId(value.requestId, `${path}.requestId`),
  };
}

function parseDispatched(
  value: Record<string, unknown>,
  path: string,
  prepared: SensitivityPreparedSolve,
): SensitivityDispatchedSolve {
  return {
    ...prepared,
    dispatchedAt: nonEmptyText(value.dispatchedAt, `${path}.dispatchedAt`),
    providerRunId: safeId(value.providerRunId, `${path}.providerRunId`),
    requestSha256: sha256(value.requestSha256, `${path}.requestSha256`),
  };
}

function validateProvenDestruction(
  value: unknown,
  expectedRunId: string,
): Extract<
  SensitivityCadSlot,
  { readonly status: "output-validation-rejected" }
>["destruction"] {
  const root = exactRecord(
    value,
    ["status", "runId", "proofFingerprint"],
    "$destruction",
  );
  literalValue(root.status, "proven", "$destruction.status");
  const runId = safeId(root.runId, "$destruction.runId");
  if (runId !== expectedRunId) {
    throw new TypeError("$destruction.runId must match the CAD execution run.");
  }
  return {
    status: "proven",
    runId,
    proofFingerprint: parseFingerprint(
      root.proofFingerprint,
      "$destruction.proofFingerprint",
    ),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: sha256(root.digest, `${path}.digest`) };
}

function sha256(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!SHA256_HEX.test(digest)) {
    throw new TypeError(`${path} must be a lowercase 64-character hex string.`);
  }
  return digest;
}

function nullableText(value: unknown, path: string): string | null {
  return value === null ? null : nonEmptyText(value, path);
}

function nullableSafeId(value: unknown, path: string): string | null {
  return value === null ? null : safeId(value, path);
}

function nullableSha256(value: unknown, path: string): string | null {
  return value === null ? null : sha256(value, path);
}

function parseSnapshot(value: unknown): NonNullable<FeaSensitivityAttempt["snapshot"]> {
  const root = exactRecord(
    value,
    ["snapshotId", "revision", "subjectId"],
    "$feaSensitivityAttempt.snapshot",
  );
  if (!Number.isSafeInteger(root.revision)) {
    throw new TypeError("$feaSensitivityAttempt.snapshot.revision must be an integer.");
  }
  return {
    snapshotId: nonEmptyText(
      root.snapshotId,
      "$feaSensitivityAttempt.snapshot.snapshotId",
    ),
    revision: Number(root.revision),
    subjectId: safeId(root.subjectId, "$feaSensitivityAttempt.snapshot.subjectId"),
  };
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

const SHA256_HEX = /^[0-9a-f]{64}$/;
