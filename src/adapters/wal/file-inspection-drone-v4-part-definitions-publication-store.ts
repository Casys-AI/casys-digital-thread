import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";

/**
 * Durable hand-off between evidence persistence and the project `publishing`
 * transition.  It makes a process crash in that narrow window resumable
 * without querying SysON again.
 */
export interface InspectionDroneV4PartDefinitionsPublication {
  readonly schemaVersion: "inspection-drone-v4-part-definitions-publication/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly fingerprint: ContentFingerprint;
  readonly snapshot: ThreadSnapshot;
}

export class FileInspectionDroneV4PartDefinitionsPublicationStore {
  constructor(
    private readonly directory =
      "state/local/inspection-drone-v4-part-definitions-publications",
  ) {}

  async save(value: InspectionDroneV4PartDefinitionsPublication): Promise<void> {
    validate(value);
    await Deno.mkdir(this.directory, { recursive: true });
    const path = this.pathFor(value.projectId, value.runId);
    const text = `${deterministicJson(value)}\n`;
    try {
      const file = await Deno.open(path, { createNew: true, write: true });
      try {
        const bytes = new TextEncoder().encode(text);
        let written = 0;
        while (written < bytes.length) {
          const count = await file.write(bytes.subarray(written));
          if (count <= 0) {
            throw new Error(
              "Inspection-drone PartDefinitions publication made no write progress.",
            );
          }
          written += count;
        }
        await file.syncData();
      } finally {
        file.close();
      }
      await syncDirectoryChain(this.directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error(
          "Inspection-drone PartDefinitions publication conflicts with its durable run record.",
        );
      }
    }
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<InspectionDroneV4PartDefinitionsPublication | undefined> {
    try {
      const value = JSON.parse(await Deno.readTextFile(this.pathFor(projectId, runId)));
      validate(value);
      if (value.projectId !== projectId || value.runId !== runId) {
        throw new Error(
          "Inspection-drone PartDefinitions publication identity mismatch.",
        );
      }
      return value;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private pathFor(projectId: string, runId: string): string {
    return `${this.directory.replace(/\/$/, "")}/${
      encodeURIComponent(JSON.stringify([projectId, runId]))
    }.json`;
  }
}

function validate(
  value: unknown,
): asserts value is InspectionDroneV4PartDefinitionsPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Inspection-drone PartDefinitions publication is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["fingerprint", "projectId", "runId", "schemaVersion", "snapshot"];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error(
      "Inspection-drone PartDefinitions publication has an unsupported shape.",
    );
  }
  if (
    record.schemaVersion !== "inspection-drone-v4-part-definitions-publication/1.0" ||
    typeof record.projectId !== "string" || !record.projectId ||
    typeof record.runId !== "string" || !record.runId ||
    !record.fingerprint || typeof record.fingerprint !== "object" ||
    (record.fingerprint as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (record.fingerprint as Record<string, unknown>).digest !== "string" ||
    !record.snapshot || typeof record.snapshot !== "object"
  ) throw new Error("Inspection-drone PartDefinitions publication fields are invalid.");
  if (
    !/^[a-f0-9]{64}$/.test(
      (record.fingerprint as Record<string, unknown>).digest as string,
    )
  ) {
    throw new Error(
      "Inspection-drone PartDefinitions publication fingerprint is invalid.",
    );
  }
  validateThreadSnapshot(record.snapshot as ThreadSnapshot);
}

/** Persist the directory entry as well as the publication bytes. */
async function syncDirectoryChain(path: string): Promise<void> {
  let current = path.replace(/\/+$/, "") || ".";
  while (current !== "/") {
    const directory = await Deno.open(current, { read: true });
    try {
      await directory.sync();
    } finally {
      directory.close();
    }
    if (current === "state" || current.endsWith("/state")) return;
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
    if (current === ".") return;
  }
}
