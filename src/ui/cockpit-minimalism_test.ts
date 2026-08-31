import { assertEquals, assertStringIncludes } from "@std/assert";

function occurrences(source: string, value: string): number {
  return source.split(value).length - 1;
}

Deno.test("project surfaces share one ProjectNavigation header without a second cockpit header", async () => {
  const navigation = await Deno.readTextFile(
    new URL("./src/project/navigation.tsx", import.meta.url),
  );
  const navigationModel = await Deno.readTextFile(
    new URL("./src/project/navigation-model.ts", import.meta.url),
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

  assertStringIncludes(navigation, "export function ProjectNavigation");
  for (
    const label of [
      'label: "Project"',
      'label: "Activity"',
      'label: "Product"',
      'label: "Evidence"',
      'label: "Systems & runs"',
    ]
  ) {
    assertStringIncludes(navigationModel, label);
  }
  for (const surface of [workbench, planning, documentary]) {
    assertEquals(occurrences(surface, "<ProjectNavigation"), 1);
    assertEquals(surface.includes("<ProjectCockpitHeader"), false);
    assertEquals(surface.includes("ProjectCockpitHeader,"), false);
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

Deno.test("the single navigation header keeps agent activity and exact projection freshness", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertStringIncludes(workbench, "buildAgentNowPresentation(project)");
  assertStringIncludes(workbench, 'label: "Last agent run"');
  assertStringIncludes(workbench, "<ProjectNavigation");
  assertStringIncludes(workbench, 'className="project-navigation-agent"');
  assertStringIncludes(
    workbench,
    "title={`${agentHeader.label}: ${agentHeader.value}`}",
  );
  assertStringIncludes(workbench, "<strong>{agentHeader.value}</strong>");
  assertStringIncludes(workbench, 'className="project-navigation-time"');
  assertStringIncludes(workbench, "dateTime={snapshot.generatedAt}");
  assertStringIncludes(
    workbench,
    "title={`Projection ${snapshot.generatedAt}`}",
  );
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
