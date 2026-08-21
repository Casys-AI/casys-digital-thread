/**
 * Write-ahead journal for one SysON constraint-evaluate dispatch.
 *
 * `dispatched` is recorded before the provider call. An interrupted dispatch
 * is not replayed automatically: the oracle outcome may already exist.
 */

import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  AttemptFileSystem,
  DENO_FILE_SYSTEM,
} from "../../shared/wal/file-attempt-store.ts";

export const ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_SCHEMA =
  "modelica-admitted-observation-evaluation-attempt/1.0" as const;

export const ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_STEP =
  "syson-constraint-evaluate" as const;

export interface AdmittedObservationEvaluationAttempt {
  readonly schemaVersion: typeof ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_SCHEMA;
  readonly projectId: string;
  readonly runId: string;
  readonly step: typeof ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_STEP;
  readonly status: "dispatched" | "completed";
  readonly dispatchedAt: string;
  readonly completedAt?: string;
  readonly captureDigest?: string;
}

export class AdmittedObservationEvaluationOutcomeUnknownError extends Error {
  constructor() {
    super(
      "The SysON admitted-observation evaluation outcome is unknown. It will not be retried automatically because the provider may already have evaluated the exact request.",
    );
    this.name = "AdmittedObservationEvaluationOutcomeUnknownError";
  }
}

export class FileAdmittedObservationEvaluationAttemptStore {
  constructor(
    private readonly directory =
      "state/local/modelica-admitted-observation-evaluation-attempts",
    private readonly fileSystem: AttemptFileSystem = DENO_FILE_SYSTEM,
  ) {}

  async begin(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly dispatchedAt: string;
  }): Promise<
    | { readonly action: "dispatch" }
    | { readonly action: "completed"; readonly captureDigest: string }
  > {
    const path = this.pathFor(input.projectId, input.runId);
    await this.fileSystem.mkdir(this.directory);
    const fresh: AdmittedObservationEvaluationAttempt = {
      schemaVersion: ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      step: ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_STEP,
      status: "dispatched",
      dispatchedAt: input.dispatchedAt,
    };
    try {
      await this.writeNewDurably(path, `${deterministicJson(fresh)}\n`);
      return { action: "dispatch" };
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
    }
    const existing = await this.readExact(input.projectId, input.runId);
    if (existing.status === "completed" && existing.captureDigest) {
      return { action: "completed", captureDigest: existing.captureDigest };
    }
    throw new AdmittedObservationEvaluationOutcomeUnknownError();
  }

  async complete(input: {
    readonly projectId: string;
    readonly runId: string;
    readonly completedAt: string;
    readonly captureDigest: string;
  }): Promise<void> {
    const existing = await this.readExact(input.projectId, input.runId);
    const completed: AdmittedObservationEvaluationAttempt = {
      schemaVersion: ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_SCHEMA,
      projectId: input.projectId,
      runId: input.runId,
      step: ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_STEP,
      status: "completed",
      dispatchedAt: existing.dispatchedAt,
      completedAt: input.completedAt,
      captureDigest: input.captureDigest,
    };
    if (existing.status === "completed") {
      if (deterministicJson(existing) !== deterministicJson(completed)) {
        throw new Error(
          "Completed admitted-observation evaluation attempt conflicts with its recorded capture.",
        );
      }
      return;
    }
    await this.replaceDurably(
      this.pathFor(input.projectId, input.runId),
      `${deterministicJson(completed)}\n`,
    );
  }

  pathFor(projectId: string, runId: string): string {
    const key = encodeURIComponent(
      JSON.stringify([projectId, runId, ADMITTED_OBSERVATION_EVALUATION_ATTEMPT_STEP]),
    );
    return `${this.directory.replace(/\/$/, "")}/${key}.json`;
  }

  private async readExact(
    projectId: string,
    runId: string,
  ): Promise<AdmittedObservationEvaluationAttempt> {
    try {
      return JSON.parse(
        await this.fileSystem.readTextFile(this.pathFor(projectId, runId)),
      ) as AdmittedObservationEvaluationAttempt;
    } catch {
      throw new AdmittedObservationEvaluationOutcomeUnknownError();
    }
  }

  private async writeNewDurably(path: string, text: string): Promise<void> {
    await this.writeDurably(path, text, { createNew: true, write: true });
  }

  private async replaceDurably(path: string, text: string): Promise<void> {
    const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
    await this.writeDurably(temporaryPath, text, { createNew: true, write: true });
    await this.fileSystem.rename(temporaryPath, path);
  }

  private async writeDurably(
    path: string,
    text: string,
    options: Deno.OpenOptions,
  ): Promise<void> {
    const file = await this.fileSystem.open(path, options);
    try {
      const bytes = new TextEncoder().encode(text);
      let written = 0;
      while (written < bytes.length) {
        const count = await file.write(bytes.subarray(written));
        if (count <= 0) {
          throw new Error(
            "Admitted-observation evaluation journal made no write progress.",
          );
        }
        written += count;
      }
      await file.syncData();
    } finally {
      file.close();
    }
  }
}
