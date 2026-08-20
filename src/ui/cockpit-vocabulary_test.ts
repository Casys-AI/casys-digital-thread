import { assertEquals } from "@std/assert";

/**
 * Le cockpit doit avoir UNE direction visuelle, pas une par vue.
 *
 * Avant cette garde, le même rôle — un libellé de section — existait en trois
 * tailles (9, 9.5 et 10 px) réparties dans onze fichiers, parce que chaque vue
 * réécrivait son chrome. Les rôles vivent désormais dans `ui/cockpit.tsx` ;
 * une vue qui recopie la classe rouvre la divergence sans que rien ne le dise.
 */
Deno.test("views compose the shared vocabulary instead of rewriting its chrome", async () => {
  const root = new URL("./src/", import.meta.url);
  const offenders: string[] = [];

  const walk = async (directory: URL) => {
    for await (const entry of Deno.readDir(directory)) {
      const child = new URL(
        entry.isDirectory ? `${entry.name}/` : entry.name,
        directory,
      );
      if (entry.isDirectory) {
        // `ui/` EST le vocabulaire : c'est le seul endroit qui le définit.
        if (entry.name !== "ui") await walk(child);
        continue;
      }
      if (!entry.name.endsWith(".tsx")) continue;
      const source = await Deno.readTextFile(child);
      if (/uppercase tracking-\[0\.1em\]/.test(source)) {
        offenders.push(entry.name);
      }
    }
  };
  await walk(root);

  assertEquals(
    offenders,
    [],
    `these views hand-roll a label role instead of using PAGE_EYEBROW, SECTION_LABEL or LANE_LABEL: ${
      offenders.join(", ")
    }`,
  );
});
