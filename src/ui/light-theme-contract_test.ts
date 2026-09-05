import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

const STYLE_FILES = [
  "04-feed-and-graph.css",
  "05-tool-drawer.css",
  "06-compact-identifier.css",
  "17-saas-shell.css",
  "18-overview-thread-flow.css",
  "18-desktop-chat.css",
] as const;

Deno.test("the application keeps native controls light under the cockpit theme remaps", async () => {
  const tokens = await Deno.readTextFile(
    new URL("./src/styles/01-tokens-and-console.css", import.meta.url),
  );

  assertMatch(
    tokens,
    /html:root\s*{[^}]*color-scheme:\s*light;/s,
  );
  assertStringIncludes(tokens, "--cockpit-panel: var(--surface-1);");
  assertStringIncludes(tokens, "--cockpit-text: var(--text);");
});

Deno.test("cockpit style families cannot reintroduce dark surface backgrounds", async () => {
  const declarations: string[] = [];
  const background = /background(?:-color)?\s*:\s*([^;]+);/gi;
  const color =
    /#([0-9a-f]{6}|[0-9a-f]{3})\b|rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})(?:\s*,\s*([\d.]+))?\s*\)/gi;

  for (const file of STYLE_FILES) {
    const css = await Deno.readTextFile(
      new URL(`./src/styles/${file}`, import.meta.url),
    );
    for (const declaration of css.matchAll(background)) {
      for (const literal of declaration[1].matchAll(color)) {
        const hex = literal[1]?.length === 3
          ? literal[1].split("").map((digit) => `${digit}${digit}`).join("")
          : literal[1];
        const [red, green, blue] = hex
          ? [0, 2, 4].map((offset) =>
            Number.parseInt(hex.slice(offset, offset + 2), 16)
          )
          : [literal[2], literal[3], literal[4]].map(Number);
        const alpha = literal[5] === undefined ? 1 : Number(literal[5]);
        const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
        if (alpha >= 0.2 && luminance < 96) {
          declarations.push(
            `${file}: ${declaration[0].replaceAll(/\s+/g, " ")}`,
          );
        }
      }
    }
  }

  assertEquals(declarations, []);
});

Deno.test("Project Chat cannot carry a private literal colour palette", async () => {
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertEquals(styles.match(/#[0-9a-f]{3,8}\b/gi), null);
  assertEquals(styles.match(/rgba?\(/gi), null);
  assertStringIncludes(styles, "var(--ui-background)");
  assertStringIncludes(styles, "var(--ui-border)");
  assertStringIncludes(styles, "var(--ui-brand)");
});

Deno.test("retired mcp-view card selectors cannot come back", async () => {
  const theme = await Deno.readTextFile(
    new URL("./src/view/mcp-view-theme.ts", import.meta.url),
  );
  assertEquals(theme.includes(".mcp-view-card"), false);
  assertEquals(theme.includes(".mcp-view-badge"), false);

  for (
    const file of [
      ...STYLE_FILES,
      "01-tokens-and-console.css",
      "10-light-atelier.css",
      "11-review-notifications.css",
    ]
  ) {
    const css = await Deno.readTextFile(
      new URL(`./src/styles/${file}`, import.meta.url),
    );
    assertEquals(css.includes(".mcp-view-"), false, file);
  }
});

Deno.test("Digital Thread does not bundle a native 3D renderer", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const controlCenter = await Deno.readTextFile(
    new URL("./src/project/control-center.tsx", import.meta.url),
  );
  const packageJson = await Deno.readTextFile(
    new URL("./package.json", import.meta.url),
  );
  for (const source of [workbench, controlCenter, packageJson]) {
    assertEquals(source.includes('from "three"'), false);
    assertEquals(source.includes("GltfAssetCanvas"), false);
    assertEquals(source.includes("STLLoader"), false);
  }
  assertEquals(packageJson.includes('"three"'), false);
  assertEquals(packageJson.includes('"@types/three"'), false);
});
