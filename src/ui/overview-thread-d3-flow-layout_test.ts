import { assert, assertEquals } from "@std/assert";
import { overviewThreadD3CableSvgPathClear } from "./src/project/overview-thread-d3-cable-field.ts";
import {
  buildOverviewThreadD3FlowLayout,
  type OverviewThreadD3FlowEdgeInput,
  overviewThreadD3FlowGroupIdentity,
  type OverviewThreadD3FlowNodeInput,
  type OverviewThreadD3FlowPoint,
  overviewThreadD3FlowRoundedPath,
} from "./src/project/overview-thread-d3-flow-layout.ts";

const REQUIREMENT_COUNT = 10;
const GEOMETRY_PART_COUNT = 50;
const ROUTE_COUNT = REQUIREMENT_COUNT * GEOMETRY_PART_COUNT;
const EPSILON = 1e-9;
const COMPACT_PART_COUNT = 100;

Deno.test(
  "D3 flow layout preserves, orders, and shares a 10 by 50 engineering thread",
  () => {
    const fixture = denseFlowFixture();
    const layout = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
    );
    const reversed = buildOverviewThreadD3FlowLayout(
      fixture.nodes.toReversed(),
      fixture.edges.toReversed(),
    );

    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(layout.nodes.length, REQUIREMENT_COUNT + GEOMETRY_PART_COUNT);
    assertEquals(layout.routes.length, ROUTE_COUNT);
    assertEquals(
      layout.nodes.map(({ key, label }) => ({ key, label })).toSorted(byKey),
      fixture.nodes.map(({ key, label }) => ({ key, label })).toSorted(byKey),
      "The layout must preserve every complete node label",
    );
    assertEquals(layout, reversed, "Input order must not affect the layout");

    const requirements = layout.nodes.filter((node) => node.lane === "requirements");
    const geometryParts = layout.nodes.filter((node) => node.lane === "geometry");
    assertEquals(requirements.length, REQUIREMENT_COUNT);
    assertEquals(geometryParts.length, GEOMETRY_PART_COUNT);
    assert(
      Math.max(...requirements.map((node) => node.rightPort.x)) <
        Math.min(...geometryParts.map((node) => node.leftPort.x)),
      "Requirements must remain strictly left of geometry parts",
    );

    assertNoNodeBoxOverlap(requirements);
    assertNoNodeBoxOverlap(geometryParts);

    const segmentByKey = new Map(
      layout.segments.map((segment) => [segment.key, segment]),
    );
    const nodeByKey = new Map(layout.nodes.map((node) => [node.key, node]));
    const edgeByKey = new Map(fixture.edges.map((edge) => [edge.key, edge]));
    assertEquals(segmentByKey.size, layout.segments.length);
    assert(
      layout.segments.length < layout.routes.length,
      "Shared flow segments must be fewer than one naive route per relation",
    );

    const sharedSegment = layout.segments.find((segment) =>
      segment.pathCount > 1 && segment.edgeKeys.length > 1
    );
    assert(
      sharedSegment,
      "At least one trunk must carry multiple projected paths",
    );
    const corridorBackbones = layout.segments.filter((segment) =>
      segment.kind === "bundle-trunk"
    );
    const nodeBranches = layout.segments.filter((segment) =>
      segment.kind === "node-branch"
    );
    assert(
      nodeBranches.length > 0 &&
        nodeBranches.every((segment) =>
          segment.curve === "catmull-rom" &&
          segment.points.length === 6 &&
          segment.d.includes("C") &&
          !/[LQAS]/.test(segment.d)
        ),
      "Every node branch must be a six-particle D3 cubic, never a bump or linear fallback",
    );
    const firstRequirementBranch = nodeBranches.find((segment) =>
      segment.role === "source" &&
      segment.fromKeys.includes(requirementKey(0))
    );
    const secondRequirementBranch = nodeBranches.find((segment) =>
      segment.role === "source" &&
      segment.fromKeys.includes(requirementKey(1))
    );
    assert(firstRequirementBranch);
    assert(secondRequirementBranch);
    assert(
      Math.abs(
        firstRequirementBranch.points[4]!.x -
          secondRequirementBranch.points[4]!.x,
      ) <= EPSILON,
      "Combed arrival teeth must share the same axial station before the hull gate",
    );
    assert(
      Math.abs(
        firstRequirementBranch.points[4]!.y -
          secondRequirementBranch.points[4]!.y,
      ) > EPSILON,
      "Compatible leaves keep distinct comb teeth at the hull throat",
    );
    assertSamePoint(
      firstRequirementBranch.points[5]!,
      secondRequirementBranch.points[5]!,
      "Compatible leaves must meet at one exact hull gate",
    );
    assert(
      firstRequirementBranch.points[3]!.y !==
        secondRequirementBranch.points[3]!.y,
      "Individual leaves must remain independently oriented before bundling",
    );
    assertEquals(
      corridorBackbones.length,
      10,
      "Two requirement hulls by five geometry hulls need ten exact pair trunks",
    );
    assertEquals(
      corridorBackbones.every((segment) =>
        segment.curve === "catmull-rom" &&
        segment.points.length === 8 &&
        segment.d.includes("C") &&
        !/[LQAS]/.test(segment.d) &&
        segment.pathCount === 50 &&
        segment.edgeKeys.length === 50 &&
        segment.pairKeys.length === 1
      ),
      true,
      "Every exact pair needs one eight-particle cubic carrying only its recorded relations",
    );
    assertEquals(
      corridorBackbones.flatMap((segment) => segment.pairKeys).toSorted(),
      layout.nextRoutingState.corridors.flatMap((corridor) => corridor.pairKeys)
        .toSorted(),
      "Magnetic corridor metadata must account for every exact pair trunk once",
    );

    for (const segment of layout.segments) {
      assertValidPathData(segment.d, segment.key);
      assert(segment.points.length >= 2, `Missing points for ${segment.key}`);
      assertEquals(
        segment.pathCount,
        segment.pathKeys.length,
        `Path accounting mismatch for ${segment.key}`,
      );
      assertEquals(
        new Set(segment.pathKeys).size,
        segment.pathKeys.length,
        `Duplicate projected path key in ${segment.key}`,
      );
      assert(
        segment.width > 0,
        `Missing presentation width for ${segment.key}`,
      );
      assertMonotoneX(segment.points, segment.key);
    }

    const seenRouteKeys = new Set<string>();
    for (const route of layout.routes) {
      assert(
        !seenRouteKeys.has(route.edgeKey),
        `Duplicate route ${route.edgeKey}`,
      );
      seenRouteKeys.add(route.edgeKey);
      assert(route.segmentKeys.length > 0, `Empty route ${route.edgeKey}`);

      const inputEdge = edgeByKey.get(route.edgeKey);
      assert(inputEdge, `Unknown projected relation ${route.edgeKey}`);
      assertEquals(route.fromKey, inputEdge.fromKey);
      assertEquals(route.toKey, inputEdge.toKey);
      assertEquals(route.pathCount, inputEdge.pathCount);
      assertEquals(route.pathKeys, inputEdge.pathKeys);
      assertEquals(
        route.segmentKeys.map((segmentKey) => segmentByKey.get(segmentKey)?.kind),
        ["node-branch", "bundle-trunk", "node-branch"],
        `Route ${route.edgeKey} must use the unified three-segment topology`,
      );

      const source = nodeByKey.get(route.fromKey);
      const target = nodeByKey.get(route.toKey);
      assert(source, `Missing route source ${route.fromKey}`);
      assert(target, `Missing route target ${route.toKey}`);

      const routePoints: OverviewThreadD3FlowPoint[] = [];
      for (const segmentKey of route.segmentKeys) {
        const segment = segmentByKey.get(segmentKey);
        assert(segment, `Unknown segment ${segmentKey} in ${route.edgeKey}`);
        assert(
          segment.edgeKeys.includes(route.edgeKey),
          `${segmentKey} does not account for ${route.edgeKey}`,
        );
        if (routePoints.length > 0) {
          assertSamePoint(
            routePoints.at(-1)!,
            segment.points[0]!,
            `Disconnected route ${route.edgeKey} at ${segmentKey}`,
          );
        }
        routePoints.push(
          ...segment.points.slice(routePoints.length > 0 ? 1 : 0),
        );
      }

      assertSamePoint(
        routePoints[0]!,
        source.rightPort,
        `Route ${route.edgeKey} must start at its requirement`,
      );
      assertSamePoint(
        routePoints.at(-1)!,
        target.leftPort,
        `Route ${route.edgeKey} must end at its geometry part`,
      );
      assertMonotoneX(routePoints, route.edgeKey);
      assertRouteJoinsC1(layout, route.edgeKey, 0.97);
    }
    assertEquals(seenRouteKeys.size, ROUTE_COUNT);

    const naiveSegmentOccurrences = layout.routes.reduce(
      (count, route) => count + route.segmentKeys.length,
      0,
    );
    assert(
      layout.segments.length < naiveSegmentOccurrences,
      "Unique shared segments must be fewer than unbundled segment occurrences",
    );
  },
);

Deno.test(
  "D3 flow layout packs 100 parts from one group into a compact deterministic matrix",
  () => {
    const nodes = compactGeometryGroupFixture(COMPACT_PART_COUNT);
    const layout = buildOverviewThreadD3FlowLayout(nodes, []);
    const reversed = buildOverviewThreadD3FlowLayout(nodes.toReversed(), []);

    assertEquals(layout, reversed, "Grid placement must ignore input order");
    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(layout.nodes.length, COMPACT_PART_COUNT);
    assertEquals(
      layout.nodes.map(({ key, label }) => ({ key, label })).toSorted(byKey),
      nodes.map(({ key, label }) => ({ key, label })).toSorted(byKey),
      "Compact dots must retain every full part label",
    );

    const columnCount = distinctCoordinateCount(
      layout.nodes.map((node) => node.centerX),
    );
    const rowCount = distinctCoordinateCount(
      layout.nodes.map((node) => node.centerY),
    );
    assert(
      columnCount >= 8,
      `Expected a real matrix, received only ${columnCount} X position(s)`,
    );
    assert(
      rowCount >= 8 && rowCount <= 14,
      `One hundred parts must use a compact matrix, not ${rowCount} visual rows`,
    );
    assert(
      layout.nodes.every((node) => node.width <= 12 && node.height <= 12),
      "Parts must render as compact nodes, never full-width cards",
    );
    assert(
      layout.viewBox[3] <= 420,
      `One compact 100-part group must not create a ${layout.viewBox[3]}px canvas`,
    );
    assertNoNodeBoxOverlap(layout.nodes);

    const group = layout.groups.find((candidate) =>
      candidate.lane === "geometry" &&
      candidate.groupKey === "geometry-assembly:compact"
    );
    assert(group, "The compact geometry group must remain explicit");
    assertEquals(group.nodeKeys.length, COMPACT_PART_COUNT);
    assertEquals(new Set(group.nodeKeys).size, COMPACT_PART_COUNT);
  },
);

Deno.test(
  "D3 flow layout preserves its defaults and reserves explicit immersive insets",
  () => {
    const nodes = compactGeometryGroupFixture(25);
    const defaultLayout = buildOverviewThreadD3FlowLayout(nodes, []);
    const explicitDefaults = buildOverviewThreadD3FlowLayout(nodes, [], {
      minHeight: 380,
      topInset: 64,
      bottomInset: 40,
    });
    const immersiveLayout = buildOverviewThreadD3FlowLayout(nodes, [], {
      minHeight: 640,
      topInset: 120,
      bottomInset: 140,
    });

    assertEquals(
      defaultLayout,
      explicitDefaults,
      "New inset options must not move the existing default projection",
    );
    assertEquals(immersiveLayout.viewBox[3], 640);
    assert(
      Math.min(...immersiveLayout.nodes.map((node) => node.y)) >= 120,
      "Nodes must stay beneath the reserved immersive header",
    );
    assert(
      Math.max(
        ...immersiveLayout.nodes.map((node) => node.y + node.height),
      ) <= 640 - 140,
      "Nodes must stay above the reserved immersive footer",
    );
  },
);

