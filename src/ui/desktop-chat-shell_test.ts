import { assertEquals, assertMatch, assertStringIncludes } from "@std/assert";

Deno.test("wide Project Chat is a fixed left shell sibling, collapsed or expanded", async () => {
  const shell = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const shellStyles = await Deno.readTextFile(
    new URL("./src/styles/17-saas-shell.css", import.meta.url),
  );
  const chatStyles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertStringIncludes(shell, 'data-chat-open={chatOpen ? "true" : "false"}');
  assertStringIncludes(
    shell,
    'data-project-chat-panel={projectChatAvailable ? "true" : "false"}',
  );
  assertEquals(
    shell.indexOf("<DesktopChat") <
      shell.indexOf('id="native-preview-content"'),
    true,
  );
  assertEquals(shell.includes("spatial"), false);

  assertStringIncludes(shellStyles, "@media (min-width: 1200px)");
  assertMatch(
    shellStyles,
    /\.native-preview-shell\[data-project-chat-panel="true"\]\s*{[^}]*grid-template-columns:\s*var\(--desktop-chat-rail-width\) minmax\(0, 1fr\);/s,
  );
  assertMatch(
    shellStyles,
    /\.native-preview-shell\[data-project-chat-panel="true"\]\[data-chat-open="true"\]\s*{[^}]*grid-template-columns:\s*var\(--desktop-chat-width\) minmax\(0, 1fr\);/s,
  );
  assertMatch(
    shellStyles,
    /\.native-preview-shell\[data-project-chat-panel="true"\] > \.native-preview-content\s*{[^}]*grid-column:\s*2;/s,
  );

  assertMatch(
    chatStyles,
    /\.desktop-chat\[data-chat-presentation="project-panel"\]\s*{[^}]*grid-column:\s*1;[^}]*border-right:\s*1px solid var\(--ui-border\);/s,
  );
  assertMatch(
    chatStyles,
    /\.desktop-chat\[data-chat-presentation="project-panel"\] \.desktop-chat-positioner,[\s\S]*display:\s*contents;/,
  );
  assertMatch(
    chatStyles,
    /\.desktop-chat\[data-chat-presentation="project-panel"\] \.desktop-chat-panel,[\s\S]*width:\s*100%;[^}]*height:\s*100dvh;[^}]*border-radius:\s*0;[^}]*box-shadow:\s*none;/,
  );
  assertEquals(
    chatStyles.includes('[data-chat-presentation="whiteboard"]'),
    false,
  );
  assertEquals(chatStyles.includes("desktop-chat-spatial"), false);
});

Deno.test("Project Chat becomes a left sheet, then a full-screen modal", async () => {
  const chat = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertStringIncludes(
    styles,
    "@media (min-width: 768px) and (max-width: 1199px)",
  );
  assertMatch(
    styles,
    /\.desktop-chat\[data-chat-presentation="project-sheet"\]\s*{[^}]*right:\s*auto;[^}]*left:\s*0;/s,
  );
  assertMatch(
    styles,
    /\.desktop-chat\[data-chat-presentation="project-sheet"\] \.desktop-chat-positioner\s*{[^}]*align-items:\s*stretch;[^}]*justify-content:\s*flex-start;[^}]*padding:\s*0;/s,
  );
  assertMatch(
    styles,
    /\.desktop-chat\[data-chat-presentation="project-sheet"\] \.desktop-chat-panel\s*{[^}]*height:\s*100dvh;[^}]*border-width:\s*0 1px 0 0;[^}]*border-radius:\s*0;/s,
  );

  assertStringIncludes(styles, "@media (max-width: 899px)");
  assertMatch(
    styles,
    /\.desktop-chat\[data-chat-presentation="modal"\] \.desktop-chat-panel\s*{[^}]*width:\s*100%;[^}]*height:\s*100dvh;[^}]*border:\s*0;[^}]*border-radius:\s*0;/s,
  );
  assertStringIncludes(chat, 'useMediaQuery("(max-width: 767px)")');
  assertStringIncludes(chat, "modal={compactModal}");
  assertStringIncludes(chat, "closeOnInteractOutside={compactModal}");
  assertStringIncludes(
    chat,
    "closeOnEscape={!fixedPanelAvailable || compactModal}",
  );
});

Deno.test("non-project Chat retains its bounded fallback panel without changing authority", async () => {
  const chat = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertMatch(
    styles,
    /\.desktop-chat-positioner\s*{[^}]*position:\s*fixed;[^}]*align-items:\s*flex-end;[^}]*justify-content:\s*flex-end;[^}]*padding:\s*0\.75rem;/s,
  );
  assertMatch(
    styles,
    /\.desktop-chat-panel\s*{[^}]*width:\s*min\(var\(--desktop-chat-width\), calc\(100vw - 1\.5rem\)\);[^}]*height:\s*min\(46rem, calc\(100dvh - 1\.5rem\)\);/s,
  );
  assertMatch(
    styles,
    /\.desktop-chat\.is-unavailable \.desktop-chat-panel\s*{[^}]*height:\s*auto;[^}]*max-height:\s*calc\(100dvh - 1\.5rem\);/s,
  );
  assertStringIncludes(chat, "const bindings = desktopBindings()");
  assertEquals(chat.includes("globalThis.bindings ="), false);
  assertEquals(chat.includes("casysChatSnapshot: async"), false);
  assertEquals(chat.includes("casysChatCommand: async"), false);
});
