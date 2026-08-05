import { deterministicJson } from "../../domain/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/thread-snapshot.ts";

export interface Cm01ErpNextBomRunCaptureRecord {
  readonly schemaVersion: "cm01-erpnext-bom-run-capture/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly capturedAt: string;
  readonly captureFingerprint: ContentFingerprint;
}

/**
 * Links one project run to its immutable capture after a read-only provider
 * observation. Unlike a write-ahead mutation log, absence permits one fresh
 * read; once present, retry must re-read these exact content-addressed bytes.
 */
export class FileCm01ErpNextBomRunCaptureStore {
  constructor(
    private readonly directory = "state/local/cm01-erpnext-bom-run-captures",
  ) {}

  async read(
    projectId: string,
    runId: string,
  ): Promise<Cm01ErpNextBomRunCaptureRecord | undefined> {
    validateId(projectId, "projectId");
    validateId(runId, "runId");
    try {
      return parse(
        await Deno.readTextFile(this.pathFor(projectId, runId)),
        projectId,
        runId,
      );
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  async save(record: Cm01ErpNextBomRunCaptureRecord): Promise<void> {
    validate(record, record.projectId, record.runId);
    await Deno.mkdir(this.directory, { recursive: true });
    const text = `${deterministicJson(record)}\n`;
    const path = this.pathFor(record.projectId, record.runId);
    try {
      await Deno.writeTextFile(path, text, { createNew: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error("CM-01 ERPNext BOM run already names a different capture.");
      }
    }
  }

  private pathFor(projectId: string, runId: string): string {
    validateId(projectId, "projectId");
    validateId(runId, "runId");
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([projectId, runId]))
    }.json`;
  }
}

function parse(
  text: string,
  projectId: string,
  runId: string,
): Cm01ErpNextBomRunCaptureRecord {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("CM-01 ERPNext BOM run capture is not valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("CM-01 ERPNext BOM run capture must be an object.");
  }
  validate(value as Cm01ErpNextBomRunCaptureRecord, projectId, runId);
  return value as Cm01ErpNextBomRunCaptureRecord;
}

function validate(
  record: Cm01ErpNextBomRunCaptureRecord,
  projectId: string,
  runId: string,
): void {
  const keys = Object.keys(record).sort();
  if (
    deterministicJson(keys) !==
      deterministicJson([
        "captureFingerprint",
        "capturedAt",
        "projectId",
        "runId",
        "schemaVersion",
      ]) ||
    record.schemaVersion !== "cm01-erpnext-bom-run-capture/1.0" ||
    record.projectId !== projectId || record.runId !== runId ||
    Number.isNaN(Date.parse(record.capturedAt)) ||
    record.captureFingerprint?.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(record.captureFingerprint.digest)
  ) {
    throw new Error("CM-01 ERPNext BOM run capture has an unsupported contract.");
  }
}

function validateId(value: string, label: string): void {
  if (value.trim() === "") throw new TypeError(`${label} must not be empty.`);
}
