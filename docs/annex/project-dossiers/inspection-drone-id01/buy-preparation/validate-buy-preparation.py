#!/usr/bin/env python3
"""Read-only consistency check for the ID01 buy-preparation packet.

Not application code. Does not call ERP, rewrite files, or admit a configuration.
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
SOURCES = REPO / "docs/annex/project-dossiers/inspection-drone-id01/sources"
SCHEMA = "id01-buy-preparation/1.0"
SHA256_HEX = re.compile(r"^[0-9a-f]{64}$")
CANONICAL_UTC = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$"
)
CANONICAL_UTC_MILLISECONDS = re.compile(
    r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"
)
EXPECTED_PROJECT = "inspection-drone-id01:project:r892:5d6ef81cf812c6f1"
EXPECTED_BRIEF = "inspection-drone-id01:brief:r7:22fb5d1b598dbd41"
EXPECTED_THREAD = (
    "project:inspection-drone-id01:r119:"
    "industrialize-run-dfm-checks-run:"
    "id01-yolo-queue-dfm-r118-authority-retry-jit-20260912"
)
EXPECTED_READY_OBSERVATION_IDS = {
    "obs.holybro-11088-none",
    "obs.ligpower-f1404-kv4600",
}


def fail(errors: list[str], msg: str) -> None:
    errors.append(msg)


def load(name: str) -> dict:
    path = HERE / name
    return json.loads(path.read_text(encoding="utf-8"))


def sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def is_canonical_utc(value: object) -> bool:
    if not isinstance(value, str) or not CANONICAL_UTC.fullmatch(value):
        return False
    try:
        datetime.strptime(
            value, "%Y-%m-%dT%H:%M:%S.%fZ" if "." in value else "%Y-%m-%dT%H:%M:%SZ"
        )
    except ValueError:
        return False
    return True


def is_canonical_utc_milliseconds(value: object) -> bool:
    return (
        isinstance(value, str)
        and CANONICAL_UTC_MILLISECONDS.fullmatch(value) is not None
        and is_canonical_utc(value)
    )


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
        if baseline.get("approvedBriefId") != EXPECTED_BRIEF:
            fail(errors, f"{label}: approvedBriefId mismatch")
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

    # Recross exact PartUsage -> PartDefinition pairs against the captures.
    expected_occurrences: set[tuple[str, str]] = set()
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
            expected_occurrences.add(
                (row["usageElementId"], row["partDefinitionElementId"])
            )
    reconstructed_occurrences = {
        (occ["elementId"], part["partDefinitionElementId"])
        for part in parts
        for occ in part["occurrences"]
    }
    if reconstructed_occurrences != expected_occurrences:
        fail(errors, "occurrence recross failed: exact usage/PartDefinition pairs differ")

    if articles["itemProposalStatus"] != "proposal-not-selected":
        fail(errors, "articles must remain proposal-not-selected")
    if articles["notSupplierQuotation"] is not True:
        fail(errors, "articles must forbid supplier quotation")
    max_alternatives = (articles.get("coverageLimits") or {}).get(
        "maxCotsMaterialAlternatives"
    )
    if max_alternatives != 5:
        fail(errors, "maxCotsMaterialAlternatives must be 5")
    elif len(articles["cotsAndMaterialArticleProposals"]) > max_alternatives:
        fail(errors, "more than 5 COTS/material alternatives")

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

    observation_rows = manifest["observations"]
    observation_ids = [row.get("observationId") for row in observation_rows]
    if len(observation_ids) != len(set(observation_ids)):
        fail(errors, "duplicate price observationId")
    if len(observation_rows) != 5:
        fail(errors, f"expected 5 price observations, got {len(observation_rows)}")
    obs = {row["observationId"]: row for row in observation_rows}
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
            source = obs.get(oid)
            if source is not None:
                if source.get("itemPriceReady") is not True:
                    fail(errors, f"{row['proposalId']} ready but observation is not ItemPrice-ready")
                if price.get("price_list_rate") != source.get("observedValue"):
                    fail(errors, f"{row['proposalId']} rate != observedValue")
                if price.get("currency") != source.get("currency"):
                    fail(errors, f"{row['proposalId']} currency != observation currency")
        elif row.get("priceReadyForItemPrice") is False:
            if price.get("price_list_rate") is not None:
                fail(errors, f"{row['proposalId']} must not copy unread checkout into Item Price")
        else:
            fail(errors, f"{row['proposalId']} must state priceReadyForItemPrice")
    if ready_ids != EXPECTED_READY_OBSERVATION_IDS:
        fail(errors, f"ItemPrice-ready observation IDs differ: {sorted(ready_ids)}")
    manifest_ready_ids = {
        row["observationId"] for row in observation_rows if row.get("itemPriceReady") is True
    }
    if manifest_ready_ids != EXPECTED_READY_OBSERVATION_IDS:
        fail(
            errors,
            f"manifest ItemPrice-ready observation IDs differ: {sorted(manifest_ready_ids)}",
        )

    for oid, row in obs.items():
        for field in ("url", "retrievedAtUtc", "currency", "unit", "observedValue", "kind"):
            if not row.get(field):
                fail(errors, f"{oid}: missing {field}")
        if not is_canonical_utc(row["retrievedAtUtc"]):
            fail(errors, f"{oid}: retrievedAtUtc must be canonical UTC")
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
    prusa_obs = obs.get("obs.prusa-petg-jet-black-1kg")
    if prusa_obs is None:
        fail(errors, "Prusa observation missing")
    else:
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
    proposal_by_code = {
        row["erp"]["item_code"]: row
        for row in articles["cotsAndMaterialArticleProposals"]
    }
    catalogue_codes = [line.get("itemCode") for line in catalogue["lines"]]
    if len(catalogue_codes) != len(set(catalogue_codes)):
        fail(errors, "duplicate catalogue itemCode")
    if set(catalogue_codes) != set(proposal_by_code):
        fail(errors, "catalogue itemCode set must exactly match article proposals")
    sources_by_id = {source["id"]: source for source in catalogue["sources"]}
    if len(sources_by_id) != len(catalogue["sources"]):
        fail(errors, "duplicate catalogue source id")
    priced_lines = 0
    for line in catalogue["lines"]:
        if not line["itemCode"].startswith("DEMO-ID01-"):
            fail(errors, f"catalogue itemCode prefix {line['itemCode']}")
        if line["observation"]["uom"] != line["stockUom"]:
            fail(errors, f"{line['itemCode']} observation.uom != stockUom")
        proposal = proposal_by_code.get(line["itemCode"])
        if proposal is None:
            continue
        erp = proposal["erp"]
        price = erp["proposed_item_price"]
        if line.get("itemName") != erp.get("item_name"):
            fail(errors, f"{line['itemCode']} itemName differs from article proposal")
        if line.get("itemGroup") != erp.get("item_group"):
            fail(errors, f"{line['itemCode']} itemGroup differs from article proposal")
        if line.get("stockUom") != erp.get("stock_uom"):
            fail(errors, f"{line['itemCode']} stockUom differs from article proposal")
        if erp.get("price_list") != catalogue["priceList"]["name"]:
            fail(errors, f"{line['itemCode']} price list differs from demo catalogue")
        if line["observation"].get("uom") != price.get("uom"):
            fail(errors, f"{line['itemCode']} observation.uom differs from article proposal")
        src = sources_by_id.get(line["sourceRef"])
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
        source_matches = [
            row
            for row in observation_rows
            if row.get("url") == src.get("url")
            and row.get("retrievedAtUtc") == src.get("retrievedAt")
        ]
        if len(source_matches) != 1:
            fail(errors, f"{line['itemCode']} source must resolve one manifest observation")
            continue
        source_observation = source_matches[0]
        if source_observation["observationId"] != price.get("observationId"):
            fail(errors, f"{line['itemCode']} source lineage differs from article observation")
        if line["observation"].get("currency") != source_observation.get("currency"):
            fail(errors, f"{line['itemCode']} catalogue currency differs from source observation")
        expected_category = (
            "public-catalogue"
            if source_observation.get("itemPriceReady") is True
            else "documentary"
        )
        if src.get("category") != expected_category:
            fail(errors, f"{src['id']} category differs from source observation readiness")
        if not is_canonical_utc_milliseconds(src.get("retrievedAt")):
            fail(errors, f"{src['id']} retrievedAt must be canonical UTC milliseconds")
        if line["observation"]["amount"] is not None:
            priced_lines += 1
            for key in ("url", "retrievedAt", "sha256"):
                if not src.get(key):
                    fail(errors, f"priced {line['itemCode']} missing source.{key}")
            if proposal.get("priceReadyForItemPrice") is not True:
                fail(errors, f"{line['itemCode']} has catalogue amount without ready article")
            if line["observation"]["amount"] != price.get("price_list_rate"):
                fail(errors, f"{line['itemCode']} catalogue amount differs from article rate")
            if line["observation"]["amount"] != source_observation.get("observedValue"):
                fail(errors, f"{line['itemCode']} catalogue amount differs from observedValue")
            if line["observation"]["currency"] != price.get("currency"):
                fail(errors, f"{line['itemCode']} catalogue currency differs from article price")
        elif proposal.get("priceReadyForItemPrice") is True:
            fail(errors, f"{line['itemCode']} ready article must carry a catalogue amount")
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
