import { assertEquals, assertRejects } from "@std/assert";
import {
  HttpThreadViewerSessionsClient,
  shouldAcceptViewerSessionsUpdate,
  type ThreadViewerSessionsProjection,
  viewerSessionsMatchWorkbench,
} from "./src/thread/viewer-sessions-client.ts";

const DIGEST = "a".repeat(64);
const SESSION_ID = `mcp-app:${"b".repeat(64)}`;

Deno.test("viewer-sessions client performs an uncached GET and rejects a non-exact descriptor", async () => {
  const requests: Array<
    { input: string; method?: string; cache?: RequestCache }
  > = [];
  const projection = viewerSessionsProjection();
  const client = new HttpThreadViewerSessionsClient(
    "/api/thread/viewer-sessions",
    undefined,
    (input, init) => {
      requests.push({
        input: String(input),
        method: init?.method,
        cache: init?.cache,
      });
      return Promise.resolve(Response.json(projection));
    },
  );

  assertEquals(await client.load(), projection);
  assertEquals(requests, [{
    input: "/api/thread/viewer-sessions",
    method: "GET",
    cache: "no-store",
  }]);

  const invalid = structuredClone(projection) as unknown as {
    sessions: Array<Record<string, unknown>>;
  };
  invalid.sessions[0]!.interactiveToken = "must-not-enter-the-workbench";
  const invalidClient = new HttpThreadViewerSessionsClient(
    "/api/thread/viewer-sessions",
    undefined,
    () => Promise.resolve(Response.json(invalid)),
  );
  await assertRejects(
    () => invalidClient.load(),
    Error,
    "unsupported contract",
  );
});

Deno.test("viewer-sessions SSE forwards only complete validated replacements", () => {
  const original = globalThis.EventSource;
  try {
    const fake = FakeEventSource.install();
    const received: ThreadViewerSessionsProjection[] = [];
    const client = new HttpThreadViewerSessionsClient(
      "/api/thread/viewer-sessions",
      "/api/thread/viewer-sessions/events",
    );
    const unsubscribe = client.subscribe((projection) => received.push(projection));
    const projection = viewerSessionsProjection(3);
    fake.emit("viewer-sessions", JSON.stringify(projection));
    fake.emit("viewer-sessions", JSON.stringify({ sessions: [] }));

    assertEquals(received, [projection]);
    unsubscribe();
    assertEquals(fake.closed, true);
  } finally {
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: original,
    });
  }
});

Deno.test("viewer-session replacements match the exact Project and evidence Thread tip", () => {
  const projection = viewerSessionsProjection(2);
  const workbench = {
    surface: "evidence" as const,
    project: {
      id: "project/demo:r7",
      revision: 7,
      project: { id: "project/demo", subjectId: "subject/demo" },
    },
    thread: { id: "thread/demo" },
    alignment: { currentThreadRevision: 11 },
  };

  assertEquals(viewerSessionsMatchWorkbench(projection, workbench), true);
  assertEquals(
    viewerSessionsMatchWorkbench(projection, {
      ...workbench,
      project: {
        ...workbench.project,
        project: { ...workbench.project.project, id: "project/lookalike" },
      },
    }),
    false,
  );
  const projectOnly = {
    ...projection,
    basis: {
      projectId: projection.basis.projectId,
      projectRevision: projection.basis.projectRevision,
      subjectId: projection.basis.subjectId,
    },
  };
  assertEquals(
    viewerSessionsMatchWorkbench(projectOnly, {
      surface: "planning",
      project: workbench.project,
    }),
    true,
  );
  assertEquals(
    viewerSessionsMatchWorkbench(projection, {
      surface: "documentary",
      project: workbench.project,
    }),
    true,
  );
  assertEquals(viewerSessionsMatchWorkbench(projectOnly, workbench), false);
  assertEquals(
    viewerSessionsMatchWorkbench(
      { ...projection, basis: { ...projection.basis, projectRevision: 8 } },
      workbench,
    ),
    false,
  );
  assertEquals(
    viewerSessionsMatchWorkbench(
      {
        ...projection,
        basis: {
          ...projection.basis,
          thread: { id: "thread/demo", revision: 12 },
        },
      },
      workbench,
    ),
    false,
  );
  assertEquals(
    shouldAcceptViewerSessionsUpdate(projection, viewerSessionsProjection(3)),
    true,
  );
  assertEquals(
    shouldAcceptViewerSessionsUpdate(viewerSessionsProjection(3), projection),
    false,
  );
  assertEquals(
    shouldAcceptViewerSessionsUpdate(projection, projection),
    false,
  );
  assertEquals(
    shouldAcceptViewerSessionsUpdate(projection, {
      ...projection,
      projectionFingerprint: `sha256:${"d".repeat(64)}`,
    }),
    false,
  );
});

function viewerSessionsProjection(
  sequence = 2,
): ThreadViewerSessionsProjection {
  return {
    schemaVersion: "thread-viewer-sessions/2.0",
    basis: {
      projectId: "project/demo",
      projectRevision: 7,
      subjectId: "subject/demo",
      thread: { id: "thread/demo", revision: 11 },
    },
    sequence,
    projectionFingerprint: `sha256:${"c".repeat(64)}`,
    sessions: [{
      id: SESSION_ID,
      kind: "mcp-app",
      anchor: { kind: "part-definition", id: "part/hull" },
      app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
      manifest: {
        uri: "ui://mcp-build123d/app-manifest",
        fingerprint: `sha256:${DIGEST}`,
      },
      resource: {
        uri: "ui://mcp-build123d/results-viewer",
        fingerprint: `sha256:${"e".repeat(64)}`,
        ownership: "whole-view",
        mimeType: "text/html;profile=mcp-app",
        bytes: 321,
      },
      launchUri: "/viewer-apps/build123d/session-a",
      readResources: [],
      session: {
        action: "viewer.session.apply",
        schema: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
        payload: {
          schemaVersion: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
          projection: { status: "unavailable" },
        },
        fingerprint: `sha256:${"f".repeat(64)}`,
      },
    }],
  };
}

class FakeEventSource {
  static latest: FakeEventSource | undefined;

  readonly #listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  closed = false;

  constructor(_url: string) {
    FakeEventSource.latest = this;
  }

  static install(): FakeEventSource {
    Object.defineProperty(globalThis, "EventSource", {
      configurable: true,
      value: FakeEventSource,
    });
    return new Proxy({} as FakeEventSource, {
      get(_target, property) {
        const source = FakeEventSource.latest;
        if (!source) {
          throw new Error("Expected the client to create EventSource.");
        }
        const value = Reflect.get(source, property);
        return typeof value === "function" ? value.bind(source) : value;
      },
    });
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent) => void,
  ): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: string): void {
    for (const listener of this.#listeners.get(type) ?? []) {
      listener(new MessageEvent(type, { data }));
    }
  }
}
