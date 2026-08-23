import { assertEquals, assertStringIncludes } from "@std/assert";

Deno.test("browser preview keeps the real Chat rail visible without simulating native authority", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );
  const shell = await Deno.readTextFile(
    new URL("./src/thread/native-preview.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("./src/styles/18-desktop-chat.css", import.meta.url),
  );

  assertEquals(source.includes("if (!bindings) return null"), false);
  assertStringIncludes(shell, "useState(false)");
  assertStringIncludes(
    shell,
    "if (!desktopChatRuntimeAvailable()) setChatOpen(true)",
  );
  assertStringIncludes(shell, 'data-chat-open={chatOpen ? "true" : "false"}');
  assertStringIncludes(source, "open={open}");
  assertStringIncludes(
    source,
    "onOpenChange={(details) => onOpenChange(details.open)}",
  );
  assertStringIncludes(
    source,
    'data-chat-runtime={nativeChatAvailable ? "native" : "browser-preview"}',
  );
  assertStringIncludes(source, 'aria-controls="desktop-chat-panel"');
  assertStringIncludes(source, 'content: "desktop-chat-panel"');
  assertStringIncludes(source, 'title: "desktop-chat-title"');
  assertStringIncludes(source, 'description: "desktop-chat-description"');
  assertStringIncludes(
    source,
    '<ArkDialog.Title className="desktop-chat-title">',
  );
  assertStringIncludes(
    source,
    '<ArkDialog.Description className="desktop-chat-description">',
  );
  assertStringIncludes(
    source,
    "<BrowserPreviewUnavailable projectId={projectId} />",
  );
  assertStringIncludes(source, "Browser preview · non-native");
  assertStringIncludes(
    source,
    "conversation is loaded and no command can be sent from this panel.",
  );
  assertStringIncludes(source, "disabled={!interactive}");
  assertStringIncludes(styles, ".desktop-chat-preview");
  assertStringIncludes(
    styles,
    ".desktop-chat .desktop-chat-rail-button:disabled",
  );
  assertEquals(source.includes("Casys agent console"), false);
  assertEquals(source.includes("›_"), false);
  assertEquals(source.includes("function ChatIcon"), false);
  assertEquals(source.includes("function CloseIcon"), false);
  assertEquals(source.includes("<button"), false);

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
  assertStringIncludes(source, "export function desktopChatRuntimeAvailable");
});

Deno.test("small Chat surfaces use Ark modal focus management without making the dock modal", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );

  assertStringIncludes(source, 'useMediaQuery("(max-width: 899px)")');
  assertStringIncludes(source, 'key={compactModal ? "modal" : "panel"}');
  assertStringIncludes(source, "modal={compactModal}");
  assertStringIncludes(source, "trapFocus={compactModal}");
  assertStringIncludes(source, "preventScroll={compactModal}");
  assertStringIncludes(source, "closeOnInteractOutside={compactModal}");
  assertStringIncludes(source, "<ArkDialog.CloseTrigger asChild>");
  assertStringIncludes(source, 'aria-label="Close project chat"');
  assertStringIncludes(source, "aria-pressed={!selectedId}");
  assertStringIncludes(source, "aria-pressed={conversation.id === selectedId}");
  assertStringIncludes(source, 'event.key === "Escape"');
  assertStringIncludes(
    source,
    'globalThis.addEventListener("keydown", dismiss)',
  );
});

Deno.test("responsive Chat rebuilds Ark effects and restores panel focus", async () => {
  const source = await Deno.readTextFile(
    new URL("./src/thread/desktop-chat.tsx", import.meta.url),
  );

  assertStringIncludes(source, 'key={compactModal ? "modal" : "panel"}');
  assertStringIncludes(
    source,
    "const triggerRef = useRef<HTMLButtonElement>(null)",
  );
  assertStringIncludes(source, "previous.open && !open");
  assertStringIncludes(source, "!previous.compactModal");
  assertStringIncludes(source, "triggerRef.current?.focus()");
  assertStringIncludes(source, "ref={triggerRef}");
});