Deno.test(
  "D3 flow layout moves one exact group with its children, hubs, and cable geometry",
  () => {
    const fixture = repositioningFixture();
    const baseline = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
    );
    const requirementGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "requirements",
      "shared-model",
    );
    const moved = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
      {
        groupPlacements: {
          [requirementGroupIdentity]: { offsetX: 36, offsetY: 28 },
        },
      },
    );

    const baselineGroup = baseline.groups.find((group) =>
      group.key === requirementGroupIdentity
    );
    const movedGroup = moved.groups.find((group) =>
      group.key === requirementGroupIdentity
    );
    assert(baselineGroup);
    assert(movedGroup);
    assertEquals(movedGroup.x - baselineGroup.x, 36);
    assertEquals(movedGroup.y - baselineGroup.y, 28);
    assertEquals(movedGroup.inHub.x - baselineGroup.inHub.x, 36);
    assertEquals(movedGroup.inHub.y - baselineGroup.inHub.y, 28);
    assertEquals(movedGroup.outHub.x - baselineGroup.outHub.x, 36);
    assertEquals(movedGroup.outHub.y - baselineGroup.outHub.y, 28);

    for (const nodeKey of baselineGroup.nodeKeys) {
      const baselineNode = baseline.nodes.find((node) => node.key === nodeKey);
      const movedNode = moved.nodes.find((node) => node.key === nodeKey);
      assert(baselineNode);
      assert(movedNode);
      assertEquals(movedNode.x - baselineNode.x, 36);
      assertEquals(movedNode.y - baselineNode.y, 28);
    }

    const baselineRoutePoints = collectRoutePoints(baseline, "trace:model");
    const movedRoutePoints = collectRoutePoints(moved, "trace:model");
    const movedSource = moved.nodes.find((node) => node.key === "req:model");
    const movedTarget = moved.nodes.find((node) => node.key === "cad:hull");
    assert(movedSource);
    assert(movedTarget);
    assertSamePoint(
      movedRoutePoints[0]!,
      movedSource.rightPort,
      "Moved cable must start at the final source port",
    );
    assertSamePoint(
      movedRoutePoints.at(-1)!,
      movedTarget.leftPort,
      "Moved cable must end at the final target port",
    );
    assert(
      movedRoutePoints.some((point, index) =>
        point.x !== baselineRoutePoints[index]?.x ||
        point.y !== baselineRoutePoints[index]?.y
      ),
      "Cable points must be regenerated from the moved layout",
    );

    const geometryIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "shared-model",
    );
    assert(
      geometryIdentity !== requirementGroupIdentity,
      "The same literal group key in another lane must retain a distinct identity",
    );
    const geometryGroup = moved.groups.find((group) => group.key === geometryIdentity);
    const baselineGeometryGroup = baseline.groups.find((group) =>
      group.key === geometryIdentity
    );
    assert(geometryGroup);
    assert(baselineGeometryGroup);
    assertEquals(
      geometryGroup,
      baselineGeometryGroup,
      "Moving one exact group must not move a same-named group in another lane",
    );
  },
);

Deno.test(
  "D3 flow layout regenerates connected cable geometry for every placement frame without topology growth",
  () => {
    const fixture = denseFlowFixture();
    const groupIdentity = overviewThreadD3FlowGroupIdentity(
      "requirements",
      "requirement-set:0",
    );
    const sourceKey = requirementKey(0);
    const observedEdgeKey = `trace:${sourceKey}>${geometryPartKey(0)}`;
    const frames = [
      { groupX: 0, groupY: 0, nodeX: 0, nodeY: 0 },
      { groupX: 8, groupY: 5, nodeX: 0, nodeY: 0 },
      { groupX: 8, groupY: 5, nodeX: 3, nodeY: 3 },
      { groupX: 16, groupY: 10, nodeX: 3, nodeY: 3 },
      { groupX: 16, groupY: 10, nodeX: 6, nodeY: 6 },
    ];
    const layouts = frames.map((frame) => {
      const options = {
        groupPlacements: {
          [groupIdentity]: {
            offsetX: frame.groupX,
            offsetY: frame.groupY,
          },
        },
        nodePlacements: {
          [sourceKey]: {
            offsetX: frame.nodeX,
            offsetY: frame.nodeY,
          },
        },
      };
      const layout = buildOverviewThreadD3FlowLayout(
        fixture.nodes,
        fixture.edges,
        options,
      );
      const reversed = buildOverviewThreadD3FlowLayout(
        fixture.nodes.toReversed(),
        fixture.edges.toReversed(),
        options,
      );
      assertEquals(
        layout,
        reversed,
        "A live placement frame must remain independent from input order",
      );
      return layout;
    });

    const topology = {
      routes: layouts[0]!.routes.map((route) => ({
        edgeKey: route.edgeKey,
        segmentKeys: route.segmentKeys,
      })),
      segmentKeys: layouts[0]!.segments.map((segment) => segment.key),
    };
    let previousObservedPoints:
      | readonly OverviewThreadD3FlowPoint[]
      | undefined;

    for (const [index, layout] of layouts.entries()) {
      assertEquals(layout.unroutedEdgeKeys, []);
      assertEquals(layout.routes.length, ROUTE_COUNT);
      assertEquals(
        layout.routes.map((route) => ({
          edgeKey: route.edgeKey,
          segmentKeys: route.segmentKeys,
        })),
        topology.routes,
        "Dragging must update geometry without inventing or dropping relations",
      );
      assertEquals(
        layout.segments.map((segment) => segment.key),
        topology.segmentKeys,
        "Repeated drag frames must reuse the bounded shared-segment topology",
      );
      assert(
        layout.segments.length < layout.routes.length,
        "Live updates must retain bundled segments instead of expanding one SVG path per relation",
      );

      const nodeByKey = new Map(layout.nodes.map((node) => [node.key, node]));
      for (const route of layout.routes) {
        const source = nodeByKey.get(route.fromKey);
        const target = nodeByKey.get(route.toKey);
        assert(source);
        assert(target);
        const points = collectRoutePoints(layout, route.edgeKey);
        assertSamePoint(
          points[0]!,
          source.rightPort,
          `Frame ${index} route ${route.edgeKey} must start at its live source port`,
        );
        assertSamePoint(
          points.at(-1)!,
          target.leftPort,
          `Frame ${index} route ${route.edgeKey} must end at its live target port`,
        );
      }

      const observedPoints = collectRoutePoints(layout, observedEdgeKey);
      if (previousObservedPoints) {
        assert(
          observedPoints.some((point, pointIndex) =>
            point.x !== previousObservedPoints?.[pointIndex]?.x ||
            point.y !== previousObservedPoints?.[pointIndex]?.y
          ),
          `Frame ${index} must regenerate the visible cable before drag end`,
        );
      }
      previousObservedPoints = observedPoints;
    }
  },
);

Deno.test(
  "D3 same-lane pair trunk keeps its identity and switches physical sides during drag",
  () => {
    const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "cad:source",
        lane: "geometry",
        groupKey: "assembly:a",
        label: "Source assembly",
      },
      {
        key: "cad:target",
        lane: "geometry",
        groupKey: "assembly:b",
        label: "Target assembly",
      },
    ];
    const edges: readonly OverviewThreadD3FlowEdgeInput[] = [{
      key: "trace:same-lane",
      fromKey: "cad:source",
      toKey: "cad:target",
      pathCount: 1,
      pathKeys: ["trace:same-lane"],
      emphasis: false,
    }];
    const sourceGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "assembly:a",
    );
    const targetGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "assembly:b",
    );
    const baseline = buildOverviewThreadD3FlowLayout(nodes, edges);
    const moved = buildOverviewThreadD3FlowLayout(nodes, edges, {
      groupPlacements: {
        [sourceGroupIdentity]: { y: 320 },
      },
    });
    const movedReversed = buildOverviewThreadD3FlowLayout(
      nodes.toReversed(),
      edges.toReversed(),
      {
        groupPlacements: {
          [sourceGroupIdentity]: { y: 320 },
        },
      },
    );

    const baselineSourceGroup = baseline.groups.find((group) =>
      group.key === sourceGroupIdentity
    );
    const baselineTargetGroup = baseline.groups.find((group) =>
      group.key === targetGroupIdentity
    );
    const movedSourceGroup = moved.groups.find((group) =>
      group.key === sourceGroupIdentity
    );
    const movedTargetGroup = moved.groups.find((group) =>
      group.key === targetGroupIdentity
    );
    assert(baselineSourceGroup);
    assert(baselineTargetGroup);
    assert(movedSourceGroup);
    assert(movedTargetGroup);
    assert(baselineSourceGroup.centerY < baselineTargetGroup.centerY);
    assert(movedSourceGroup.centerY > movedTargetGroup.centerY);

    const baselineTrunk = baseline.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    const movedTrunk = moved.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(baselineTrunk);
    assert(movedTrunk);
    assertEquals(movedTrunk.key, baselineTrunk.key);
    assert(
      movedTrunk.d !== baselineTrunk.d,
      "The same stable trunk must still regenerate its visible geometry",
    );
    assertEquals(
      moved.routes[0]?.segmentKeys[1],
      baseline.routes[0]?.segmentKeys[1],
      "Crossing vertically must retain the exact directed-pair trunk identity",
    );
    for (const layout of [baseline, moved]) {
      const route = layout.routes[0];
      assert(route);
      assertEquals(
        route.segmentKeys.map((key) =>
          layout.segments.find((segment) => segment.key === key)?.kind
        ),
        ["node-branch", "bundle-trunk", "node-branch"],
      );
    }
    assertEquals(moved, movedReversed);

    const movedRoutePoints = collectRoutePoints(moved, "trace:same-lane");
    const movedSource = moved.nodes.find((node) => node.key === "cad:source");
    const movedTarget = moved.nodes.find((node) => node.key === "cad:target");
    assert(movedSource);
    assert(movedTarget);
    assertSamePoint(
      movedRoutePoints[0]!,
      movedSource.topPort,
      "A source moved below its target must leave through its top port",
    );
    assertSamePoint(
      movedRoutePoints.at(-1)!,
      movedTarget.bottomPort,
      "The upper target must receive the cable through its bottom port",
    );
    const baselineSource = baseline.nodes.find((node) => node.key === "cad:source");
    const baselineTarget = baseline.nodes.find((node) => node.key === "cad:target");
    assert(baselineSource);
    assert(baselineTarget);
    const baselineRoutePoints = collectRoutePoints(baseline, "trace:same-lane");
    assertSamePoint(
      baselineRoutePoints[0]!,
      baselineSource.bottomPort,
      "baseline source",
    );
    assertSamePoint(
      baselineRoutePoints.at(-1)!,
      baselineTarget.topPort,
      "baseline target",
    );
    assertRouteJoinsC1(baseline, "trace:same-lane", 0.97);
    assertRouteJoinsC1(moved, "trace:same-lane", 0.97);
  },
);

