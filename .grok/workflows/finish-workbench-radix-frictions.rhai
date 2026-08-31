let meta = #{
    name: "finish-workbench-radix-frictions",
    description: "Restore lost planned/status details after the shadcn/radix workbench migration and fix the live CA01 cockpit frictions",
    when_to_use: "After a live behave walk when Product/Project/Activity lost planned status, system-only counts, or other radix-migration details",
    phases: [
        #{ title: "Confirm", detail: "three independent read-only confirmations" },
        #{ title: "Implement", detail: "sequential shared-workspace fixes" },
        #{ title: "Verify", detail: "targeted tests then remaining-hole scan" },
    ],
};

let items_schema = #{
    "type": "object",
    "required": ["items"],
    "properties": #{
        "items": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

let done_schema = #{
    "type": "object",
    "required": ["changed", "tests"],
    "properties": #{
        "changed": #{
            "type": "array",
            "items": #{ "type": "string" },
        },
        "tests": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let holes_schema = #{
    "type": "object",
    "required": ["holes"],
    "properties": #{
        "holes": #{
            "type": "array",
            "maxItems": 8,
            "items": #{
                "type": "object",
                "required": ["file", "issue"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                },
            },
        },
    },
};

let root = ".";

phase("Confirm");
let base = "Use read_file and grep only. Do not edit. Read the files before answering. ";
base += "Current checkout (repository root): " + root + ". Empty items is valid only after a real read. ";
base += "Do not propose ERPNext, make/buy, DFM, printability, FEA @3, or inventing SysML/CAD. ";
base += "ERPNext 0/1 on Product is expected. ";

let cjobs = [];
let p1 = base;
p1 += "Confirm how a cancelled-before-claim seed with superseded-by-successor reconciliation ";
p1 += "becomes Project path Gate satisfied with 0/1 work. Read ";
p1 += "src/domain/project/engineering-project.ts deriveEngineeringPhaseStatus, ";
p1 += "src/ui/src/project/model.ts buildProjectPath/buildProjectBrief, ";
p1 += "src/ui/src/project/overview.tsx phaseStatusLabel. ";
p1 += "The first CA01 seed (wi-seed) was planned, cancelled before claim, then wi-seed-2 completed on another phase. ";
p1 += "Do not recommend changing same-phase reconcile tests to fail. Quote file:line.";
cjobs.push(#{
    prompt: p1,
    label: "confirm:planned-gate",
    capability_mode: "read-only",
    output_schema: items_schema,
});

let p2 = base;
p2 += "Confirm Product system-only regressions. Read ";
p2 += "src/ui/src/thread/product-anchor-model.ts (partOccurrenceCount only counts kind=part), ";
p2 += "src/ui/src/thread/component-workspace.tsx header 00 declared part occurrences, ";
p2 += "src/adapters/architecture/renderer/product-structure-catalog.ts buildCatalog (attributes parsed, not projected). ";
p2 += "Named AttributeUsage thickness is invisible. ERPNext gap is out of scope.";
cjobs.push(#{
    prompt: p2,
    label: "confirm:product-counts",
    capability_mode: "read-only",
    output_schema: items_schema,
});

let p3 = base;
p3 += "Confirm leftover shadcn/radix migration holes that hid status details. ";
p3 += "Primitives live in src/ui/src/ui/ (badge, button, card, dialog, dropdown-menu, notice, select, separator, tabs, tooltip). ";
p3 += "No collapsible/accordion. Native details/button remain in project/thread. ";
p3 += "Check Execution journal in src/ui/src/project/work.tsx: Badge status is trailing so the a11y tree attaches it to the next run. ";
p3 += "Check Activity freshness in src/ui/src/thread/feed.tsx: historical requirements still Validated fresh. ";
p3 += "List only holes that lose a contract status or identity, not style nits.";
cjobs.push(#{
    prompt: p3,
    label: "confirm:radix-leftovers",
    capability_mode: "read-only",
    output_schema: items_schema,
});
let confirmed = parallel(cjobs);
log("confirm panel returned");

phase("Implement");

