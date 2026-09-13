#!/usr/bin/env python3
"""Read-only consistency check for the ID01 buy-preparation packet.

Not application code. Does not call ERP, rewrite files, or admit a configuration.
"""

from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
SOURCES = REPO / "docs/annex/project-dossiers/inspection-drone-id01/sources"
SCHEMA = "id01-buy-preparation/1.0"
SHA256_HEX = __import__("re").compile(r"^[0-9a-f]{64}$")
EXPECTED_PROJECT = "inspection-drone-id01:project:r892:5d6ef81cf812c6f1"
EXPECTED_BRIEF = "inspection-drone-id01:brief:r7:22fb5d1b598dbd41"
EXPECTED_THREAD = (
    "project:inspection-drone-id01:r119:"
    "industrialize-run-dfm-checks-run:"
    "id01-yolo-queue-dfm-r118-authority-retry-jit-20260912"
)


def fail(errors: list[str], msg: str) -> None:
    errors.append(msg)


def load(name: str) -> dict:
    path = HERE / name
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    errors: list[str] = []
    architecture = load("architecture-reconstruction.json")
    articles = load("article-proposals.json")
    manifest = load("price-source-manifest.json")

    for doc, kind in (
        (architecture, "architecture-reconstruction"),
        (articles, "article-proposals"),
        (manifest, "price-source-manifest"),
    ):
        if doc.get("schemaVersion") != SCHEMA:
            fail(errors, f"{kind}: schemaVersion must be {SCHEMA}")
        if doc.get("notSchema") != "buy-configuration/1.0":
            fail(errors, f"{kind}: must declare notSchema buy-configuration/1.0")
        if doc.get("schemaVersion") == "buy-configuration/1.0":
            fail(errors, f"{kind}: must not claim buy-configuration/1.0")

    for doc, label in ((architecture, "architecture"), (articles, "articles")):
        baseline = doc.get("baseline") or {}
        if baseline.get("projectSnapshotId") != EXPECTED_PROJECT:
            fail(errors, f"{label}: unexpected projectSnapshotId")
        brief = baseline.get("approvedBriefId")
        if brief not in (EXPECTED_BRIEF, None) and baseline.get("approvedBriefId") != EXPECTED_BRIEF:
            fail(errors, f"{label}: unexpected approvedBriefId")
        if label == "architecture" and baseline.get("approvedBriefId") != EXPECTED_BRIEF:
            fail(errors, "architecture: approvedBriefId mismatch")
        if baseline.get("threadSnapshotId") != EXPECTED_THREAD:
            fail(errors, f"{label}: unexpected threadSnapshotId")

    if architecture["baseline"]["approvedBriefItemCount"] != 40:
        fail(errors, "brief item count must stay 40")
    if architecture["baseline"]["threadArtifactCount"] != 220:
        fail(errors, "thread artifact count must stay 220")
    if architecture["buyAbsence"]["buyArtifactsInThreadR119"] != 0:
        fail(errors, "Buy artifact count must remain 0")
    cas = architecture.get("casReopen") or {}
    if cas.get("architectureCaptureBytes") != "reopened":
        fail(errors, "architecture capture must be reopened")
    if cas.get("partDefinitionsCaptureBytes") != "reopened":
        fail(errors, "part-definitions capture must be reopened")
    if cas.get("copiedIntoPublicDocs") is not False:
        fail(errors, "full captures must not be copied into public docs")
    if (architecture.get("captureBackedProductStructure") or {}).get("partDefinitionCount") != 19:
        fail(errors, "capture-backed structure must list 19 PartDefinitions")
    if architecture["rootPartDefinition"]["elementId"] != "f58ee456-a69f-4835-a6f4-e15503c528a1":
        fail(errors, "semantic root PartDefinition mismatch")

    geom = architecture["applicableConfigurationGeometry"]
    if geom["parentOperation"] != "design.write-geometry@1":
        fail(errors, "parentOperation must be design.write-geometry@1")
    for key in ("parentFingerprint", "stepFingerprint"):
        if not SHA256_HEX.match(geom[key]):
            fail(errors, f"geometry.{key} is not sha256 hex")
    if not geom["preparatoryThreadArtifactUri"].startswith(
        "thread-artifact://inspection-drone-id01/"
    ):
        fail(errors, "preparatory STEP URI must use thread-artifact://inspection-drone-id01/")

    parts = architecture["parts"]
    if len(parts) != 12:
        fail(errors, f"expected 12 leaf parts, got {len(parts)}")
    pd_ids = [p["partDefinitionElementId"] for p in parts]
    if len(pd_ids) != len(set(pd_ids)):
        fail(errors, "duplicate leaf PartDefinition ids")

    occ_ids: list[str] = []
    for part in parts:
        occs = part["occurrences"]
        if not occs:
            fail(errors, f"{part['name']}: missing occurrences")
        qty = part["quantity"]
        if qty.get("buyStatus") != "unresolved":
            fail(errors, f"{part['name']}: buy quantity must stay unresolved")
        if qty.get("canonicalBuyQuantity") is not False:
            fail(errors, f"{part['name']}: must not promote quantity to canonical")
        if qty.get("architectureUsageCount") != len(occs):
            fail(errors, f"{part['name']}: architectureUsageCount != capture usages")
        proposal = qty.get("placementProposal") or {}
        if proposal.get("status") != "proposed-from-placement-source":
            fail(errors, f"{part['name']}: placement proposal must be preserved")
        if proposal.get("canonical") is not False:
            fail(errors, f"{part['name']}: placement proposal is not canonical")
        if proposal.get("uom") != "Nos":
            fail(errors, f"{part['name']}: UOM must be Nos")
        if proposal.get("value") != str(len(occs)):
            fail(
                errors,
                f"{part['name']}: placement proposal {proposal.get('value')} != usage count {len(occs)}",
            )
        for occ in occs:
            if occ.get("identitySource") != "architecture-capture/4.0":
                fail(errors, f"{part['name']}: occurrence must cite architecture-capture/4.0")
            if occ.get("targetId") != part["partDefinitionElementId"]:
                fail(errors, f"{part['name']}: usage targetId mismatch")
            occ_ids.append(occ["elementId"])
        fp = part["currentGeometry"]["stepFingerprint"]
        if not SHA256_HEX.match(fp):
            fail(errors, f"{part['name']}: STEP fingerprint not sha256")
    if len(occ_ids) != len(set(occ_ids)):
        fail(errors, "duplicate occurrence ids")
    if len(occ_ids) != 22:
        fail(errors, f"expected 22 leaf occurrences, got {len(occ_ids)}")

    classes = {p["name"]: p["class"] for p in parts}
    if classes["BatteryReservedVolume"] != "generic-unselected-placeholder":
        fail(errors, "BatteryReservedVolume must stay a placeholder")
    if classes["StaticPropellerEnvelope"] != "generic-unselected-placeholder":
        fail(errors, "StaticPropellerEnvelope must stay a placeholder")
    if classes["RadialArm"] != "printed-or-custom-candidate":
        fail(errors, "RadialArm class")
    if classes["MotorEnvelope"] != "cots-envelope":
        fail(errors, "MotorEnvelope class")

    for entry in architecture["placementSources"]["files"]:
        rel = Path(entry["path"])
        path = REPO / rel
        if not path.is_file():
            fail(errors, f"missing placement file {rel}")
            continue
        digest = sha256_file(path)
        if digest != entry["sha256"]:
            fail(errors, f"hash mismatch {rel}: packet {entry['sha256']} file {digest}")
        if path.stat().st_size != entry["bytes"]:
            fail(errors, f"size mismatch {rel}")

    # Recross occurrence counts against placement JSON.
    expected_counts: dict[str, int] = {}
    for fname in (
        "airframe-placements.json",
        "propulsion-placements.json",
        "avionics-placements.json",
        "electricalPower-placements.json",
        "landingGear-placements.json",
        "cameraPayload-placements.json",
    ):
        payload = json.loads((SOURCES / fname).read_text(encoding="utf-8"))
        for row in payload["placements"]:
            pd = row["partDefinitionElementId"]
            expected_counts[pd] = expected_counts.get(pd, 0) + 1
    reconstructed = {p["partDefinitionElementId"]: len(p["occurrences"]) for p in parts}
    if reconstructed != expected_counts:
        fail(errors, f"occurrence recross failed: {reconstructed} vs {expected_counts}")

    if articles["itemProposalStatus"] != "proposal-not-selected":
        fail(errors, "articles must remain proposal-not-selected")
    if articles["notSupplierQuotation"] is not True:
        fail(errors, "articles must forbid supplier quotation")
    if len(articles["cotsAndMaterialArticleProposals"]) > 6:
        fail(errors, "more than 6 COTS/material alternatives")

    codes = [row["erp"]["item_code"] for row in articles["cotsAndMaterialArticleProposals"]]
    if len(codes) != len(set(codes)):
        fail(errors, "duplicate item_code")
    for code in codes:
        if not code.startswith("DEMO-ID01-"):
            fail(errors, f"item_code {code} must use DEMO-ID01- prefix")

    make_priced = [
        line for line in articles["structuralMakeLines"] if line.get("erpItem") != "none-do-not-forge-item-price"
    ]
    if make_priced:
        fail(errors, "make lines must not carry forged Item Price")

    obs = {row["observationId"]: row for row in manifest["observations"]}
    if len(obs) != 5:
        fail(errors, f"expected 5 price observations, got {len(obs)}")
    if manifest["noAggregateDroneTotal"] is not True:
        fail(errors, "manifest must forbid a drone total")

    ready_ids = set()
    for row in articles["cotsAndMaterialArticleProposals"]:
        price = row["erp"]["proposed_item_price"]
        oid = price["observationId"]
        if oid not in obs:
            fail(errors, f"{row['proposalId']} observation {oid} missing from manifest")
        if "valid_upto" in price or "valid_from_observation_date" in price:
            fail(errors, f"{row['proposalId']} must not carry validity-date payload fields")
        if row.get("priceReadyForItemPrice") is True:
            ready_ids.add(oid)
            if price.get("price_list_rate") in (None, ""):
                fail(errors, f"{row['proposalId']} marked ready without rate")
        elif row.get("priceReadyForItemPrice") is False:
            if price.get("price_list_rate") is not None:
                fail(errors, f"{row['proposalId']} must not copy unread checkout into Item Price")

    for oid, row in obs.items():
        for field in ("url", "retrievedAtUtc", "currency", "unit", "observedValue", "kind"):
            if not row.get(field):
                fail(errors, f"{oid}: missing {field}")
        if not str(row["retrievedAtUtc"]).startswith("2026-09-13T"):
            fail(errors, f"{oid}: retrieval timestamp is not 2026-09-13 UTC")
        scope = row.get("scope") or {}
        for dim in ("tax", "shipping", "validity", "stock"):
            if dim not in scope:
                fail(errors, f"{oid}: scope.{dim} missing")
        if row["kind"] == "add-to-cart-catalogue-price" and row.get("readableCheckoutPrice") is False:
            fail(errors, f"{oid}: add-to-cart cannot be marked unreadable")
        if "supplier" in row["kind"].lower() and "quotation" in row["kind"].lower():
            fail(errors, f"{oid}: supplier quotation is forbidden")

    filament = next(
        row
        for row in articles["cotsAndMaterialArticleProposals"]
        if row["proposalId"] == "article.prusament-petg-jet-black-1kg"
    )
    if filament["mapsToPartDefinition"] is not None:
        fail(errors, "filament must not map to a PartDefinition")
    if filament["buySourcingIfLaterConfigured"] != "documentary":
        fail(errors, "filament must stay documentary if later configured")
    if filament.get("priceReadyForItemPrice") is not False:
        fail(errors, "filament must not be ItemPrice-ready without a retained primary receipt")
    prusa_obs = obs["obs.prusa-petg-jet-black-1kg"]
    if prusa_obs.get("observedValue") != "25.49":
        fail(errors, "must retain the documentary 25.49 Prusa observation")
    if prusa_obs.get("itemPriceReady") is not False:
        fail(errors, "Prusa observation must stay not ItemPrice-ready")

    catalogue = load("erp-demo-catalogue.json")
    if catalogue.get("schema") != "demo-catalogue/1.0":
        fail(errors, "erp-demo-catalogue.json must be demo-catalogue/1.0")
    if catalogue["priceList"] != {
        "name": "DEMO-ID01-PUBLIC-CATALOGUE",
        "currency": "USD",
    }:
        fail(errors, "demo catalogue priceList mismatch")
    manifest_digest = sha256_file(HERE / "price-source-manifest.json")
    priced_lines = 0
    for line in catalogue["lines"]:
        if not line["itemCode"].startswith("DEMO-ID01-"):
            fail(errors, f"catalogue itemCode prefix {line['itemCode']}")
        if line["observation"]["uom"] != line["stockUom"]:
            fail(errors, f"{line['itemCode']} observation.uom != stockUom")
        src = next(
            (s for s in catalogue["sources"] if s["id"] == line["sourceRef"]),
            None,
        )
        if src is None:
            fail(errors, f"{line['itemCode']} unknown sourceRef")
            continue
        if src.get("path") != (
            "docs/annex/project-dossiers/inspection-drone-id01/"
            "buy-preparation/price-source-manifest.json"
        ):
            fail(errors, f"{src['id']} path must point at the local price-source manifest")
        if src.get("sha256") != f"sha256:{manifest_digest}":
            fail(errors, f"{src['id']} sha256 must be the stored manifest digest")
        if line["observation"]["amount"] is not None:
            priced_lines += 1
            for key in ("url", "retrievedAt", "sha256"):
                if not src.get(key):
                    fail(errors, f"priced {line['itemCode']} missing source.{key}")
            if not str(src["retrievedAt"]).endswith(".000Z") and "." not in str(
                src["retrievedAt"]
            ):
                fail(errors, f"{src['id']} retrievedAt must be canonical UTC with milliseconds")
    if priced_lines != 2:
        fail(errors, f"expected 2 priced catalogue lines, got {priced_lines}")
    filament_line = next(
        line
        for line in catalogue["lines"]
        if line["itemCode"] == "DEMO-ID01-PRUSAMENT-PETG-JB-1KG"
    )
    if filament_line["observation"]["amount"] is not None:
        fail(errors, "filament catalogue amount must be null")
    if filament_line["stockUom"] != "Kg":
        fail(errors, "filament stockUom must stay Kg (spool as sold)")
    if filament_line["sourceMapping"] != "unknown":
        fail(errors, "filament sourceMapping must stay unknown")

    worksheet = (HERE / "production-estimate-worksheet.md").read_text(encoding="utf-8")
    for token in ("C_part", "unresolved", "m_part,g", "ne pas copier"):
        if token.lower() not in worksheet.lower() and token not in worksheet:
            fail(errors, f"worksheet missing {token}")
    if "130.99" in worksheet or "16.90" in worksheet:
        fail(errors, "worksheet must not compute a numeric production total from catalogue prices")

    print(
        json.dumps(
            {
                "ok": not errors,
                "schemaVersion": SCHEMA,
                "files": [
                    "architecture-reconstruction.json",
                    "article-proposals.json",
                    "price-source-manifest.json",
                    "erp-demo-catalogue.json",
                    "production-estimate-worksheet.md",
                    "README.md",
                ],
                "counts": {
                    "leafParts": len(parts),
                    "leafOccurrences": len(occ_ids),
                    "cotsMaterialProposals": len(articles["cotsAndMaterialArticleProposals"]),
                    "priceObservations": len(obs),
                    "itemPriceReady": sum(
                        1
                        for row in articles["cotsAndMaterialArticleProposals"]
                        if row.get("priceReadyForItemPrice") is True
                    ),
                    "addToCartPrices": sum(
                        1
                        for row in obs.values()
                        if row["kind"] == "add-to-cart-catalogue-price"
                    ),
                    "errors": len(errors),
                },
                "errors": errors,
            },
            indent=2,
        )
    )
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
