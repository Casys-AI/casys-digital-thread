import { assertEquals } from "jsr:@std/assert@1.0.14";
import { escapeHtml } from "./escape.ts";

Deno.test("escapeHtml encodes markup and quotes for text and attributes", () => {
  assertEquals(
    escapeHtml(`<script>alert("xss")</script> & 'done'`),
    "&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &#39;done&#39;",
  );
  assertEquals(
    escapeHtml(`"><img src=x onerror=alert(1)>`),
    "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;",
  );
});

Deno.test("escapeHtml strips null bytes before encoding", () => {
  assertEquals(escapeHtml("safe\0<script>"), "safe&lt;script&gt;");
});
