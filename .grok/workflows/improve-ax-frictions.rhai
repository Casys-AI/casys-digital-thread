let meta = #{
    name: "improve-ax-frictions",
    description: "Audit remaining agent-facing MCP loopback frictions after mcp:call and optional cockpit focus revision",
    when_to_use: "After live from-zero AX fixes, to confirm remaining holes without changing authority",
    phases: [
        #{ title: "Audit", detail: "three independent AX scans" },
        #{ title: "Verify", detail: "adversarial check of each claimed hole" },
    ],
};

let holes_schema = #{
    "type": "object",
    "required": ["holes"],
    "properties": #{
        "holes": #{
            "type": "array",
            "maxItems": 6,
            "items": #{
                "type": "object",
                "required": ["file", "issue", "why_ax"],
                "properties": #{
                    "file": #{ "type": "string" },
                    "issue": #{ "type": "string" },
                    "why_ax": #{ "type": "string" },
                },
            },
        },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
    },
};

phase("Audit");
let root = "/Users/erwanpesle/Documents/GitHub/casys-digital-thread";
let base = "Use read_file and grep only. Do not edit. Read the files before answering. ";
base += "Repo: " + root + ". ";
base += "Already owned (do not re-report unless still broken): cockpit_focus_set optional expectedRevision; ";
base += "scripts/probes/mcp-call.ts CLI; preview:thread follows --workspace-id=primary. ";
base += "Do not propose making issuedAt optional on server mutation tools (retry identity). ";
base += "Do not propose DFM, printability, BOM, or inventing numbers. ";
base += "A hole is only valid if you read the current file and can quote the failing contract. ";
base += "Empty holes is valid after a real read. ";

let jobs = [];
jobs.push(#{
    prompt: base + "Scan scripts/probes/mcp-call.ts and src/tools/cockpit-focus.ts for remaining AX bugs: issuedAt injected on additionalProperties:false reads, missing unwrap of structuredContent, missing deno.json check entry, missing scripts/README row.",
    label: "audit:cli-focus",
    capability_mode: "read-only",
    output_schema: holes_schema,
});
jobs.push(#{
    prompt: base + "Scan docs/reference/agent-workspace.md, docs/how-to/run-the-behave-loop-from-zero.md, CLAUDE.md, docs/reference/workspace-map.md for agent-facing command holes: mcp:call not indexed, expectedRevision still required in docs, preview --project-id still presented as default.",
    label: "audit:docs",
    capability_mode: "read-only",
    output_schema: holes_schema,
});
jobs.push(#{
    prompt: base + "Scan src/tools/project-control/mcp-tool-schemas.ts and src/tools/project-brief.ts for AX traps that burned the live loop besides issuedAt/focus. Quote schemas. Do not invent new tools.",
    label: "audit:schemas",
    capability_mode: "read-only",
    output_schema: holes_schema,
});
let results = parallel(jobs);

let holes = [];
for r in results {
    if r != () && r.success && r.output.holes != () {
        for h in r.output.holes { holes.push(h); }
    }
}
if holes.len() == 0 { complete(#{ summary: "No remaining AX holes after owned fixes.", confirmed: [] }); }

phase("Verify");
let vjobs = [];
for h in holes {
    let p = "Adversarially verify this AX hole by reading the shipped file. Default real=false unless you independently inspect evidence. ";
    p += "Issue: " + json_encode(h.issue) + " File: " + json_encode(h.file) + " Why: " + json_encode(h.why_ax);
    vjobs.push(#{
        prompt: p,
        label: "verify-hole",
        capability_mode: "read-only",
        output_schema: verdict_schema,
    });
}
let verdicts = parallel(vjobs);
let confirmed = [];
let i = 0;
for v in verdicts {
    if v != () && v.success && v.output.real == true && v.output.evidence != () && v.output.evidence != "" {
        confirmed.push(#{
            file: holes[i].file,
            issue: holes[i].issue,
            evidence: v.output.evidence,
        });
    }
    i += 1;
}
log(confirmed.len().to_string() + "/" + holes.len().to_string() + " holes survived verification");
complete(#{ summary: confirmed.len().to_string() + " confirmed AX holes", confirmed: confirmed });
