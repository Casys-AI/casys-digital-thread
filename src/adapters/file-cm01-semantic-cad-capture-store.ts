import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

/** Immutable, content-addressed normalized CAD export captures. */
export class FileCm01SemanticCadCaptureStore {
  constructor(private readonly directory = "state/local/cm01-semantic-cad-captures") {}

  uriFor(fingerprint: ContentFingerprint): string {
    return `casys://cm01-semantic-cad-capture/sha256/${digest(fingerprint)}`;
  }

  async save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    const expected = digest(fingerprint);
    if (await sha256(text) !== expected) {
      throw new Error("CM-01 CAD capture does not match its sha256.");
    }
    await Deno.mkdir(this.directory, { recursive: true });
    const path = `${this.directory.replace(/\/$/, "")}/${expected}.json`;
    try {
      await Deno.writeTextFile(path, text, { createNew: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error("CM-01 CAD capture digest already names different bytes.");
      }
    }
  }

  async read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    const expected = digest(fingerprint);
    try {
      const text = await Deno.readTextFile(
        `${this.directory.replace(/\/$/, "")}/${expected}.json`,
      );
      if (await sha256(text) !== expected) {
        throw new Error("CM-01 CAD capture no longer matches its sha256.");
      }
      return text;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }
}

function digest(value: ContentFingerprint): string {
  if (value.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(value.digest)) {
    throw new TypeError("Expected a lowercase SHA-256 content fingerprint.");
  }
  return value.digest;
}

async function sha256(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