let rules = "Current checkout (repository root): " + root + ". Implement in this workspace. Do not use a private worktree. ";
rules += "Read the files, write tests first or with the change, then implement. ";
rules += "Use @std/assert. Test names are English invariant sentences. ";
rules += "New non-test modules must be added to deno.json check. ";
rules += "UI src changes require npm --prefix src/ui run build:thread so dist/thread is regenerated. ";
rules += "Run deno fmt on touched files. Deno tests: put --filter BEFORE paths. ";
rules += "Do not commit. Do not touch ERPNext, dl05, FEA @3, DFM, printability, or invent SysML/CAD text. ";
rules += "Labels stay literal: planned, cancelled, unavailable, unresolved, fresh, historical. ";
rules += "Do not add aliases for operations. ";

let i1 = rules;
i1 += "CLUSTER Project path planned vs fake Gate satisfied. ";
i1 += "Do NOT break same-phase reconcile: src/application/use-cases/project/engineering-project-command-service_test.ts expects verification completed when successor evidence is on that same phase. ";
i1 += "CA01 bug: phase-seed has only cancelled wi-seed with reconciliation.successorEvidenceRefs pointing at evidence owned by phase-seed-2. deriveEngineeringPhaseStatus still returns completed, so overview shows Gate satisfied 0/1 work. ";
i1 += "Fix the Project PATH presentation so a phase whose work is only cancelled+superseded-by-successor and whose own evidenceRefs are empty is not rendered as Gate satisfied. Prefer folding it under the successor phase as retained lifecycle (same registered operation id@version) in buildProjectPath. If fold is not unique, show Planned (never executed), never Gate satisfied. ";
i1 += "Restore an explicit planned label on overview/planning/documentary phaseStatusLabel (planned must not fall through as an accident). ";
i1 += "Add a test that a cancelled-before-claim seed on phase A with successor on phase B does not appear as a satisfied gate. ";
i1 += "Files: src/ui/src/project/model.ts, overview.tsx, planning-workbench.tsx, documentary-baseline-workbench.tsx, src/ui/project-model*_test.ts. Domain deriveEngineeringPhaseStatus only if you can keep same-phase reconcile completed AND empty other-phase cancelled seed not completed — prove with tests.";
let r1 = agent(i1, #{
    label: "impl:project-path",
    capability_mode: "all",
    output_schema: done_schema,
});
if (r1 == () || !r1.success) {
    log("project-path implementer failed; continuing other clusters");
}

let i2 = rules;
i2 += "CLUSTER Product system-only. ";
i2 += "productStructureAvailability must not present a valid system-only assembly as 00 declared part occurrences. ";
i2 += "Header should report the unique PartDefinition / assembly root honestly (1 definition, 0 occurrences is allowed; padStart 00 is the lie). ";
i2 += "AttributeUsage names already parsed in product-structure-catalog.ts (attributes array on PartDefinition) must appear on the SysON Product facet. Do not invent a PartUsage. Do not add ERP. Do not add a new binding kind if you can carry optional attributes on the existing component without breaking thread-components/1.0 validation — if you must extend the catalog, keep it optional, validated, and tested in both domain catalog and UI. ";
i2 += "Skip duplicate GLB copy only if the two blocks render the same sha256; collapse to one sealed preview. ";
i2 += "GLB camera: Fit/reset for a thin 80x20x4 box must frame the mesh, not a hairline. Touch gltf-asset-canvas / three-orbit-viewport if needed. ";
i2 += "Files: src/ui/src/thread/product-anchor-model.ts, component-workspace.tsx, src/ui/product-anchor-model_test.ts, src/adapters/architecture/renderer/product-structure-catalog.ts and its tests, viewport/canvas if camera is wrong.";
let r2 = agent(i2, #{
    label: "impl:product-system-only",
    capability_mode: "all",
    output_schema: done_schema,
});
if (r2 == () || !r2.success) {
    log("product implementer failed; continuing");
}

