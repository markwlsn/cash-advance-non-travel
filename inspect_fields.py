#!/usr/bin/env python3
"""
inspect_fields.py
-----------------
Read-only Bitable schema inspection utility for Cash Advance (Non-Travel).
Reads credentials from environment variables or local .env file (zero hardcoded secrets).
"""

import argparse
import json
import os
import sys
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


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only inspection of Lark Base Table 1 & Table 2 field schemas for Cash Advance (Non-Travel)."
    )
    parser.add_argument("--base-token", default=get_env("LARK_BASE_TOKEN", "ZMxobOBv0aW8AosmOhflq4IagBe"))
    parser.add_argument("--main-table-id", default=get_env("LARK_MAIN_TABLE_ID", "tblIbyc67hpYTyiI"))
    parser.add_argument("--log-table-id", default=get_env("LARK_LOG_TABLE_ID", "tbliGywXHe6qMIm6"))
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    app_id = get_env("LARK_APP_ID", "cli_aa74f7f23ab8df04")
    app_secret = get_env("LARK_APP_SECRET", "")

    if not app_secret or app_secret == "replace_with_lark_app_secret":
        print("Error: Missing LARK_APP_SECRET. Set LARK_APP_SECRET in environment or .env file.", file=sys.stderr)
        return 1

    auth_res = requests.post(
        "https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal",
        json={"app_id": app_id, "app_secret": app_secret},
        timeout=15,
    ).json()
    if auth_res.get("code") != 0:
        print(f"Error obtaining tenant_access_token: {auth_res}", file=sys.stderr)
        return 1

    token = auth_res["tenant_access_token"]

    tables = [
        (args.main_table_id, "Table 1 - Cash Advance Form"),
        (args.log_table_id, "Table 2 - Step Approval Log"),
    ]
    for tid, tname in tables:
        res = requests.get(
            f"https://open.larksuite.com/open-apis/bitable/v1/apps/{args.base_token}/tables/{tid}/fields?page_size=100",
            headers={"Authorization": f"Bearer {token}"},
            timeout=15,
        ).json()
        items = res.get("data", {}).get("items", [])
        print(f"\n{'=' * 25} {tname} ({tid}) [{len(items)} fields] {'=' * 25}")
        for f in items:
            prop = json.dumps(f.get("property", {}))
            if len(prop) > 60:
                prop = prop[:57] + "..."
            print(f"ID: {f['field_id']:<14} | Type: {f['type']:<4} | Name: {f['field_name']:<45} | Prop: {prop}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
