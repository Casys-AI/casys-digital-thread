import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("Collapsible wraps Ark UI and is the disclosure for earlier gates", async () => {
  const primitive = await Deno.readTextFile(
    new URL("./src/ui/collapsible.tsx", import.meta.url),
  );
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );

  assertStringIncludes(primitive, 'from "@ark-ui/react/collapsible"');
  assertStringIncludes(primitive, "export function Collapsible");
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
});

Deno.test("earlier gates expand below the spine and follow the five thread lanes", async () => {
  const overview = await Deno.readTextFile(
    new URL("./src/project/overview.tsx", import.meta.url),
  );
  const historyStart = overview.indexOf("function EarlierGatesPanel");
  const historyEnd = overview.indexOf("function Chevron", historyStart);
  const history = overview.slice(historyStart, historyEnd);

  assertEquals(historyStart >= 0, true);
  assertEquals(historyEnd > historyStart, true);
  assertStringIncludes(overview, "groupProjectPathGatesByLane");
  assertStringIncludes(overview, 'data-project-path-history="lanes"');
  assertStringIncludes(
    overview,
    '<CollapsibleContent className="border-t border-border bg-muted/20',
  );
  assertEquals(
    overview.includes("collapsedGates.map"),
    false,
    "the top-level disclosure must not render a flat list of every old gate",
  );
  assertStringIncludes(history, "groups.map");
  assertStringIncludes(history, "<Collapsible");
  assertStringIncludes(history, "<Badge");
  assertStringIncludes(history, "variant={recordStatusVariant(item.status)}");
  assertStringIncludes(history, "{phaseStatusLabel(item.status)}");
  assertEquals(
    history.includes('className="sr-only"'),
    false,
    "expanded historical gates must not hide phase status as sr-only",
  );

  const compactStart = overview.indexOf("// Pas de ligne lifecycle en compact");
  const compactEnd = overview.indexOf("function NowPanel", compactStart);
  const compact = overview.slice(compactStart, compactEnd);
  assertEquals(compactStart >= 0, true);
  // Le bandeau n'écrit plus le statut sous chaque gate — répété huit fois il
  // cassait la ligne. Il doit rester dans le nom accessible de l'étape, et
  // l'état doit se distinguer par la FORME du nœud, pas par la seule couleur.
  const spineStart = overview.indexOf("function SpinePhase(");
  const spine = overview.slice(
    spineStart,
    overview.indexOf("function ", spineStart + 10),
  );
  assertStringIncludes(spine, "phaseStatusLabel(item.status)");
  assertStringIncludes(spine, "aria-label=");
  assertStringIncludes(overview, "border-2 border-success bg-background");
  assertEquals(
    compact.includes('className="sr-only"'),
    false,
    "compact spine phases must not hide planned as sr-only",
  );
});

Deno.test("the Work ribbon stays visible instead of a collapsed Project pulse", async () => {
  const workbench = await Deno.readTextFile(
    new URL("./src/thread/workbench.tsx", import.meta.url),
  );
  const start = workbench.indexOf('activeView === "work" &&');
  const end = workbench.indexOf('activeView === "verification" &&', start);
  const pulse = workbench.slice(start, end);

  assertEquals(start >= 0, true);
  assertEquals(end > start, true);
  assertStringIncludes(pulse, "<ProjectWorkRibbon");
  assertEquals(
    workbench.includes("Project pulse"),
    false,
    "the validated Work feed (7a) has no collapsed Project pulse disclosure",
  );
});
