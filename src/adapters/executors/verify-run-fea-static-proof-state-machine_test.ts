/**
 * Couche 1 integration test — FEA static-proof WAL state machine with real
 * file I/O.
 *
 * WHY THIS SUITE EXISTS — the existing `verify-run-fea-static-proof-run-executor_test.ts`
 * used in-memory stubs for all stores. The stub for the project always returned
 * a fixture where `run.startedAt` was already set, masking the bug where
 * `capturedAt` was read from the pre-claim snapshot (where `startedAt` is
 * absent). These tests use a real `FileFeaStaticProofAttemptStore` backed by a
 * temporary directory to exercise the WAL transitions on the actual filesystem.
 *
 * TEMPORALLY CORRECT STUB PRINCIPLE — the existing stubs pre-set `startedAt`
 * on the project fixture even before `claimRun` was called. The tests here
 * validate `requiredStart()` directly to confirm it throws when `startedAt` is
 * absent (the pre-claim state) and succeeds when it is present (the post-claim
 * state). This ensures the executor cannot proceed past the start-timestamp
 * check without a real claim having been recorded.
 *
 * SCOPE — these tests exercise file-level invariants only:
 *  - WAL file creation and durability (link-then-sync / rename-then-sync)
 *  - Correct state transitions: absent → dispatched → solver-recorded → completed
 *  - Terminal error on dispatched (CalculiX may have run; outcome unknown)
 *  - Recovery payload from solver-recorded
 *  - Quarantine blocks subsequent begin calls
 *  - `requiredStart()` throws for a queued run and returns the timestamp post-claim
 *
 * No provider (SysON, build123d, CalculiX) is contacted. No project or snapshot
 * stores are used. The temp directories are cleaned up in each test's `finally`.
 */

import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  EngineeringProjectCommandError,
} from "../../domain/project/engineering-project-command-service.ts";
import { requiredStart } from "./executor-run-helpers.ts";
import {
  FeaStaticProofIllegalTransitionError,
  FeaStaticProofOutcomeUnknownError,
  FeaStaticProofRunQuarantinedError,
  FileFeaStaticProofAttemptStore,
} from "../wal/file-fea-static-proof-attempt-store.ts";

// ── Test constants ────────────────────────────────────────────────────────────

const PROJECT_ID = "project:fea-state-machine-test";
const RUN_ID = "run:fea-sm-001";
const PLAN_DIGEST = "a".repeat(64);
const DISPATCHED_AT = "2026-08-10T12:00:00.000Z";
const VERDICT_FP = "c".repeat(64);
// Canonical solver text must be non-empty; content is opaque to the WAL.
const SOLVER_TEXT = JSON.stringify({
  schemaVersion: "fea-solver-result-capture/1.0",
  trustedRunId: RUN_ID,
  test: true,
});
const SOLVER_FP = await sha256Text(SOLVER_TEXT);

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// ── Temp directory helper ─────────────────────────────────────────────────────

/**
 * Create a unique temporary directory for each test case, returning a cleanup
 * function.  Each test calls `await cleanup()` in its own `finally` block so
 * the temp tree is removed even on failure.
 */
async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await Deno.makeTempDir({ prefix: "fea-sm-test-" });
  return {
    dir,
    cleanup: async () => {
      await Deno.remove(dir, { recursive: true }).catch(() => {
        // Best-effort cleanup — ignore errors on already-removed directories.
      });
    },
  };
}

// ── WAL: begin on a fresh run returns "dispatch" ──────────────────────────────

Deno.test(
  "WAL begin on a fresh run returns action dispatch and creates a durable file",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);
      const result = await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });

      assertStrictEquals(result.action, "dispatch");

      // Verify the file was actually written to disk.
      const attempt = await store.readRun(PROJECT_ID, RUN_ID);
      if (!attempt) throw new Error("WAL file not created after begin.");
      assertStrictEquals(attempt.status, "dispatched");
      assertStrictEquals(attempt.planDigest, PLAN_DIGEST);
      assertStrictEquals(attempt.projectId, PROJECT_ID);
      assertStrictEquals(attempt.runId, RUN_ID);
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: begin on dispatched entry is TERMINAL ────────────────────────────────

