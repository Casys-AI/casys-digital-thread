import { assert, assertEquals } from "@std/assert";
import {
  overviewThreadD3CableHub,
  overviewThreadD3CableHullSides,
  overviewThreadD3CableTerminal,
} from "./src/project/overview-thread-d3-cable-board.ts";
import { overviewThreadD3CableSidesForBoxes } from "./src/project/overview-thread-d3-cable-anchorage.ts";

Deno.test(
  "left/right hubs sit on the content band, not on a reserved header",
  () => {
    const hull = {
      key: "group:compact",
      x: 44,
      y: 150,
      width: 112,
      height: 34,
      hubMargin: 20,
      headerHeight: 24,
      footerHeight: 0,
    };
    const leaf = { key: "leaf", x: 44, y: 174, width: 10, height: 10 };
    const right = overviewThreadD3CableHub(hull, "right");
    const left = overviewThreadD3CableHub(hull, "left");
    const top = overviewThreadD3CableHub(hull, "top");
    const terminal = overviewThreadD3CableTerminal(
      hull,
      leaf,
      "right",
      "source",
    );

    assertEquals(right, { x: 176, y: 179 });
    assertEquals(left, { x: 24, y: 179 });
    assertEquals(top, { x: 100, y: 130 });
    assertEquals(terminal.hub, right);
    assertEquals(terminal.port, { x: 54, y: 179 });
  },
);

function testHull(
  key: string,
  x: number,
  y: number,
  width = 112,
  height = 80,
) {
  return {
    key,
    x,
    y,
    width,
    height,
    hubMargin: 20,
    headerHeight: 24,
    footerHeight: 0,
  };
}

Deno.test(
  "hull side selection stays left/right for every relative placement",
  () => {
    const source = testHull("source", 40, 80);
    const placements = [
      testHull("side-by-side", 240, 80),
      testHull("stacked", 40, 200),
      testHull("stacked-touching", 40, 160),
      testHull("close-gap", 160, 90),
      testHull("partial-overlap", 80, 100),
      testHull("identical", 40, 80),
      testHull("left-of-source", -160, 40),
      testHull("below-right", 90, 220),
      testHull("drag-over", 36, 70, 140, 90),
    ];
    const before = JSON.stringify(source);

    for (const target of placements) {
      const targetBefore = JSON.stringify(target);
      for (const preferred of ["left-to-right", "right-to-left"] as const) {
        const sides = overviewThreadD3CableHullSides(
          source,
          target,
          preferred,
        );
        assert(
          sides.source === "left" || sides.source === "right",
          `${target.key} source must stay lateral, got ${sides.source}`,
        );
        assert(
          sides.target === "left" || sides.target === "right",
          `${target.key} target must stay lateral, got ${sides.target}`,
        );
        const sourceHub = overviewThreadD3CableHub(source, sides.source);
        const targetHub = overviewThreadD3CableHub(target, sides.target);
        assert(
          Math.hypot(
            sourceHub.x - targetHub.x,
            sourceHub.y - targetHub.y,
          ) > 1,
          `${target.key} hubs must not coincide`,
        );
      }
      assertEquals(JSON.stringify(target), targetBefore);
    }
    assertEquals(JSON.stringify(source), before);

    const stackedTarget = testHull("stacked", 40, 200);
    const stacked = overviewThreadD3CableHullSides(source, stackedTarget);
    assertEquals(stacked, { source: "right", target: "right" });
    const genericStacked = overviewThreadD3CableSidesForBoxes(
      source,
      stackedTarget,
    );
    assert(
      genericStacked.source === "top" || genericStacked.source === "bottom",
      "The generic four-side primitive may still choose top/bottom",
    );

    const facing = overviewThreadD3CableHullSides(
      source,
      testHull("facing", 240, 80),
    );
    assertEquals(facing, { source: "right", target: "left" });
    const tight = overviewThreadD3CableHullSides(
      source,
      testHull("tight", 156, 80),
    );
    assertEquals(tight, { source: "left", target: "right" });
  },
);