Deno.test(
  "D3 same-lane cable curves around overlapping immutable hulls without moving them",
  () => {
    const source: OverviewThreadD3FlowNodeInput = {
      key: "local-cable:source",
      lane: "geometry",
      groupKey: "local-cable-source",
      label: "Local source",
    };
    const target: OverviewThreadD3FlowNodeInput = {
      key: "local-cable:target",
      lane: "geometry",
      groupKey: "local-cable-target",
      label: "Local target",
    };
    const edge: OverviewThreadD3FlowEdgeInput = {
      key: "trace:local-cable",
      fromKey: source.key,
      toKey: target.key,
      pathCount: 1,
      pathKeys: ["path:local-cable"],
      emphasis: false,
    };
    const sourceIdentity = overviewThreadD3FlowGroupIdentity(
      source.lane,
      source.groupKey,
    );
    const targetIdentity = overviewThreadD3FlowGroupIdentity(
      target.lane,
      target.groupKey,
    );
    const endpointPlacements = {
      [sourceIdentity]: { x: 430, y: 105 },
      [targetIdentity]: { x: 430, y: 235 },
    };
    const baseline = buildOverviewThreadD3FlowLayout(
      [source, target],
      [edge],
      { groupPlacements: endpointPlacements },
    );
    const baselineTrunk = baseline.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(baselineTrunk);

    const foreignNodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "local-cable:foreign-requirement",
        lane: "requirements",
        groupKey: "foreign-requirement",
        label: "Foreign requirement",
      },
      {
        key: "local-cable:foreign-model",
        lane: "system-model",
        groupKey: "foreign-model",
        label: "Foreign model",
      },
      {
        key: "local-cable:foreign-physics",
        lane: "physics",
        groupKey: "foreign-physics",
        label: "Foreign physics",
      },
      {
        key: "local-cable:foreign-verdict",
        lane: "verdicts",
        groupKey: "foreign-verdict",
        label: "Foreign verdict",
      },
    ];
    const interiorPoint = baselineTrunk.points[
      Math.floor(baselineTrunk.points.length / 2)
    ]!;
    const foreignPlacements = Object.fromEntries(
      foreignNodes.map((node, index) => [
        overviewThreadD3FlowGroupIdentity(node.lane, node.groupKey),
        {
          x: interiorPoint.x - 12 + index * 4,
          y: interiorPoint.y - 12 + index * 3,
        },
      ]),
    );
    const nodes = [source, ...foreignNodes, target];
    const layout = buildOverviewThreadD3FlowLayout(nodes, [edge], {
      groupPlacements: { ...endpointPlacements, ...foreignPlacements },
    });
    const reversed = buildOverviewThreadD3FlowLayout(
      nodes.toReversed(),
      [edge],
      { groupPlacements: { ...endpointPlacements, ...foreignPlacements } },
    );
    const trunk = layout.segments.find((segment) => segment.kind === "bundle-trunk");
    assert(trunk);
    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(layout, reversed);
    assert(
      foreignNodes.some((node) => {
        const group = layout.groups.find((candidate) =>
          candidate.key === overviewThreadD3FlowGroupIdentity(
            node.lane,
            node.groupKey,
          )
        );
        assert(group);
        return pointInsideRectangle(interiorPoint, {
          minimumX: group.x - 12,
          maximumX: group.x + group.width + 12,
          minimumY: group.y - 12,
          maximumY: group.y + group.height + 12,
        });
      }),
      "The regression fixture must place a foreign-lane hull over the baseline return",
    );
    assert(
      trunk.d !== baselineTrunk.d,
      "The cable field must react when immutable foreign hulls cover its baseline",
    );
    assert(
      trunk.curve === "catmull-rom" && trunk.d.includes("C"),
      "A successful local return must remain a D3 Catmull-Rom cubic",
    );
    const foreignObstacles = foreignNodes.map((node) => {
      const group = layout.groups.find((candidate) =>
        candidate.key === overviewThreadD3FlowGroupIdentity(
          node.lane,
          node.groupKey,
        )
      );
      assert(group);
      return {
        key: group.key,
        minimumX: group.x - 12,
        maximumX: group.x + group.width + 12,
        minimumY: group.y - 12,
        maximumY: group.y + group.height + 12,
      };
    });
    assert(
      overviewThreadD3CableSvgPathClear(trunk.d, foreignObstacles),
      "The rendered same-lane cubic must clear every inflated foreign hull",
    );
    const endpoints = [trunk.points[0]!, trunk.points.at(-1)!];
    const minimumX = Math.min(...endpoints.map((point) => point.x)) - 40;
    const maximumX = Math.max(...endpoints.map((point) => point.x)) + 40;
    const minimumY = Math.min(...endpoints.map((point) => point.y)) - 40;
    const maximumY = Math.max(...endpoints.map((point) => point.y)) + 40;
    assert(
      trunk.points.every((point) =>
        point.x >= minimumX && point.x <= maximumX &&
        point.y >= minimumY && point.y <= maximumY
      ),
      "The local cable bbox must stay near its endpoints while clearing hulls",
    );
  },
);

Deno.test(
  "D3 inter-lane trunk follows physical X order when freely moved hulls cross",
  () => {
    const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "req:movable",
        lane: "requirements",
        groupKey: "requirement-set:movable",
        label: "Movable requirement",
      },
      {
        key: "cad:fixed",
        lane: "geometry",
        groupKey: "geometry-assembly:fixed",
        label: "Fixed geometry",
      },
    ];
    const edges: readonly OverviewThreadD3FlowEdgeInput[] = [{
      key: "trace:movable>fixed",
      fromKey: "req:movable",
      toKey: "cad:fixed",
      pathCount: 1,
      pathKeys: ["trace:movable>fixed"],
      emphasis: false,
    }];
    const sourceGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "requirements",
      "requirement-set:movable",
    );
    const targetGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "geometry-assembly:fixed",
    );
    const baseline = buildOverviewThreadD3FlowLayout(nodes, edges);
    const baselineSourceGroup = baseline.groups.find((group) =>
      group.key === sourceGroupIdentity
    );
    const baselineTargetGroup = baseline.groups.find((group) =>
      group.key === targetGroupIdentity
    );
    assert(baselineSourceGroup);
    assert(baselineTargetGroup);

    const approachedX = baselineTargetGroup.x - baselineSourceGroup.width - 48;
    const crossedX = baselineTargetGroup.x + baselineTargetGroup.width + 48;
    const atSourceX = (x: number) =>
      buildOverviewThreadD3FlowLayout(nodes, edges, {
        groupPlacements: { [sourceGroupIdentity]: { x } },
      });
    const frames = [baseline, atSourceX(approachedX), atSourceX(crossedX)];

    for (const [index, layout] of frames.entries()) {
      assertEquals(layout.unroutedEdgeKeys, []);
      assertEquals(layout.routes.length, 1);
      const route = layout.routes[0]!;
      assertEquals(
        {
          edgeKey: route.edgeKey,
          fromKey: route.fromKey,
          toKey: route.toKey,
          pathCount: route.pathCount,
          pathKeys: route.pathKeys,
        },
        {
          edgeKey: edges[0]!.key,
          fromKey: edges[0]!.fromKey,
          toKey: edges[0]!.toKey,
          pathCount: edges[0]!.pathCount,
          pathKeys: edges[0]!.pathKeys,
        },
        `Frame ${index} must retain the exact recorded relation`,
      );
      const sourceGroup = layout.groups.find((group) =>
        group.key === sourceGroupIdentity
      );
      const targetGroup = layout.groups.find((group) =>
        group.key === targetGroupIdentity
      );
      const sourceNode = layout.nodes.find((node) => node.key === "req:movable");
      const targetNode = layout.nodes.find((node) => node.key === "cad:fixed");
      assert(sourceGroup);
      assert(targetGroup);
      assert(sourceNode);
      assert(targetNode);
      const routeSegments = route.segmentKeys.map((key) => {
        const segment = layout.segments.find((candidate) => candidate.key === key);
        assert(segment);
        return segment;
      });
      assertEquals(
        routeSegments.map((segment) => segment.kind),
        ["node-branch", "bundle-trunk", "node-branch"],
      );
      const trunk = routeSegments[1]!;
      assertEquals(trunk.direction, "forward");
      assertEquals(trunk.points.length, 8);
      assert(trunk.d.includes("C") && !/[LQAS]/.test(trunk.d));
      const sourceIsLeft = sourceGroup.x < targetGroup.x;
      const routePoints = assertConnectedRoute(layout, route.edgeKey);
      assertSamePoint(
        routePoints[0]!,
        sourceIsLeft ? sourceNode.rightPort : sourceNode.leftPort,
        `Frame ${index} must leave through the physically facing source port`,
      );
      assertSamePoint(
        routePoints.at(-1)!,
        sourceIsLeft ? targetNode.leftPort : targetNode.rightPort,
        `Frame ${index} must enter through the physically facing target port`,
      );
      assertRouteJoinsC1(layout, route.edgeKey, 0.97);
    }

    const atFacingHubDelta = (delta: number) =>
      atSourceX(
        baselineSourceGroup.x +
          baselineTargetGroup.inHub.x -
          baselineSourceGroup.outHub.x +
          delta,
      );
    for (const delta of [-1, 0, 36]) {
      const layout = atFacingHubDelta(delta);
      assertEquals(
        layout.unroutedEdgeKeys,
        [],
        `Facing-hub delta ${delta} must not drop the exact relation`,
      );
      assertEquals(layout.routes.length, 1);
      const route = layout.routes[0]!;
      assertEquals(
        route.segmentKeys.map((key) =>
          layout.segments.find((segment) => segment.key === key)?.kind
        ),
        ["node-branch", "bundle-trunk", "node-branch"],
      );
      const sourceNode = layout.nodes.find((node) => node.key === "req:movable");
      const targetNode = layout.nodes.find((node) => node.key === "cad:fixed");
      assert(sourceNode);
      assert(targetNode);
      const routePoints = assertConnectedRoute(layout, route.edgeKey);
      assertSamePoint(
        routePoints[0]!,
        sourceNode.topPort,
        `delta ${delta} source`,
      );
      assertSamePoint(
        routePoints.at(-1)!,
        targetNode.topPort,
        `delta ${delta} target`,
      );
      assertRouteJoinsC1(layout, route.edgeKey, 0.97);
      assertEquals(
        layout,
        buildOverviewThreadD3FlowLayout(
          nodes.toReversed(),
          edges.toReversed(),
          {
            groupPlacements: {
              [sourceGroupIdentity]: {
                x: baselineSourceGroup.x +
                  baselineTargetGroup.inHub.x -
                  baselineSourceGroup.outHub.x +
                  delta,
              },
            },
          },
        ),
      );
    }

    const approachedTrunk = frames[1]!.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    const crossedTrunk = frames[2]!.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(approachedTrunk);
    assert(crossedTrunk);
    assert(approachedTrunk.points[0]!.x < approachedTrunk.points.at(-1)!.x);
    assert(
      crossedTrunk.points[0]!.x > crossedTrunk.points.at(-1)!.x,
      "The crossed frame must exercise right-to-left physical routing",
    );
    assertEquals(
      frames[2],
      buildOverviewThreadD3FlowLayout(
        nodes.toReversed(),
        edges.toReversed(),
        { groupPlacements: { [sourceGroupIdentity]: { x: crossedX } } },
      ),
      "Crossed routing must remain independent from input order",
    );
  },
);

