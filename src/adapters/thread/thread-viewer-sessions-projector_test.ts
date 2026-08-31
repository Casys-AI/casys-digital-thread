import { assertEquals, assertRejects } from "@std/assert";
import { sha256Fingerprint } from "../../domain/kernel/deterministic-json.ts";
import { GENERIC_THREAD_FIXTURE } from "../../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  isThreadViewerSessionsProjection,
  type ThreadViewerAppBinding,
  type ThreadViewerProjectReviewAnchor,
} from "../../presentation/workbench/thread/viewer-sessions.ts";
import {
  projectThreadViewerSessions,
  type ThreadViewerAppLaunchResolver,
} from "./thread-viewer-sessions-projector.ts";

const BASIS = {
  projectId: "project-generic",
  projectRevision: 12,
  subjectId: "GEN-01",
  thread: { id: GENERIC_THREAD_FIXTURE.id, revision: 1 },
} as const;

const CONTEXT = { ...BASIS, sequence: 7 } as const;

const VERIFIED_LAUNCH_RESOLVER: ThreadViewerAppLaunchResolver = {
  resolve: (request) =>
    Promise.resolve({
      ...structuredClone(request),
      launchUri: "/viewer-apps/build123d/session-a",
    }),
};

Deno.test("viewer sessions emit no inferred native or provider viewer", async () => {
  const projection = await projectThreadViewerSessions(
    CONTEXT,
    structuredClone(GENERIC_THREAD_FIXTURE),
  );

  assertEquals(projection.schemaVersion, "thread-viewer-sessions/2.0");
  assertEquals(projection.basis, BASIS);
  assertEquals(projection.sequence, 7);
  assertEquals(projection.sessions, []);
  assertEquals(
    /^sha256:[a-f0-9]{64}$/.test(projection.projectionFingerprint),
    true,
  );
  assertEquals(isThreadViewerSessionsProjection(projection), true);
});

Deno.test("viewer sessions project one exact registered whole App", async () => {
  const binding = await appBinding();
  assertEquals(
    (await projectThreadViewerSessions(
      CONTEXT,
      structuredClone(GENERIC_THREAD_FIXTURE),
      [binding],
    )).sessions,
    [],
    "a registration without an exact launch attestation stays unavailable",
  );
  const projection = await projectThreadViewerSessions(
    CONTEXT,
    structuredClone(GENERIC_THREAD_FIXTURE),
    [binding],
    VERIFIED_LAUNCH_RESOLVER,
  );

  assertEquals(projection.sessions.length, 1);
  assertEquals(projection.sessions[0], {
    id: projection.sessions[0]?.id,
    kind: "mcp-app",
    anchor: { kind: "artifact", id: "ART-CAD-018" },
    app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
    manifest: {
      uri: "ui://mcp-build123d/app-manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-build123d/results-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 321,
    },
    launchUri: "/viewer-apps/build123d/session-a",
    readResources: binding.readResources,
    session: binding.session,
  });
  assertEquals(/^mcp-app:[a-f0-9]{64}$/.test(projection.sessions[0]!.id), true);
  assertEquals(isThreadViewerSessionsProjection(projection), true);
  assertEquals(
    await projectThreadViewerSessions(
      CONTEXT,
      structuredClone(GENERIC_THREAD_FIXTURE),
      [binding],
      VERIFIED_LAUNCH_RESOLVER,
    ),
    projection,
  );
});

Deno.test("viewer sessions require exact registered basis and graph anchor", async () => {
  const wrongBasis = structuredClone(await appBinding()) as unknown as {
    basis: { projectRevision: number };
  };
  wrongBasis.basis.projectRevision = 13;
  assertEquals(
    (await projectThreadViewerSessions(
      CONTEXT,
      structuredClone(GENERIC_THREAD_FIXTURE),
      [wrongBasis as unknown as ThreadViewerAppBinding],
    )).sessions,
    [],
  );

  const missingAnchor = structuredClone(await appBinding()) as unknown as {
    anchor: { id: string };
  };
  missingAnchor.anchor.id = "lookalike-cad-label";
  assertEquals(
    (await projectThreadViewerSessions(
      CONTEXT,
      structuredClone(GENERIC_THREAD_FIXTURE),
      [missingAnchor as unknown as ThreadViewerAppBinding],
    )).sessions,
    [],
  );

  const labelledSnapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  labelledSnapshot.graph.nodes[0]!.label = "Build123d results viewer";
  assertEquals(
    (await projectThreadViewerSessions(CONTEXT, labelledSnapshot)).sessions,
    [],
  );
});

