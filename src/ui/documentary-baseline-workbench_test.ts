import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("documentary baseline Workbench is a quiet provenance record, not an evidence dashboard", async () => {
  const source = await Deno.readTextFile(
    new URL(
      "./src/project/documentary-baseline-workbench.tsx",
      import.meta.url,
    ),
  );

  assertStringIncludes(source, "export function DocumentaryBaselineWorkbench");
  assertStringIncludes(source, "DURABLE STARTING RECORD");
  assertStringIncludes(source, "WHAT THIS DOES NOT PROVE");
  assertStringIncludes(source, "Exact documentary record");
  assertStringIncludes(source, "No SysML model or CAD geometry is recorded.");

  for (
    const forbiddenEvidenceViewer of [
      "ThreadGraph",
      "ThreadFeed",
      "ComponentWorkspace",
      "ToolInspectorPanel",
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