Deno.test(
  "WAL begin on a dispatched entry throws FeaStaticProofOutcomeUnknownError (TERMINAL)",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      // First begin — creates the dispatched entry.
      const firstResult = await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });
      assertStrictEquals(firstResult.action, "dispatch");

      // Second begin — must raise FeaStaticProofOutcomeUnknownError.
      // CalculiX may already have run; the server must not dispatch again.
      await assertRejects(
        () =>
          store.begin({
            projectId: PROJECT_ID,
            runId: RUN_ID,
            planDigest: PLAN_DIGEST,
            dispatchedAt: DISPATCHED_AT,
          }),
        FeaStaticProofOutcomeUnknownError,
      );
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: recordSolver advances dispatched → solver-recorded ──────────────────

Deno.test(
  "WAL recordSolver transitions dispatched → solver-recorded and begin returns recovery payload",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });

      await store.recordSolver({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: SOLVER_TEXT,
      });

      const attempt = await store.readRun(PROJECT_ID, RUN_ID);
      if (!attempt) throw new Error("WAL file missing after recordSolver.");
      assertStrictEquals(attempt.status, "solver-recorded");
      if (attempt.status !== "solver-recorded") throw new Error("unreachable");
      assertStrictEquals(attempt.solverCaptureFp, SOLVER_FP);
      assertStrictEquals(attempt.canonicalSolverCaptureText, SOLVER_TEXT);

      // begin again → recovery payload (no CalculiX re-dispatch).
      const recovery = await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });
      assertStrictEquals(recovery.action, "solver-recorded");
      if (recovery.action !== "solver-recorded") throw new Error("unreachable");
      assertStrictEquals(recovery.solverCaptureFp, SOLVER_FP);
      assertStrictEquals(recovery.canonicalSolverCaptureText, SOLVER_TEXT);
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: complete transitions solver-recorded → completed ────────────────────

Deno.test(
  "WAL complete transitions solver-recorded → completed and begin returns completed payload",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });
      await store.recordSolver({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: SOLVER_TEXT,
      });
      await store.complete({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        verdictCaptureFp: VERDICT_FP,
      });

      const attempt = await store.readRun(PROJECT_ID, RUN_ID);
      if (!attempt) throw new Error("WAL file missing after complete.");
      assertStrictEquals(attempt.status, "completed");
      if (attempt.status !== "completed") throw new Error("unreachable");
      assertStrictEquals(attempt.verdictCaptureFp, VERDICT_FP);

      // begin again → completed payload.
      const idempotent = await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });
      assertStrictEquals(idempotent.action, "completed");
      if (idempotent.action !== "completed") throw new Error("unreachable");
      assertStrictEquals(idempotent.verdictCaptureFp, VERDICT_FP);
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: complete from dispatched is an illegal transition ───────────────────

Deno.test(
  "WAL complete called directly from dispatched throws FeaStaticProofIllegalTransitionError",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });

      // complete without recordSolver is illegal.
      await assertRejects(
        () =>
          store.complete({
            projectId: PROJECT_ID,
            runId: RUN_ID,
            planDigest: PLAN_DIGEST,
            verdictCaptureFp: VERDICT_FP,
          }),
        FeaStaticProofIllegalTransitionError,
      );
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: quarantine blocks subsequent begin ───────────────────────────────────

Deno.test(
  "WAL quarantine blocks begin with FeaStaticProofRunQuarantinedError",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      // Quarantine without a prior begin (possible if the executor crashes before
      // WAL begin but after the provider acknowledged — modelled here as a
      // direct quarantine call).
      await store.quarantine({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        quarantinedAt: DISPATCHED_AT,
      });

      assertStrictEquals(await store.isQuarantined(PROJECT_ID, RUN_ID), true);

      await assertRejects(
        () =>
          store.begin({
            projectId: PROJECT_ID,
            runId: RUN_ID,
            planDigest: PLAN_DIGEST,
            dispatchedAt: DISPATCHED_AT,
          }),
        FeaStaticProofRunQuarantinedError,
      );
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: planDigest mismatch on begin is terminal ────────────────────────────

Deno.test(
  "WAL begin with a different planDigest than the existing entry throws FeaStaticProofOutcomeUnknownError",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      // Dispatch with plan A.
      await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });
      await store.recordSolver({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: SOLVER_TEXT,
      });

      // Try to recover with plan B — must raise TERMINAL.
      const differentDigest = "d".repeat(64);
      await assertRejects(
        () =>
          store.begin({
            projectId: PROJECT_ID,
            runId: RUN_ID,
            planDigest: differentDigest,
            dispatchedAt: DISPATCHED_AT,
          }),
        FeaStaticProofOutcomeUnknownError,
      );
    } finally {
      await cleanup();
    }
  },
);