let i3 = rules;
i3 += "CLUSTER Activity currency and Execution journal status chip. ";
i3 += "Activity: historical requirements capture (family historicalRefs) must not display Validated fresh. Use the evidence family graph already on the workbench snapshot. ";
i3 += "Execution: src/ui/src/project/work.tsx Agent run journal puts Badge after the text so the a11y tree lists Failed on the next run. Put the status with the title (leading Badge or aria on the li) so each run's status is unambiguous. ";
i3 += "Do not invent a cancelled-run as failed. Keep cancelled vs failed literal. ";
i3 += "Files: src/ui/src/thread/feed.tsx, feed-model.ts, src/ui/src/project/work.tsx and colocated tests.";
let r3 = agent(i3, #{
    label: "impl:activity-execution",
    capability_mode: "all",
    output_schema: done_schema,
});
if (r3 == () || !r3.success) {
    log("activity/execution implementer failed; continuing");
}

let i4 = rules;
i4 += "CLUSTER finish shadcn/radix leftovers that hid details. ";
i4 += "Add a Collapsible primitive under src/ui/src/ui/ wrapping @radix-ui/react-collapsible if the package is already a dependency or add it via npm --prefix src/ui. ";
i4 += "Use it for Project path collapsed earlier gates and Activity project pulse so planned/cancelled/completed stay visible as Badge text, not only a colored dot. ";
i4 += "Replace raw status chips that lost planned with Badge variants already in src/ui/src/ui/badge.tsx. ";
i4 += "Do not rewrite the Evidence sigma canvas. Do not restyle the whole cockpit. ";
i4 += "Do not mass-replace every native button. Only controls whose radix rewrite dropped a status or identity. ";
i4 += "Register any new non-test module in deno.json check if it is imported from Deno tests. UI-only files follow src/ui tsc. Rebuild the thread bundle.";
let r4 = agent(i4, #{
    label: "impl:radix-collapsible",
    capability_mode: "all",
    output_schema: done_schema,
});
if (r4 == () || !r4.success) {
    log("radix leftover implementer failed; continuing");
}

phase("Verify");
let v1 = rules;
v1 += "Run targeted Deno tests for the files changed in this workflow: project path, product-anchor, product-structure-catalog, feed, work journal. ";
v1 += "Command pattern: deno test --allow-read --allow-write --allow-net=127.0.0.1,localhost --allow-env --filter <phrase> <path> with --filter BEFORE paths. ";
v1 += "Also npm --prefix src/ui run check if UI types changed. ";
v1 += "Fix red tests you caused. Do not disable check with --no-check. Do not claim green without the command output.";
let vr = agent(v1, #{
    label: "verify:tests",
    capability_mode: "all",
    output_schema: done_schema,
});

let v2 = "Use read_file and grep only. Repo: " + root + ". ";
v2 += "After the implementers, scan whether these still remain: ";
v2 += "1) Gate satisfied on a 0/1 cancelled seed, 2) Product 00 occurrences on system-only, ";
v2 += "3) thickness AttributeUsage invisible, 4) historical requirements Validated fresh, ";
v2 += "5) Execution badge attached to the next run. ERPNext gap is not a hole. ";
v2 += "Quote current file:line. Empty holes only after reading the current code.";
let remain = agent(v2, #{
    label: "verify:remaining",
    capability_mode: "read-only",
    output_schema: holes_schema,
});

let changed = [];
let cluster = [r1, r2, r3, r4, vr];
for c in cluster {
    if c != () && c.success && c.output.changed != () {
        for path in c.output.changed { changed.push(path); }
    }
}
let holes = [];
if remain != () && remain.success && remain.output.holes != () {
    for h in remain.output.holes { holes.push(h); }
}

let report = "# Workbench radix + CA01 frictions\n\n";
report += "Changed files: " + changed.len().to_string() + "\n";
report += "Remaining holes: " + holes.len().to_string() + "\n";
let idx = 0;
while idx < holes.len() {
    let hole = holes[idx];
    report += "- " + hole.file + ": " + hole.issue + "\n";
    idx += 1;
}
let artifact = write_scratch_file("radix-frictions-report.md", report);
complete(#{
    path: artifact,
    changed_count: changed.len(),
    remaining_holes: holes.len(),
    report: report,
});
