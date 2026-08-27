import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("project surfaces share one compact cockpit header", async () => {
  const navigation = await Deno.readTextFile(
    new URL("./src/project/navigation.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
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

  assertStringIncludes(navigation, "export function ProjectCockpitHeader");
  for (const surface of [workbench, planning, documentary]) {
    assertStringIncludes(surface, "<ProjectCockpitHeader");
    assertEquals(surface.includes("ENGINEERING PROJECT COCKPIT"), false);
    assertEquals(surface.includes('className="thread-subject-mark"'), false);
    assertEquals(surface.includes('className="thread-session-panel"'), false);
  }
});

Deno.test("cockpit wayfinding keeps descriptions accessible without a second label row", async () => {
  const navigation = await Deno.readTextFile(
    new URL("./src/project/navigation.tsx", import.meta.url),
  );
  const navigationBody = navigation.slice(
    navigation.indexOf("export function ProjectNavigation"),
  );

  assertStringIncludes(navigationBody, "aria-label={`${view.label}: ${");
  assertEquals(navigationBody.includes("<small>"), false);
});

Deno.test("the compact header keeps agent activity and exact projection freshness", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertStringIncludes(workbench, "buildAgentNowPresentation(project)");
  assertStringIncludes(workbench, 'label: "Last agent run"');
  assertStringIncludes(workbench, "statusLabel={agentHeader.label}");
  assertStringIncludes(workbench, "title={agentHeader.value}");
  assertStringIncludes(workbench, 'metaLabel="Projection"');
  assertStringIncludes(workbench, "dateTime={snapshot.generatedAt}");
  assertStringIncludes(workbench, "title={snapshot.generatedAt}");
  assertStringIncludes(workbench, "formatTime(snapshot.generatedAt)");
  assertEquals(
    workbench.includes("metaValue={formatTime(project.generatedAt)}"),
    false,
  );
});

Deno.test("removed decorative chrome cannot come back", async () => {
  // Chaque entrée est un ornement retiré lors d'une passe de simplification :
  // le test garde la porte, sans figer le style qui l'a remplacé.
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
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

  assertEquals(overview.includes("project-objective-index"), false);
  assertEquals(
    overview.includes("One product, three ways to inspect it"),
    false,
  );
  assertEquals(workbench.includes("thread-operator-contract"), false);
  assertEquals(workbench.includes("<span>PROJECT PULSE</span>"), false);
  assertEquals(planning.includes("planning-baseline-mark"), false);
  assertEquals(documentary.includes("documentary-baseline-mark"), false);
});
