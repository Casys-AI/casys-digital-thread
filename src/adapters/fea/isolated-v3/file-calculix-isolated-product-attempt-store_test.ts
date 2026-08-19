import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  CalculixIsolatedProductAttemptIntegrityError,
  FileCalculixIsolatedProductAttemptStore,
} from "./file-calculix-isolated-product-attempt-store.ts";

const AT = "2026-08-14T05:00:00.000Z";
const EVALUATION_AT = "2026-08-14T05:00:01.000Z";
const EVIDENCE_SHA256 = "4".repeat(64);
const EVALUATION_SHA256 = "5".repeat(64);

const IDENTITY = {
  projectId: "project-calculix-v3",
  runId: "run-calculix-v3",
  planSha256: "1".repeat(64),
  executionRunId: "calculix-execution-v3",
  bundleSha256: "2".repeat(64),
  profileSha256: "3".repeat(64),
  preparedAt: AT,
} as const;

const EVALUATION_CAPTURE = {
  uri: `casys://calculix-isolated-syson-evaluation/sha256/${EVALUATION_SHA256}`,
  byteCount: 321,
  sha256: EVALUATION_SHA256,
} as const;

const SNAPSHOT = {
  snapshotId: "thread-snapshot-calculix-v3",
  revision: 7,
  subjectId: "subject-calculix-v3",
} as const;

Deno.test(
  "CalculiX product WAL follows its five exact durable phases and replays each transition idempotently",
  async () => {
    await withStore(async (store, directory, boundary) => {
      const prepared = await store.begin(IDENTITY);
      assertEquals(prepared.status, "prepared");
      assertEquals(await store.begin(IDENTITY), prepared);

      const evidenceCaptured = await store.recordEvidence({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evidenceSha256: EVIDENCE_SHA256,
      });
      assertEquals(evidenceCaptured.status, "evidence-captured");
      assertEquals(
        await store.recordEvidence({
          projectId: IDENTITY.projectId,
          runId: IDENTITY.runId,
          evidenceSha256: EVIDENCE_SHA256,
        }),
        evidenceCaptured,
      );

      const evaluationDispatched = await store.markEvaluationDispatched({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evaluationDispatchedAt: EVALUATION_AT,
      });
      assertEquals(evaluationDispatched.status, "evaluation-dispatched");
      assertEquals(
        await store.markEvaluationDispatched({
          projectId: IDENTITY.projectId,
          runId: IDENTITY.runId,
          evaluationDispatchedAt: EVALUATION_AT,
        }),
        evaluationDispatched,
      );

      const restarted = new FileCalculixIsolatedProductAttemptStore(
        directory,
        boundary,
      );
      assertEquals(
        await restarted.read(IDENTITY.projectId, IDENTITY.runId),
        evaluationDispatched,
      );

      const evaluationCaptured = await restarted.recordEvaluation({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evaluationCapture: EVALUATION_CAPTURE,
      });
      assertEquals(evaluationCaptured.status, "evaluation-captured");
      assertEquals(
        await restarted.recordEvaluation({
          projectId: IDENTITY.projectId,
          runId: IDENTITY.runId,
          evaluationCapture: EVALUATION_CAPTURE,
        }),
        evaluationCaptured,
      );

      const completed = await restarted.complete({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        snapshot: SNAPSHOT,
      });
      assertEquals(completed.status, "completed");
      assertEquals(
        await restarted.complete({
          projectId: IDENTITY.projectId,
          runId: IDENTITY.runId,
          snapshot: SNAPSHOT,
        }),
        completed,
      );
      assertEquals(
        await new FileCalculixIsolatedProductAttemptStore(directory, boundary)
          .read(IDENTITY.projectId, IDENTITY.runId),
        completed,
      );

      const path = await store.pathFor(IDENTITY.projectId, IDENTITY.runId);
      assertEquals(
        await Deno.readTextFile(path),
        `${deterministicJson(completed)}\n`,
      );
      if (Deno.build.os !== "windows") {
        assertEquals((await Deno.stat(directory)).mode! & 0o777, 0o700);
      }
    });
  },
);

