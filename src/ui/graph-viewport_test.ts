import { assertEquals } from "@std/assert";
import { canvasComponentRowWidth, graphViewport } from "./src/thread/graph-viewport.ts";
import type { ThreadGraphRef } from "./src/thread/types.ts";

Deno.test("graph viewport fits the complete thread and bounds a focused zoom", () => {
  const layout = {
    width: 940,
    height: 340,
    nodes: [
      { node: { ref: ref("brief") }, x: 36, y: 46 },
      { node: { ref: ref("cad") }, x: 364, y: 46 },
      { node: { ref: ref("result") }, x: 692, y: 46 },
    ],
  };

  const fit = graphViewport(layout, 1);
  const focused = graphViewport(layout, 8, ref("result"));

  assertEquals(fit, {
    x: 0,
    y: 0,
    width: layout.width,
    height: layout.height,
    zoom: 1,
  });
  assertEquals(focused.zoom, 4.5);
  assertEquals(focused.width, layout.width / 4.5);
  assertEquals(focused.height, layout.height / 4.5);
  assertEquals(
    focused.x >= 0 && focused.x <= layout.width - focused.width,
    true,
  );
  assertEquals(
    focused.y >= 0 && focused.y <= layout.height - focused.height,
    true,
  );
});

Deno.test("graph viewport adopts a wide canvas ratio without cropping overview", () => {
  const layout = {
    width: 1272,
    height: 1592,
    nodes: [
      { node: { ref: ref("top") }, x: 36, y: 46 },
      { node: { ref: ref("bottom") }, x: 1020, y: 1460 },
    ],
  };
  const canvasRatio = 1224 / 512;
  const fit = graphViewport(layout, 1, undefined, {
    aspectRatio: canvasRatio,
  });

  assertEquals(Math.abs((fit.width / fit.height) - canvasRatio) < 0.0001, true);
  assertEquals(fit.x <= 0 && fit.y <= 0, true);
  assertEquals(fit.x + fit.width >= layout.width, true);
  assertEquals(fit.y + fit.height >= layout.height, true);
});

Deno.test("native ultra-wide context fit never crops its outer nodes", () => {
  const layout = {
    width: 1264,
    height: 274,
    nodes: [
      { node: { ref: ref("left") }, x: 36, y: 46 },
      { node: { ref: ref("right") }, x: 1012, y: 46 },
    ],
  };
  const fit = graphViewport(layout, 1);

  assertEquals(fit, {
    x: 0,
    y: 0,
    width: layout.width,
    height: layout.height,
    zoom: 1,
  });
});

Deno.test("large portrait graph keeps a selected fact readable and pannable", () => {
  const layout = {
    width: 1272,
    height: 1592,
    nodes: [
      { node: { ref: ref("top") }, x: 36, y: 46 },
      { node: { ref: ref("bottom") }, x: 1020, y: 1460 },
    ],
  };
  const canvasWidth = 1224;
  const canvasHeight = 512;
  const focused = graphViewport(layout, 3.25, ref("bottom"), {
    aspectRatio: canvasWidth / canvasHeight,
  });
  const panned = graphViewport(layout, 3.25, undefined, {
    aspectRatio: canvasWidth / canvasHeight,
    center: { x: 0, y: 0 },
  });
  const labelPixels = 12 * (canvasHeight / focused.height);

  assertEquals(labelPixels >= 8, true);
  assertEquals(focused.y > panned.y, true);
  assertEquals(focused.y + focused.height <= layout.height, true);
  assertEquals(
    canvasComponentRowWidth(canvasWidth / canvasHeight) > 2200,
    true,
  );
});

Deno.test("real 64-fact graph opens at a readable inspection scale", () => {
  // Dimensions measured from the canonical generic-product graph after its
  // wide-canvas component packing.
  const layout = {
    width: 5369,
    height: 2636,
    nodes: [{ node: { ref: ref("selected") }, x: 2710, y: 1240 }],
  };
  const canvasWidth = 1232;
  const canvasHeight = 605;
  const viewport = graphViewport(layout, 3.25, ref("selected"), {
    aspectRatio: canvasWidth / canvasHeight,
  });
  const nodeLabelPixels = 12 * Math.min(
    canvasWidth / viewport.width,
    canvasHeight / viewport.height,
  );

  assertEquals(nodeLabelPixels >= 8, true);
  assertEquals(
    Math.abs(
      (viewport.width / viewport.height) -
        (canvasWidth / canvasHeight),
    ) < 0.0001,
    true,
  );
});

function ref(id: string): ThreadGraphRef {
  return { kind: "artifact", id };
}