Deno.test(
  "D3 inter-lane ports follow crossed hull geometry with a direct three-part cable",
  () => {
    const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "node:requirement",
        lane: "requirements",
        groupKey: "group:requirement",
        label: "Requirement",
      },
      {
        key: "node:geometry",
        lane: "geometry",
        groupKey: "group:geometry",
        label: "Geometry",
      },
    ];
    const edges: readonly OverviewThreadD3FlowEdgeInput[] = [
      {
        key: "trace:forward-crossed",
        fromKey: "node:requirement",
        toKey: "node:geometry",
        pathCount: 2,
        pathKeys: ["path:forward:a", "path:forward:b"],
        emphasis: true,
      },
      {
        key: "trace:reverse-crossed",
        fromKey: "node:geometry",
        toKey: "node:requirement",
        pathCount: 1,
        pathKeys: ["path:reverse"],
        emphasis: false,
      },
    ];
    const requirementGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "requirements",
      "group:requirement",
    );
    const geometryGroupIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "group:geometry",
    );
    const options = {
      groupPlacements: {
        [requirementGroupIdentity]: { x: 780, y: 180 },
        [geometryGroupIdentity]: { x: 160, y: 180 },
      },
    };
    const layout = buildOverviewThreadD3FlowLayout(nodes, edges, options);
    const reversed = buildOverviewThreadD3FlowLayout(
      nodes.toReversed(),
      edges.toReversed(),
      options,
    );
    const placementOnly = buildOverviewThreadD3FlowLayout(nodes, [], options);

    assertEquals(
      layout,
      reversed,
      "Physical port selection must remain independent from node and edge input order",
    );
    assertEquals(
      layout.groups,
      placementOnly.groups,
      "Cable routing must not move either manually placed hull",
    );
    assertEquals(
      layout.nodes,
      placementOnly.nodes,
      "Cable routing must not move either hull's nodes",
    );

    const requirementGroup = layout.groups.find((group) =>
      group.key === requirementGroupIdentity
    );
    const geometryGroup = layout.groups.find((group) =>
      group.key === geometryGroupIdentity
    );
    const requirementNode = layout.nodes.find((node) =>
      node.key === "node:requirement"
    );
    const geometryNode = layout.nodes.find((node) => node.key === "node:geometry");
    assert(requirementGroup);
    assert(geometryGroup);
    assert(requirementNode);
    assert(geometryNode);
    assert(
      requirementGroup.x > geometryGroup.x + geometryGroup.width,
      "The fixture must put the canonically first hull physically on the right",
    );

    const expected = new Map([
      [
        "trace:forward-crossed",
        {
          direction: "forward" as const,
          sourcePort: requirementNode.leftPort,
          targetPort: geometryNode.rightPort,
          edge: edges[0]!,
        },
      ],
      [
        "trace:reverse-crossed",
        {
          direction: "reverse" as const,
          sourcePort: geometryNode.rightPort,
          targetPort: requirementNode.leftPort,
          edge: edges[1]!,
        },
      ],
    ]);

    for (const [edgeKey, expectation] of expected) {
      const route = layout.routes.find((candidate) => candidate.edgeKey === edgeKey);
      assert(route, `Missing exact crossed route ${edgeKey}`);
      assertEquals(
        {
          edgeKey: route.edgeKey,
          fromKey: route.fromKey,
          toKey: route.toKey,
          pathCount: route.pathCount,
          pathKeys: route.pathKeys,
        },
        {
          edgeKey: expectation.edge.key,
          fromKey: expectation.edge.fromKey,
          toKey: expectation.edge.toKey,
          pathCount: expectation.edge.pathCount,
          pathKeys: expectation.edge.pathKeys,
        },
        `${edgeKey} must retain its exact relation metadata`,
      );
      const segments = route.segmentKeys.map((segmentKey) => {
        const segment = layout.segments.find((candidate) =>
          candidate.key === segmentKey
        );
        assert(segment, `Missing ${segmentKey} in ${edgeKey}`);
        return segment;
      });
      assertEquals(
        segments.map((segment) => segment.kind),
        ["node-branch", "bundle-trunk", "node-branch"],
      );
      assertEquals(
        segments.every((segment) =>
          segment.direction === expectation.direction &&
          segment.edgeKeys.includes(edgeKey)
        ),
        true,
        `${edgeKey} must preserve business direction through physical rerouting`,
      );

      const sourceBranch = segments[0]!;
      const trunk = segments[1]!;
      const targetBranch = segments[2]!;
      assertSamePoint(
        sourceBranch.points[0]!,
        expectation.sourcePort,
        `${edgeKey} must exit through the physically facing source port`,
      );
      assertSamePoint(
        targetBranch.points.at(-1)!,
        expectation.targetPort,
        `${edgeKey} must enter through the physically facing target port`,
      );
      assertDirectionDotAtLeast(
        sourceBranch.points.at(-2)!,
        sourceBranch.points.at(-1)!,
        trunk.points[0]!,
        trunk.points[1]!,
        0.97,
        `${edgeKey} source branch-to-trunk join must stay smooth`,
      );
      assertDirectionDotAtLeast(
        trunk.points.at(-2)!,
        trunk.points.at(-1)!,
        targetBranch.points[0]!,
        targetBranch.points[1]!,
        0.97,
        `${edgeKey} trunk-to-target branch join must stay smooth`,
      );
      assertEquals(trunk.points.length, 8);
      assert(trunk.d.includes("C") && !/[LQAS]/.test(trunk.d));

      const points = assertConnectedRoute(layout, edgeKey);
      assertSamePoint(points[0]!, expectation.sourcePort, `${edgeKey} start`);
      assertSamePoint(
        points.at(-1)!,
        expectation.targetPort,
        `${edgeKey} end`,
      );
    }
  },
);

Deno.test(
  "D3 curves an exact corridor around local overlapping foreign hulls",
  () => {
    const sourceNode: OverviewThreadD3FlowNodeInput = {
      key: "junction:source",
      lane: "requirements",
      groupKey: "junction-source-group",
      label: "Junction source",
    };
    const targetNode: OverviewThreadD3FlowNodeInput = {
      key: "junction:target",
      lane: "geometry",
      groupKey: "junction-target-group",
      label: "Junction target",
    };
    const edge: OverviewThreadD3FlowEdgeInput = {
      key: "trace:junction-projection",
      fromKey: sourceNode.key,
      toKey: targetNode.key,
      pathCount: 1,
      pathKeys: ["path:junction-projection"],
      emphasis: false,
    };
    const sourceIdentity = overviewThreadD3FlowGroupIdentity(
      sourceNode.lane,
      sourceNode.groupKey,
    );
    const targetIdentity = overviewThreadD3FlowGroupIdentity(
      targetNode.lane,
      targetNode.groupKey,
    );
    const endpointPlacements = {
      [sourceIdentity]: { y: 160 },
      [targetIdentity]: { y: 160 },
    };
    const baseline = buildOverviewThreadD3FlowLayout(
      [sourceNode, targetNode],
      [edge],
      { obstacleMargin: 12, groupPlacements: endpointPlacements },
    );
    const baselineTrunk = baseline.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(baselineTrunk);
    const coveredInterior = baselineTrunk.points[
      Math.floor(baselineTrunk.points.length / 2)
    ]!;

    const foreignNodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "junction:foreign-a",
        lane: "system-model",
        groupKey: "junction-foreign-a",
        label: "Foreign hull A",
      },
      {
        key: "junction:foreign-b",
        lane: "physics",
        groupKey: "junction-foreign-b",
        label: "Foreign hull B",
      },
    ];
    const foreignAIdentity = overviewThreadD3FlowGroupIdentity(
      foreignNodes[0]!.lane,
      foreignNodes[0]!.groupKey,
    );
    const foreignBIdentity = overviewThreadD3FlowGroupIdentity(
      foreignNodes[1]!.lane,
      foreignNodes[1]!.groupKey,
    );
    const options = {
      obstacleMargin: 12,
      groupPlacements: {
        ...endpointPlacements,
        [foreignAIdentity]: {
          x: coveredInterior.x - 5,
          y: coveredInterior.y - 5,
        },
        [foreignBIdentity]: {
          x: coveredInterior.x + 8,
          y: coveredInterior.y - 5,
        },
      },
    };
    const nodes = [sourceNode, ...foreignNodes, targetNode];
    const layout = buildOverviewThreadD3FlowLayout(nodes, [edge], options);
    const reversed = buildOverviewThreadD3FlowLayout(
      nodes.toReversed(),
      [edge],
      options,
    );
    const placementOnly = buildOverviewThreadD3FlowLayout(nodes, [], options);

    assertEquals(layout, reversed);
    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(layout.groups, placementOnly.groups);
    assertEquals(layout.nodes, placementOnly.nodes);
    const foreignObstacles = [foreignAIdentity, foreignBIdentity].map(
      (identity) => {
        const group = layout.groups.find((candidate) => candidate.key === identity);
        assert(group);
        return {
          key: group.key,
          minimumX: group.x - 12,
          maximumX: group.x + group.width + 12,
          minimumY: group.y - 12,
          maximumY: group.y + group.height + 12,
        };
      },
    );
    assert(
      foreignObstacles.every((obstacle) =>
        pointInsideRectangle(coveredInterior, obstacle)
      ),
      "The regression fixture must cover an interior point of the baseline cable",
    );
    const trunk = layout.segments.find((segment) => segment.kind === "bundle-trunk");
    assert(trunk);
    assert(
      overviewThreadD3CableSvgPathClear(trunk.d, foreignObstacles),
      "The recomputed Catmull-Rom cable must clear every inflated foreign hull",
    );
    assert(
      trunk.d !== baselineTrunk.d,
      "Covering an interior point must regenerate the visible cable",
    );
    assertSamePoint(trunk.points[0]!, baselineTrunk.points[0]!, "source hub");
    assertSamePoint(
      trunk.points.at(-1)!,
      baselineTrunk.points.at(-1)!,
      "target hub",
    );
    const route = layout.routes.find((candidate) => candidate.edgeKey === edge.key);
    assert(route);
    for (const segmentKey of route.segmentKeys) {
      const segment = layout.segments.find((candidate) => candidate.key === segmentKey);
      assert(segment);
      if (segment.kind === "node-branch") continue;
      assert(
        overviewThreadD3CableSvgPathClear(segment.d, foreignObstacles),
        `${segment.key} must route around, never omit, foreign hulls`,
      );
    }
    assertConnectedRoute(layout, edge.key);
    assertRouteJoinsC1(layout, edge.key, 0.97);
  },
);

Deno.test(
  "D3 fails a relation closed when a foreign hull covers its exact physical hub",
  () => {
    const sourceNode: OverviewThreadD3FlowNodeInput = {
      key: "covered:source",
      lane: "requirements",
      groupKey: "covered-source-group",
      label: "Covered source",
    };
    const targetNode: OverviewThreadD3FlowNodeInput = {
      key: "covered:target",
      lane: "geometry",
      groupKey: "covered-target-group",
      label: "Covered target",
    };
    const foreignNode: OverviewThreadD3FlowNodeInput = {
      key: "covered:foreign",
      lane: "system-model",
      groupKey: "covered-foreign-group",
      label: "Foreign covering hull",
    };
    const edge: OverviewThreadD3FlowEdgeInput = {
      key: "trace:covered-port",
      fromKey: sourceNode.key,
      toKey: targetNode.key,
      pathCount: 1,
      pathKeys: ["path:covered-port"],
      emphasis: false,
    };
    const baseline = buildOverviewThreadD3FlowLayout(
      [sourceNode, targetNode],
      [edge],
      {
        groupPlacements: {
          [
            overviewThreadD3FlowGroupIdentity(
              sourceNode.lane,
              sourceNode.groupKey,
            )
          ]: { y: 140 },
          [
            overviewThreadD3FlowGroupIdentity(
              targetNode.lane,
              targetNode.groupKey,
            )
          ]: { y: 140 },
        },
      },
    );
    const sourceGroup = baseline.groups.find((group) =>
      group.groupKey === sourceNode.groupKey
    );
    assert(sourceGroup);
    const foreignIdentity = overviewThreadD3FlowGroupIdentity(
      foreignNode.lane,
      foreignNode.groupKey,
    );
    const placements = {
      [
        overviewThreadD3FlowGroupIdentity(
          sourceNode.lane,
          sourceNode.groupKey,
        )
      ]: { y: 140 },
      [
        overviewThreadD3FlowGroupIdentity(
          targetNode.lane,
          targetNode.groupKey,
        )
      ]: { y: 140 },
      [foreignIdentity]: {
        x: sourceGroup.outHub.x - 5,
        y: sourceGroup.outHub.y - 5,
      },
    };
    const nodes = [sourceNode, foreignNode, targetNode];
    const layout = buildOverviewThreadD3FlowLayout(nodes, [edge], {
      obstacleMargin: 12,
      groupPlacements: placements,
    });
    const placementOnly = buildOverviewThreadD3FlowLayout(nodes, [], {
      obstacleMargin: 12,
      groupPlacements: placements,
    });
    const layoutSourceGroup = layout.groups.find((group) =>
      group.groupKey === sourceNode.groupKey
    );
    const foreignGroup = layout.groups.find((group) => group.key === foreignIdentity);
    assert(layoutSourceGroup);
    assert(foreignGroup);
    assert(
      pointInsideRectangle(layoutSourceGroup.outHub, {
        minimumX: foreignGroup.x - 12,
        maximumX: foreignGroup.x + foreignGroup.width + 12,
        minimumY: foreignGroup.y - 12,
        maximumY: foreignGroup.y + foreignGroup.height + 12,
      }),
      "The regression fixture must cover the exact source hub",
    );
    assertEquals(layout.routes, []);
    assertEquals(layout.segments, []);
    assertEquals(layout.unroutedEdgeKeys, [edge.key]);
    assertEquals(layout.groups, placementOnly.groups);
    assertEquals(layout.nodes, placementOnly.nodes);
  },
);