Deno.test("viewer sessions project nothing from a mismatched Thread revision", async () => {
  const mismatchedSnapshot = structuredClone(GENERIC_THREAD_FIXTURE);
  mismatchedSnapshot.evidenceFamilyGraph.asOf.revision = 2;
  let resolveCalls = 0;
  const resolver: ThreadViewerAppLaunchResolver = {
    resolve(request) {
      resolveCalls += 1;
      return Promise.resolve({
        ...structuredClone(request),
        launchUri: "/viewer-apps/build123d/session-a",
      });
    },
  };

  const projection = await projectThreadViewerSessions(
    CONTEXT,
    mismatchedSnapshot,
    [await appBinding()],
    resolver,
  );

  assertEquals(projection.sessions, []);
  assertEquals(resolveCalls, 0);
});

Deno.test("viewer sessions admit an exact Project review without inventing a Thread", async () => {
  const reviewAnchor: ThreadViewerProjectReviewAnchor = {
    kind: "project-review",
    id: "decision.geometry.review",
    revision: BASIS.projectRevision,
    fingerprint: `sha256:${"e".repeat(64)}`,
  };
  const binding: ThreadViewerAppBinding = {
    ...(await appBinding()),
    basis: {
      projectId: BASIS.projectId,
      projectRevision: BASIS.projectRevision,
      subjectId: BASIS.subjectId,
    },
    anchor: reviewAnchor,
  };
  const context = {
    ...CONTEXT,
    projectReviewAnchors: [reviewAnchor],
  };
  const withThread = await projectThreadViewerSessions(
    context,
    structuredClone(GENERIC_THREAD_FIXTURE),
    [binding],
    VERIFIED_LAUNCH_RESOLVER,
  );
  assertEquals(withThread.sessions.length, 1);
  assertEquals(withThread.sessions[0]?.anchor, binding.anchor);

  const beforeThread = await projectThreadViewerSessions(
    {
      projectId: BASIS.projectId,
      projectRevision: BASIS.projectRevision,
      subjectId: BASIS.subjectId,
      sequence: CONTEXT.sequence,
      projectReviewAnchors: [reviewAnchor],
    },
    undefined,
    [binding],
    VERIFIED_LAUNCH_RESOLVER,
  );
  assertEquals(beforeThread.sessions.length, 1);

  const changedFingerprint: ThreadViewerProjectReviewAnchor = {
    ...reviewAnchor,
    fingerprint: `sha256:${"f".repeat(64)}`,
  };
  assertEquals(
    (await projectThreadViewerSessions(
      { ...CONTEXT, projectReviewAnchors: [changedFingerprint] },
      structuredClone(GENERIC_THREAD_FIXTURE),
      [binding],
      VERIFIED_LAUNCH_RESOLVER,
    )).sessions,
    [],
  );
});

