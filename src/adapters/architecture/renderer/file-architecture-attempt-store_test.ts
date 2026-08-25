import { assertEquals, assertRejects } from "@std/assert";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import {
  architectureWriteSelector,
  type InsertionItem,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";
import type { SysmlSourceAnalysisReference } from "./sysml-source-analysis-capture.ts";
import {
  ArchitectureWriteOutcomeUnknownError,
  architectureWritePlanDigest,
  FileArchitectureAttemptStore,
} from "./file-architecture-attempt-store.ts";

const AT = "2026-08-08T12:00:00.000Z";
const ID = { projectId: "project:architecture", runId: "run:architecture" };
const PACKAGE_ID = "architecture-package-001";
const PACKAGE_NAME = "DroneV4";
const FULL_PACKAGE_ITEMS = [{ kind: "full-package" }] as const;

function sourceReference(options: {
  readonly selector?: SysmlSourceAnalysisReference["selector"];
  readonly runId?: string;
  readonly operation?: SysmlSourceAnalysisReference["operation"];
  readonly fingerprintDigit?: string;
  readonly sourceSuffix?: string;
} = {}): SysmlSourceAnalysisReference {
  const digit = options.fingerprintDigit ?? "a";
  return {
    sourceId: `sysml-source:${options.sourceSuffix ?? digit}`,
    selector: options.selector ?? {
      kind: "full-package",
      packageName: PACKAGE_NAME,
    },
    runId: options.runId ?? ID.runId,
    operation: options.operation ?? {
      id: "model.write-architecture",
      version: "1",
    },
    sourceFingerprint: { algorithm: "sha256", digest: digit.repeat(64) },
    sourceCaptureFingerprint: { algorithm: "sha256", digest: "c".repeat(64) },
    analysisFingerprint: { algorithm: "sha256", digest: "d".repeat(64) },
  };
}

async function input(options: {
  readonly projectId?: string;
  readonly runId?: string;
  readonly packageName?: string;
  readonly items?: readonly InsertionItem[];
  readonly sourceAnalyses?: readonly SysmlSourceAnalysisReference[];
  readonly fingerprintDigit?: string;
} = {}) {
  const projectId = options.projectId ?? ID.projectId;
  const runId = options.runId ?? ID.runId;
  const packageName = options.packageName ?? PACKAGE_NAME;
  const items = options.items ?? FULL_PACKAGE_ITEMS;
  const sourceAnalyses = options.sourceAnalyses ??
    items.map((item, index) =>
      sourceReference({
        selector: architectureWriteSelector(item, packageName),
        runId,
        fingerprintDigit: options.fingerprintDigit,
        sourceSuffix: `${options.fingerprintDigit ?? "a"}-${index}`,
      })
    );
  return {
    projectId,
    runId,
    packageName,
    items,
    sourceAnalyses,
    planDigest: await architectureWritePlanDigest({
      packageName,
      items,
      sourceAnalyses,
    }),
    dispatchedAt: AT,
  };
}

function completion(planDigest: string) {
  return { ...ID, planDigest, architecturePackageId: PACKAGE_ID };
}

async function withStore(
  body: (directory: string, store: FileArchitectureAttemptStore) => Promise<void>,
): Promise<void> {
  const directory = await Deno.makeTempDir({ prefix: "casys-architecture-wal-" });
  try {
    await body(directory, new FileArchitectureAttemptStore(directory));
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
}

Deno.test("architecture WAL permits exactly one plan digest for a run", async () => {
  await withStore(async (_directory, store) => {
    const first = await input();
    assertEquals(await store.begin(first), { action: "dispatch" });
    await store.complete(completion(first.planDigest));

    // A changed live preflight must recover from the original acknowledged
    // mutation instead of opening a second dispatch for this run.
    const changed = await input({ fingerprintDigit: "b" });
    assertEquals(await store.begin(changed), {
      action: "completed",
      architecturePackageId: PACKAGE_ID,
    });
    assertEquals(await store.readRun(ID.projectId, ID.runId), {
      schemaVersion: "architecture-write-attempt/3.0",
      ...ID,
      packageName: PACKAGE_NAME,
      items: FULL_PACKAGE_ITEMS,
      sourceAnalyses: first.sourceAnalyses,
      planDigest: first.planDigest,
      status: "completed",
      dispatchedAt: AT,
      result: { inserted: "true", architecturePackageId: PACKAGE_ID },
    });
  });
});

Deno.test("architecture WAL blocks a changed plan after a dispatched crash", async () => {
  await withStore(async (_directory, store) => {
    assertEquals(await store.begin(await input()), { action: "dispatch" });
    await assertRejects(
      async () => await store.begin(await input({ fingerprintDigit: "b" })),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture WAL atomically elects one concurrent identical dispatcher", async () => {
  await withStore(async (directory) => {
    const first = new FileArchitectureAttemptStore(directory);
    const second = new FileArchitectureAttemptStore(directory);
    const exactInput = await input();
    const results = await Promise.allSettled([
      first.begin(exactInput),
      second.begin(exactInput),
    ]);
    assertEquals(
      results.filter((result) =>
        result.status === "fulfilled" && result.value.action === "dispatch"
      ).length,
      1,
    );
    assertEquals(
      results.filter((result) =>
        result.status === "rejected" &&
        result.reason instanceof ArchitectureWriteOutcomeUnknownError
      ).length,
      1,
    );
    const names = await Array.fromAsync(Deno.readDir(directory));
    assertEquals(names.some((entry) => entry.name.endsWith(".tmp")), false);
  });
});

Deno.test("architecture WAL keeps final filenames bounded for long run identities", async () => {
  await withStore(async (directory, store) => {
    const long = "x".repeat(1_000);
    const longProjectId = `project:${long}`;
    await store.begin(await input({ projectId: longProjectId }));
    const names: string[] = [];
    for await (const entry of Deno.readDir(directory)) names.push(entry.name);
    assertEquals(names.length, 1);
    assertEquals(names[0]!.startsWith("run-"), true);
    assertEquals(new TextEncoder().encode(names[0]!).length <= 255, true);
    assertEquals(
      (await store.readRun(longProjectId, ID.runId))?.status,
      "dispatched",
    );
  });
});

Deno.test("architecture WAL treats a torn run record as unknown, not dispatchable", async () => {
  await withStore(async (directory, store) => {
    const exactInput = await input();
    await store.begin(exactInput);
    const [entry] = [
      ...(await Array.fromAsync(Deno.readDir(directory))),
    ];
    await Deno.writeTextFile(`${directory}/${entry!.name}`, "{");
    await assertRejects(
      () => store.begin(exactInput),
      ArchitectureWriteOutcomeUnknownError,
    );
  });
});

Deno.test("architecture WAL production begin rejects missing or foreign source evidence", async () => {
  await withStore(async (_directory, store) => {
    const exactInput = await input();
    await assertRejects(
      () => store.begin({ ...exactInput, sourceAnalyses: [] }),
      Error,
      "one or more SysML sources",
    );

    for (
      const foreignReference of [
        sourceReference({ runId: "run:foreign" }),
        sourceReference({
          operation: { id: "model.write-requirements", version: "1" },
        }),
        sourceReference({
          selector: { kind: "full-package", packageName: "ForeignPackage" },
        }),
      ]
    ) {
      const sourceAnalyses = [foreignReference];
      const planDigest = await architectureWritePlanDigest({
        packageName: PACKAGE_NAME,
        items: FULL_PACKAGE_ITEMS,
        sourceAnalyses,
      });
      await assertRejects(() =>
        store.begin({
          ...exactInput,
          sourceAnalyses,
          planDigest,
        })
      );
    }
  });
});

Deno.test(
  "architecture WAL seals one leading full-package write with ordered fallback statements",
  async () => {
    await withStore(async (_directory, store) => {
      const items = [
        { kind: "full-package" },
        { kind: "part-def", componentName: "DroneSystem" },
        { kind: "part-def", componentName: "Wing" },
        {
          kind: "usage",
          componentName: "Wing",
          usageName: "wing",
          parentName: "DroneSystem",
        },
      ] as const;
      const exact = await input({ items });
      assertEquals(await store.begin(exact), { action: "dispatch" });
      const reopened = await store.readRun(ID.projectId, ID.runId);
      assertEquals(reopened?.items, items);
      assertEquals(reopened?.sourceAnalyses, exact.sourceAnalyses);
      assertEquals(
        reopened?.sourceAnalyses.map((reference) => reference.selector),
        items.map((item) => architectureWriteSelector(item, PACKAGE_NAME)),
      );
    });
  },
);

Deno.test("architecture WAL requires exact ordered selector coverage", async () => {
  await withStore(async (_directory, store) => {
    const items = [
      { kind: "part-def", componentName: "Wing" },
      {
        kind: "usage",
        componentName: "Wing",
        usageName: "wing",
        parentName: "InspectionDrone",
      },
    ] as const;
    const ordered = items.map((item, index) =>
      sourceReference({
        selector: architectureWriteSelector(item, PACKAGE_NAME),
        sourceSuffix: `ordered-${index}`,
      })
    );
    const sourceAnalyses = [...ordered].reverse();
    const planDigest = await architectureWritePlanDigest({
      packageName: PACKAGE_NAME,
      items,
      sourceAnalyses,
    });
    await assertRejects(
      () =>
        store.begin({
          ...ID,
          packageName: PACKAGE_NAME,
          items,
          sourceAnalyses,
          planDigest,
          dispatchedAt: AT,
        }),
      Error,
      "ordered write items",
    );
  });
});

Deno.test("architecture WAL read rejects tampered v3 context and plan", async () => {
  for (
    const mutate of [
      (record: Record<string, unknown>) => {
        const [reference] = record.sourceAnalyses as Record<string, unknown>[];
        reference!.runId = "run:foreign";
      },
      (record: Record<string, unknown>) => {
        const [reference] = record.sourceAnalyses as Record<string, unknown>[];
        reference!.operation = { id: "model.write-requirements", version: "1" };
      },
      (record: Record<string, unknown>) => {
        record.planDigest = "f".repeat(64);
      },
    ]
  ) {
    await withStore(async (directory, store) => {
      await store.begin(await input());
      const [entry] = await Array.fromAsync(Deno.readDir(directory));
      const path = `${directory}/${entry!.name}`;
      const record = JSON.parse(await Deno.readTextFile(path)) as Record<
        string,
        unknown
      >;
      mutate(record);
      await Deno.writeTextFile(path, `${deterministicJson(record)}\n`);
      await assertRejects(() => store.readRun(ID.projectId, ID.runId));
    });
  }
});

Deno.test("architecture WAL parser rejects v1 and v2 attempt records", async () => {
  for (
    const schemaVersion of [
      "architecture-write-attempt/1.0",
      "architecture-write-attempt/2.0",
    ]
  ) {
    await withStore(async (directory, store) => {
      const exactInput = await input();
      await store.begin(exactInput);
      const [entry] = await Array.fromAsync(Deno.readDir(directory));
      const path = `${directory}/${entry!.name}`;
      const record = JSON.parse(await Deno.readTextFile(path)) as Record<
        string,
        unknown
      >;
      record.schemaVersion = schemaVersion;
      if (schemaVersion === "architecture-write-attempt/2.0") {
        delete record.items;
        delete record.packageName;
        delete record.sourceAnalyses;
      }
      await Deno.writeTextFile(path, `${deterministicJson(record)}\n`);
      await assertRejects(() => store.readRun(ID.projectId, ID.runId));
      await assertRejects(
        () => store.begin(exactInput),
        ArchitectureWriteOutcomeUnknownError,
      );
    });
  }
});

Deno.test("architecture quarantine validates an EEXIST sentinel before trusting it", async () => {
  await withStore(async (directory, store) => {
    await Promise.all([
      store.quarantine({ ...ID, quarantinedAt: AT }),
      store.quarantine({ ...ID, quarantinedAt: AT }),
    ]);
    assertEquals(await store.isQuarantined(ID.projectId, ID.runId), true);

    const entries = await Array.fromAsync(Deno.readDir(directory));
    const marker = entries.find((entry) => entry.name.startsWith("quarantine-"));
    await Deno.writeTextFile(`${directory}/${marker!.name}`, "{}");
    await assertRejects(() => store.isQuarantined(ID.projectId, ID.runId));
  });
});

Deno.test("architecture WAL ignores leftover per-plan filenames and uses only run-scoped paths", async () => {
  await withStore(async (directory, store) => {
    await Deno.writeTextFile(
      `${directory}/${
        encodeURIComponent(JSON.stringify([
          ID.projectId,
          ID.runId,
          "a".repeat(64),
        ]))
      }.json`,
      `${
        deterministicJson({
          schemaVersion: "architecture-write-attempt/1.0",
          ...ID,
          planDigest: "a".repeat(64),
          status: "completed",
          dispatchedAt: AT,
          result: { inserted: "true" },
        })
      }\n`,
    );
    const exactInput = await input();
    assertEquals(await store.begin(exactInput), { action: "dispatch" });
    assertEquals(
      (await store.readRun(ID.projectId, ID.runId))?.schemaVersion,
      "architecture-write-attempt/3.0",
    );
  });
});
