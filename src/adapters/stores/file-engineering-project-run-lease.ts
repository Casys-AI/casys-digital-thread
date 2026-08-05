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
    const path = this.#path(projectId, runId);
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

  #path(projectId: string, runId: string): string {
    nonEmpty(projectId, "projectId");
    nonEmpty(runId, "runId");
    const key = encodeURIComponent(JSON.stringify([projectId, runId]));
    return `${this.#directory}/${key}.lock`;
  }
}

function nonEmpty(value: string, label: string): void {
  if (value.trim() === "") throw new TypeError(`${label} must not be empty`);
}
