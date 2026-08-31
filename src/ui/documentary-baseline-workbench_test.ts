import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("documentary baseline stays inside the project cockpit, without pretending it has evidence", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "./src/project/documentary-baseline-workbench.tsx",
      import.meta.url,
    ),
  );

  assertStringIncludes(source, "export function DocumentaryBaselineWorkbench");
  assertStringIncludes(source, "Durable starting record");
  assertStringIncludes(source, "What this does not prove");
  assertStringIncludes(source, "Exact documentary record");
  assertStringIncludes(source, "No SysML model or CAD geometry is recorded.");
  assertStringIncludes(source, "ProjectNavigation");
  assertStringIncludes(source, "ProjectWorkRibbon");
  assertStringIncludes(source, "Intent to technical proof");
  assertStringIncludes(source, "phaseStatusLabel");
  assertStringIncludes(source, "No product definition is recorded yet");
  assertStringIncludes(source, "No verification chain is recorded yet");

  for (
    const forbiddenEvidenceViewer of [
      "ThreadGraph",
      "ThreadFeed",
      "ComponentWorkspace",
      "RecordInspectorPanel",
      "thread.graph",
      "thread.components",
      "callTool(",
    ]
  ) {
    assertEquals(
      source.includes(forbiddenEvidenceViewer),
      false,
      forbiddenEvidenceViewer,
    );
  }

  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  assertStringIncludes(workbench, "DocumentaryBaselineWorkbench");
  assertStringIncludes(workbench, 'workbench.surface === "documentary"');
});

Deno.test("a failed documentary technical start makes the main project seal require review", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "./src/project/documentary-baseline-workbench.tsx",
      import.meta.url,
    ),
  );

  assertStringIncludes(
    source,
    "documentaryProjectStatusSeal(brief, technicalStart)",
  );
  assertStringIncludes(source, 'technicalStart?.state === "failed"');
  assertStringIncludes(source, 'tone: "attention", label: "Review required"');
  assertStringIncludes(source, "data-tone={statusSeal.tone}");
  assertStringIncludes(source, "Project status: ${statusSeal.label}");
});