Deno.test(
  "D3 flow layout keeps hulls unbounded while clamping node offsets inside their hull",
  () => {
    const nodes = compactGeometryGroupFixture(4);
    const groupIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "geometry-assembly:compact",
    );
    const firstNodeKey = nodes[0]!.key;
    const secondNodeKey = nodes[1]!.key;
    const layout = buildOverviewThreadD3FlowLayout(nodes, [], {
      groupPlacements: {
        [groupIdentity]: { x: -10_000, y: 10_000 },
      },
      nodePlacements: {
        [firstNodeKey]: { offsetX: -10_000, offsetY: -10_000 },
        [secondNodeKey]: { offsetX: 10_000, offsetY: 10_000 },
      },
    });
    const group = layout.groups.find((candidate) => candidate.key === groupIdentity);
    const firstNode = layout.nodes.find((node) => node.key === firstNodeKey);
    const secondNode = layout.nodes.find((node) => node.key === secondNodeKey);
    assert(group);
    assert(firstNode);
    assert(secondNode);

    assertEquals(group.x, -10_000);
    assertEquals(group.y, 10_000);
    assertEquals(firstNode.x, group.x);
    assertEquals(firstNode.y, group.y);
    assertEquals(secondNode.x, group.x + group.width - secondNode.width);
    assertEquals(secondNode.y, group.y + group.height - secondNode.height);
    for (const node of layout.nodes) {
      assert(node.x >= group.x - EPSILON);
      assert(node.y >= group.y - EPSILON);
      assert(node.x + node.width <= group.x + group.width + EPSILON);
      assert(node.y + node.height <= group.y + group.height + EPSILON);
    }
  },
);

Deno.test(
  "D3 flow layout keeps deterministic defaults and ignores unknown placements",
  () => {
    const fixture = repositioningFixture();
    const baseline = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
    );
    const emptyPlacements = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
      { groupPlacements: {}, nodePlacements: {} },
    );
    const unknownPlacements = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
      {
        groupPlacements: {
          "group:missing": { x: 1, y: 2, offsetX: 3, offsetY: 4 },
        },
        nodePlacements: {
          "node:missing": { offsetX: 999, offsetY: -999 },
        },
      },
    );

    assertEquals(emptyPlacements, baseline);
    assertEquals(unknownPlacements, baseline);
    assertEquals(
      buildOverviewThreadD3FlowLayout(
        fixture.nodes.toReversed(),
        fixture.edges.toReversed(),
        { groupPlacements: {}, nodePlacements: {} },
      ),
      baseline,
      "Placements must not make the projection depend on input order",
    );
  },
);

Deno.test(
  "D3 magnetic corridors use complete-link capture and deterministic exact metadata",
  () => {
    const fixture = magneticCorridorFixture(["a", "b", "c"]);
    const groupY = { a: 100, b: 118, c: 136 };
    const options = {
      corridorCaptureDistance: 20,
      corridorReleaseDistance: 30,
      groupPlacements: magneticCorridorPlacements(groupY),
    };
    const layout = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
      options,
    );
    const reversed = buildOverviewThreadD3FlowLayout(
      fixture.nodes.toReversed(),
      fixture.edges.toReversed(),
      options,
    );

    assertEquals(
      layout,
      reversed,
      "Corridor membership and lexical IDs must not depend on input order",
    );
    assertEquals(layout.unroutedEdgeKeys, []);
    assertEquals(layout.routes.length, 3);
    assertEquals(corridorSizes(layout), [1, 2]);
    assert(
      layout.nextRoutingState.corridors.every((corridor) =>
        corridor.pairKeys.length < 3
      ),
      "A near A↔B and B↔C chain must not transitively capture distant A↔C",
    );

    const backbones = layout.segments.filter((segment) =>
      segment.kind === "bundle-trunk"
    );
    assertEquals(
      backbones.every((segment) =>
        segment.pairKeys.length === 1 && segment.edgeKeys.length === 1 &&
        segment.pathKeys.length === 1 && segment.pathCount === 1 &&
        segment.points.length === 8 && segment.curve === "catmull-rom" &&
        segment.d.includes("C") && !/[LQAS]/.test(segment.d)
      ),
      true,
      "Each exact pair trunk must retain one relation and one eight-particle cubic",
    );
    assertEquals(backbones.length, fixture.edges.length);

    const capturedCorridor = layout.nextRoutingState.corridors.find((
      corridor,
    ) => corridor.pairKeys.length === 2);
    assert(capturedCorridor);
    const capturedTrunks = backbones.filter((segment) =>
      segment.corridorKeys.includes(capturedCorridor.id)
    );
    assertEquals(capturedTrunks.length, 2);
    assertEquals(
      capturedTrunks.flatMap((segment) => segment.pairKeys).toSorted(),
      capturedCorridor.pairKeys,
    );
    const middleIndex = Math.floor(capturedTrunks[0]!.points.length / 2);
    const endpointGap = Math.abs(
      capturedTrunks[0]!.points[0]!.y - capturedTrunks[1]!.points[0]!.y,
    );
    const middleGap = Math.abs(
      capturedTrunks[0]!.points[middleIndex]!.y -
        capturedTrunks[1]!.points[middleIndex]!.y,
    );
    assert(
      middleGap < endpointGap,
      "Compatible exact trunks must converge progressively without losing identity",
    );

    for (const corridor of layout.nextRoutingState.corridors) {
      const corridorBackbones = backbones.filter((segment) =>
        segment.corridorKeys.includes(corridor.id)
      );
      assertEquals(corridorBackbones.length, corridor.pairKeys.length);
      assertEquals(
        corridorBackbones.flatMap((segment) => segment.pairKeys).toSorted(),
        corridor.pairKeys,
      );
    }
    for (const edge of fixture.edges) {
      const points = assertConnectedRoute(layout, edge.key);
      const source = layout.nodes.find((node) => node.key === edge.fromKey);
      const target = layout.nodes.find((node) => node.key === edge.toKey);
      assert(source);
      assert(target);
      assertSamePoint(points[0]!, source.rightPort, `${edge.key} source port`);
      assertSamePoint(
        points.at(-1)!,
        target.leftPort,
        `${edge.key} target port`,
      );
      assertRouteJoinsC1(layout, edge.key, 0.97);
    }
  },
);

Deno.test(
  "D3 magnetic corridor hysteresis captures, retains, and releases without moving groups or nodes",
  () => {
    const fixture = magneticCorridorFixture(["a", "b"]);
    const frame = (
      secondY: number,
      previousRoutingState?: ReturnType<
        typeof buildOverviewThreadD3FlowLayout
      >["nextRoutingState"],
    ) =>
      buildOverviewThreadD3FlowLayout(fixture.nodes, fixture.edges, {
        corridorCaptureDistance: 20,
        corridorReleaseDistance: 30,
        previousRoutingState,
        groupPlacements: magneticCorridorPlacements({
          a: 100,
          b: secondY,
        }),
      });

    const captured = frame(118);
    const statelessOutsideCapture = frame(122);
    const retained = frame(122, captured.nextRoutingState);
    const released = frame(131, retained.nextRoutingState);

    assertEquals(corridorSizes(captured), [2]);
    assertEquals(corridorSizes(statelessOutsideCapture), [1, 1]);
    assertEquals(corridorSizes(retained), [2]);
    assertEquals(corridorSizes(released), [1, 1]);
    assertEquals(
      retained.groups,
      statelessOutsideCapture.groups,
      "Hysteresis may change only cable grouping, never hull placement",
    );
    assertEquals(
      retained.nodes,
      statelessOutsideCapture.nodes,
      "Hysteresis may change only cable grouping, never node placement",
    );
    assertMagneticGroupY(retained, { a: 100, b: 122 });
    assertMagneticGroupY(released, { a: 100, b: 131 });

    const capturedCorridor = captured.nextRoutingState.corridors.find((
      corridor,
    ) => corridor.pairKeys.length === 2);
    assert(capturedCorridor);
    const releasedPairKey = capturedCorridor.pairKeys[0]!;
    const capturedBackbone = corridorBackboneForPair(
      captured,
      releasedPairKey,
    );
    assert(capturedBackbone);
    const releasedBackbone = corridorBackboneForPair(
      released,
      releasedPairKey,
    );
    assertEquals(capturedBackbone.pathCount, 1);
    assertEquals(releasedBackbone.pathCount, 1);
    assertEquals(capturedBackbone.pairKeys, [releasedPairKey]);
    assertEquals(releasedBackbone.pairKeys, [releasedPairKey]);
    assertEquals(capturedBackbone.edgeKeys, releasedBackbone.edgeKeys);
    assertEquals(corridorForPair(captured, releasedPairKey).pairKeys.length, 2);
    assertEquals(corridorForPair(released, releasedPairKey).pairKeys.length, 1);
    assert(capturedBackbone.d !== releasedBackbone.d);

    const retainedReversed = buildOverviewThreadD3FlowLayout(
      fixture.nodes.toReversed(),
      fixture.edges.toReversed(),
      {
        corridorCaptureDistance: 20,
        corridorReleaseDistance: 30,
        previousRoutingState: captured.nextRoutingState,
        groupPlacements: magneticCorridorPlacements({ a: 100, b: 122 }),
      },
    );
    assertEquals(retained, retainedReversed);
  },
);

Deno.test(
  "D3 magnetic corridors regroup moved cables while preserving exact user placements",
  () => {
    const fixture = magneticCorridorFixture(["a", "b", "c"]);
    const baselineY = { a: 100, b: 112, c: 170 };
    const movedY = { a: 50, b: 112, c: 122 };
    const baseline = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
      {
        corridorCaptureDistance: 20,
        corridorReleaseDistance: 30,
        groupPlacements: magneticCorridorPlacements(baselineY),
      },
    );
    const moved = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
      {
        corridorCaptureDistance: 20,
        corridorReleaseDistance: 30,
        previousRoutingState: baseline.nextRoutingState,
        groupPlacements: magneticCorridorPlacements(movedY),
      },
    );

    assertEquals(corridorSizes(baseline), [1, 2]);
    assertEquals(corridorSizes(moved), [1, 2]);
    assertMagneticGroupY(baseline, baselineY);
    assertMagneticGroupY(moved, movedY);
    const pairB = pairKeyForEdge(baseline, "trace:b");
    const baselineBackbone = corridorBackboneForPair(baseline, pairB);
    const movedBackbone = corridorBackboneForPair(moved, pairB);
    const baselineCorridor = corridorForPair(baseline, pairB);
    const movedCorridor = corridorForPair(moved, pairB);
    assertEquals(
      baselineCorridor.pairKeys.includes(pairKeyForEdge(baseline, "trace:a")),
      true,
    );
    assertEquals(
      movedCorridor.pairKeys.includes(pairKeyForEdge(moved, "trace:c")),
      true,
    );
    assert(
      baselineBackbone.d !== movedBackbone.d,
      "The shared cable geometry must react to its current member pairs",
    );
    for (const edge of fixture.edges) assertConnectedRoute(moved, edge.key);
  },
);

