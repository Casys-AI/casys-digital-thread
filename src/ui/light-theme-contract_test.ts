import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

const STYLE_FILES = [
  "03-cockpit-shell.css",
  "04-feed-and-graph.css",
  "05-tool-drawer.css",
  "06-component-workspace.css",
  "16-refined-cockpit.css",
  "17-saas-shell.css",
] as const;

Deno.test("the application keeps native controls light after the shared MCP theme loads", async () => {
  const tokens = await Deno.readTextFile(
    new URL("./src/styles/01-tokens-and-console.css", import.meta.url),
  );

  assertMatch(
    tokens,
    /html:root\s*{[^}]*color-scheme:\s*light;/s,
  );
  assertStringIncludes(tokens, "--mcp-view-panel: var(--surface-1);");
  assertStringIncludes(tokens, "--mcp-view-text: var(--text);");
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

Deno.test("the 3D viewers cannot reintroduce a dark scene background", async () => {
  // La teinte exacte est un choix de design ; l'invariant est qu'aucun canvas
  // WebGL ne repasse sur le fond sombre du thème abandonné.
  for (
    const file of [
      "./src/thread/component-workspace.tsx",
      "./src/thread/gltf-asset-canvas.tsx",
      "./src/project/control-center.tsx",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(file, import.meta.url));
    assertEquals(source.includes("0x0b0f10"), false, file);
    assertEquals(source.includes("0x1a1c1e"), false, file);
  }
});
