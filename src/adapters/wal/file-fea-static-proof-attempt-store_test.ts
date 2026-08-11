import { assertEquals, assertRejects } from "@std/assert";
import {
  FeaStaticProofIllegalTransitionError,
  FeaStaticProofOutcomeUnknownError,
  FileFeaStaticProofAttemptStore,
} from "./file-fea-static-proof-attempt-store.ts";

/** Stable 64-char hex digests used as test fixtures. */
const PLAN_DIGEST = "a".repeat(64);
const PLAN_DIGEST_OTHER = "b".repeat(64);
const SOLVER_FP_OTHER = "d".repeat(64);
const VERDICT_FP = "e".repeat(64);
const CANONICAL_TEXT =
  '{"schemaVersion":"fea-solver-capture/1.0","kind":"static-solve"}';
const SOLVER_FP = await sha256Text(CANONICAL_TEXT);

async function sha256Text(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const IDENTITY = {
  projectId: "inspection-drone-v4",
  runId: "run:fea-static-proof-test-2026-08-10",
};

Deno.test("a fresh FEA static-proof attempt begins as a dispatch", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    const outcome = await store.begin({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      dispatchedAt: "2026-08-10T10:00:00.000Z",
    });
    assertEquals(outcome.action, "dispatch");
    const record = await store.readRun(IDENTITY.projectId, IDENTITY.runId);
    assertEquals(record?.status, "dispatched");
    assertEquals(record?.planDigest, PLAN_DIGEST);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test(
  "begin on an existing dispatched attempt is outcome unknown — CalculiX may already have run",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await assertRejects(
        () =>
          store.begin({
            ...IDENTITY,
            planDigest: PLAN_DIGEST,
            dispatchedAt: "2026-08-10T10:01:00.000Z",
          }),
        FeaStaticProofOutcomeUnknownError,
        "will not be retried automatically",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "begin returns the solver capture on recovery from solver-recorded state",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await store.recordSolver({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      });
      const outcome = await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:02:00.000Z",
      });
      assertEquals(outcome.action, "solver-recorded");
      if (outcome.action === "solver-recorded") {
        assertEquals(outcome.solverCaptureFp, SOLVER_FP);
        assertEquals(outcome.canonicalSolverCaptureText, CANONICAL_TEXT);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "begin returns the full completion payload on recovery from completed state",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await store.recordSolver({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      });
      await store.complete({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        verdictCaptureFp: VERDICT_FP,
      });
      const outcome = await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:03:00.000Z",
      });
      assertEquals(outcome.action, "completed");
      if (outcome.action === "completed") {
        assertEquals(outcome.solverCaptureFp, SOLVER_FP);
        assertEquals(outcome.verdictCaptureFp, VERDICT_FP);
        assertEquals(outcome.canonicalSolverCaptureText, CANONICAL_TEXT);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test("planDigest mismatch on begin is always outcome unknown", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    await store.begin({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      dispatchedAt: "2026-08-10T10:00:00.000Z",
    });
    await store.recordSolver({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      solverCaptureFp: SOLVER_FP,
      canonicalSolverCaptureText: CANONICAL_TEXT,
    });
    // A different planDigest on the same runId must never be silently adopted.
    await assertRejects(
      () =>
        store.begin({
          ...IDENTITY,
          planDigest: PLAN_DIGEST_OTHER,
          dispatchedAt: "2026-08-10T10:04:00.000Z",
        }),
      FeaStaticProofOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("recordSolver advances a dispatched attempt to solver-recorded", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    await store.begin({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      dispatchedAt: "2026-08-10T10:00:00.000Z",
    });
    await store.recordSolver({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      solverCaptureFp: SOLVER_FP,
      canonicalSolverCaptureText: CANONICAL_TEXT,
    });
    const record = await store.readRun(IDENTITY.projectId, IDENTITY.runId);
    assertEquals(record?.status, "solver-recorded");
    if (record?.status === "solver-recorded") {
      assertEquals(record.solverCaptureFp, SOLVER_FP);
      assertEquals(record.canonicalSolverCaptureText, CANONICAL_TEXT);
    }
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test(
  "readRun rejects a shape-valid WAL whose solver fingerprint does not hash its canonical text",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await store.recordSolver({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      });
      const entry = (await Array.fromAsync(Deno.readDir(directory))).find((item) =>
        item.name.startsWith("run-")
      );
      if (!entry) throw new Error("test WAL file missing");
      const path = `${directory}/${entry.name}`;
      const record = JSON.parse(await Deno.readTextFile(path));
      record.solverCaptureFp = "f".repeat(64);
      await Deno.writeTextFile(path, JSON.stringify(record));
      await assertRejects(
        () => store.readRun(IDENTITY.projectId, IDENTITY.runId),
        Error,
        "does not match canonicalSolverCaptureText",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "recordSolver is idempotent when called with identical data on a solver-recorded attempt",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      const solverInput = {
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      };
      await store.recordSolver(solverInput);
      // Second call with identical data must not throw.
      await store.recordSolver(solverInput);
      const record = await store.readRun(IDENTITY.projectId, IDENTITY.runId);
      assertEquals(record?.status, "solver-recorded");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "recordSolver from completed is an illegal transition",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await store.recordSolver({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      });
      await store.complete({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        verdictCaptureFp: VERDICT_FP,
      });
      await assertRejects(
        () =>
          store.recordSolver({
            ...IDENTITY,
            planDigest: PLAN_DIGEST,
            solverCaptureFp: SOLVER_FP_OTHER,
            canonicalSolverCaptureText: CANONICAL_TEXT,
          }),
        FeaStaticProofIllegalTransitionError,
        "completed → solver-recorded",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "complete advances solver-recorded to completed and preserves the canonical solver text",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await store.recordSolver({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      });
      await store.complete({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        verdictCaptureFp: VERDICT_FP,
      });
      const record = await store.readRun(IDENTITY.projectId, IDENTITY.runId);
      assertEquals(record?.status, "completed");
      if (record?.status === "completed") {
        assertEquals(record.solverCaptureFp, SOLVER_FP);
        assertEquals(record.verdictCaptureFp, VERDICT_FP);
        // The canonical text must be conserved verbatim through the transition.
        assertEquals(record.canonicalSolverCaptureText, CANONICAL_TEXT);
      }
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "complete is idempotent when called with identical data on a completed attempt",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await store.recordSolver({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        solverCaptureFp: SOLVER_FP,
        canonicalSolverCaptureText: CANONICAL_TEXT,
      });
      const completeInput = {
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        verdictCaptureFp: VERDICT_FP,
      };
      await store.complete(completeInput);
      // Second call with identical data must not throw.
      await store.complete(completeInput);
      const record = await store.readRun(IDENTITY.projectId, IDENTITY.runId);
      assertEquals(record?.status, "completed");
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test(
  "complete from dispatched is an illegal transition — solver-recorded is required first",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      await assertRejects(
        () =>
          store.complete({
            ...IDENTITY,
            planDigest: PLAN_DIGEST,
            verdictCaptureFp: VERDICT_FP,
          }),
        FeaStaticProofIllegalTransitionError,
        "dispatched → completed",
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test("planDigest mismatch on recordSolver is outcome unknown", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    await store.begin({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      dispatchedAt: "2026-08-10T10:00:00.000Z",
    });
    await assertRejects(
      () =>
        store.recordSolver({
          ...IDENTITY,
          planDigest: PLAN_DIGEST_OTHER,
          solverCaptureFp: SOLVER_FP,
          canonicalSolverCaptureText: CANONICAL_TEXT,
        }),
      FeaStaticProofOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("planDigest mismatch on complete is outcome unknown", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    await store.begin({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      dispatchedAt: "2026-08-10T10:00:00.000Z",
    });
    await store.recordSolver({
      ...IDENTITY,
      planDigest: PLAN_DIGEST,
      solverCaptureFp: SOLVER_FP,
      canonicalSolverCaptureText: CANONICAL_TEXT,
    });
    await assertRejects(
      () =>
        store.complete({
          ...IDENTITY,
          planDigest: PLAN_DIGEST_OTHER,
          verdictCaptureFp: VERDICT_FP,
        }),
      FeaStaticProofOutcomeUnknownError,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test(
  "quarantine marks a run as quarantined and isQuarantined confirms it",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      assertEquals(
        await store.isQuarantined(IDENTITY.projectId, IDENTITY.runId),
        false,
      );
      await store.quarantine({
        ...IDENTITY,
        quarantinedAt: "2026-08-10T10:05:00.000Z",
      });
      assertEquals(
        await store.isQuarantined(IDENTITY.projectId, IDENTITY.runId),
        true,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);

Deno.test("quarantine is idempotent when the same run is quarantined twice", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    await store.quarantine({
      ...IDENTITY,
      quarantinedAt: "2026-08-10T10:05:00.000Z",
    });
    // Second call must not throw.
    await store.quarantine({
      ...IDENTITY,
      quarantinedAt: "2026-08-10T10:06:00.000Z",
    });
    assertEquals(
      await store.isQuarantined(IDENTITY.projectId, IDENTITY.runId),
      true,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("readRun returns undefined for an unknown run", async () => {
  const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
  try {
    const store = new FileFeaStaticProofAttemptStore(directory);
    assertEquals(
      await store.readRun(IDENTITY.projectId, IDENTITY.runId),
      undefined,
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test(
  "a corrupted attempt file is treated as outcome unknown, never as a silent dispatch",
  async () => {
    const directory = await Deno.makeTempDir({ prefix: "casys-fea-wal-" });
    try {
      const store = new FileFeaStaticProofAttemptStore(directory);
      // Write a dispatched record first so the path exists.
      await store.begin({
        ...IDENTITY,
        planDigest: PLAN_DIGEST,
        dispatchedAt: "2026-08-10T10:00:00.000Z",
      });
      // Overwrite the WAL file with invalid JSON.
      const [entry] = [...Deno.readDirSync(directory)];
      await Deno.writeTextFile(`${directory}/${entry.name}`, "{corrupted");
      await assertRejects(
        () =>
          store.begin({
            ...IDENTITY,
            planDigest: PLAN_DIGEST,
            dispatchedAt: "2026-08-10T10:07:00.000Z",
          }),
        FeaStaticProofOutcomeUnknownError,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
);
