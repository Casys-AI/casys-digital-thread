import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Collapsible wraps Radix and is the disclosure for earlier gates and project pulse", async () => {
  const primitive = await Deno.readTextFile(
    new URL("./src/ui/collapsible.tsx", import.meta.url),
  );
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );

  assertStringIncludes(primitive, 'from "@radix-ui/react-collapsible"');
  assertStringIncludes(primitive, "export const Collapsible");
  assertStringIncludes(primitive, "export function CollapsibleTrigger");
  assertStringIncludes(primitive, "export function CollapsibleContent");

  assertStringIncludes(overview, 'from "../ui/collapsible.tsx"');
  assertStringIncludes(overview, "earlier gates satisfied");
  assertStringIncludes(overview, "<Collapsible");
  assertStringIncludes(overview, "<CollapsibleTrigger");
  assertStringIncludes(overview, "<CollapsibleContent");
  assertEquals(
    overview.includes('<details className="min-w-0 pb-3">'),
    false,
    "collapsed earlier gates must not stay on native details",
  );

  assertStringIncludes(workbench, 'from "../ui/collapsible.tsx"');
  assertStringIncludes(workbench, "Project pulse");
  assertStringIncludes(workbench, "<Collapsible");
  assertStringIncludes(workbench, "projectPulseStatus");
  assertEquals(
    workbench.includes('className="group mb-3"'),
    true,
  );
  assertEquals(
    /<details[\s\S]*Project pulse/.test(workbench),
    false,
    "Activity project pulse must not stay on native details",
  );
});

Deno.test("collapsed earlier gates and compact spine keep planned completed as Badge text", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const collapsedStart = overview.indexOf("collapsedGates.length > 0");
  const collapsedEnd = overview.indexOf("visiblePhases.map", collapsedStart);
  const collapsed = overview.slice(collapsedStart, collapsedEnd);

  assertEquals(collapsedStart >= 0, true);
  assertEquals(collapsedEnd > collapsedStart, true);
  assertStringIncludes(collapsed, "<Badge");
  assertStringIncludes(
    collapsed,
    "variant={recordStatusVariant(item.status)}",
  );
  assertStringIncludes(collapsed, "{phaseStatusLabel(item.status)}");
  assertEquals(
    collapsed.includes('className="sr-only"'),
    false,
    "collapsed gates must not hide phase status as sr-only",
  );

  const compactStart = overview.indexOf("// Pas de ligne lifecycle en compact");
  const compactEnd = overview.indexOf("function NowPanel", compactStart);
  const compact = overview.slice(compactStart, compactEnd);
  assertEquals(compactStart >= 0, true);
  assertStringIncludes(compact, "<Badge");
  assertStringIncludes(
    compact,
    "variant={recordStatusVariant(item.status)}",
  );
  assertStringIncludes(compact, "{phaseStatusLabel(item.status)}");
  assertEquals(
    compact.includes('className="sr-only"'),
    false,
    "compact spine phases must not hide planned as sr-only",
  );
});

Deno.test("Activity project pulse keeps planned cancelled completed as Badge text on the trigger", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const start = workbench.indexOf('activeView === "work" &&');
  const end = workbench.indexOf('activeView === "verification" &&', start);
  const pulse = workbench.slice(start, end);

  assertEquals(start >= 0, true);
  assertEquals(end > start, true);
  assertStringIncludes(pulse, "<CollapsibleTrigger");
  assertStringIncludes(pulse, "pulseStatus");
  assertStringIncludes(pulse, "<Badge");
  assertStringIncludes(
    pulse,
    "variant={recordStatusVariant(pulseStatus.status)}",
  );
  assertStringIncludes(pulse, "{pulseStatus.label}");
  assertStringIncludes(pulse, "data-state={pulseStatus.status}");
});
