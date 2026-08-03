import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

/** Immutable normalized CM-01 Modelica captures, addressed by their JSON hash. */
export class FileCm01NominalModelicaCaptureStore {
  constructor(
    private readonly directory = "state/local/cm01-nominal-modelica-captures",
  ) {}

  pathFor(fingerprint: ContentFingerprint): string {
    return `${this.directory.replace(/\/$/, "")}/${digest(fingerprint)}.json`;
  }

  uriFor(fingerprint: ContentFingerprint): string {
    return `casys://cm01-nominal-modelica-capture/sha256/${digest(fingerprint)}`;
  }

  async save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    const expected = digest(fingerprint);
    const actual = await fingerprintText(text);
    if (actual !== expected) {
      throw new Error(
        `CM-01 Modelica capture does not match declared sha256 ${expected}.`,
      );
    }
    const path = this.pathFor(fingerprint);
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await writeNewDurably(path, text);
      await syncDirectoryChain(this.directory);
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      const existing = await Deno.readTextFile(path);
      if (existing !== text) {
        throw new Error(
          `CM-01 Modelica capture ${expected} already exists with different content.`,
        );
      }
    }
  }

  async read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    try {
      const text = await Deno.readTextFile(this.pathFor(fingerprint));
      if (await fingerprintText(text) !== digest(fingerprint)) {
        throw new Error(
          `CM-01 Modelica capture ${fingerprint.digest} does not match its filename digest.`,
        );
      }
      return text;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}

async function writeNewDurably(path: string, text: string): Promise<void> {
  const file = await Deno.open(path, { createNew: true, write: true });
  try {
    const bytes = new TextEncoder().encode(text);
    let written = 0;
    while (written < bytes.length) {
      const count = await file.write(bytes.subarray(written));
      if (count <= 0) throw new Error("CM-01 Modelica capture made no write progress.");
      written += count;
    }
    await file.syncData();
  } finally {
    file.close();
  }
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
    const parent = current.lastIndexOf("/");
    current = parent < 0 ? "." : parent === 0 ? "/" : current.slice(0, parent);
    if (current === ".") return;
  }
}

function digest(fingerprint: ContentFingerprint): string {
  if (
    fingerprint.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError("A lowercase 64-character sha256 fingerprint is required.");
  }
  return fingerprint.digest;
}

async function fingerprintText(text: string): Promise<string> {
  const result = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(result)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
