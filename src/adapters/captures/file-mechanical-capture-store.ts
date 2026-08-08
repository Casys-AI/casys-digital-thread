/**
 * Deno I/O implementation of MechanicalCaptureStore.
 *
 * WHY NOT FileCaptureStore — FileCaptureStore is content-addressed: it keys
 * entries by their SHA-256 digest and is idempotent on identical content. The
 * mechanical runner needs the opposite guarantee: it must claim an exclusive
 * write-ahead slot before dispatching any FEA call, so that two concurrent
 * runner instances cannot both succeed and produce diverging captures at the
 * same path. This is a write-ahead-log pattern with OS-level file locking, not
 * a content-addressed append.
 *
 * The port interface (MechanicalCaptureStore) lives in src/domain/cm01/ so
 * executors can reference it without pulling in Deno I/O.
 */

import type { MechanicalCaptureStore } from "../../domain/cm01/coffee-machine-cm01-mechanical-proposal.ts";

/**
 * Write-ahead mechanical capture store backed by OS-level exclusive file locks.
 *
 * Each capture slot has two files:
 *   <path>.lock  — claim token; holds the OS lock while the runner is active.
 *   <path>       — the committed capture JSON; written only after the claim.
 *
 * The persistent `.lock` file is only a rendezvous point; the OS file lock is
 * the claim. A process crash releases that claim automatically, so recovery
 * never depends on an unsafe age-based stale-lock heuristic.
 */
export class FileMechanicalCaptureStore implements MechanicalCaptureStore {
  readonly #claims = new Map<string, Deno.FsFile>();

  async prepare(path: string): Promise<void> {
    if (this.#claims.has(path)) {
      throw new Error(`Mechanical capture is already claimed at ${path}.`);
    }
    await Deno.mkdir(directoryName(path), { recursive: true });
    const claim = await Deno.open(`${path}.lock`, {
      create: true,
      read: true,
      write: true,
    });
    let locked = false;
    try {
      locked = await claim.tryLock(true);
      if (!locked) {
        throw new Error(
          `Mechanical capture is already claimed by another runner at ${path}.`,
        );
      }
      try {
        await Deno.stat(path);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          this.#claims.set(path, claim);
          return;
        }
        throw error;
      }
      throw new Error(`Mechanical capture already exists at ${path}.`);
    } catch (error) {
      if (locked) await claim.unlock();
      claim.close();
      throw error;
    }
  }

  async persist(path: string, contents: string): Promise<void> {
    if (!this.#claims.has(path)) {
      throw new Error(`Mechanical capture has no active claim at ${path}.`);
    }
    await Deno.writeTextFile(path, contents, { createNew: true });
  }

  async release(path: string): Promise<void> {
    const claim = this.#claims.get(path);
    if (!claim) return;
    this.#claims.delete(path);
    try {
      await claim.unlock();
    } finally {
      claim.close();
    }
  }
}

// ── Private helpers ──────────────────────────────────────────────────────────

function directoryName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "." : path.slice(0, index) || "/";
}