Deno.test(
  "D3 bidirectional routes remain continuous at every exact node port",
  () => {
    const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "node:a",
        lane: "requirements",
        groupKey: "group:a",
        label: "Node A",
      },
      {
        key: "node:b",
        lane: "geometry",
        groupKey: "group:b",
        label: "Node B",
      },
    ];
    const edges: readonly OverviewThreadD3FlowEdgeInput[] = [
      {
        key: "trace:a>b",
        fromKey: "node:a",
        toKey: "node:b",
        pathCount: 1,
        pathKeys: ["trace:a>b"],
        emphasis: false,
      },
      {
        key: "trace:b>a",
        fromKey: "node:b",
        toKey: "node:a",
        pathCount: 1,
        pathKeys: ["trace:b>a"],
        emphasis: false,
      },
    ];
    const layout = buildOverviewThreadD3FlowLayout(nodes, edges);
    assertEquals(
      layout,
      buildOverviewThreadD3FlowLayout(
        nodes.toReversed(),
        edges.toReversed(),
      ),
    );
    const nodeA = layout.nodes.find((node) => node.key === "node:a");
    const nodeB = layout.nodes.find((node) => node.key === "node:b");
    assert(nodeA);
    assert(nodeB);
    const forward = assertConnectedRoute(layout, "trace:a>b");
    const reverse = assertConnectedRoute(layout, "trace:b>a");
    assertSamePoint(forward[0]!, nodeA.rightPort, "A→B source port");
    assertSamePoint(forward.at(-1)!, nodeB.leftPort, "A→B target port");
    assertSamePoint(reverse[0]!, nodeB.leftPort, "B→A source port");
    assertSamePoint(reverse.at(-1)!, nodeA.rightPort, "B→A target port");
    assertEquals(
      layout.nextRoutingState.corridors.length,
      2,
      "Opposite physical directions must never share a corridor",
    );

    const sameLaneNodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "same:a",
        lane: "geometry",
        groupKey: "same-group:a",
        label: "Same-lane A",
      },
      {
        key: "same:b",
        lane: "geometry",
        groupKey: "same-group:b",
        label: "Same-lane B",
      },
    ];
    const sameLaneEdges: readonly OverviewThreadD3FlowEdgeInput[] = [
      {
        key: "same:a>b",
        fromKey: "same:a",
        toKey: "same:b",
        pathCount: 1,
        pathKeys: ["same:a>b"],
        emphasis: false,
      },
      {
        key: "same:b>a",
        fromKey: "same:b",
        toKey: "same:a",
        pathCount: 1,
        pathKeys: ["same:b>a"],
        emphasis: false,
      },
    ];
    const sameLane = buildOverviewThreadD3FlowLayout(
      sameLaneNodes,
      sameLaneEdges,
    );
    const sameA = sameLane.nodes.find((node) => node.key === "same:a");
    const sameB = sameLane.nodes.find((node) => node.key === "same:b");
    assert(sameA);
    assert(sameB);
    const sameForward = assertConnectedRoute(sameLane, "same:a>b");
    const sameReverse = assertConnectedRoute(sameLane, "same:b>a");
    assertSamePoint(sameForward[0]!, sameA.bottomPort, "same A→B source");
    assertSamePoint(sameForward.at(-1)!, sameB.topPort, "same A→B target");
    assertSamePoint(sameReverse[0]!, sameB.topPort, "same B→A source");
    assertSamePoint(sameReverse.at(-1)!, sameA.bottomPort, "same B→A target");
    assertRouteJoinsC1(sameLane, "same:a>b", 0.97);
    assertRouteJoinsC1(sameLane, "same:b>a", 0.97);
  },
);

Deno.test(
  "D3 magnetic routing stays bounded for 100 nodes and 500 exact edges",
  () => {
    const fixture = hundredNodeFiveHundredEdgeFixture();
    const layout = buildOverviewThreadD3FlowLayout(
      fixture.nodes,
      fixture.edges,
    );
    const reversed = buildOverviewThreadD3FlowLayout(
      fixture.nodes.toReversed(),
      fixture.edges.toReversed(),
    );
    assertEquals(layout, reversed);
    assertEquals(layout.nodes.length, 100);
    assertEquals(layout.routes.length, 500);
    assertEquals(layout.unroutedEdgeKeys, []);

    const branches = layout.segments.filter((segment) =>
      segment.kind === "node-branch"
    );
    const backbones = layout.segments.filter((segment) =>
      segment.kind === "bundle-trunk"
    );
    const pairCount = new Set(backbones.flatMap((segment) => segment.pairKeys))
      .size;
    assertEquals(backbones.length, pairCount);
    assertEquals(
      backbones.flatMap((segment) => segment.pairKeys).toSorted(),
      layout.nextRoutingState.corridors.flatMap((corridor) => corridor.pairKeys)
        .toSorted(),
    );
    assertEquals(
      layout.segments.length,
      branches.length + backbones.length,
    );
    assert(
      layout.segments.length < layout.routes.length,
      `Expected bounded shared topology, received ${layout.segments.length} segments`,
    );
    for (const segment of layout.segments) {
      assertValidPathData(segment.d, segment.key);
      assert(
        segment.points.every((point) =>
          Number.isFinite(point.x) && Number.isFinite(point.y)
        ),
        `Non-finite cable field point in ${segment.key}`,
      );
    }
    const nodeByKey = new Map(layout.nodes.map((node) => [node.key, node]));
    assertEquals(
      layout.routes.map((route) => route.edgeKey).toSorted(),
      fixture.edges.map((edge) => edge.key).toSorted(),
      "All 500 exact recorded edge identities must survive routing",
    );
    for (const route of layout.routes) {
      const points = assertConnectedRoute(layout, route.edgeKey);
      const source = nodeByKey.get(route.fromKey);
      const target = nodeByKey.get(route.toKey);
      assert(source);
      assert(target);
      assertSamePoint(points[0]!, source.rightPort, `${route.edgeKey} source`);
      assertSamePoint(
        points.at(-1)!,
        target.leftPort,
        `${route.edgeKey} target`,
      );
      assertEquals(
        route.segmentKeys.map((key) =>
          layout.segments.find((segment) => segment.key === key)?.kind
        ),
        ["node-branch", "bundle-trunk", "node-branch"],
      );
      assertRouteJoinsC1(layout, route.edgeKey, 0.97);
    }
  },
);

Deno.test(
  "D3 edge-only cable fields stay taut and curve safely around immutable hulls",
  () => {
    const nodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "obstacle-source",
        lane: "requirements",
        groupKey: "obstacle-source-group",
        label: "Obstacle source",
      },
      {
        key: "blocking-hull",
        lane: "system-model",
        groupKey: "blocking-hull-group",
        label: "Blocking hull",
      },
      {
        key: "obstacle-target",
        lane: "geometry",
        groupKey: "obstacle-target-group",
        label: "Obstacle target",
      },
    ];
    const edges: readonly OverviewThreadD3FlowEdgeInput[] = [{
      key: "obstacle-edge",
      fromKey: "obstacle-source",
      toKey: "obstacle-target",
      pathCount: 1,
      pathKeys: ["obstacle-edge"],
      emphasis: false,
    }];
    const sourceIdentity = overviewThreadD3FlowGroupIdentity(
      "requirements",
      "obstacle-source-group",
    );
    const obstacleIdentity = overviewThreadD3FlowGroupIdentity(
      "system-model",
      "blocking-hull-group",
    );
    const targetIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "obstacle-target-group",
    );
    const layout = buildOverviewThreadD3FlowLayout(nodes, edges, {
      obstacleMargin: 12,
      groupPlacements: {
        [sourceIdentity]: { y: 150 },
        [obstacleIdentity]: { y: 145 },
        [targetIdentity]: { y: 150 },
      },
    });
    const reversed = buildOverviewThreadD3FlowLayout(
      nodes.toReversed(),
      edges.toReversed(),
      {
        obstacleMargin: 12,
        groupPlacements: {
          [sourceIdentity]: { y: 150 },
          [obstacleIdentity]: { y: 145 },
          [targetIdentity]: { y: 150 },
        },
      },
    );
    assertEquals(layout, reversed);

    const sourceGroup = layout.groups.find((group) => group.key === sourceIdentity);
    const obstacleGroup = layout.groups.find((group) => group.key === obstacleIdentity);
    const targetGroup = layout.groups.find((group) => group.key === targetIdentity);
    assert(sourceGroup);
    assert(obstacleGroup);
    assert(targetGroup);
    assertEquals(sourceGroup.y, 150);
    assertEquals(obstacleGroup.y, 145);
    assertEquals(targetGroup.y, 150);
    assertEquals(
      layout.nodes.find((node) => node.key === "blocking-hull")?.y,
      145,
      "Obstacle avoidance must not move the blocking node or its hull",
    );

    const backbone = layout.segments.find((segment) => segment.kind === "bundle-trunk");
    assert(backbone);
    const inflatedObstacle = {
      key: obstacleGroup.key,
      minimumX: obstacleGroup.x - 12,
      maximumX: obstacleGroup.x + obstacleGroup.width + 12,
      minimumY: obstacleGroup.y - 12,
      maximumY: obstacleGroup.y + obstacleGroup.height + 12,
    };
    assertPolylineAvoidsRectangle(
      backbone.points,
      inflatedObstacle,
      "Backbone must clear the inflated immutable hull",
    );
    assert(
      overviewThreadD3CableSvgPathClear(backbone.d, [inflatedObstacle]),
      "The actual rendered backbone curve must clear the inflated hull",
    );
    assert(
      backbone.curve === "catmull-rom" && backbone.d.includes("C"),
      "A successful obstacle route must remain an actual D3 Catmull-Rom cubic",
    );
    assertConnectedRoute(layout, "obstacle-edge");
    assertRouteJoinsC1(layout, "obstacle-edge", 0.97);

    const direct = buildOverviewThreadD3FlowLayout(
      [nodes[0]!, nodes[2]!],
      edges,
      {
        obstacleMargin: 12,
        groupPlacements: {
          [sourceIdentity]: { y: 150 },
          [targetIdentity]: { y: 150 },
        },
      },
    );
    const directBackbone = direct.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(directBackbone);
    assertEquals(
      directBackbone.points.length,
      8,
      "A clear magnetic backbone must retain its eight dynamic particles",
    );
    assert(
      directBackbone.curve === "catmull-rom" &&
        directBackbone.d.includes("C") &&
        !/[LQAS]/.test(directBackbone.d),
      "A clear cable must remain a curved cubic, never a straight-line fallback",
    );
    const directRoutePoints = assertConnectedRoute(direct, "obstacle-edge");
    const directChord = Math.hypot(
      directRoutePoints.at(-1)!.x - directRoutePoints[0]!.x,
      directRoutePoints.at(-1)!.y - directRoutePoints[0]!.y,
    );
    assert(
      polylineLength(directRoutePoints) <= directChord * 1.01,
      "A clear complete route must stay within one percent of its shortest chord",
    );
    assertEquals(/Q/.test(directBackbone.d), false);
    assertRouteJoinsC1(direct, "obstacle-edge", 0.97);

    const sameLaneNodes: readonly OverviewThreadD3FlowNodeInput[] = [
      {
        key: "same-obstacle-source",
        lane: "geometry",
        groupKey: "same-obstacle-source-group",
        label: "Same-lane obstacle source",
      },
      {
        key: "same-blocking-hull",
        lane: "geometry",
        groupKey: "same-blocking-hull-group",
        label: "Same-lane blocking hull",
      },
      {
        key: "same-obstacle-target",
        lane: "geometry",
        groupKey: "same-obstacle-target-group",
        label: "Same-lane obstacle target",
      },
    ];
    const sameLaneEdge: readonly OverviewThreadD3FlowEdgeInput[] = [{
      key: "same-obstacle-edge",
      fromKey: "same-obstacle-source",
      toKey: "same-obstacle-target",
      pathCount: 1,
      pathKeys: ["same-obstacle-edge"],
      emphasis: false,
    }];
    const sameSourceIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "same-obstacle-source-group",
    );
    const sameObstacleIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "same-blocking-hull-group",
    );
    const sameTargetIdentity = overviewThreadD3FlowGroupIdentity(
      "geometry",
      "same-obstacle-target-group",
    );
    const sameLane = buildOverviewThreadD3FlowLayout(
      sameLaneNodes,
      sameLaneEdge,
      {
        obstacleMargin: 12,
        groupPlacements: {
          [sameSourceIdentity]: { y: 100 },
          [sameObstacleIdentity]: { x: 600, y: 145 },
          [sameTargetIdentity]: { y: 200 },
        },
      },
    );
    const sameObstacle = sameLane.groups.find((group) =>
      group.key === sameObstacleIdentity
    );
    const sameTrunk = sameLane.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(sameObstacle);
    assert(sameTrunk);
    assertEquals(sameObstacle.x, 600);
    assertEquals(sameObstacle.y, 145);
    const inflatedSameObstacle = {
      key: sameObstacle.key,
      minimumX: sameObstacle.x - 12,
      maximumX: sameObstacle.x + sameObstacle.width + 12,
      minimumY: sameObstacle.y - 12,
      maximumY: sameObstacle.y + sameObstacle.height + 12,
    };
    assertPolylineAvoidsRectangle(
      sameTrunk.points,
      inflatedSameObstacle,
      "Same-lane cable must clear the immutable intervening hull",
    );
    assertConnectedRoute(sameLane, "same-obstacle-edge");
    assert(
      overviewThreadD3CableSvgPathClear(sameTrunk.d, [
        inflatedSameObstacle,
      ]),
      "The rendered same-lane field curve must clear the intervening hull",
    );

    const unobstructedSameLane = buildOverviewThreadD3FlowLayout(
      [sameLaneNodes[0]!, sameLaneNodes[2]!],
      sameLaneEdge,
      {
        groupPlacements: {
          [sameSourceIdentity]: { y: 100 },
          [sameTargetIdentity]: { y: 200 },
        },
      },
    );
    const localTrunk = unobstructedSameLane.segments.find((segment) =>
      segment.kind === "bundle-trunk"
    );
    assert(localTrunk);
    const endpointMaximumX = Math.max(
      localTrunk.points[0]!.x,
      localTrunk.points.at(-1)!.x,
    );
    assert(
      Math.max(...localTrunk.points.map((point) => point.x)) <=
        endpointMaximumX + 24,
      "An unobstructed same-lane cable must stay local instead of creating a page-wide right bus",
    );
    assert(
      localTrunk.d.includes("C") && !localTrunk.d.includes("Q"),
      "The local same-lane return must be an actual smooth cubic field curve",
    );
    const localSegments = unobstructedSameLane.routes[0]!.segmentKeys.map(
      (key) => unobstructedSameLane.segments.find((segment) => segment.key === key)!,
    );
    assertDirectionDotAtLeast(
      localSegments[0]!.points.at(-2)!,
      localSegments[0]!.points.at(-1)!,
      localSegments[1]!.points[0]!,
      localSegments[1]!.points[1]!,
      0.97,
      "Same-lane source join must curve progressively instead of turning 90 degrees",
    );
    assertDirectionDotAtLeast(
      localSegments[1]!.points.at(-2)!,
      localSegments[1]!.points.at(-1)!,
      localSegments[2]!.points[0]!,
      localSegments[2]!.points[1]!,
      0.97,
      "Same-lane target join must curve progressively instead of turning 90 degrees",
    );
  },
);

