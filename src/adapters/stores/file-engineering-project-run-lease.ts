/**
 * Mutual exclusion for one executor-owned project scope. Most executors use a
 * run id; linear generic Thread writers share an exact-basis scope. The file is
 * retained as an empty lock target and the OS releases its advisory lock if the
 * owning process exits, so no stale lock record can block a later retry.
 */
export interface EngineeringProjectRunLease {
  withLease<T>(
    projectId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T>;
}

/**
 * Cross-process lease used only by trusted run executors. It does not own
 * project state, snapshots, or command transitions.
 */
export class FileEngineeringProjectRunLease implements EngineeringProjectRunLease {
  readonly #directory: string;

  constructor(directory = "state/local/engineering-project-run-leases") {
    if (directory.trim() === "") throw new TypeError("directory must not be empty");
    this.#directory = directory;
  }

  async withLease<T>(
    projectId: string,
    scope: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const path = await this.#path(projectId, scope);
    await Deno.mkdir(this.#directory, { recursive: true });
    const file = await Deno.open(path, { create: true, read: true, write: true });
    let locked = false;
    try {
      await file.lock(true);
      locked = true;
      return await operation();
    } finally {
      try {
        if (locked) await file.unlock();
      } finally {
        file.close();
      }
    }
  }

  async #path(projectId: string, scope: string): Promise<string> {
    nonEmpty(projectId, "projectId");
    nonEmpty(scope, "scope");
    // The former escaped tuple can exceed NAME_MAX for valid 160-character
    // project ids and executor scopes. There is deliberately no legacy-path fallback:
    // advisory locks cannot safely span two path schemes. Deployments must
    // restart coordinated lease holders when moving to this key format.
    const key = await sha256Hex(JSON.stringify([projectId, scope]));
    return `${this.#directory}/${key}.lock`;
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

function nonEmpty(value: string, label: string): void {
  if (value.trim() === "") throw new TypeError(`${label} must not be empty`);
}
