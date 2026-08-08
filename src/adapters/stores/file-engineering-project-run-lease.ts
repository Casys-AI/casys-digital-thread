/**
 * Mutual exclusion for one durable project run. The file is retained as an
 * empty lock target; the operating system releases an advisory lock if its
 * owning process exits, so no stale lock record can block a later retry.
 */
export interface EngineeringProjectRunLease {
  withLease<T>(
    projectId: string,
    runId: string,
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
    runId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const path = await this.#path(projectId, runId);
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

  async #path(projectId: string, runId: string): Promise<string> {
    nonEmpty(projectId, "projectId");
    nonEmpty(runId, "runId");
    // The former escaped tuple can exceed NAME_MAX for valid 160-character
    // project and run ids. There is deliberately no legacy-path fallback:
    // advisory locks cannot safely span two path schemes. Deployments must
    // restart coordinated lease holders when moving to this key format.
    const key = await sha256Hex(JSON.stringify([projectId, runId]));
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
