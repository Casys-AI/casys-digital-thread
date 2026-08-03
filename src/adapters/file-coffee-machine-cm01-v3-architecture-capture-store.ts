import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

/**
 * Content-addressed normalized evidence produced by the CM-01 SysON authoring
 * operation. The bytes contain no raw provider response or rendered SysML.
 */
export class FileCoffeeMachineCm01V3ArchitectureCaptureStore {
  constructor(
    private readonly directory =
      "state/local/coffee-machine-cm01-v3-architecture-captures",
  ) {}

  uriFor(fingerprint: ContentFingerprint): string {
    return `casys://coffee-machine-cm01-v3-architecture/sha256/${digest(fingerprint)}`;
  }

  async save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ readonly uri: string }> {
    const expected = digest(fingerprint);
    if (await sha256(text) !== expected) {
      throw new Error("CM-01 architecture capture content does not match its sha256.");
    }
    await Deno.mkdir(this.directory, { recursive: true });
    const path = this.pathFor(fingerprint);
    try {
      await Deno.writeTextFile(path, text, { createNew: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error(
          "CM-01 architecture capture digest already names different bytes.",
        );
      }
    }
    return { uri: this.uriFor(fingerprint) };
  }

  async read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    try {
      const text = await Deno.readTextFile(this.pathFor(fingerprint));
      if (await sha256(text) !== digest(fingerprint)) {
        throw new Error(
          "CM-01 architecture capture content no longer matches its sha256.",
        );
      }
      return text;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return undefined;
      throw error;
    }
  }

  private pathFor(fingerprint: ContentFingerprint): string {
    return `${this.directory.replace(/\/$/, "")}/${digest(fingerprint)}.json`;
  }
}

function digest(fingerprint: ContentFingerprint): string {
  if (
    fingerprint.algorithm !== "sha256" || !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError("Expected a lowercase SHA-256 content fingerprint.");
  }
  return fingerprint.digest;
}

async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