Deno.test("viewer App bindings reject authority, aliases, catalog fragments and caller launches", async () => {
  for (const field of ["providerEndpoint", "credentials", "toolName", "args"]) {
    const invented = structuredClone(await appBinding()) as unknown as Record<
      string,
      unknown
    >;
    invented[field] = field === "args" ? {} : "caller authority";
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [invented as unknown as ThreadViewerAppBinding],
        ),
      TypeError,
      "unsupported contract",
    );
  }

  for (const version of ["latest", "1", "^1.2.3"]) {
    const alias = structuredClone(await appBinding()) as unknown as {
      app: { version: string };
    };
    alias.app.version = version;
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [alias as unknown as ThreadViewerAppBinding],
        ),
      TypeError,
      "unsupported contract",
    );
  }

  const componentCatalog = structuredClone(
    await appBinding(),
  ) as unknown as { resource: { ownership: string } };
  componentCatalog.resource.ownership = "component-catalog";
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        CONTEXT,
        structuredClone(GENERIC_THREAD_FIXTURE),
        [componentCatalog as unknown as ThreadViewerAppBinding],
      ),
    TypeError,
    "unsupported contract",
  );

  for (
    const resource of [
      { ...(await appBinding()).resource, mimeType: "text/html" },
      { ...(await appBinding()).resource, bytes: 32 * 1024 * 1024 + 1 },
    ]
  ) {
    const unsafe = structuredClone(await appBinding()) as unknown as {
      resource: unknown;
    };
    unsafe.resource = resource;
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [unsafe as unknown as ThreadViewerAppBinding],
        ),
      TypeError,
      "unsupported contract",
    );
  }

  const callerLaunch = {
    ...(await appBinding()),
    launchUri: "/viewer-apps/caller-selected",
  } as unknown as ThreadViewerAppBinding;
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        CONTEXT,
        structuredClone(GENERIC_THREAD_FIXTURE),
        [callerLaunch],
        VERIFIED_LAUNCH_RESOLVER,
      ),
    TypeError,
    "unsupported contract",
  );

  for (
    const readResource of [
      { ...(await appBinding()).readResources[0]!, uri: "/assets/latest.glb" },
      {
        ...(await appBinding()).readResources[0]!,
        uri: `/api/thread/assets/${"c".repeat(64)}.glb`,
      },
      {
        ...(await appBinding()).readResources[0]!,
        uri: "https://provider.invalid/result.glb",
      },
      {
        ...(await appBinding()).readResources[0]!,
        bytes: 32 * 1024 * 1024 + 1,
      },
      { ...(await appBinding()).readResources[0]!, mimeType: "not-a-mime" },
    ]
  ) {
    const unsafe = structuredClone(await appBinding()) as unknown as {
      readResources: unknown[];
    };
    unsafe.readResources = [readResource];
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [unsafe as unknown as ThreadViewerAppBinding],
        ),
      TypeError,
      "unsupported contract",
    );
  }
});

Deno.test("viewer App launch resolver must echo exact identities and a safe route", async () => {
  for (
    const launchUri of [
      "https://viewer.example/session",
      "//viewer.example/session",
      "/viewer-apps/latest/session",
      "/viewer-apps/session#provider-token",
      "/viewer-apps/session?providerEndpoint=http%3A%2F%2Finternal",
    ]
  ) {
    const resolver: ThreadViewerAppLaunchResolver = {
      resolve: (request) => Promise.resolve({ ...request, launchUri }),
    };
    const binding = await appBinding();
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [binding],
          resolver,
        ),
      TypeError,
      "unsupported attestation",
    );
  }

  const substituted: ThreadViewerAppLaunchResolver = {
    resolve: (request) =>
      Promise.resolve({
        ...request,
        manifest: {
          ...request.manifest,
          fingerprint: `sha256:${"d".repeat(64)}`,
        },
        launchUri: "/viewer-apps/substituted",
      }),
  };
  const binding = await appBinding();
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        CONTEXT,
        structuredClone(GENERIC_THREAD_FIXTURE),
        [binding],
        substituted,
      ),
    TypeError,
    "unsupported attestation",
  );
});

Deno.test("viewer App session payload is schema-bound and fingerprint-bound", async () => {
  const wrongSchema = structuredClone(await appBinding()) as unknown as {
    session: { schema: string };
  };
  wrongSchema.session.schema = "io.casys.thread.build123d-viewer-session/2.0";
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        CONTEXT,
        structuredClone(GENERIC_THREAD_FIXTURE),
        [wrongSchema as unknown as ThreadViewerAppBinding],
      ),
    TypeError,
    "unsupported contract",
  );

  const changedPayload = structuredClone(await appBinding()) as unknown as {
    session: { payload: { projection: { status: string } } };
  };
  changedPayload.session.payload.projection = { status: "unavailable" };
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        CONTEXT,
        structuredClone(GENERIC_THREAD_FIXTURE),
        [changedPayload as unknown as ThreadViewerAppBinding],
      ),
    TypeError,
    "payload fingerprint does not match",
  );

  const projection = await projectThreadViewerSessions(
    CONTEXT,
    structuredClone(GENERIC_THREAD_FIXTURE),
    [await appBinding()],
    VERIFIED_LAUNCH_RESOLVER,
  );
  const inventedAuthority = structuredClone(projection) as unknown as {
    sessions: Array<Record<string, unknown>>;
  };
  inventedAuthority.sessions[0]!.credentials = { token: "secret" };
  assertEquals(isThreadViewerSessionsProjection(inventedAuthority), false);
});

