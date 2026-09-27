/**
 * Renderer→Desktop file export (#51). Bytes already crossed a capped
 * channel (resource read or opened input); this only persists them to the
 * user's Downloads with a sanitized unique name and reports the exact path.
 * It never writes into chat data, Thread state, or the provider.
 */

export interface DesktopChatFileSaver {
  saveFile(
    fileName: string,
    data: Uint8Array,
  ): Promise<{ readonly path: string; readonly bytes: number }>;
}

export function decodeSaveFileBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let offset = 0; offset < binary.length; offset += 1) {
    bytes[offset] = binary.charCodeAt(offset);
  }
  return bytes;
}

/** Basename, narrow charset, no hidden files, bounded length. */
export function sanitizeSaveFileName(suggestion: string): string {
  const leaf = (suggestion.split("/").pop() ?? "").split("\\").pop() ?? "";
  const cleaned = leaf
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/\.+$/, "")
    .slice(0, 96);
  const dotted = cleaned.replace(/^\.+/, "");
  if (dotted === "" || dotted === "." || dotted === "..") {
    return "casys-export.bin";
  }
  return dotted;
}

export function createDownloadsFileSaver(
  homeDir: string | undefined,
): DesktopChatFileSaver {
  return {
    async saveFile(fileName, data) {
      if (homeDir === undefined || homeDir === "") {
        throw new Error("The home directory is unavailable for file export.");
      }
      const directory = `${homeDir}/Downloads`;
      await Deno.mkdir(directory, { recursive: true });
      const safe = sanitizeSaveFileName(fileName);
      const dot = safe.lastIndexOf(".");
      const stem = dot > 0 ? safe.slice(0, dot) : safe;
      const extension = dot > 0 ? safe.slice(dot) : "";
      for (let attempt = 0; attempt < 100; attempt += 1) {
        // Suffix room is reserved before the cap: truncating after would
        // collapse every retry onto the same overlong name.
        const suffix = attempt === 0 ? "" : `-${attempt + 1}`;
        const room = Math.max(1, 96 - suffix.length - extension.length);
        const candidate = `${stem.slice(0, room)}${suffix}${extension}`;
        const path = `${directory}/${candidate}`;
        try {
          await Deno.writeFile(path, data, { mode: 0o600, createNew: true });
          return { path, bytes: data.byteLength };
        } catch (error) {
          // Lost a concurrent race for this name: advance the suffix.
          if (error instanceof Deno.errors.AlreadyExists) continue;
          throw error;
        }
      }
      throw new Error("No free export file name was found in Downloads.");
    },
  };
}
