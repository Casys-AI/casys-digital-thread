import { assertEquals } from "@std/assert";
import {
  overviewThreadD3CableHub,
  overviewThreadD3CableTerminal,
} from "./src/project/overview-thread-d3-cable-board.ts";

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
