import { assertMatch, assertStringIncludes } from "@std/assert";

Deno.test("wide Project Chat reserves a real shell column", async () => {
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
  assertStringIncludes(shellStyles, "@media (min-width: 1200px)");
  assertMatch(
    shellStyles,
    /\.native-preview-shell\[data-chat-open="true"\]\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) var\(--desktop-chat-width\);/s,
  );
  assertMatch(
    chatStyles,
    /@media \(min-width: 1200px\)[\s\S]*\.desktop-chat\.is-open\s*{[^}]*grid-column:\s*2;[^}]*height:\s*100dvh;/,
  );
  assertStringIncludes(chatStyles, "display: contents;");
  assertStringIncludes(chatStyles, "border-width: 0 0 0 1px;");
});

Deno.test("Project Chat becomes a bounded overlay before its compact modal", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertMatch(
    styles,
    /\.desktop-chat-positioner\s*{[^}]*position:\s*fixed;[^}]*padding:\s*0\.75rem;/s,
  );
  assertMatch(
    styles,
    /\.desktop-chat-panel\s*{[^}]*width:\s*min\(var\(--desktop-chat-width\), calc\(100vw - 1\.5rem\)\);[^}]*height:\s*min\(46rem, calc\(100dvh - 1\.5rem\)\);/s,
  );
  assertMatch(
    styles,
    /\.desktop-chat\.is-unavailable \.desktop-chat-panel\s*{[^}]*height:\s*auto;[^}]*max-height:\s*calc\(100dvh - 1\.5rem\);/s,
  );
  assertStringIncludes(styles, "@media (max-width: 899px)");
  assertMatch(
    styles,
    /@media \(max-width: 899px\)[\s\S]*\.desktop-chat-panel\s*{[^}]*width:\s*100%;[^}]*height:\s*100dvh;/,
  );
  assertStringIncludes(
    source,
    'data-chat-presentation={compactModal ? "modal" : "panel"}',
  );
});