Deno.test("viewer session arrays are dense and unadorned before fingerprinting", async () => {
  for (const payloadArray of [sparseArray(), adornedArray()]) {
    const binding = await appBinding();
    const payload = binding.session.payload as Record<string, unknown>;
    payload.samples = payloadArray;
    const fingerprint = await sha256Fingerprint(payload);
    const invalid = {
      ...binding,
      session: {
        ...binding.session,
        payload,
        fingerprint: `${fingerprint.algorithm}:${fingerprint.digest}`,
      },
    } as unknown as ThreadViewerAppBinding;
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [invalid],
        ),
      TypeError,
      "unsupported contract",
    );
  }

  for (const readResources of [sparseArray(), adornedArray()]) {
    const binding = {
      ...(await appBinding()),
      readResources,
    } as unknown as ThreadViewerAppBinding;
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          [binding],
        ),
      TypeError,
      "unsupported contract",
    );
  }

  for (const bindings of [sparseArray(), adornedArray()]) {
    await assertRejects(
      () =>
        projectThreadViewerSessions(
          CONTEXT,
          structuredClone(GENERIC_THREAD_FIXTURE),
          bindings as unknown as ThreadViewerAppBinding[],
        ),
      TypeError,
      "dense, unadorned array",
    );
  }

  const valid = await projectThreadViewerSessions(
    CONTEXT,
    structuredClone(GENERIC_THREAD_FIXTURE),
    [await appBinding()],
    VERIFIED_LAUNCH_RESOLVER,
  );
  for (const sessions of [sparseArray(), adornedArray()]) {
    assertEquals(
      isThreadViewerSessionsProjection({ ...valid, sessions }),
      false,
    );
  }
});

Deno.test("viewer sessions require the exact canonical Thread identity", async () => {
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        { ...CONTEXT, sequence: -1 },
        structuredClone(GENERIC_THREAD_FIXTURE),
      ),
    TypeError,
    "non-negative integer",
  );
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        { ...CONTEXT, subjectId: "other-subject" },
        structuredClone(GENERIC_THREAD_FIXTURE),
      ),
    TypeError,
    "does not match",
  );
  await assertRejects(
    () =>
      projectThreadViewerSessions(
        { ...CONTEXT, thread: { id: "other-thread", revision: 1 } },
        structuredClone(GENERIC_THREAD_FIXTURE),
      ),
    TypeError,
    "exact canonical Thread identity",
  );
});

async function appBinding(): Promise<ThreadViewerAppBinding> {
  const payload = {
    schemaVersion: "io.casys.mcp-build123d.recorded-geometry-session/1.0",
    kind: "recorded-canonical-geometry",
    basis: {
      snapshotId: GENERIC_THREAD_FIXTURE.id,
      revision: 1,
    },
    projection: { status: "available", artifactId: "ART-CAD-018" },
  } as const;
  const fingerprint = await sha256Fingerprint(payload);
  return {
    basis: BASIS,
    anchor: { kind: "artifact", id: "ART-CAD-018" },
    app: { id: "io.casys.mcp-build123d.results", version: "1.2.3" },
    manifest: {
      uri: "ui://mcp-build123d/app-manifest",
      fingerprint: `sha256:${"a".repeat(64)}`,
    },
    resource: {
      uri: "ui://mcp-build123d/results-viewer",
      fingerprint: `sha256:${"b".repeat(64)}`,
      ownership: "whole-view",
      mimeType: "text/html;profile=mcp-app",
      bytes: 321,
    },
    readResources: [{
      uri: `/api/thread/viewer-apps/resources/${"c".repeat(64)}`,
      mimeType: "model/gltf-binary",
      bytes: 123,
      fingerprint: `sha256:${"c".repeat(64)}`,
    }],
    session: {
      action: "viewer.session.apply",
      schema: payload.schemaVersion,
      payload,
      fingerprint: `${fingerprint.algorithm}:${fingerprint.digest}`,
    },
  };
}

function sparseArray(): unknown[] {
  const value = new Array<unknown>(1);
  return value;
}

function adornedArray(): unknown[] {
  const value: unknown[] = [];
  Object.defineProperty(value, "authority", {
    enumerable: true,
    value: "must-not-be-ignored",
  });
  return value;
}
