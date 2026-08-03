import type { ContentFingerprint } from "../domain/thread-snapshot.ts";

/** Immutable normalized ERPNext BOM observations, named by their JSON hash. */
export class FileCm01ErpNextBomCaptureStore {
  constructor(
    private readonly directory = "state/local/cm01-erpnext-bom-captures",
  ) {}

  uriFor(fingerprint: ContentFingerprint): string {
    return `casys://cm01-erpnext-bom-capture/sha256/${digest(fingerprint)}`;
  }

  async save(fingerprint: ContentFingerprint, text: string): Promise<void> {
    const expected = digest(fingerprint);
    if (await fingerprintText(text) !== expected) {
      throw new Error("CM-01 ERPNext BOM capture content does not match its sha256.");
    }
    const path = this.pathFor(fingerprint);
    await Deno.mkdir(this.directory, { recursive: true });
    try {
      await Deno.writeTextFile(path, text, { createNew: true });
    } catch (error) {
      if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
      if (await Deno.readTextFile(path) !== text) {
        throw new Error(
          "CM-01 ERPNext BOM capture digest already names different bytes.",
        );
      }
    }
  }

  async read(fingerprint: ContentFingerprint): Promise<string | undefined> {
    try {
      const text = await Deno.readTextFile(this.pathFor(fingerprint));
      if (await fingerprintText(text) !== digest(fingerprint)) {
        throw new Error("CM-01 ERPNext BOM capture no longer matches its sha256.");
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
    fingerprint.algorithm !== "sha256" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError("Expected a lowercase SHA-256 content fingerprint.");
  }
  return fingerprint.digest;
}

async function fingerprintText(text: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