Deno.test(
  "D3 routed path fillets corners with M/L/Q and keeps two-point routes straight",
  () => {
    const straight = overviewThreadD3FlowRoundedPath([
      { x: 0, y: 0 },
      { x: 80, y: 20 },
    ]);
    assert(straight.startsWith("M"), "Straight cable must start with M");
    assert(straight.includes("L"), "Straight cable must keep a linear command");
    assertEquals(straight.includes("Q"), false);
    assertEquals(straight.includes("C"), false);
    assertEquals(/NaN|Infinity/.test(straight), false);

    const elbow = overviewThreadD3FlowRoundedPath([
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
      { x: 80, y: 40 },
    ]);
    assert(elbow.includes("Q"), "A routed corner must emit a quadratic fillet");
    assertEquals(elbow.includes("C"), false);
    assertRoundedPathHasNoOrthogonalLinearElbow(elbow, "unit-elbow");

    const hardClearance = {
      minimumX: 48,
      maximumX: 72,
      minimumY: 8,
      maximumY: 32,
    };
    assertQuadraticPathClearsRectangle(
      elbow,
      hardClearance,
      "Unit quadratic fillet must not enter the hard-clearance rectangle",
    );
  },
);

function magneticCorridorFixture(ids: readonly string[]): {
  readonly nodes: readonly OverviewThreadD3FlowNodeInput[];
  readonly edges: readonly OverviewThreadD3FlowEdgeInput[];
} {
  const nodes = ids.flatMap((id) => [
    {
      key: `magnetic-source:${id}`,
      lane: "requirements" as const,
      groupKey: `magnetic-source-group:${id}`,
      label: `Magnetic source ${id}`,
    },
    {
      key: `magnetic-target:${id}`,
      lane: "geometry" as const,
      groupKey: `magnetic-target-group:${id}`,
      label: `Magnetic target ${id}`,
    },
  ]);
  const edges = ids.map((id) => ({
    key: `trace:${id}`,
    fromKey: `magnetic-source:${id}`,
    toKey: `magnetic-target:${id}`,
    pathCount: 1,
    pathKeys: [`trace:${id}`],
    emphasis: false,
  }));
  return { nodes, edges };
}

function magneticCorridorPlacements(
  yById: Readonly<Record<string, number>>,
): Readonly<Record<string, { readonly y: number }>> {
  const placements: Record<string, { readonly y: number }> = {};
  for (const [id, y] of Object.entries(yById)) {
    placements[
      overviewThreadD3FlowGroupIdentity(
        "requirements",
        `magnetic-source-group:${id}`,
      )
    ] = { y };
    placements[
      overviewThreadD3FlowGroupIdentity(
        "geometry",
        `magnetic-target-group:${id}`,
      )
    ] = { y };
  }
  return placements;
}

function assertMagneticGroupY(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  yById: Readonly<Record<string, number>>,
): void {
  for (const [id, expectedY] of Object.entries(yById)) {
    for (const lane of ["requirements", "geometry"] as const) {
      const prefix = lane === "requirements" ? "source" : "target";
      const groupKey = `magnetic-${prefix}-group:${id}`;
      const identity = overviewThreadD3FlowGroupIdentity(lane, groupKey);
      const group = layout.groups.find((candidate) => candidate.key === identity);
      const node = layout.nodes.find((candidate) =>
        candidate.key === `magnetic-${prefix}:${id}`
      );
      assert(group);
      assert(node);
      assertEquals(group.y, expectedY, `${identity} must keep the requested Y`);
      assertEquals(
        node.y,
        expectedY,
        `${node.key} must keep its exact hull-relative placement`,
      );
    }
  }
}

function corridorSizes(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
): readonly number[] {
  return layout.nextRoutingState.corridors.map((corridor) => corridor.pairKeys.length)
    .toSorted((left, right) => left - right);
}

function pairKeyForEdge(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  edgeKey: string,
): string {
  const trunk = layout.segments.find((segment) =>
    segment.kind === "bundle-trunk" && segment.edgeKeys.includes(edgeKey)
  );
  assert(trunk, `Missing exact pair trunk for ${edgeKey}`);
  assertEquals(trunk.pairKeys.length, 1);
  return trunk.pairKeys[0]!;
}

function corridorBackboneForPair(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  pairKey: string,
): ReturnType<typeof buildOverviewThreadD3FlowLayout>["segments"][number] {
  const backbone = layout.segments.find((segment) =>
    segment.kind === "bundle-trunk" && segment.pairKeys.includes(pairKey)
  );
  assert(backbone, `Missing corridor backbone for ${pairKey}`);
  return backbone;
}

function corridorForPair(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  pairKey: string,
): ReturnType<
  typeof buildOverviewThreadD3FlowLayout
>["nextRoutingState"]["corridors"][number] {
  const corridor = layout.nextRoutingState.corridors.find((candidate) =>
    candidate.pairKeys.includes(pairKey)
  );
  assert(corridor, `Missing magnetic corridor for ${pairKey}`);
  return corridor;
}

function hundredNodeFiveHundredEdgeFixture(): {
  readonly nodes: readonly OverviewThreadD3FlowNodeInput[];
  readonly edges: readonly OverviewThreadD3FlowEdgeInput[];
} {
  const sources: OverviewThreadD3FlowNodeInput[] = Array.from(
    { length: 50 },
    (_, index) => ({
      key: `bounded-source:${String(index).padStart(2, "0")}`,
      lane: "requirements",
      groupKey: `bounded-source-group:${Math.floor(index / 5)}`,
      label: `Bounded source ${index}`,
    }),
  );
  const targets: OverviewThreadD3FlowNodeInput[] = Array.from(
    { length: 50 },
    (_, index) => ({
      key: `bounded-target:${String(index).padStart(2, "0")}`,
      lane: "geometry",
      groupKey: `bounded-target-group:${Math.floor(index / 5)}`,
      label: `Bounded target ${index}`,
    }),
  );
  const edges: OverviewThreadD3FlowEdgeInput[] = sources.flatMap(
    (source, sourceIndex) =>
      Array.from({ length: 10 }, (_, offset) => {
        const targetIndex = (sourceIndex * 7 + offset * 3) % targets.length;
        const target = targets[targetIndex]!;
        const key = `bounded-edge:${String(sourceIndex).padStart(2, "0")}:${
          String(offset).padStart(2, "0")
        }`;
        return {
          key,
          fromKey: source.key,
          toKey: target.key,
          pathCount: 1,
          pathKeys: [key],
          emphasis: false,
        };
      }),
  );
  return { nodes: [...sources, ...targets], edges };
}

function denseFlowFixture(): {
  readonly nodes: readonly OverviewThreadD3FlowNodeInput[];
  readonly edges: readonly OverviewThreadD3FlowEdgeInput[];
} {
  const requirements: OverviewThreadD3FlowNodeInput[] = Array.from(
    { length: REQUIREMENT_COUNT },
    (_, index) => ({
      key: requirementKey(index),
      lane: "requirements",
      groupKey: `requirement-set:${Math.floor(index / 5)}`,
      label: `Scale requirement ${
        String(index + 1).padStart(2, "0")
      } - complete retained label`,
    }),
  );
  const geometryParts: OverviewThreadD3FlowNodeInput[] = Array.from(
    { length: GEOMETRY_PART_COUNT },
    (_, index) => ({
      key: geometryPartKey(index),
      lane: "geometry",
      groupKey: `geometry-assembly:${Math.floor(index / 10)}`,
      label: `Scale geometry part ${
        String(index + 1).padStart(2, "0")
      } - complete retained label`,
    }),
  );
  const edges: OverviewThreadD3FlowEdgeInput[] = requirements.flatMap(
    (requirement) =>
      geometryParts.map((part) => {
        const key = `trace:${requirement.key}>${part.key}`;
        return {
          key,
          fromKey: requirement.key,
          toKey: part.key,
          pathCount: 1,
          pathKeys: [key],
          emphasis: false,
        };
      }),
  );
  return { nodes: [...requirements, ...geometryParts], edges };
}

function repositioningFixture(): {
  readonly nodes: readonly OverviewThreadD3FlowNodeInput[];
  readonly edges: readonly OverviewThreadD3FlowEdgeInput[];
} {
  return {
    nodes: [
      {
        key: "req:model",
        lane: "requirements",
        groupKey: "shared-model",
        label: "Recorded model requirement",
      },
      {
        key: "req:load",
        lane: "requirements",
        groupKey: "shared-model",
        label: "Recorded load requirement",
      },
      {
        key: "cad:hull",
        lane: "geometry",
        groupKey: "shared-model",
        label: "Recorded hull assembly",
      },
    ],
    edges: [{
      key: "trace:model",
      fromKey: "req:model",
      toKey: "cad:hull",
      pathCount: 1,
      pathKeys: ["trace:model"],
      emphasis: false,
    }],
  };
}

function compactGeometryGroupFixture(
  count: number,
): readonly OverviewThreadD3FlowNodeInput[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `artifact:compact-part-${String(index + 1).padStart(3, "0")}`,
    lane: "geometry" as const,
    groupKey: "geometry-assembly:compact",
    label: `Compact geometry part ${
      String(index + 1).padStart(3, "0")
    } - complete retained label`,
  }));
}

function assertNoNodeBoxOverlap(
  nodes: ReturnType<typeof buildOverviewThreadD3FlowLayout>["nodes"],
): void {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex++) {
    const left = nodes[leftIndex]!;
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < nodes.length;
      rightIndex++
    ) {
      const right = nodes[rightIndex]!;
      const horizontalOverlap = left.x < right.x + right.width - EPSILON &&
        right.x < left.x + left.width - EPSILON;
      const verticalOverlap = left.y < right.y + right.height - EPSILON &&
        right.y < left.y + left.height - EPSILON;
      assert(
        !(horizontalOverlap && verticalOverlap),
        `Overlapping ${left.lane} node boxes: ${left.key} and ${right.key}`,
      );
    }
  }
}

