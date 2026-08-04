import { assertEquals, assertThrows } from "@std/assert";
import {
  buildRibbedCalculixRequest,
  renderRibbedTrayScript,
  RIB_HEIGHT_MAX_MM,
  RIB_HEIGHT_MIN_MM,
} from "./ribbed-geometry.ts";

// ── renderRibbedTrayScript — determinism ──────────────────────────────────────

Deno.test(
  "renderRibbedTrayScript produces identical bytes for the same rib height",
  () => {
    const first = renderRibbedTrayScript(7);
    const second = renderRibbedTrayScript(7);
    assertEquals(first, second);
  },
);

Deno.test(
  "renderRibbedTrayScript produces distinct scripts for distinct rib heights",
  () => {
    const at2 = renderRibbedTrayScript(2);
    const at12 = renderRibbedTrayScript(12);
    assertEquals(at2 === at12, false);
  },
);

// ── renderRibbedTrayScript — domain rejection ─────────────────────────────────

Deno.test(
  "renderRibbedTrayScript rejects zero",
  () => {
    assertThrows(
      () => renderRibbedTrayScript(0),
      TypeError,
      `[${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}]`,
    );
  },
);

Deno.test(
  "renderRibbedTrayScript rejects a negative value",
  () => {
    assertThrows(
      () => renderRibbedTrayScript(-1),
      TypeError,
      `[${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}]`,
    );
  },
);

Deno.test(
  "renderRibbedTrayScript rejects a value below the minimum (0.5 mm)",
  () => {
    assertThrows(
      () => renderRibbedTrayScript(0.5),
      TypeError,
      `[${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}]`,
    );
  },
);

Deno.test(
  "renderRibbedTrayScript rejects a value above the maximum (14.1 mm)",
  () => {
    assertThrows(
      () => renderRibbedTrayScript(14.1),
      TypeError,
      `[${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}]`,
    );
  },
);

Deno.test(
  "renderRibbedTrayScript rejects Infinity",
  () => {
    assertThrows(
      () => renderRibbedTrayScript(Infinity),
      TypeError,
      `[${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}]`,
    );
  },
);

Deno.test(
  "renderRibbedTrayScript rejects NaN",
  () => {
    assertThrows(
      () => renderRibbedTrayScript(NaN),
      TypeError,
      `[${RIB_HEIGHT_MIN_MM}, ${RIB_HEIGHT_MAX_MM}]`,
    );
  },
);

// ── renderRibbedTrayScript — structural invariants ────────────────────────────

Deno.test(
  "renderRibbedTrayScript script contains exactly one plate Box and five rib Boxes",
  () => {
    const script = renderRibbedTrayScript(5);
    const boxCalls = (script.match(/\bBox\(/g) ?? []).length;
    // 1 plate + 5 ribs = 6 Box() calls
    assertEquals(boxCalls, 6);
  },
);

Deno.test(
  "renderRibbedTrayScript embeds the rib height value in the script",
  () => {
    const script = renderRibbedTrayScript(7);
    assertEquals(script.includes("_R = 7"), true);
  },
);

Deno.test(
  "renderRibbedTrayScript positions ribs at x = -60, -30, 0, 30, 60",
  () => {
    const script = renderRibbedTrayScript(5);
    assertEquals(script.includes("-60"), true);
    assertEquals(script.includes("-30"), true);
    assertEquals(script.includes("0.0"), true);
    assertEquals(script.includes("30"), true);
    assertEquals(script.includes("60"), true);
  },
);

Deno.test(
  "renderRibbedTrayScript computes z-centre so the rib top face is flush with plate bottom",
  () => {
    // plate bottom = z = -3; rib centre = -3 - R/2
    const script = renderRibbedTrayScript(4);
    // R = 4, zc = -3 - 2 = -5
    assertEquals(script.includes("_zc = -5"), true);
  },
);

Deno.test(
  "renderRibbedTrayScript accepts the domain boundary values without throwing",
  () => {
    // Should not throw at the limits
    renderRibbedTrayScript(RIB_HEIGHT_MIN_MM);
    renderRibbedTrayScript(RIB_HEIGHT_MAX_MM);
  },
);

// ── buildRibbedCalculixRequest ────────────────────────────────────────────────

const SHA = "b".repeat(64);
const STEP = "/exports/oracle-ribbed-tray-rib-5.step";

Deno.test(
  "buildRibbedCalculixRequest includes step_path and expected_step_sha256",
  () => {
    const req = buildRibbedCalculixRequest(STEP, SHA);
    assertEquals(req.step_path, STEP);
    assertEquals(req.expected_step_sha256, SHA);
  },
);

Deno.test(
  "buildRibbedCalculixRequest uses the reviewed material constants",
  () => {
    const req = buildRibbedCalculixRequest(STEP, SHA);
    assertEquals(req.material, { e_mpa: 2200, nu: 0.35 });
    assertEquals(req.mesh_size_mm, 5);
  },
);

Deno.test(
  "buildRibbedCalculixRequest declares exactly two selections named FIXED and LOADED",
  () => {
    const req = buildRibbedCalculixRequest(STEP, SHA);
    const sels = req.selections as Array<{ name: string }>;
    assertEquals(sels.length, 2);
    assertEquals(sels[0].name, "FIXED");
    assertEquals(sels[1].name, "LOADED");
  },
);

Deno.test(
  "buildRibbedCalculixRequest FIXED band is outside rib y-span so boundary condition is stable",
  () => {
    const req = buildRibbedCalculixRequest(STEP, SHA);
    const sels = req.selections as Array<
      { name: string; box: { min: number[]; max: number[] } }
    >;
    const fixed = sels.find((s) => s.name === "FIXED")!;
    // Band at y ∈ [66.5, 68.5]; ribs stop at |y| = 60 — no overlap possible
    assertEquals(fixed.box.min[1] > 60, true);
    assertEquals(fixed.box.max[1] > 60, true);
  },
);

Deno.test(
  "buildRibbedCalculixRequest encodes a downward force on the LOADED selection",
  () => {
    const req = buildRibbedCalculixRequest(STEP, SHA);
    const loads = req.loads as Array<{ selection: string; force_n: number[] }>;
    assertEquals(loads.length, 1);
    assertEquals(loads[0].selection, "LOADED");
    assertEquals(loads[0].force_n, [0, 0, -100]);
  },
);

Deno.test(
  "buildRibbedCalculixRequest is deterministic for identical inputs",
  () => {
    const a = buildRibbedCalculixRequest(STEP, SHA);
    const b = buildRibbedCalculixRequest(STEP, SHA);
    assertEquals(JSON.stringify(a), JSON.stringify(b));
  },
);
