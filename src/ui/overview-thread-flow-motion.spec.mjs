import assertStrict from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const assert = (value) => assertStrict.ok(value);
const assertEquals = (actual, expected) =>
  assertStrict.deepStrictEqual(actual, expected);
const assertAlmostEquals = (actual, expected, tolerance) =>
  assertStrict.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} differs from ${expected} by more than ${tolerance}`,
  );

const uiRoot = dirname(fileURLToPath(import.meta.url));
const vite = await createServer({
  root: uiRoot,
  configFile: resolve(uiRoot, "vite.native.config.ts"),
  appType: "custom",
  logLevel: "silent",
  server: {
    middlewareMode: true,
    hmr: false,
    ws: false,
    watch: null,
  },
});
let loadedMotionModule;
try {
  loadedMotionModule = await vite.ssrLoadModule(
    "/src/project/overview-thread-d3-flow.tsx",
  );
} finally {
  await vite.close();
}

const {
  advanceOverviewFlowMotionScalar,
  overviewFlowMotionPath,
  OverviewFlowMotionScene,
  overviewFlowMotionTopologySignature,
} = loadedMotionModule;

test("flow motion preserves velocity when a live cable retargets", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }],
  })], false);
  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 90, y: 30 }, { x: 140, y: 0 }],
  })], false);
  scene.advance(1_000 / 60);

  const beforeRetarget = onlyVisual(scene);
  const movingPoint = beforeRetarget.points[1];
  assert(movingPoint.vx > 0);
  assert(movingPoint.vy > 0);

  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 130, y: 55 }, { x: 180, y: 0 }],
  })], false);
  const immediatelyAfterRetarget = onlyVisual(scene).points[1];
  assertEquals(immediatelyAfterRetarget.vx, movingPoint.vx);
  assertEquals(immediatelyAfterRetarget.vy, movingPoint.vy);

  scene.advance(1_000 / 60);
  const afterFrame = onlyVisual(scene).points[1];
  assert(afterFrame.x > movingPoint.x);
  assert(afterFrame.y > movingPoint.y);
});

test("retargeted cable controls never overshoot their safe coordinate channel", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
  })], false);
  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 95, y: 0 }, { x: 100, y: 0 }],
  })], false);
  scene.advance(1_000 / 60);
  const moving = onlyVisual(scene).points[1];
  assert(moving.vx > 0);

  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 100, y: 0 }],
  })], false);
  assertEquals(onlyVisual(scene).points[1].vx, moving.vx);
  scene.advance(1_000 / 60);
  const clamped = onlyVisual(scene).points[1];
  assert(clamped.x <= moving.x);
  assert(clamped.x >= 20);

  advanceUntilSettled(scene);
  assertEquals(onlyVisual(scene).points[1].x, 20);
});

test("flow motion pins both live endpoints while only cable interiors settle", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    points: [
      { x: 0, y: 0 },
      { x: 35, y: 5 },
      { x: 65, y: 5 },
      { x: 100, y: 0 },
    ],
  })], false);
  scene.reconcile([motionTarget({
    points: [
      { x: 20, y: 12 },
      { x: 55, y: 18 },
      { x: 85, y: 18 },
      { x: 120, y: 12 },
    ],
    pinEndpoints: true,
  })], false);

  const immediate = onlyVisual(scene);
  assertEquals(immediate.points[0], { x: 20, y: 12, vx: 0, vy: 0 });
  assertEquals(immediate.points.at(-1), { x: 120, y: 12, vx: 0, vy: 0 });
  assertEquals(immediate.points[1].x, 35);

  scene.advance(1_000 / 60);
  const afterFrame = onlyVisual(scene);
  assertEquals(afterFrame.points[0], { x: 20, y: 12, vx: 0, vy: 0 });
  assertEquals(afterFrame.points.at(-1), {
    x: 120,
    y: 12,
    vx: 0,
    vy: 0,
  });
  assert(afterFrame.points[1].x > 35);
  assert(afterFrame.points[1].x < 55);
});

test("flow motion cross-fades incompatible segment kinds and arities", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    kind: "bundle-trunk",
    points: [{ x: 0, y: 0 }, { x: 50, y: 20 }, { x: 100, y: 0 }],
  })], false);
  scene.reconcile([motionTarget({
    kind: "pair-feeder",
    points: [{ x: 10, y: 4 }, { x: 110, y: 14 }],
  })], false);

  const initial = scene.snapshot();
  assertEquals(initial.length, 2);
  assertEquals(
    initial.find((visual) => visual.phase === "exiting")?.presence,
    1,
  );
  assertEquals(
    initial.find((visual) => visual.phase === "active")?.presence,
    0,
  );

  scene.advance(1_000 / 60);
  const inFlight = scene.snapshot();
  const exiting = inFlight.find((visual) => visual.phase === "exiting");
  const active = inFlight.find((visual) => visual.phase === "active");
  assert(exiting.presence < 1);
  assert(active.presence > 0);
  assertEquals(exiting.points.length, 3);
  assertEquals(active.points.length, 2);

  advanceUntilSettled(scene);
  assertEquals(scene.snapshot().length, 1);
  assertEquals(onlyVisual(scene).kind, "pair-feeder");
});

test("flow motion cross-fades a same-arity route that changes obstacle side", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    points: [
      { x: 0, y: 0 },
      { x: 20, y: -30 },
      { x: 80, y: -30 },
      { x: 100, y: 0 },
    ],
  })], false);
  scene.reconcile([motionTarget({
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 30 },
      { x: 80, y: 30 },
      { x: 100, y: 0 },
    ],
  })], false);

  const visuals = scene.snapshot();
  assertEquals(visuals.length, 2);
  assertEquals(visuals.filter((visual) => visual.phase === "active").length, 1);
  assertEquals(
    visuals.filter((visual) => visual.phase === "exiting").length,
    1,
  );
  assert(
    visuals[0].topologySignature !== visuals[1].topologySignature,
  );
});

test("flow motion reuses exact route identity across a visual key split", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    key: "old-backbone",
    edgeKeys: ["edge:a"],
    pathKeys: ["path:a"],
    points: [{ x: 0, y: 0 }, { x: 50, y: 10 }, { x: 100, y: 0 }],
  })], false);
  scene.reconcile([motionTarget({
    key: "new-backbone",
    edgeKeys: ["edge:a"],
    pathKeys: ["path:a"],
    points: [{ x: 10, y: 5 }, { x: 60, y: 20 }, { x: 110, y: 5 }],
  })], false);

  const active = scene.snapshot().find((visual) => visual.phase === "active");
  assertEquals(active.points.map(({ x, y }) => ({ x, y })), [
    { x: 0, y: 0 },
    { x: 50, y: 10 },
    { x: 100, y: 0 },
  ]);
  assertEquals(active.presence, 0);
});

test("reduced motion snaps geometry and removes exiting ghosts immediately", () => {
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    points: [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }],
  })], false);
  const target = motionTarget({
    points: [{ x: 30, y: 20 }, { x: 80, y: 40 }, { x: 130, y: 20 }],
    width: 4.5,
  });
  scene.reconcile([target], true);

  const visual = onlyVisual(scene);
  assertEquals(visual.points.map(({ x, y }) => ({ x, y })), target.points);
  assertEquals(visual.width, 4.5);
  assertEquals(visual.presence, 1);
  assertEquals(scene.needsAnimation(), false);

  scene.reconcile([], true);
  assertEquals(scene.snapshot(), []);
});

test("critical spring integration is deterministic across fixed frame rates", () => {
  let sixtyHertz = { value: 0, velocity: 0 };
  for (let index = 0; index < 60; index++) {
    sixtyHertz = advanceOverviewFlowMotionScalar(
      sixtyHertz.value,
      sixtyHertz.velocity,
      100,
      22,
      1 / 60,
    );
  }
  let thirtyHertz = { value: 0, velocity: 0 };
  for (let index = 0; index < 30; index++) {
    thirtyHertz = advanceOverviewFlowMotionScalar(
      thirtyHertz.value,
      thirtyHertz.velocity,
      100,
      22,
      1 / 30,
    );
  }
  assertAlmostEquals(sixtyHertz.value, thirtyHertz.value, 1e-9);
  assertAlmostEquals(sixtyHertz.velocity, thirtyHertz.velocity, 1e-9);
});

test("routed cable motion preserves D3 Catmull-Rom cubic geometry", () => {
  const feeder = overviewFlowMotionPath(
    [
      { x: 0, y: 0 },
      { x: 18, y: 0 },
      { x: 58, y: 18 },
      { x: 80, y: 20 },
    ],
    "pair-feeder",
    "catmull-rom",
  );
  const corridor = overviewFlowMotionPath(
    [
      { x: 0, y: 0 },
      { x: 25, y: 10 },
      { x: 55, y: 10 },
      { x: 80, y: 20 },
    ],
    "future-corridor-kind",
    "catmull-rom",
  );
  assert(feeder.startsWith("M"));
  assert(corridor.startsWith("M"));
  assert(feeder.includes("C"));
  assert(corridor.includes("C"));
  assertEquals(feeder.includes("Q"), false);
  assertEquals(feeder.includes("NaN"), false);
  assertEquals(corridor.includes("NaN"), false);

  const scene = new OverviewFlowMotionScene();
  scene.reconcile([motionTarget({
    curve: "catmull-rom",
    topologySignature: "cable-field/v1|direct|curve:catmull-rom:3",
    points: [
      { x: 0, y: 0 },
      { x: 18, y: 0 },
      { x: 58, y: 18 },
      { x: 80, y: 20 },
    ],
  })], false);
  scene.reconcile([motionTarget({
    curve: "catmull-rom",
    topologySignature: "cable-field/v1|direct|curve:catmull-rom:3",
    points: [
      { x: 4, y: 2 },
      { x: 24, y: 3 },
      { x: 64, y: 24 },
      { x: 86, y: 25 },
    ],
  })], false);
  scene.advance(1_000 / 60);
  const visual = onlyVisual(scene);
  const inFlight = overviewFlowMotionPath(
    visual.points,
    visual.kind,
    visual.curve,
  );
  assert(inFlight.includes("C"));
  assertEquals(inFlight.includes("Q"), false);
});

test("node fan-in motion stays Catmull-Rom instead of reverting to a bump", () => {
  const points = [
    { x: 8, y: 18 },
    { x: 20, y: 18 },
    { x: 40, y: 20 },
    { x: 62, y: 24 },
    { x: 78, y: 25 },
    { x: 88, y: 25 },
  ];
  const target = motionTarget({
    kind: "node-branch",
    curve: "catmull-rom",
    points,
    topologySignature: "node-fan-in/v1|particles:6",
  });
  const scene = new OverviewFlowMotionScene();
  scene.reconcile([target], false);
  scene.reconcile([motionTarget({
    ...target,
    points: points.map((point, index) => ({
      x: point.x + (index === 0 || index === points.length - 1 ? 0 : 3),
      y: point.y + (index === 0 || index === points.length - 1 ? 0 : 2),
    })),
  })], false);
  scene.advance(1_000 / 60);
  const visual = onlyVisual(scene);
  const inFlight = overviewFlowMotionPath(
    visual.points,
    visual.kind,
    visual.curve,
  );
  assert(inFlight.includes("C"));
  assertEquals(inFlight.includes("Q"), false);
  assertEquals(inFlight.includes("L"), false);
});

function motionTarget(
  overrides = {},
) {
  const points = overrides.points ?? [
    { x: 0, y: 0 },
    { x: 50, y: 10 },
    { x: 100, y: 0 },
  ];
  const kind = overrides.kind ?? "bundle-trunk";
  const curve = overrides.curve ??
    (kind === "node-branch" ? "bump" : "catmull-rom");
  return {
    key: overrides.key ?? "cable:a",
    kind,
    curve,
    points,
    topologySignature: overrides.topologySignature ??
      overviewFlowMotionTopologySignature(kind, points),
    targetD: overrides.targetD ?? overviewFlowMotionPath(points, kind, curve),
    width: overrides.width ?? 2,
    edgeKeys: overrides.edgeKeys ?? ["edge:a"],
    pathKeys: overrides.pathKeys ?? ["path:a"],
    pinEndpoints: overrides.pinEndpoints ?? false,
  };
}

function onlyVisual(scene) {
  const snapshot = scene.snapshot();
  assertEquals(snapshot.length, 1);
  return snapshot[0];
}

function advanceUntilSettled(scene) {
  for (let frame = 0; frame < 240 && scene.needsAnimation(); frame++) {
    scene.advance(1_000 / 60);
  }
  assertEquals(scene.needsAnimation(), false);
}
