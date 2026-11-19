#!/usr/bin/env python3
"""
configure_table2_schema.py
--------------------------
Configures and standardizes Lark Base schema for Cash Advance (Non-Travel):
Base Token: ZMxobOBv0aW8AosmOhflq4IagBe
Table 1: tblIbyc67hpYTyiI (Cash Advance Form)
Table 2: tbliGywXHe6qMIm6 (Step Approval Log)

Cash Advance Table 2 was initially created with 45 Type 1 (Text) columns and no SourceID.
This script converts all Table 2 fields to mirror Liquidation (Non-Travel) Table 2 (tbl9kYdGsLsPQzB6):
1. Enforces Standard Header Field Types (Zero Type 19 cross-table lookup bugs):
   - Task ID (fldBjoyX55) -> Type 15 (URL)
   - Overall Status (fldHJmh5oy) -> Type 3 (SingleSelect with 11 canonical options)
   - Requester (fld4JyNcj7) -> Type 11 (User, multiple=True)
   - SourceID -> Created as Type 1 (Text) if missing
2. Converts All 40 Stage Columns (8 Stages x 5 Columns) in Dependency Order:
   - <Stage> Approver -> Type 11 (User, multiple=True)
   - <Stage> Start -> Type 5 (DateTime, yyyy/MM/dd HH:mm)
   - <Stage> End -> Type 5 (DateTime, yyyy/MM/dd HH:mm)
   - <Stage> Duration -> Type 20 (Formula referencing exact Start & End field IDs)
   - <Stage> Action -> Type 3 (SingleSelect with 12 canonical action options)

Usage:
  python configure_table2_schema.py --dry-run   # Preview all schema mutations without calling PUT/POST
  python configure_table2_schema.py             # Execute live schema standardization (requires LARK_APP_SECRET)
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
import requests

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def load_dotenv_file(dotenv_path: Path) -> dict:
    env_vars = {}
    if not dotenv_path.is_file():
        return env_vars
    for raw_line in dotenv_path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        env_vars[k.strip()] = v.strip().strip('"').strip("'")
    return env_vars


_DOTENV = load_dotenv_file(Path(__file__).resolve().parent / ".env")


def get_env(key: str, default: str = "") -> str:
    return os.getenv(key) or _DOTENV.get(key) or default


APP_ID = get_env("LARK_APP_ID", "cli_aa74f7f23ab8df04")
APP_SECRET = get_env("LARK_APP_SECRET", "")
BASE_TOKEN = get_env("LARK_BASE_TOKEN", "ZMxobOBv0aW8AosmOhflq4IagBe")
MAIN_TABLE_ID = get_env("LARK_MAIN_TABLE_ID", "tblIbyc67hpYTyiI")
LOG_TABLE_ID = get_env("LARK_LOG_TABLE_ID", "tbliGywXHe6qMIm6")

# The 8 Canonical Stages for Cash Advance (Non-Travel) Table 2 (tbliGywXHe6qMIm6)
# Note: Stage 3 preserves the exact existing Table 2 header prefix 'Acounting Processing <2000'
ALL_8_STAGES = [
    "Team Head (if none, enter requester name)",
    "Department Head",
    "Acounting Processing <2000",
    "Accounting Processing > 2000",
    "Treasury Processing > 2000",
    "For Check Releasing > 2000",
    "Approval",
    "Receipt",
]

KNOWN_HEADER_FIELD_IDS = {
    "ID": "fldtasZNMb",
    "Approval Instance Code": "fldsi8OrLP",
    "Request No": "fld9huFx99",
    "Task ID": "fldBjoyX55",
    "Overall Status": "fldHJmh5oy",
    "Requester": "fld4JyNcj7",
}

# Complete verified 40-field ID map for Table 2 (tbliGywXHe6qMIm6)
KNOWN_STAGE_FIELD_IDS = {
    "Team Head (if none, enter requester name)": {
        "approver": "fldnfWGZfr",
        "start": "fldm6rt0Da",
        "end": "fldSGguMqr",
        "dur": "fldDToonr7",
        "action": "fldkZW2xhj",
    },
    "Department Head": {
        "approver": "flddkWf62m",
        "start": "fldQrDvezE",
        "end": "fld81FRJje",
        "dur": "fldNgOGlUr",
        "action": "fldlyfZLA9",
    },
    "Acounting Processing <2000": {
        "approver": "fldvJTJiBk",
        "start": "fldWjwoDz9",
        "end": "fldM68Sx6Y",
        "dur": "fldvoGfrit",
        "action": "fld2iWEfe9",
    },
    "Accounting Processing > 2000": {
        "approver": "fldSsaekoj",
        "start": "fldwrzHxAM",
        "end": "fldvJ8Ymn4",
        "dur": "fldxRWtYUO",
        "action": "fldCb2dxbw",
    },
    "Treasury Processing > 2000": {
        "approver": "fldtcS1mlv",
        "start": "fldMRGKVAc",
        "end": "fldKPptPRr",
        "dur": "fldPTJYoVo",
        "action": "fldz2gNQMw",
    },
    "For Check Releasing > 2000": {
        "approver": "fldsdF3XCM",
        "start": "fldjZcwRq1",
        "end": "fldQgwN7iT",
        "dur": "fld1uo0aS2",
        "action": "fldYneWxFY",
    },
    "Approval": {
        "approver": "fld8DrYnUB",
        "start": "fldodBOmMg",
        "end": "fldK51hurg",
        "dur": "fldNpG5UCu",
        "action": "fldmnD3jOz",
    },
    "Receipt": {
        "approver": "fldnDNor3X",
        "start": "fldH1LsoFp",
        "end": "fldYUtu8J0",
        "dur": "fldLCBseUK",
        "action": "fldrRxdZWB",
    },
}

ACTION_OPTIONS = [
    {"name": "PENDING", "color": 0},
    {"name": "APPROVED", "color": 1},
    {"name": "COMPLETED", "color": 2},
    {"name": "RESOLVED", "color": 3},
    {"name": "NOT APPLICABLE", "color": 4},
    {"name": "AUTO-PASSED", "color": 5},
    {"name": "REJECTED", "color": 6},
    {"name": "RECALLED", "color": 7},
    {"name": "CANCELLED", "color": 8},
    {"name": "DONE", "color": 9},
    {"name": "TRANSFERRED", "color": 10},
    {"name": "INVALID_STATUS", "color": 11},
]

OVERALL_STATUS_OPTIONS = [
    {"name": "Phase 1: Line & Dept Review", "color": 0},
    {"name": "Phase 2: Accounting Processing", "color": 1},
    {"name": "Phase 3: Treasury Processing & Check Release", "color": 2},
    {"name": "Phase 4: Receipt Confirmation", "color": 3},
    {"name": "COMPLETED: Cash Advance Released", "color": 5},
    {"name": "Approved", "color": 6},
    {"name": "Under Review", "color": 39},
    {"name": "Pending", "color": 36},
    {"name": "Rejected", "color": 44},
    {"name": "Recalled", "color": 44},
    {"name": "Canceled", "color": 44},
]


def build_duration_formula(table_id: str, start_fid: str, end_fid: str) -> str:
    return (
        f"IF(OR(ISBLANK(bitable::$table[{table_id}].$field[{start_fid}]),"
        f"ISBLANK(bitable::$table[{table_id}].$field[{end_fid}]),"
        f"bitable::$table[{table_id}].$field[{end_fid}]<bitable::$table[{table_id}].$field[{start_fid}]),"
        f'"",DATEDIF(bitable::$table[{table_id}].$field[{start_fid}],'
        f'bitable::$table[{table_id}].$field[{end_fid}],"d")&" day "&'
        f"TEXT(bitable::$table[{table_id}].$field[{end_fid}]-"
        f'bitable::$table[{table_id}].$field[{start_fid}],"hh:mm:ss"))'
    )


def get_tenant_access_token() -> str:
    if not APP_SECRET or APP_SECRET == "replace_with_lark_app_secret":
        raise RuntimeError(
            "Missing LARK_APP_SECRET. Set LARK_APP_SECRET in environment or .env before running live migration."
        )
    url = "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal"
    res = requests.post(url, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=15).json()
    if res.get("code") != 0:
        raise RuntimeError(f"Failed to get tenant token: {res}")
    return res["tenant_access_token"]


def fetch_table_fields(token: str, table_id: str) -> tuple[dict, dict]:
    url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{table_id}/fields?page_size=100"
    res = requests.get(url, headers={"Authorization": f"Bearer {token}"}, timeout=15).json()
    if res.get("code") != 0:
        raise RuntimeError(f"Failed to list fields for {table_id}: {res}")
    items = res.get("data", {}).get("items", [])
    by_name = {f["field_name"]: f for f in items}
    by_id = {f["field_id"]: f for f in items}
    return by_name, by_id


def update_field(token: str, table_id: str, field_id: str, payload: dict, dry_run: bool = False) -> dict:
    if dry_run:
        return {"code": 0, "msg": "DRY_RUN"}
    url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{table_id}/fields/{field_id}"
    res = requests.put(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=20,
    ).json()
    return res


def create_field(token: str, table_id: str, payload: dict, dry_run: bool = False) -> dict:
    if dry_run:
        return {"code": 0, "msg": "DRY_RUN", "data": {"field": {"field_id": "fld_DRY_RUN_SOURCEID"}}}
    url = f"https://open.larksuite.com/open-apis/bitable/v1/apps/{BASE_TOKEN}/tables/{table_id}/fields"
    res = requests.post(
        url,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json=payload,
        timeout=20,
    ).json()
    return res


def build_offline_field_maps() -> tuple[dict, dict]:
    by_name = {}
    by_id = {}
    for name, fid in KNOWN_HEADER_FIELD_IDS.items():
        f_type = 1005 if name == "ID" else 1
        obj = {"field_id": fid, "field_name": name, "type": f_type}
        by_name[name] = obj
        by_id[fid] = obj
    for stage in ALL_8_STAGES:
        s_map = KNOWN_STAGE_FIELD_IDS[stage]
        for suffix, key in [
            ("Approver", "approver"),
            ("Start", "start"),
            ("End", "end"),
            ("Duration", "dur"),
            ("Action", "action"),
        ]:
            fname = f"{stage} {suffix}"
            fid = s_map[key]
            obj = {"field_id": fid, "field_name": fname, "type": 1}
            by_name[fname] = obj
            by_id[fid] = obj
    return by_name, by_id


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Standardize Lark Base Table 2 (tbliGywXHe6qMIm6) schema for Cash Advance (Non-Travel)."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview all 43 field type conversions and 1 field creation (SourceID) without modifying live Bitable.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    dry_run = args.dry_run
    mode_banner = "DRY-RUN PREVIEW (No Live Bitable Mutations)" if dry_run else "LIVE EXECUTION"

    print("=" * 80)
    print(f"Configuring Cash Advance (Non-Travel) Table 2 Schema Standard [{mode_banner}]")
    print(f"Base Token      : {BASE_TOKEN}")
    print(f"Table 1 (Master): {MAIN_TABLE_ID}")
    print(f"Table 2 (Log)   : {LOG_TABLE_ID}")
    print(f"App ID          : {APP_ID}")
    print("=" * 80)

    token = ""
    if dry_run and (not APP_SECRET or APP_SECRET == "replace_with_lark_app_secret"):
        print("[*] Dry-run mode without LARK_APP_SECRET: using verified offline schema map (46 fields).")
        fields_by_name, fields_by_id = build_offline_field_maps()
    else:
        token = get_tenant_access_token()
        fields_by_name, fields_by_id = fetch_table_fields(token, LOG_TABLE_ID)
        print(f"[*] Fetched {len(fields_by_id)} live fields from Table 2 ({LOG_TABLE_ID}).")

    errors = []

    # ------------------------------------------------------------------
    # Step 1: Configure Header Columns & Create SourceID
    # ------------------------------------------------------------------
    print("\n[1/2] Enforcing Standard Types on Header Columns (Zero Type 19 Lookups)...")

    header_conversions = [
        (
            "Overall Status",
            KNOWN_HEADER_FIELD_IDS["Overall Status"],
            {
                "field_name": "Overall Status",
                "type": 3,
                "property": {"options": OVERALL_STATUS_OPTIONS},
            },
            "Type 3 (SingleSelect, 11 options)",
        ),
        (
            "Task ID",
            KNOWN_HEADER_FIELD_IDS["Task ID"],
            {
                "field_name": "Task ID",
                "type": 15,
            },
            "Type 15 (URL)",
        ),
        (
            "Requester",
            KNOWN_HEADER_FIELD_IDS["Requester"],
            {
                "field_name": "Requester",
                "type": 11,
                "property": {"multiple": True},
            },
            "Type 11 (User, multiple=True)",
        ),
    ]

    for fname, known_fid, payload, desc in header_conversions:
        f_obj = fields_by_id.get(known_fid) or fields_by_name.get(fname)
        if not f_obj:
            msg = f"Missing header field '{fname}' ({known_fid})"
            print(f"  [!] {msg}")
            errors.append(msg)
            continue
        fid = f_obj["field_id"]
        res = update_field(token, LOG_TABLE_ID, fid, payload, dry_run=dry_run)
        if res.get("code") in [0, 1254606]:
            status = "DRY-RUN OK" if dry_run else "OK"
        else:
            status = f"Error {res.get('code')}: {res.get('msg')}"
            errors.append(f"{fname} ({fid}): {status}")
        print(f"  -> {fname:<24} ({fid}) -> {desc}: {status}")
        if not dry_run:
            time.sleep(0.15)

    # Create SourceID if missing
    has_source_id = "SourceID" in fields_by_name or any(
        f.get("field_name") == "SourceID" for f in fields_by_id.values()
    )
    if not has_source_id:
        res = create_field(token, LOG_TABLE_ID, {"field_name": "SourceID", "type": 1}, dry_run=dry_run)
        if res.get("code") == 0:
            new_fid = res.get("data", {}).get("field", {}).get("field_id", "created")
            status = f"DRY-RUN OK ({new_fid})" if dry_run else f"OK ({new_fid})"
        else:
            status = f"Error {res.get('code')}: {res.get('msg')}"
            errors.append(f"SourceID create: {status}")
        print(f"  -> {'SourceID':<24} (CREATE)    -> Type 1 (Text): {status}")
        if not dry_run:
            time.sleep(0.15)
    else:
        print(f"  -> {'SourceID':<24} (EXISTING)  -> Type 1 (Text): Already exists")

    # ------------------------------------------------------------------
    # Step 2: Convert All 40 Stage Columns (8 Stages x 5 Columns)
    # ------------------------------------------------------------------
    print("\n[2/2] Converting All 40 Stage Columns Across 8 Stages (Approver -> Start -> End -> Duration -> Action)...")
    if not dry_run:
        fields_by_name, fields_by_id = fetch_table_fields(token, LOG_TABLE_ID)

    for idx, stage in enumerate(ALL_8_STAGES, start=1):
        known = KNOWN_STAGE_FIELD_IDS[stage]
        approver_fid = (
            known["approver"]
            if known["approver"] in fields_by_id
            else (fields_by_name.get(f"{stage} Approver") or {}).get("field_id")
        )
        start_fid = (
            known["start"]
            if known["start"] in fields_by_id
            else (fields_by_name.get(f"{stage} Start") or {}).get("field_id")
        )
        end_fid = (
            known["end"]
            if known["end"] in fields_by_id
            else (fields_by_name.get(f"{stage} End") or {}).get("field_id")
        )
        dur_fid = (
            known["dur"]
            if known["dur"] in fields_by_id
            else (fields_by_name.get(f"{stage} Duration") or {}).get("field_id")
        )
        action_fid = (
            known["action"]
            if known["action"] in fields_by_id
            else (fields_by_name.get(f"{stage} Action") or {}).get("field_id")
        )

        print(f"\n  Stage {idx}/8: {stage}")
        if not all([approver_fid, start_fid, end_fid, dur_fid, action_fid]):
            msg = (
                f"Missing stage field IDs for '{stage}': "
                f"Approver={approver_fid}, Start={start_fid}, End={end_fid}, Duration={dur_fid}, Action={action_fid}"
            )
            print(f"    [!] {msg}")
            errors.append(msg)
            continue

        dur_formula = build_duration_formula(LOG_TABLE_ID, start_fid, end_fid)

        # Important dependency order: Start & End MUST be converted to Type 5 DateTime before Duration Type 20 Formula
        stage_mutations = [
            (
                f"{stage} Approver",
                approver_fid,
                {"field_name": f"{stage} Approver", "type": 11, "property": {"multiple": True}},
                "Type 11 (User)",
            ),
            (
                f"{stage} Start",
                start_fid,
                {"field_name": f"{stage} Start", "type": 5, "property": {"date_formatter": "yyyy/MM/dd HH:mm"}},
                "Type 5 (DateTime)",
            ),
            (
                f"{stage} End",
                end_fid,
                {"field_name": f"{stage} End", "type": 5, "property": {"date_formatter": "yyyy/MM/dd HH:mm"}},
                "Type 5 (DateTime)",
            ),
            (
                f"{stage} Duration",
                dur_fid,
                {"field_name": f"{stage} Duration", "type": 20, "property": {"formula_expression": dur_formula}},
                "Type 20 (Formula)",
            ),
            (
                f"{stage} Action",
                action_fid,
                {"field_name": f"{stage} Action", "type": 3, "property": {"options": ACTION_OPTIONS}},
                "Type 3 (SingleSelect)",
            ),
        ]

        for col_name, fid, payload, desc in stage_mutations:
            res = update_field(token, LOG_TABLE_ID, fid, payload, dry_run=dry_run)
            if res.get("code") in [0, 1254606]:
                status = "DRY-RUN OK" if dry_run else "OK"
            else:
                status = f"Error {res.get('code')}: {res.get('msg')}"
                errors.append(f"{col_name} ({fid}): {status}")
            print(f"    -> {col_name:<52} ({fid}) -> {desc:<21}: {status}")
            if not dry_run:
                time.sleep(0.15)

    print("\n" + "=" * 80)
    if errors:
        print(f"[!] Completed with {len(errors)} error(s):")
        for err in errors:
            print(f"  - {err}")
        print("=" * 80)
        return 1

    print(f"Table 2 Schema Standardization Completed Successfully [{mode_banner}]")
    print("=" * 80)
    return 0


if __name__ == "__main__":
    sys.exit(main())