Deno.test(
  "CalculiX product WAL refuses every phase skip before the durable SysON dispatch intent",
  async () => {
    await withStore(async (store) => {
      await assertRejects(
        () =>
          store.recordEvidence({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evidenceSha256: EVIDENCE_SHA256,
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "missing",
      );
      await store.begin(IDENTITY);
      await assertRejects(
        () =>
          store.markEvaluationDispatched({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evaluationDispatchedAt: EVALUATION_AT,
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "cannot precede durable local CalculiX evidence",
      );
      await assertRejects(
        () =>
          store.recordEvaluation({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evaluationCapture: EVALUATION_CAPTURE,
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "cannot precede its durable dispatch intent",
      );
      await assertRejects(
        () =>
          store.complete({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            snapshot: SNAPSHOT,
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "cannot complete before the SysON capture",
      );

      await store.recordEvidence({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evidenceSha256: EVIDENCE_SHA256,
      });
      await assertRejects(
        () =>
          store.recordEvaluation({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evaluationCapture: EVALUATION_CAPTURE,
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "cannot precede its durable dispatch intent",
      );
      await store.markEvaluationDispatched({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evaluationDispatchedAt: EVALUATION_AT,
      });
      await assertRejects(
        () =>
          store.complete({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            snapshot: SNAPSHOT,
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "cannot complete before the SysON capture",
      );
    });
  },
);

Deno.test(
  "CalculiX product WAL preserves a SysON dispatch with lost acknowledgement across restart",
  async () => {
    await withStore(async (store, directory, boundary) => {
      await store.begin(IDENTITY);
      await store.recordEvidence({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evidenceSha256: EVIDENCE_SHA256,
      });
      const dispatched = await store.markEvaluationDispatched({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evaluationDispatchedAt: EVALUATION_AT,
      });

      const restarted = new FileCalculixIsolatedProductAttemptStore(
        directory,
        boundary,
      );
      const recovered = await restarted.begin(IDENTITY);
      assertEquals(recovered, dispatched);
      assertEquals(recovered.status, "evaluation-dispatched");
      assert(
        recovered.status !== "evidence-captured",
        "a lost SysON acknowledgement must never reopen oracle dispatch authority",
      );
      assertEquals(
        await restarted.markEvaluationDispatched({
          projectId: IDENTITY.projectId,
          runId: IDENTITY.runId,
          evaluationDispatchedAt: EVALUATION_AT,
        }),
        recovered,
      );
      await assertRejects(
        () =>
          restarted.markEvaluationDispatched({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evaluationDispatchedAt: "2026-08-14T05:00:02.000Z",
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "timestamp conflicts",
      );
    });
  },
);

Deno.test(
  "CalculiX product WAL binds the exact plan execution bundle and profile identity",
  async () => {
    await withStore(async (store) => {
      await store.begin(IDENTITY);
      for (
        const drift of [
          { planSha256: "a".repeat(64) },
          { executionRunId: "calculix-execution-foreign" },
          { bundleSha256: "b".repeat(64) },
          { profileSha256: "c".repeat(64) },
        ]
      ) {
        await assertRejects(
          () => store.begin({ ...IDENTITY, ...drift }),
          CalculixIsolatedProductAttemptIntegrityError,
          "binds another execution",
        );
      }

      const path = await store.pathFor(IDENTITY.projectId, IDENTITY.runId);
      const original = await Deno.readTextFile(path);
      const foreignProject = {
        ...JSON.parse(original),
        projectId: "project-calculix-foreign",
      };
      await Deno.writeTextFile(
        path,
        `${deterministicJson(foreignProject)}\n`,
      );
      await assertRejects(
        () => store.read(IDENTITY.projectId, IDENTITY.runId),
        CalculixIsolatedProductAttemptIntegrityError,
        "foreign identity",
      );
    });
  },
);

Deno.test(
  "CalculiX product WAL rejects divergent replay values even after later phases",
  async () => {
    await withStore(async (store) => {
      await store.begin(IDENTITY);
      await store.recordEvidence({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evidenceSha256: EVIDENCE_SHA256,
      });
      await store.markEvaluationDispatched({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evaluationDispatchedAt: EVALUATION_AT,
      });
      await store.recordEvaluation({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        evaluationCapture: EVALUATION_CAPTURE,
      });
      const completed = await store.complete({
        projectId: IDENTITY.projectId,
        runId: IDENTITY.runId,
        snapshot: SNAPSHOT,
      });

      assertEquals(
        await store.recordEvidence({
          projectId: IDENTITY.projectId,
          runId: IDENTITY.runId,
          evidenceSha256: EVIDENCE_SHA256,
        }),
        completed,
      );
      await assertRejects(
        () =>
          store.recordEvidence({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evidenceSha256: "6".repeat(64),
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "evidence conflicts",
      );
      await assertRejects(
        () =>
          store.recordEvaluation({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            evaluationCapture: {
              ...EVALUATION_CAPTURE,
              byteCount: EVALUATION_CAPTURE.byteCount + 1,
            },
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "capture conflicts",
      );
      await assertRejects(
        () =>
          store.complete({
            projectId: IDENTITY.projectId,
            runId: IDENTITY.runId,
            snapshot: { ...SNAPSHOT, revision: SNAPSHOT.revision + 1 },
          }),
        CalculixIsolatedProductAttemptIntegrityError,
        "names another snapshot",
      );
    });
  },
);

Deno.test(
  "CalculiX product WAL rejects noncanonical corrupted and over-specified records",
  async () => {
    await withStore(async (store) => {
      const prepared = await store.begin(IDENTITY);
      const path = await store.pathFor(IDENTITY.projectId, IDENTITY.runId);
      const canonical = `${deterministicJson(prepared)}\n`;

      await Deno.writeTextFile(path, `${JSON.stringify(prepared, null, 2)}\n`);
      await assertRejects(
        () => store.read(IDENTITY.projectId, IDENTITY.runId),
        CalculixIsolatedProductAttemptIntegrityError,
        "not canonical",
      );

      await Deno.writeTextFile(path, "{");
      await assertRejects(
        () => store.read(IDENTITY.projectId, IDENTITY.runId),
        CalculixIsolatedProductAttemptIntegrityError,
        "not JSON",
      );

      const overSpecified = { ...prepared, providerRunId: "forbidden" };
      await Deno.writeTextFile(
        path,
        `${deterministicJson(overSpecified)}\n`,
      );
      await assertRejects(
        () => store.read(IDENTITY.projectId, IDENTITY.runId),
        TypeError,
        "unsupported field providerRunId",
      );

      await Deno.writeTextFile(path, canonical);
      assertEquals(
        await store.read(IDENTITY.projectId, IDENTITY.runId),
        prepared,
      );
    });
  },
);

Deno.test(
  "CalculiX product WAL validates its sync boundary before creating any private file",
  async () => {
    const root = await Deno.makeTempDir({
      prefix: "casys-calculix-product-wal-boundary-",
    });
    try {
      const directory = `${root}/attempts`;
      const foreignBoundary = `${root}/foreign`;
      assertThrows(
        () =>
          new FileCalculixIsolatedProductAttemptStore(
            directory,
            foreignBoundary,
          ),
        TypeError,
        "must contain",
      );
      await assertRejects(() => Deno.stat(directory), Deno.errors.NotFound);

      const store = new FileCalculixIsolatedProductAttemptStore(directory, root);
      const prepared = await store.begin(IDENTITY);
      assertEquals(prepared.status, "prepared");
      assert((await Deno.stat(directory)).isDirectory);
      assert(
        (await Deno.stat(
          await store.pathFor(
            IDENTITY.projectId,
            IDENTITY.runId,
          ),
        )).isFile,
      );
    } finally {
      await Deno.remove(root, { recursive: true });
    }
  },
);

async function withStore(
  body: (
    store: FileCalculixIsolatedProductAttemptStore,
    directory: string,
    boundary: string,
  ) => Promise<void>,
): Promise<void> {
  const boundary = await Deno.makeTempDir({
    prefix: "casys-calculix-product-wal-",
  });
  const directory = `${boundary}/attempts`;
  try {
    await body(
      new FileCalculixIsolatedProductAttemptStore(directory, boundary),
      directory,
      boundary,
    );
  } finally {
    await Deno.remove(boundary, { recursive: true });
  }
}