function assertValidPathData(d: string, key: string): void {
  assert(d.startsWith("M"), `Invalid SVG path for ${key}`);
  assert(
    !/NaN|Infinity|undefined|null/.test(d),
    `Non-finite SVG path for ${key}`,
  );
}

function assertMonotoneX(
  points: readonly OverviewThreadD3FlowPoint[],
  key: string,
): void {
  assert(
    points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    `Non-finite point in ${key}`,
  );
  for (let index = 1; index < points.length; index++) {
    assert(
      points[index]!.x + EPSILON >= points[index - 1]!.x,
      `Non-monotone left-to-right flow in ${key}`,
    );
  }
}

function assertRouteJoinsC1(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  edgeKey: string,
  minimumDot: number,
): void {
  const route = layout.routes.find((candidate) => candidate.edgeKey === edgeKey);
  assert(route, `Missing route ${edgeKey}`);
  const segments = route.segmentKeys.map((key) => {
    const segment = layout.segments.find((candidate) => candidate.key === key);
    assert(segment, `Missing segment ${key}`);
    assert(segment.points.length >= 2, `${key} needs a tangent`);
    return segment;
  });
  for (let index = 1; index < segments.length; index++) {
    const previous = segments[index - 1]!;
    const next = segments[index]!;
    assertSamePoint(
      previous.points.at(-1)!,
      next.points[0]!,
      `${edgeKey} must stay connected at ${next.key}`,
    );
    const previousTangents = cubicEndpointTangents(previous.d, previous.key);
    const nextTangents = cubicEndpointTangents(next.d, next.key);
    assertDirectionDotAtLeast(
      { x: 0, y: 0 },
      previousTangents.arrival,
      { x: 0, y: 0 },
      nextTangents.departure,
      minimumDot,
      `${edgeKey} must stay C1 at ${next.key}`,
    );
  }
}

function cubicEndpointTangents(
  d: string,
  key: string,
): {
  readonly departure: OverviewThreadD3FlowPoint;
  readonly arrival: OverviewThreadD3FlowPoint;
} {
  const tokens = [...d.matchAll(
    /([MC])|(-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)/gi,
  )].map((match) => match[1] ?? Number(match[2]));
  let cursor: OverviewThreadD3FlowPoint | undefined;
  let departure: OverviewThreadD3FlowPoint | undefined;
  let arrival: OverviewThreadD3FlowPoint | undefined;
  let index = 0;
  const readNumber = (): number => {
    const token = tokens[index++];
    assert(typeof token === "number", `${key} has malformed cubic data`);
    return token;
  };
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === "M") {
      cursor = {
        x: readNumber(),
        y: readNumber(),
      };
      continue;
    }
    assert(
      command === "C" && cursor,
      `${key} must contain cubic-only geometry`,
    );
    const control1 = {
      x: readNumber(),
      y: readNumber(),
    };
    const control2 = {
      x: readNumber(),
      y: readNumber(),
    };
    const target = {
      x: readNumber(),
      y: readNumber(),
    };
    departure ??= unitVector(cursor, control1);
    arrival = unitVector(control2, target);
    cursor = target;
  }
  assert(departure, `${key} is missing its rendered departure tangent`);
  assert(arrival, `${key} is missing its rendered arrival tangent`);
  return { departure, arrival };
}

function assertDirectionDotAtLeast(
  incomingFrom: OverviewThreadD3FlowPoint,
  incomingTo: OverviewThreadD3FlowPoint,
  outgoingFrom: OverviewThreadD3FlowPoint,
  outgoingTo: OverviewThreadD3FlowPoint,
  minimumDot: number,
  message: string,
): void {
  const incoming = unitVector(incomingFrom, incomingTo);
  const outgoing = unitVector(outgoingFrom, outgoingTo);
  assert(incoming, `${message}: missing incoming tangent`);
  assert(outgoing, `${message}: missing outgoing tangent`);
  const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
  assert(
    dot >= minimumDot,
    `${message}: tangent dot ${dot} is below ${minimumDot}`,
  );
}

function unitVector(
  from: OverviewThreadD3FlowPoint,
  to: OverviewThreadD3FlowPoint,
): OverviewThreadD3FlowPoint | undefined {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const length = Math.hypot(x, y);
  if (length <= EPSILON) return undefined;
  return { x: x / length, y: y / length };
}

function assertRoundedPathHasNoOrthogonalLinearElbow(
  d: string,
  key: string,
): void {
  const commands = parseSvgPathCommands(d);
  let cursor: OverviewThreadD3FlowPoint | undefined;
  let previousLinear: OverviewThreadD3FlowPoint | undefined;
  for (const command of commands) {
    if (command.command === "M") {
      cursor = { x: command.numbers[0]!, y: command.numbers[1]! };
      previousLinear = undefined;
      continue;
    }
    if (command.command === "Q") {
      cursor = { x: command.numbers[2]!, y: command.numbers[3]! };
      previousLinear = undefined;
      continue;
    }
    if (command.command !== "L" || !cursor) continue;
    const next = { x: command.numbers[0]!, y: command.numbers[1]! };
    const direction = { x: next.x - cursor.x, y: next.y - cursor.y };
    const length = Math.hypot(direction.x, direction.y);
    if (length > EPSILON && previousLinear) {
      const previousLength = Math.hypot(previousLinear.x, previousLinear.y);
      const dot = (previousLinear.x * direction.x + previousLinear.y * direction.y) /
        (previousLength * length);
      assert(
        Math.abs(dot) > 0.08,
        `Orthogonal L elbow in ${key} at (${cursor.x}, ${cursor.y})`,
      );
    }
    if (length > EPSILON) previousLinear = direction;
    cursor = next;
  }
}

function assertQuadraticPathClearsRectangle(
  d: string,
  rectangle: {
    readonly minimumX: number;
    readonly maximumX: number;
    readonly minimumY: number;
    readonly maximumY: number;
  },
  message: string,
): void {
  const commands = parseSvgPathCommands(d);
  let cursor: OverviewThreadD3FlowPoint | undefined;
  for (const command of commands) {
    if (command.command === "M") {
      cursor = { x: command.numbers[0]!, y: command.numbers[1]! };
      continue;
    }
    if (command.command === "L") {
      const next = { x: command.numbers[0]!, y: command.numbers[1]! };
      if (cursor) {
        assert(
          !segmentIntersectsRectangle(cursor, next, rectangle),
          `${message}: linear span intersects the hard-clearance rectangle`,
        );
      }
      cursor = next;
      continue;
    }
    if (command.command !== "Q" || !cursor) continue;
    const control = { x: command.numbers[0]!, y: command.numbers[1]! };
    const end = { x: command.numbers[2]!, y: command.numbers[3]! };
    const samples = sampleQuadraticBezier(cursor, control, end, 16);
    for (let index = 1; index < samples.length; index++) {
      assert(
        !segmentIntersectsRectangle(
          samples[index - 1]!,
          samples[index]!,
          rectangle,
        ),
        `${message}: quadratic primitive entered the hard-clearance rectangle`,
      );
    }
    cursor = end;
  }
}

function sampleQuadraticBezier(
  start: OverviewThreadD3FlowPoint,
  control: OverviewThreadD3FlowPoint,
  end: OverviewThreadD3FlowPoint,
  steps: number,
): readonly OverviewThreadD3FlowPoint[] {
  const samples: OverviewThreadD3FlowPoint[] = [];
  for (let index = 0; index <= steps; index++) {
    const t = index / steps;
    const rest = 1 - t;
    samples.push({
      x: rest * rest * start.x + 2 * rest * t * control.x + t * t * end.x,
      y: rest * rest * start.y + 2 * rest * t * control.y + t * t * end.y,
    });
  }
  return samples;
}

function parseSvgPathCommands(
  d: string,
): readonly { readonly command: string; readonly numbers: number[] }[] {
  const commands: { command: string; numbers: number[] }[] = [];
  const matcher = /([MLQ])([^MLQ]*)/g;
  for (const match of d.matchAll(matcher)) {
    commands.push({
      command: match[1]!,
      numbers: match[2]!.trim().split(/[\s,]+/).filter(Boolean).map(Number),
    });
  }
  return commands;
}

function assertPolylineAvoidsRectangle(
  points: readonly OverviewThreadD3FlowPoint[],
  rectangle: {
    readonly minimumX: number;
    readonly maximumX: number;
    readonly minimumY: number;
    readonly maximumY: number;
  },
  message: string,
): void {
  for (let index = 1; index < points.length; index++) {
    assert(
      !segmentIntersectsRectangle(
        points[index - 1]!,
        points[index]!,
        rectangle,
      ),
      message,
    );
  }
}

function pointInsideRectangle(
  point: OverviewThreadD3FlowPoint,
  rectangle: {
    readonly minimumX: number;
    readonly maximumX: number;
    readonly minimumY: number;
    readonly maximumY: number;
  },
): boolean {
  return point.x >= rectangle.minimumX &&
    point.x <= rectangle.maximumX &&
    point.y >= rectangle.minimumY &&
    point.y <= rectangle.maximumY;
}

function segmentIntersectsRectangle(
  source: OverviewThreadD3FlowPoint,
  target: OverviewThreadD3FlowPoint,
  rectangle: {
    readonly minimumX: number;
    readonly maximumX: number;
    readonly minimumY: number;
    readonly maximumY: number;
  },
): boolean {
  let minimumT = 0;
  let maximumT = 1;
  const deltaX = target.x - source.x;
  const deltaY = target.y - source.y;
  const clips: readonly [number, number][] = [
    [-deltaX, source.x - rectangle.minimumX],
    [deltaX, rectangle.maximumX - source.x],
    [-deltaY, source.y - rectangle.minimumY],
    [deltaY, rectangle.maximumY - source.y],
  ];
  for (const [direction, distance] of clips) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const ratio = distance / direction;
    if (direction < 0) minimumT = Math.max(minimumT, ratio);
    else maximumT = Math.min(maximumT, ratio);
    if (minimumT > maximumT) return false;
  }
  return maximumT >= 0 && minimumT <= 1;
}

function polylineLength(
  points: readonly OverviewThreadD3FlowPoint[],
): number {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index]!.x - points[index - 1]!.x,
      points[index]!.y - points[index - 1]!.y,
    );
  }
  return length;
}

function assertSamePoint(
  actual: OverviewThreadD3FlowPoint,
  expected: OverviewThreadD3FlowPoint,
  message: string,
): void {
  assert(
    Math.abs(actual.x - expected.x) <= EPSILON &&
      Math.abs(actual.y - expected.y) <= EPSILON,
    message,
  );
}

function collectRoutePoints(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  edgeKey: string,
): readonly OverviewThreadD3FlowPoint[] {
  return assertConnectedRoute(layout, edgeKey);
}

function assertConnectedRoute(
  layout: ReturnType<typeof buildOverviewThreadD3FlowLayout>,
  edgeKey: string,
): readonly OverviewThreadD3FlowPoint[] {
  const route = layout.routes.find((candidate) => candidate.edgeKey === edgeKey);
  assert(route, `Missing route ${edgeKey}`);
  const segmentByKey = new Map(
    layout.segments.map((segment) => [segment.key, segment]),
  );
  const points: OverviewThreadD3FlowPoint[] = [];
  for (const segmentKey of route.segmentKeys) {
    const segment = segmentByKey.get(segmentKey);
    assert(segment, `Missing segment ${segmentKey}`);
    if (points.length > 0) {
      assertSamePoint(
        points.at(-1)!,
        segment.points[0]!,
        `Disconnected route ${edgeKey} at ${segmentKey}`,
      );
    }
    points.push(...segment.points.slice(points.length > 0 ? 1 : 0));
  }
  return points;
}

function byKey(
  left: { readonly key: string },
  right: { readonly key: string },
): number {
  return left.key.localeCompare(right.key);
}

function distinctCoordinateCount(values: readonly number[]): number {
  return new Set(values.map((value) => value.toFixed(6))).size;
}

function requirementKey(index: number): string {
  return `requirement:scale-${String(index + 1).padStart(2, "0")}`;
}

function geometryPartKey(index: number): string {
  return `artifact:scale-part-${String(index + 1).padStart(2, "0")}`;
}
