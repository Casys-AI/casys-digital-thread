import { joinWorkspace, MRTR_KEY_RELATIVE_PATH, SidecarFailure } from "./contracts.ts";
import { ensureClosedWorkspaceDirectory } from "./workspace.ts";

const HEX_KEY = /^[0-9a-f]{64}$/;

export function mrtrKeyPath(workspaceRoot: string): string {
  return joinWorkspace(workspaceRoot, MRTR_KEY_RELATIVE_PATH);
}

export async function persistMrtrSigningKey(
  workspaceRoot: string,
): Promise<string> {
  const path = mrtrKeyPath(workspaceRoot);
  await ensureClosedWorkspaceDirectory(workspaceRoot, "secrets");

  try {
    const stat = await Deno.lstat(path);
    if (!stat.isFile || stat.isSymlink) {
      throw new SidecarFailure(
        "mrtr-key.path-unsafe",
        "The persisted MRTR signing key path is not a regular non-symlink file.",
      );
    }
    if (!samePath(await Deno.realPath(path), path)) {
      throw new SidecarFailure(
        "mrtr-key.path-unsafe",
        "The persisted MRTR signing key resolves through a symlinked path.",
      );
    }
    if (stat.mode === null || (stat.mode & 0o777) !== 0o600) {
      throw new SidecarFailure(
        "mrtr-key.mode-unsafe",
        "The persisted MRTR signing key must already have exact mode 0o600.",
      );
    }
    const existing = (await Deno.readTextFile(path)).trim();
    if (!HEX_KEY.test(existing)) {
      throw new SidecarFailure(
        "mrtr-key.corrupt",
        "The persisted MRTR signing key is not a 32-byte hex secret.",
      );
    }
    return existing;
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }

  const key = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const file = await Deno.open(path, {
    write: true,
    createNew: true,
    mode: 0o600,
  });
  try {
    const bytes = new TextEncoder().encode(`${key}\n`);
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset));
      if (written === 0) {
        throw new SidecarFailure(
          "mrtr-key.write-failed",
          "The MRTR signing key file accepted zero bytes.",
        );
      }
      offset += written;
    }
    await file.sync();
  } finally {
    file.close();
  }
  await Deno.chmod(path, 0o600);
  const persisted = await Deno.lstat(path);
  if (
    !persisted.isFile || persisted.isSymlink || persisted.mode === null ||
    (persisted.mode & 0o777) !== 0o600 ||
    !samePath(await Deno.realPath(path), path)
  ) {
    throw new SidecarFailure(
      "mrtr-key.persist-unsafe",
      "The persisted MRTR signing key did not retain its exact private file contract.",
    );
  }
  return key;
}

function samePath(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalize(left) === normalize(right);
}
