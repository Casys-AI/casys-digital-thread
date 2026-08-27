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
export interface PartDefinitionsPublication {
  readonly schemaVersion: "part-definitions-publication/1.0";
  readonly projectId: string;
  readonly runId: string;
  readonly fingerprint: ContentFingerprint;
  readonly snapshot: ThreadSnapshot;
}

export class FilePartDefinitionsPublicationStore {
  constructor(
    private readonly directory = "state/local/part-definitions-publications",
  ) {}

  async save(value: PartDefinitionsPublication): Promise<void> {
    validate(value);
    await Deno.mkdir(this.directory, { recursive: true });
    const path = await this.pathFor(value.projectId, value.runId);
    const text = `${deterministicJson(value)}\n`;
    // The run key can itself be close to NAME_MAX.  Keep the disposable
    // temporary basename short while retaining the same directory for link(2).
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
            throw new Error("PartDefinitions publication made no write progress.");
          }
          written += count;
        }
        await file.syncData();
      } finally {
        file.close();
      }
      // link(2) publishes the complete fsynced inode without rename's
      // overwrite semantics.  A crash can leave only a disposable .tmp, never
      // a truncated final WAL record.
      await Deno.link(temporary, path);
      await syncDirectoryChain(this.directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error(
          "PartDefinitions publication conflicts with its durable run record.",
        );
      }
      // A matching concurrent final is not a durable outcome until some
      // successful caller has fsynced its parent directory.
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
  ): Promise<PartDefinitionsPublication | undefined> {
    let text = await readTextIfExists(await this.pathFor(projectId, runId));
    if (text === undefined) {
      // Upgrade-only compatibility. New writes never recreate this path, and
      // long legacy basenames are deliberately not touched: attempting them
      // would itself fail with ENAMETOOLONG on otherwise valid identifiers.
      const legacy = this.legacyPathFor(projectId, runId);
      if (legacy.basenameUtf8Bytes <= 255) {
        text = await readTextIfExists(legacy.path);
      }
    }
    if (text === undefined) return undefined;
    const value = JSON.parse(text);
    validate(value);
    if (value.projectId !== projectId || value.runId !== runId) {
      throw new Error("PartDefinitions publication identity mismatch.");
    }
    return value;
  }

  /**
   * A fixed-length canonical tuple digest keeps valid 160-character project
   * and run identifiers below NAME_MAX. The record itself re-attests both
   * identities, so a cryptographic collision is still rejected fail-closed.
   */
  async pathFor(projectId: string, runId: string): Promise<string> {
    return `${this.directory.replace(/\/$/, "")}/${await sha256Hex(
      deterministicJson([projectId, runId]),
    )}.json`;
  }

  private legacyPathFor(
    projectId: string,
    runId: string,
  ): Readonly<{ path: string; basenameUtf8Bytes: number }> {
    const basename = `${encodeURIComponent(JSON.stringify([projectId, runId]))}.json`;
    return {
      path: `${this.directory.replace(/\/$/, "")}/${basename}`,
      basenameUtf8Bytes: new TextEncoder().encode(basename).byteLength,
    };
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
): asserts value is PartDefinitionsPublication {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("PartDefinitions publication is invalid.");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expected = ["fingerprint", "projectId", "runId", "schemaVersion", "snapshot"];
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index])
  ) {
    throw new Error("PartDefinitions publication has an unsupported shape.");
  }
  if (
    record.schemaVersion !== "part-definitions-publication/1.0" ||
    typeof record.projectId !== "string" || !record.projectId ||
    typeof record.runId !== "string" || !record.runId ||
    !record.fingerprint || typeof record.fingerprint !== "object" ||
    (record.fingerprint as Record<string, unknown>).algorithm !== "sha256" ||
    typeof (record.fingerprint as Record<string, unknown>).digest !== "string" ||
    !record.snapshot || typeof record.snapshot !== "object"
  ) throw new Error("PartDefinitions publication fields are invalid.");
  if (
    !/^[a-f0-9]{64}$/.test(
      (record.fingerprint as Record<string, unknown>).digest as string,
    )
  ) {
    throw new Error("PartDefinitions publication fingerprint is invalid.");
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
    // Relative runtime directories are children of `.`; fsync that creation
    // entry once before stopping, without permitting an infinite `.` loop.
    if (current === ".") return;
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
  }
}
