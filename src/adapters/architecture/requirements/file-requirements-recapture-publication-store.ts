import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import type {
  ContentFingerprint,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";

/**
 * Durable hand-off between evidence persistence and the project `publishing`
 * transition. It makes a process crash in that narrow window resumable
 * without querying SysON again.
 */
export interface RequirementsRecapturePublication {
  readonly schemaVersion: "requirements-recapture-publication/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly fingerprint: ContentFingerprint;
  readonly snapshot: ThreadSnapshot;
  /** Canonical capture JSON staged with the publication so CAS can be recovered. */
  readonly capture: string;
}

export class FileRequirementsRecapturePublicationStore {
  constructor(
    private readonly directory = "state/local/requirements-recapture-publications",
  ) {}

  async save(value: RequirementsRecapturePublication): Promise<void> {
    validate(value);
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.pathFor(value.projectId, value.runId);
    const text = `${deterministicJson(value)}\n`;
    const parent = path.slice(0, path.lastIndexOf("/"));
    const temporary = `${parent}/.${crypto.randomUUID()}.tmp`;
    try {
      const file = await Deno.open(temporary, { createNew: true, write: true });
      try {
        const bytes = new TextEncoder().encode(text);
        let written = 0;
        while (written < bytes.length) {
          const count = await file.write(bytes.subarray(written));
          if (count <= 0) {
            throw new Error(
              "Requirements recapture publication made no write progress.",
            );
          }
          written += count;
        }
        await file.syncData();
      } finally {
        file.close();
      }
      await Deno.link(temporary, path);
      await syncDirectoryChain(this.directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error(
          "Requirements recapture publication conflicts with its durable run record.",
        );
      }
      await syncDirectoryChain(this.directory);
    } finally {
      await Deno.remove(temporary).catch((error) => {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      });
    }
  }

  async read(
    projectId: string,
    runId: string,
  ): Promise<RequirementsRecapturePublication | undefined> {
    const text = await readTextIfExists(await this.pathFor(projectId, runId));
    if (text === undefined) return undefined;
    const value = JSON.parse(text);
    validate(value);
    if (value.projectId !== projectId || value.runId !== runId) {
      throw new Error("Requirements recapture publication identity mismatch.");
    }
    return value;
  }

  async pathFor(projectId: string, runId: string): Promise<string> {
    return `${this.directory.replace(/\/$/, "")}/${await sha256Hex(
      deterministicJson([projectId, runId]),
    )}.json`;
  }
}

async function readTextIfExists(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function validate(
  value: unknown,
): asserts value is RequirementsRecapturePublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Requirements recapture publication is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = [
    "capture",
    "fingerprint",
    "projectId",
    "runId",
    "schemaVersion",
    "snapshot",
  ];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error("Requirements recapture publication has an unsupported shape.");
  }
  if (
    record.schemaVersion !== "requirements-recapture-publication/1.0" ||
    typeof record.projectId !== "string" || !record.projectId ||
    typeof record.runId !== "string" || !record.runId ||
    !record.fingerprint || typeof record.fingerprint !== "object" ||
    (record.fingerprint as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (record.fingerprint as Record<string, unknown>).digest !== "string" ||
    !record.snapshot || typeof record.snapshot !== "object" ||
    typeof record.capture !== "string" || record.capture.length === 0
  ) throw new Error("Requirements recapture publication fields are invalid.");
  if (
    !/^[a-f0-9]{64}$/.test(
      (record.fingerprint as Record<string, unknown>).digest as string,
    )
  ) {
    throw new Error("Requirements recapture publication fingerprint is invalid.");
  }
  validateThreadSnapshot(record.snapshot as ThreadSnapshot);
}

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
    if (current === ".") return;
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
  }
}
