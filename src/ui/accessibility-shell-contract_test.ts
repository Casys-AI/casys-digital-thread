import { assertEquals, assertStringIncludes } from "@std/assert";

function occurrences(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

function relativeLuminance(hex: string): number {
  const channels =
    hex.slice(1).match(/../g)?.map((pair) => Number.parseInt(pair, 16) / 255) ??
      [];
  const linear = channels.map((channel) =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

Deno.test("every project view exposes one focusable main landmark and a working skip link", async () => {
  const preview = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const planning = await Deno.readTextFile(
    new URL("./src/project/planning-workbench.tsx", import.meta.url),
  );
  const documentary = await Deno.readTextFile(
    new URL(
      "./src/project/documentary-baseline-workbench.tsx",
      import.meta.url,
    ),
  );

  assertStringIncludes(preview, 'className="skip-link"');
  assertStringIncludes(preview, 'href="#project-workspace-panel"');
  assertStringIncludes(preview, '"project-workspace-panel",');
  assertStringIncludes(preview, 'getElementById("native-preview-content")');
  assertStringIncludes(preview, 'id="native-preview-content"');
  assertStringIncludes(preview, "tabIndex={-1}");
  assertStringIncludes(preview, "?.focus()");

  assertEquals(occurrences(overview, /<main\b/g), 1);
  assertStringIncludes(overview, 'id="project-workspace-panel"');
  assertStringIncludes(overview, "tabIndex={-1}");

  assertEquals(occurrences(workbench, /<main\b/g), 1);
  const sharedViewStart = workbench.indexOf(
    "<main\n            className={`thread-flow-section",
  );
  const sharedViewEnd = workbench.indexOf("</main>", sharedViewStart);
  assertEquals(sharedViewStart >= 0, true);
  assertEquals(sharedViewEnd > sharedViewStart, true);
  const sharedView = workbench.slice(sharedViewStart, sharedViewEnd);
  assertStringIncludes(sharedView, 'id="project-workspace-panel"');
  assertStringIncludes(sharedView, "tabIndex={-1}");

  assertStringIncludes(planning, 'id="project-workspace-panel"');
  assertStringIncludes(planning, "tabIndex={-1}");
  assertEquals(
    occurrences(documentary, /id="project-workspace-panel"/g),
    2,
  );
  assertEquals(occurrences(documentary, /tabIndex=\{-1\}/g), 2);
});

Deno.test("Overview captions use the readable cockpit token", async () => {
  const hero = await Deno.readTextFile(
    new URL("./src/project/overview-thread-hero.tsx", import.meta.url),
  );
  const atelier = await Deno.readTextFile(
    new URL("./src/styles/10-light-atelier.css", import.meta.url),
  );
  const tokens = await Deno.readTextFile(
    new URL("./src/styles/01-tokens-and-console.css", import.meta.url),
  );

  assertEquals(hero.includes('fill="#a1a1aa"'), false);
  assertStringIncludes(hero, 'return "var(--thread-muted)"');

  const muted = atelier.match(/--thread-muted:\s*(#[0-9a-f]{6})/i)?.[1];
  const panel = tokens.match(/--surface-1:\s*(#[0-9a-f]{6})/i)?.[1];
  assertEquals(muted !== undefined, true);
  assertEquals(panel !== undefined, true);
  assertEquals(contrastRatio(muted!, panel!) >= 4.5, true);
});
