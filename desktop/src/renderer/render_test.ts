import {
  assertEquals,
  assertFalse,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1.0.14";
import type {
  ComponentDiagnostic,
  DesktopShellViewModel,
  ShellStatus,
} from "../contracts/diagnostics.ts";
import { escapeHtml } from "./escape.ts";
import { DESKTOP_SHELL_CSP } from "./headers.ts";
import { renderDesktopShell } from "./render.ts";

const MALICE = `"><img src=x onerror=alert(1)></title><script>alert('xss')</script>&`;

function component(
  overrides: Partial<ComponentDiagnostic> = {},
): ComponentDiagnostic {
  return {
    id: "desktop-shell",
    label: "Desktop shell",
    state: "ready",
    summary: "Bundled shell is present.",
    evidence: "Manifest entry desktop-shell is pinned.",
    ...overrides,
  };
}

function model(
  overrides: Partial<DesktopShellViewModel> = {},
): DesktopShellViewModel {
  return {
    productName: "Casys Digital Thread",
    productVersion: "0.2.0",
    status: "degraded",
    title: "Desktop shell is degraded",
    summary:
      "The Desktop shell and its manifest may be ready, while required services remain unavailable.",
    platform: "macOS",
    components: [
      component(),
      component({
        id: "casys-control-plane",
        label: "Control plane",
        state: "unavailable",
        summary: "Local control plane is not started in this lot.",
        evidence: "Lifecycle is deferred.",
      }),
    ],
    ...overrides,
  };
}

function render(overrides: Partial<DesktopShellViewModel> = {}): string {
  return renderDesktopShell(model(overrides));
}

Deno.test("renderDesktopShell returns one complete HTML document with landmarks", () => {
  const html = render();
  assertEquals(html.startsWith("<!DOCTYPE html>"), true);
  assertStringIncludes(html, '<html lang="en">');
  assertStringIncludes(html, "</html>");
  assertStringIncludes(html, '<header class="title-block">');
  assertStringIncludes(html, '<main id="main">');
  assertStringIncludes(html, "<footer>");
  assertStringIncludes(html, 'href="#main"');
  assertStringIncludes(html, '<h1 id="shell-status-heading"');
  assertStringIncludes(html, '<h2 id="component-evidence-heading"');
  assertStringIncludes(html, "prefers-reduced-motion");
  assertStringIncludes(html, `content="${escapeHtml(DESKTOP_SHELL_CSP)}"`);
});

Deno.test("renderDesktopShell escapes every view-model field including attributes", () => {
  const html = renderDesktopShell({
    productName: MALICE,
    productVersion: MALICE,
    status: "recovery-required",
    title: MALICE,
    summary: MALICE,
    platform: MALICE as DesktopShellViewModel["platform"],
    components: [
      component({
        id: MALICE,
        label: MALICE,
        state: "error",
        summary: MALICE,
        evidence: MALICE,
        recovery: MALICE,
        version: MALICE,
      }),
    ],
  });

  assertFalse(html.includes(MALICE));
  assertFalse(html.includes("<script"));
  assertFalse(html.includes("<img"));
  assertStringIncludes(html, "&lt;script&gt;");
  assertStringIncludes(html, "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  assertStringIncludes(html, "&amp;");
  assertStringIncludes(html, "&#39;xss&#39;");
  assertStringIncludes(html, "<title>");
  assertFalse(/<title>.*<script/s.test(html));
});

Deno.test(
  "renderDesktopShell keeps aggregate and component states literal and distinct",
  () => {
    const html = render({
      status: "degraded",
      components: [
        component({ state: "ready" }),
        component({
          id: "casys-control-plane",
          label: "Control plane",
          state: "unavailable",
        }),
        component({
          id: "workbench-projection",
          label: "Workbench",
          state: "unresolved",
          summary: "Projection is not joined.",
          evidence: "No GET surface is observed.",
        }),
        component({
          id: "chat-host",
          label: "Chat host",
          state: "error",
          summary: "Sidecar observation failed.",
          evidence: "Runtime check returned error.",
        }),
      ],
    });

    assertStringIncludes(html, 'data-shell-status="degraded"');
    assertStringIncludes(html, 'data-component-state="ready"');
    assertStringIncludes(html, 'data-component-state="unavailable"');
    assertStringIncludes(html, 'data-component-state="unresolved"');
    assertStringIncludes(html, 'data-component-state="error"');
    assertStringIncludes(
      html,
      "means the shell is shown while one or more components are not ready.",
    );
    assertStringIncludes(html, "means not present to observe.");
    assertStringIncludes(html, "means observed, still incomplete.");
    assertStringIncludes(html, "means observation failed.");
    assertStringIncludes(html, '.stamp[data-shell-status="degraded"] {');
    assertStringIncludes(html, '.stamp[data-component-state="ready"] {');
    assertStringIncludes(html, '.stamp[data-component-state="unavailable"] {');
    assertStringIncludes(html, '.stamp[data-component-state="unresolved"] {');
    assertStringIncludes(html, '.stamp[data-component-state="error"] {');
    assertFalse(html.includes('[data-shell-status="degraded"] .stamp {'));
    assertFalse(html.includes("latest"));
  },
);

Deno.test("renderDesktopShell distinguishes each aggregate status", () => {
  const statuses: readonly ShellStatus[] = [
    "ready",
    "degraded",
    "recovery-required",
  ];
  for (const status of statuses) {
    const html = render({ status, title: `Shell is ${status}` });
    assertStringIncludes(html, `data-shell-status="${status}"`);
    assertStringIncludes(html, `<span class="stamp-word">${status}</span>`);
  }
});

Deno.test("renderDesktopShell omits recovery and version when they are absent", () => {
  const withoutOptional = render({
    components: [component({ recovery: undefined, version: undefined })],
  });
  assertFalse(withoutOptional.includes(">Recovery<"));
  assertFalse(withoutOptional.includes(">Observed version<"));

  const withOptional = render({
    components: [
      component({ recovery: "Reinstall the pinned runtime.", version: "0.2.0" }),
    ],
  });
  assertStringIncludes(withOptional, ">Recovery<");
  assertStringIncludes(withOptional, "Reinstall the pinned runtime.");
  assertStringIncludes(withOptional, ">Observed version<");
  assertStringIncludes(withOptional, "0.2.0");
});

Deno.test(
  "renderDesktopShell does not emit scripts, forms, controls, or network resources",
  () => {
    const html = render();
    assertFalse(/<script\b/i.test(html));
    assertFalse(/<form\b/i.test(html));
    assertFalse(/<input\b/i.test(html));
    assertFalse(/<button\b/i.test(html));
    assertFalse(/<iframe\b/i.test(html));
    assertFalse(/<img\b/i.test(html));
    assertFalse(/<link\b/i.test(html));
    assertFalse(/<object\b/i.test(html));
    assertFalse(/https?:\/\//i.test(html));
    assertFalse(/file:/i.test(html));
    assertFalse(html.includes("javascript:"));
  },
);

Deno.test("renderDesktopShell rejects unknown status tokens", () => {
  assertThrows(
    () => render({ status: "latest" as ShellStatus }),
    TypeError,
    "ready, degraded, or recovery-required",
  );
  assertThrows(
    () =>
      render({
        components: [component({ state: "latest" as ComponentDiagnostic["state"] })],
      }),
    TypeError,
    "ready, unavailable, unresolved, or error",
  );
});

Deno.test("renderDesktopShell reports an empty component list without inventing rows", () => {
  const html = render({ components: [] });
  assertStringIncludes(html, "No component evidence in this view.");
  assertFalse(html.includes('class="component"'));
});