// ── WAL: idempotent recordSolver with identical text ─────────────────────────

Deno.test(
  "WAL recordSolver is idempotent when called twice with identical solver capture text",
  async () => {
    const { dir, cleanup } = await makeTempDir();
    try {
      const store = new FileFeaStaticProofAttemptStore(dir);

      await store.begin({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        dispatchedAt: DISPATCHED_AT,
      });
      await store.recordSolver({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: SOLVER_TEXT,
      });
      // Second identical call must not throw.
      await store.recordSolver({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: SOLVER_TEXT,
      });

      const attempt = await store.readRun(PROJECT_ID, RUN_ID);
      assertStrictEquals(attempt?.status, "solver-recorded");
    } finally {
      await cleanup();
    }
  },
);

// ── requiredStart: throws when startedAt is absent (pre-claim state) ──────────

Deno.test(
  "requiredStart throws EngineeringProjectCommandError when the run has no startedAt",
  () => {
    /**
     * WHY THIS TEST MATTERS — the original bug: `capturedAt = requiredStart(run)` was
     * called on the pre-claim run snapshot where `startedAt` is undefined. The
     * executor then proceeded with an empty timestamp, making the FEA run
     * structurally inexecutable. This test ensures `requiredStart` always
     * throws for a queued run, preventing any downstream logic from receiving
     * a missing timestamp.
     */
    const queuedRun = {
      id: RUN_ID,
      workItemId: "wi:test",
      status: "queued" as const,
      summary: "test run",
      queuedAt: "2026-08-10T12:00:00.000Z",
      startedAt: undefined,
      completedAt: undefined,
      claimedBy: undefined,
      basis: undefined,
      inputFingerprint: undefined,
      evidenceRefs: [],
      resultSnapshot: undefined,
    };

    // requiredStart must throw immediately — no async operation needed.
    let threw = false;
    try {
      // deno-lint-ignore no-explicit-any
      requiredStart(queuedRun as any);
    } catch (error) {
      threw = true;
      if (!(error instanceof EngineeringProjectCommandError)) {
        throw new Error(
          `Expected EngineeringProjectCommandError but got: ${
            error instanceof Error ? error.constructor.name : typeof error
          }`,
        );
      }
      if (error.code !== "invalid_transition") {
        throw new Error(
          `Expected code "invalid_transition" but got: ${error.code}`,
        );
      }
    }
    assertEquals(threw, true, "requiredStart must throw for a queued run.");
  },
);

// ── requiredStart: succeeds after claimRun stamps startedAt ──────────────────

Deno.test(
  "requiredStart returns the ISO timestamp once the run carries startedAt (post-claim state)",
  () => {
    /**
     * The executor reads capturedAt = requiredStart(run) AFTER claimRun has
     * been called and the project re-loaded. This test verifies the happy path
     * so the coupling between claimRun and requiredStart is explicit.
     *
     * A temporally correct stub must set startedAt on the project snapshot it
     * returns after claimRun. Any stub that returns the same project before and
     * after claimRun silently masks the pre-claim / post-claim distinction.
     */
    const startedAt = "2026-08-10T12:01:00.000Z";
    const runningRun = {
      id: RUN_ID,
      workItemId: "wi:test",
      status: "running" as const,
      summary: "test run",
      queuedAt: "2026-08-10T12:00:00.000Z",
      startedAt,
      completedAt: undefined,
      claimedBy: undefined,
      basis: undefined,
      inputFingerprint: undefined,
      evidenceRefs: [],
      resultSnapshot: undefined,
    };

    // deno-lint-ignore no-explicit-any
    const result = requiredStart(runningRun as any);
    assertStrictEquals(result, startedAt);
  },
);
