import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("browser preview keeps the real Chat rail visible without simulating native authority", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertEquals(source.includes("if (!bindings) return null"), false);
  assertStringIncludes(source, "useState(!nativeChatAvailable)");
  assertStringIncludes(
    source,
    'data-chat-runtime={nativeChatAvailable ? "native" : "browser-preview"}',
  );
  assertStringIncludes(source, 'aria-controls="desktop-chat-panel"');
  assertStringIncludes(source, 'id="desktop-chat-panel"');
  assertStringIncludes(source, 'aria-labelledby="desktop-chat-title"');
  assertStringIncludes(
    source,
    "<BrowserPreviewUnavailable projectId={projectId} />",
  );
  assertStringIncludes(source, "Browser preview · non-native");
  assertStringIncludes(
    source,
    "No\n        conversation is loaded and no command can be sent from this panel.",
  );
  assertStringIncludes(source, "disabled={!interactive}");
  assertStringIncludes(styles, ".desktop-chat-unavailable");
  assertStringIncludes(
    styles,
    ".desktop-chat .desktop-chat-rail button:disabled",
  );

  assertEquals(source.includes("globalThis.bindings ="), false);
  assertEquals(source.includes("casysChatSnapshot: async"), false);
  assertEquals(source.includes("casysChatCommand: async"), false);
});

Deno.test("native Chat keeps command dispatch behind the injected Desktop binding", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );

  assertStringIncludes(source, "if (!bindings) return;");
  assertStringIncludes(source, "if (!bindings) return undefined;");
  assertStringIncludes(source, "await bindings.casysChatSnapshot");
  assertStringIncludes(source, "await bindings.casysChatCommand(request)");
  assertStringIncludes(source, "interactive={nativeChatAvailable}");
});
