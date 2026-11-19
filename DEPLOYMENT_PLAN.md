# Implementation & Deployment Plan: Cash Advance (Non-Travel) Fetch/Sync & Auto-Heal Setup

> **Status**: Deployed & Verified in Production (`c:\Users\User.MIS\Documents\Cash Advance (Non-Travel)`)  
> **Production Architecture**: Enforces strict 1-to-1 parity with **Liquidation (Non-Travel)** — Lark AnyCross (`7709705859911143183` / `7709746437629710091`) serves strictly as the **Creation Trigger ONLY** (`Instance status = Pending`), while Cloudflare Worker `cash-advance-non-travel` on Account `98aa9b41c7867464e61d89b0d86cf59b` (`https://cash-advance-non-travel.markwlsn.workers.dev`) handles all stage sync and financial field auto-healing via its 1-minute Cron Trigger (`* * * * *`).

---

## 1. Executive Summary & Architectural Parity

This setup replicates the production **Liquidation (Non-Travel)** architecture (`PpBYbfebXalTOpsPThNlag60gef` / `tblaIarx3eSshV6N` / `tbl9kYdGsLsPQzB6`) 1-to-1 for **Cash Advance (Non-Travel)** (`ZMxobOBv0aW8AosmOhflq4IagBe` / `tblIbyc67hpYTyiI` / `tbliGywXHe6qMIm6`):

| Layer | Reference: Liquidation (Non-Travel) | Target: Cash Advance (Non-Travel) | Role |
| :--- | :--- | :--- | :--- |
| **Lark Base Token** | `PpBYbfebXalTOpsPThNlag60gef` | `ZMxobOBv0aW8AosmOhflq4IagBe` | Master Bitable tracker |
| **Table 1 (Master)** | `tblaIarx3eSshV6N` (`vewlYBEDTw`, 23 fields) | `tblIbyc67hpYTyiI` (`vewIj1OSBd`, 40 fields) | Native Lark Approval-synced master table + auto-healed `Vendor Bill No.` & `Check No.` |
| **Table 2 (Step Log)** | `tbl9kYdGsLsPQzB6` (47 fields, native types) | `tbliGywXHe6qMIm6` (`vewYFHTdcL`, 46 $\rightarrow$ 47 fields) | 8-stage SLA approval log (`Approver`, `Start`, `End`, `Duration`, `Action`) + `Overall Status` |
| **Approval Definition** | `19715E22-9CC7-4F81-B1F6-2FE7B2C1FA0B` | `D375F005-FCC9-4AA7-8B03-683AA17F4997` | `Cash Advance Form (Non-Travel)` (Admin ID `7690379670504460009`) |
| **Dedicated Lark Bot** | `cli_aa795f5a66b89f1d` (`Liquidation (Non-Travel)`) | `cli_aa74f7f23ab8df04` (`Cash Advance NT Bot`) | Dedicated OpenAPI credentials & `approval_instance` v1.0 event forwarder |
| **Lark AnyCross** | Project `7706752931566980882` / Flow `7706817672578600716` | Project `7709705859911143183` / Flow `7709746437629710091` | Real-time create trigger ONLY (`status = PENDING` $\rightarrow$ `HTTP Client` v1.7 `GET /sync`) |
| **Cloudflare Worker** | `liquidation-non-travel-watchdog` | `cash-advance-non-travel` (`98aa9b41c7867464e61d89b0d86cf59b`) | Instant `/sync` webhook handler (`ctx.waitUntil`) + 1-min cron (`* * * * *`) auto-heal engine (`https://cash-advance-non-travel.markwlsn.workers.dev`) |
| **GitHub Repository** | `markwlsn/Liquidation-Non-Travel-watchdog-` | `markwlsn/cash-advance-non-travel` | Source control & GitHub Actions Node 20 CI |

---

## 2. Verified Lark Approval Definition (`D375F005-FCC9-4AA7-8B03-683AA17F4997`)

Inspected read-only via `GET /open-apis/approval/v4/approvals/D375F005-FCC9-4AA7-8B03-683AA17F4997` and Approval Admin `queryById` (`7690379670504460009`):

### 2.1 Approval DAG & 8 Canonical Stage `node_id` Mappings

| Stage # | `node_id` (32-char MD5) | Admin `node_key` | Raw Approval Node `name` | Table 2 (`tbliGywXHe6qMIm6`) Column Prefix | Routing / Branch Condition (`widget17459832417220001`: `Total Cash Advance Amount`) |
| :---: | :--- | :--- | :--- | :--- | :--- |
| — | `b078ffd28db767c502ac367053f6e0ac` | `START` | `Submit` | *(Entry Node)* | Submitter initiates form; 4 fixed default CC recipients |
| **1** | `c1e48274b814fdce8dc77ddc6be0cd82` | `APPROVAL_805933_029688` | `Team Head (if none, enter requester name)` | `Team Head (if none, enter requester name)` | Always runs (`AND`, initiator-selected, `empty_auto_pass: true`) |
| **2** | `2bc64761cd7fa34d3905a13b982c73f2` | `APPROVAL_875932_2348742` | `Department Head` | `Department Head` | Always runs (`OR`, initiator-selected, `empty_auto_pass: true`) |
| **3** | `b42dc2a7ceae426ff6a9f683db746ac2` | `APPROVAL_24814_5912818` | `Acounting Processing` | `Acounting Processing <2000` | **Branch 1 (`< 2000`, priority 1)**: merges to `Receipt` |
| **4** | `0d47568655d7427088adc32db11e6dea` | `APPROVAL_64772_5920640` | `Accounting Processing` | `Accounting Processing > 2000` | **Branch 2 Step 1 (`> 2000`, priority 2)**: `Vendor Bill No.` & `Check No.` writable |
| **5** | `cc9562b8bb3b689f4051b9f64610f557` | `APPROVAL_270125_03757` | `Treasury Processing` | `Treasury Processing > 2000` | **Branch 2 Step 2 (`> 2000`)**: `Vendor Bill No.` & `Check No.` writable |
| **6** | `42fbf264c757382bea8706424f06dd8e` | `APPROVAL_591881_01519` | `For Check Releasing` | `For Check Releasing > 2000` | **Branch 2 Step 3 (`> 2000`)**: `Vendor Bill No.` & `Check No.` writable; merges to `Receipt` |
| **7** | `6303e52fcf398a2d8df73b79b144a6d4` | `APPROVAL_858806_1850412` | `Approval` | `Approval` | **Branch 3 (`== 2000`, priority 3)**: verified live on instance `7F3D0D9F-C74C-4507-993C-88B7F79DA0BD`; merges to `Receipt` |
| **8** | `1750beb4c4c8c6afe329c07dd4ea6028` | `APPROVAL_9451_027800` | `Receipt` | `Receipt` | **Post-Merge Final Step** (`approverType: 8` — initiator confirms receipt before `END`) |
| — | `b1a326c06d88bf042f73d70f50197905` | `END` | `End` | *(Terminal Node)* | Triggers post-approval automation initiating `Liquidation (Non-Travel)` |

### 2.2 Financial Auto-Heal Form Widgets

| Widget ID | Widget Name | Type | Table 1 Target Field (`tblIbyc67hpYTyiI`) | Parity Note |
| :--- | :--- | :--- | :--- | :--- |
| `widget17501233698840001` | `Vendor Bill No.` | `input` | `Vendor Bill No.` (`fldykERwG2`, Type `1` Text) | **Exact same widget ID & field ID as Liquidation** |
| `widget17501234330640001` | `Check No.` | `input` | `Check No.` (`fldfG1rDCh`, Type `1` Text) | **Exact same widget ID & field ID as Liquidation** |

---

## 3. Complete 1-to-1 Field & Schema Parity Matrix

### 3.1 Table 1 Parity: Master Registry (`tblaIarx3eSshV6N` vs `tblIbyc67hpYTyiI`)

#### Workflow-Critical Sync & Auto-Heal Columns (12 Columns)

| # | Field Name | Liquidation (`tblaIarx3eSshV6N`) | Cash Advance (`tblIbyc67hpYTyiI`) | Parity Status | Worker / Sync Behavior |
| :---: | :--- | :--- | :--- | :--- | :--- |
| 1 | `Request No.` | `fldnNUwM35` · Type `15` (Url, Primary) | `fldnNUwM35` · Type `15` (Url, Primary) | **Exact ID & Type Match** | Worker extracts `{ text, link }` $\rightarrow$ populates Table 2 `Request No` and `Task ID` |
| 2 | `Status` | `fldamAspZC` · Type `3` (SingleSelect, 7 opts) | `fldamAspZC` · Type `3` (SingleSelect, 7 opts) | **Exact ID, Type & Option Labels** | Native Approval-synced status (`Approved`, `Processing`, `Rejected`, `Canceled`, `Deleted`, `Terminated`, `Recalled`) |
| 3 | `Approval process` | `fldffN5UpV` · Type `3` (SingleSelect) | `fldffN5UpV` · Type `3` (SingleSelect) | **Exact ID & Type Match** | Native Approval-synced process name (`Cash Advance Form`) |
| 4 | `Submitted at` | `fld9bo7VQq` · Type `5` (DateTime) | `fld9bo7VQq` · Type `5` (DateTime) | **Exact ID & Type Match** | Native Approval-synced submission timestamp |
| 5 | `Completed at` | `fldwbbnW1f` · Type `5` (DateTime) | `fldwbbnW1f` · Type `5` (DateTime) | **Exact ID & Type Match** | Native Approval-synced completion timestamp |
| 6 | `Requester` | `fldxh36E5r` · Type `11` (User, `multiple: true`) | `fldxh36E5r` · Type `11` (User, `multiple: true`) | **Exact ID & Type Match** | Worker normalizes `[{ id: open_id }]` $\rightarrow$ copies to Table 2 `Requester` |
| 7 | `Initiator department` | `fldyM8OoyR` · Type `1` (Text) | `fldyM8OoyR` · Type `1` (Text) | **Exact ID & Type Match** | Native Approval-synced department |
| 8 | `Current assignee` | `fldaX5wpNH` · Type `11` (User, `multiple: true`) | `fldaX5wpNH` · Type `11` (User, `multiple: true`) | **Exact ID & Type Match** | Native Approval-synced current task assignee |
| 9 | `Approval steps` | `fldp68or9B` · Type `1` (Text) | `fldp68or9B` · Type `1` (Text) | **Exact ID & Type Match** | Native Approval-synced summary |
| 10 | `Vendor Bill No.` | `fldykERwG2` · Type `1` (Text) | `fldykERwG2` · Type `1` (Text) | **Exact ID & Type Match** | **Auto-Heal Target**: Worker `PUT`s value from `widget17501233698840001` when blank in Table 1 |
| 11 | `Check No.` | `fldfG1rDCh` · Type `1` (Text) | `fldfG1rDCh` · Type `1` (Text) | **Exact ID & Type Match** | **Auto-Heal Target**: Worker `PUT`s value from `widget17501234330640001` when blank in Table 1 |
| 12 | `SourceID` | `fldz4BInbN` · Type `1` (Text, Hidden) | `fldiJweS90` · Type `1` (Text, Hidden) | **Name & Type Match** (ID differs) | **Primary Join Key**: Base64 `<connector_id>:<instance_code>:<hash>:1`; decoded by `decodeInstanceCode()` |

#### Domain Columns, Reused Field ID Collisions & Synced Typos in Table 1 (`tblIbyc67hpYTyiI`)

- **Shared Identity Columns**: `Company` (`flds1qSojV`, Type 3, 6 corporate entities), `Employee Name` (`fldvkDa8sK`, Type 1), `Department` (`fldmHBHqMg`, Type 4).
- **Reused Field ID Collisions (Handled Safely)**:
  - `fld3miUipA` is `Detailed Liquidation` in Liquidation vs `Fare within travel area` in Cash Advance.
  - `fldqrR7p6R` is `Total Amount` in Liquidation vs `Total Fare Amount` in Cash Advance (`Total Cash Advance Amount` is `fldx8ATvj2`).
  - *Safeguard*: Dead Table 3 (`parseLiquidationItems`) code has been completely removed from `cloudflare_worker.js`.
- **Synced Approval Form Typos (Do Not Rename in Base Without Updating Approval Form Sync)**:
  - `Deparnent` (`fldvklINOg`), `Stard Date` (`fld9vjOT7F`), and option `Veue` under `Purpose` (`fldrBN3Ehz`) are synced directly from the Approval template (`exInfo.synced: true`) and are untouched by the Worker.

---

### 3.2 Table 2 Parity: Step Approval Log (`tbl9kYdGsLsPQzB6` vs `tbliGywXHe6qMIm6`)

Cash Advance Table 2 (`tbliGywXHe6qMIm6`) currently has **46 fields**, where **all 45 non-ID fields are Type 1 (`Text`)** and `SourceID` is missing. `configure_table2_schema.py` standardizes all 47 target columns to match Liquidation Table 2 (`tbl9kYdGsLsPQzB6`):

#### Header Columns (7 Target Fields)

| # | Field Name | Liquidation (`tbl9kYdGsLsPQzB6`) | Cash Advance (`tbliGywXHe6qMIm6`) | Current CA Type | Target Type & Configuration (`configure_table2_schema.py`) |
| :---: | :--- | :--- | :--- | :---: | :--- |
| 1 | `ID` | `fld3CHbOCw` (`1005`) | `fldtasZNMb` | `1005` (AutoNumber) | Keep `1005` (no change) |
| 2 | `Approval Instance Code` | `fldPkhzWrA` (`1`) | `fldsi8OrLP` | `1` (Text) | Keep `1` (Text) — primary upsert lookup key |
| 3 | `Request No` | `fldC03UtRL` (`1`) | `fld9huFx99` | `1` (Text) | Keep `1` (Text) |
| 4 | `Task ID` | `fldftxq2oM` (`15`) | `fldBjoyX55` | **`1` (Text)** | **Convert to Type `15` (URL)** (`{ text, link }`) |
| 5 | `Overall Status` | `fldIREvsv2` (`3`) | `fldHJmh5oy` | **`1` (Text)** | **Convert to Type `3` (SingleSelect)** with 11 `OVERALL_STATUS_OPTIONS` |
| 6 | `Requester` | `fldjZUBKcR` (`11`) | `fld4JyNcj7` | **`1` (Text)** | **Convert to Type `11` (User, `multiple: True`)** |
| 7 | `SourceID` | `fldWeSHm7X` (`1`) | *(Missing)* | **Missing** | **Create Field (`POST`) as Type `1` (Text)** |

#### 8 Stage Groups $\times$ 5 Columns = 40 Stage Fields in `tbliGywXHe6qMIm6`

| Stage # | Cash Advance Stage Prefix (`ALL_8_STAGES`) | `Approver` (Type `1` $\rightarrow$ **`11` User**) | `Start` (Type `1` $\rightarrow$ **`5` DateTime**) | `End` (Type `1` $\rightarrow$ **`5` DateTime**) | `Duration` (Type `1` $\rightarrow$ **`20` Formula**) | `Action` (Type `1` $\rightarrow$ **`3` SingleSelect**) |
| :---: | :--- | :--- | :--- | :--- | :--- | :--- |
| **1** | `Team Head (if none, enter requester name)` | `fldnfWGZfr` | `fldm6rt0Da` | `fldSGguMqr` | `fldDToonr7` | `fldkZW2xhj` |
| **2** | `Department Head` | `flddkWf62m` | `fldQrDvezE` | `fld81FRJje` | `fldNgOGlUr` | `fldlyfZLA9` |
| **3** | `Acounting Processing <2000` *(exact Table 2 prefix)* | `fldvJTJiBk` | `fldWjwoDz9` | `fldM68Sx6Y` | `fldvoGfrit` | `fld2iWEfe9` |
| **4** | `Accounting Processing > 2000` | `fldSsaekoj` | `fldwrzHxAM` | `fldvJ8Ymn4` | `fldxRWtYUO` | `fldCb2dxbw` |
| **5** | `Treasury Processing > 2000` | `fldtcS1mlv` | `fldMRGKVAc` | `fldKPptPRr` | `fldPTJYoVo` | `fldz2gNQMw` |
| **6** | `For Check Releasing > 2000` | `fldsdF3XCM` | `fldjZcwRq1` | `fldQgwN7iT` | `fld1uo0aS2` | `fldYneWxFY` |
| **7** | `Approval` | `fld8DrYnUB` | `fldodBOmMg` | `fldK51hurg` | `fldNpG5UCu` | `fldmnD3jOz` |
| **8** | `Receipt` | `fldnDNor3X` | `fldH1LsoFp` | `fldYUtu8J0` | `fldLCBseUK` | `fldrRxdZWB` |

#### Exact `Overall Status` SingleSelect Options (11 Options)
`Phase 1: Line & Dept Review` (`color: 0`), `Phase 2: Accounting Processing` (`color: 1`), `Phase 3: Treasury Processing & Check Release` (`color: 2`), `Phase 4: Receipt Confirmation` (`color: 3`), `COMPLETED: Cash Advance Released` (`color: 5`), `Approved` (`color: 6`), `Under Review` (`color: 39`), `Pending` (`color: 36`), `Rejected` (`color: 44`), `Recalled` (`color: 44`), `Canceled` (`color: 44`).

#### Exact `<Stage> Action` SingleSelect Options (12 Options)
`PENDING` (`0`), `APPROVED` (`1`), `COMPLETED` (`2`), `RESOLVED` (`3`), `NOT APPLICABLE` (`4`), `AUTO-PASSED` (`5`), `REJECTED` (`6`), `RECALLED` (`7`), `CANCELLED` (`8`), `DONE` (`9`), `TRANSFERRED` (`10`), `INVALID_STATUS` (`11`).

#### Exact `<Stage> Duration` Type 20 Formula Pattern
Converted **after** `<Stage> Start` and `<Stage> End` are converted to Type 5 DateTime (`yyyy/MM/dd HH:mm`):
```text
IF(OR(ISBLANK(bitable::$table[tbliGywXHe6qMIm6].$field[<START_FID>]),ISBLANK(bitable::$table[tbliGywXHe6qMIm6].$field[<END_FID>]),bitable::$table[tbliGywXHe6qMIm6].$field[<END_FID>]<bitable::$table[tbliGywXHe6qMIm6].$field[<START_FID>]),"",DATEDIF(bitable::$table[tbliGywXHe6qMIm6].$field[<START_FID>],bitable::$table[tbliGywXHe6qMIm6].$field[<END_FID>],"d")&" day "&TEXT(bitable::$table[tbliGywXHe6qMIm6].$field[<END_FID>]-bitable::$table[tbliGywXHe6qMIm6].$field[<START_FID>],"hh:mm:ss"))
```

---

## 4. External Platform Configuration Specifications

### 4.1 Lark Developer Console (`Cash Advance NT Bot`, `cli_aa74f7f23ab8df04`)

Current status inspected via live session: Version `1.0.0` (Approved), missing `contact:user.employee_id:readonly`, Event Subscription Mode = `Not configured`, Events Added = `None`.

| Setting | Target Configuration |
| :--- | :--- |
| **Permissions & Scopes** | Retain existing `approval:*` and `bitable:app` scopes; **add tenant scope `contact:user.employee_id:readonly`** |
| **Event Subscription Mode** | `Send notifications to developer's server` |
| **Request URL** | Paste the AnyCross Webhook URL (`https://anycross-sg.larksuite.com/hooks/<hookKey>`) generated by AnyCross Step 1 |
| **Subscribed Event** | Add **`Approval instance updates` (`approval_instance`, v1.0, Tenant access token)** |
| **Version Release** | Create & publish version **`1.0.1`** so the new scope and event subscription take effect |
| **Lark Base Collaborator Check** | Ensure `Cash Advance NT Bot` (`cli_aa74f7f23ab8df04`) is added as a collaborator with **Can Manage / Full Edit** access on Base `ZMxobOBv0aW8AosmOhflq4IagBe` |

### 4.2 Lark AnyCross Workflow (`7709705859911143183`, `Cash Advance NT`)

Mirrors reference AnyCross workflow `7706817672578600716` (`Liquidation (Non-Travel) Real-Time Ingestion`) identically:

1. **Connection Profile**:
   - Create `Lark Approval` Connection Profile named **`Cash Advance NT Bot`** using App ID `cli_aa74f7f23ab8df04` and its App Secret (`oauth2_client_credentials`).
2. **Workflow (`Cash Advance (Non-Travel) Real-Time Ingestion`)**:
   - **Node 1 (`approval-1`, Trigger)**:
     - Connector: `Lark Approval` (`connectorId: "7651530969798675892"`)
     - Trigger Event: `Approval instance status change` (`operationId: "7651530970603982263"`)
     - Auth Credential: `Cash Advance NT Bot`
     - Parameters:
       - `approval_code` (Approval Name): **`D375F005-FCC9-4AA7-8B03-683AA17F4997`** (`Cash Advance Form (Non-Travel)`)
       - `status` (Instance Status): **`PENDING`**
     - Copy the generated Webhook URL (`https://anycross-sg.larksuite.com/hooks/<hookKey>`) to `cli_aa74f7f23ab8df04` Event Subscriptions.
   - **Node 2 (`http-client-1`, Action)**:
     - Connector: `HTTP Client` v1.7 (`connectorId: "7327606926668267526"`)
     - Action: `GET Method` (`operationId: "7327606926726938630"`)
     - Parameters:
       - `url`: **`https://cash-advance-non-travel.markwlsn.workers.dev/sync`**
       - `response_parser`: **`none`**
       - `response_encoding_format`: **`UTF8`** (`utf8`)
       - `is_response_contain_file` (Response Includes File): **`No` (`false`)** *(mandatory: prevents AnyCross `Error: 1` validation failure)*
       - `success_status_code`: **`between`**
       - `status_code_range`: **`[200,299]`**

---

## 5. Step-by-Step Ordered Rollout Procedure (Execute Upon User Approval)

### Step 1: Standardize Lark Base Table 2 (`tbliGywXHe6qMIm6`) Schema
1. Copy `.env.example` to `.env` (gitignored) and set `LARK_APP_SECRET` for `cli_aa74f7f23ab8df04`.
2. Ensure `Cash Advance NT Bot` (`cli_aa74f7f23ab8df04`) has edit/manage permission on Base `ZMxobOBv0aW8AosmOhflq4IagBe`.
3. Preview with dry-run, then execute live standardization:
   ```powershell
   python configure_table2_schema.py --dry-run
   python configure_table2_schema.py
   ```
4. *(Optional)* Delete the 5 blank placeholder rows (`reczz28bLjXIyY9k`, `reczz28bLjXIzcqF`, `reczz28bLjXIzK48`, `reczz28bLjXIyEC1`, `reczz28bLjXIyelm`) in `tbliGywXHe6qMIm6` (note: `cloudflare_worker.js` safely ignores rows with null `Approval Instance Code` even if left in place).
5. Run `python inspect_fields.py` to confirm all 47 columns in `tbliGywXHe6qMIm6` have their target types (`1005`, `1`, `15`, `3`, `11`, `5`, `20`) and zero `(!)` icons appear in the Lark Base UI.

### Step 2: Deploy Cloudflare Worker (`cash-advance-non-travel` on Account `98aa9b41c7867464e61d89b0d86cf59b`)
1. Set the worker secret and deploy from `c:\Users\User.MIS\Documents\Cash Advance (Non-Travel)`:
   ```powershell
   npx wrangler secret put LARK_APP_SECRET
   npx wrangler deploy
   ```
2. Verify `/health` and initial `/sync` (which will backfill existing record `reczz28bLguiEPFR` / `202609280009` into Table 2):
   ```powershell
   curl https://cash-advance-non-travel.markwlsn.workers.dev/health
   curl https://cash-advance-non-travel.markwlsn.workers.dev/sync
   ```

### Step 3: Configure AnyCross (`7709705859911143183`) & Lark App (`cli_aa74f7f23ab8df04`)
1. In AnyCross project `7709705859911143183` (`Cash Advance NT`), create the `Cash Advance NT Bot` credential profile and build the 2-node workflow (`approval-1` $\rightarrow$ `http-client-1`) per Section 4.2.
2. Copy the generated AnyCross Webhook URL (`https://anycross-sg.larksuite.com/hooks/<hookKey>`).
3. In Lark Developer Console (`cli_aa74f7f23ab8df04`), add scope `contact:user.employee_id:readonly`, configure Event Subscription Request URL to the AnyCross Webhook URL, subscribe to `approval_instance` v1.0, and release version **`1.0.1`**.
4. Return to AnyCross `7709705859911143183`, click **Publish**, and verify the workflow status is **Running**.

### Step 4: Push to GitHub (`markwlsn/cash-advance-non-travel`)
1. Initialize/commit the prepared files (`cloudflare_worker.js`, `wrangler.toml`, `package.json`, `test_cloudflare_worker_logic.js`, `configure_table2_schema.py`, `inspect_fields.py`, `.github/workflows/ci.yml`, `.env.example`, `.gitignore`, `README.md`, `DEPLOYMENT_PLAN.md`) and push to `https://github.com/markwlsn/cash-advance-non-travel` (`main` branch).

---

## 6. Concrete Live End-to-End (E2E) Verification & Cleanup Procedure

> **Why Test Records Must Originate from Lark Approval**: Table 1 (`Cash Advance Form`, `tblIbyc67hpYTyiI`) is a native Lark Approval-synced table (`exInfo.synced: true`), so its `"Add Record"` button is disabled in the Bitable UI. Submitting a test request via Lark Approval tests the full production chain: **Lark Approval $\rightarrow$ Native Table 1 Sync (`SourceID`) + `approval_instance` Event $\rightarrow$ AnyCross Create Trigger (`GET /sync`) $\rightarrow$ Cloudflare Worker Auto-Heal $\rightarrow$ Table 2 (`tbliGywXHe6qMIm6`) Upsert**.

### Phase A: Verify Existing Historical Record Backfill (`202609280009`)
1. Immediately after deploying the Worker and triggering `GET /sync`, open Table 2 (`Step Approval Log`, `tbliGywXHe6qMIm6`).
2. Confirm that existing Table 1 record `reczz28bLguiEPFR` (`Request No.`: `202609280009`, instance `7F3D0D9F-C74C-4507-993C-88B7F79DA0BD`) is automatically created in Table 2 with:
   - `Approval Instance Code` = `7F3D0D9F-C74C-4507-993C-88B7F79DA0BD`
   - `Request No` = `202609280009`
   - `Task ID` = clickable native Type 15 URL link (`202609280009`)
   - `Overall Status` = `COMPLETED: Cash Advance Released`
   - `Team Head (if none, enter requester name) Action` = `APPROVED`
   - `Department Head Action` = `DONE`
   - `Approval Action` = `APPROVED`
   - `Receipt Action` = `APPROVED`
   - Computed Type 20 `Duration` strings (`0 day hh:mm:ss`) with **zero** `(!)` formula warning icons.

### Phase B: Live Create Trigger & Auto-Heal E2E Test with a New Test Record
1. **Submit Test Request in Lark Approval**:
   - Open Lark Approval $\rightarrow$ **`Cash Advance Form (Non-Travel)`** (`D375F005-FCC9-4AA7-8B03-683AA17F4997`).
   - Fill in test values:
     - `Employee Name`: `[E2E TEST - DO NOT PROCESS]`
     - `Purpose`: `Others (please indicate)` $\rightarrow$ `Other`: `[E2E TEST - AUTOHEAL VERIFICATION]`
     - `Particulars`: Description = `E2E Test Item`, Amount = `100.00`
     - `Team Head` / `Department Head`: Select your own user account so no external manager is notified.
   - Submit the form and note the new `Request No.` (`2026xxxxxxxx`).
2. **Verify Table 1 (`tblIbyc67hpYTyiI`) Native Sync**:
   - Confirm the new test row appears in `Cash Advance Form` (`tblIbyc67hpYTyiI`) with `Status = Processing` and hidden `SourceID` (`fldiJweS90`) populated.
3. **Verify AnyCross Create Trigger (`7709705859911143183`)**:
   - In AnyCross $\rightarrow$ Execution Logs, verify a new execution triggered on `status = PENDING` and `HTTP Client` (`GET /sync`) succeeded with HTTP `200` (`{"code":0,"msg":"Sync job scheduled"}`) in $< 2\text{s}$.
4. **Verify Cloudflare Worker & Table 2 (`tbliGywXHe6qMIm6`) Auto-Heal**:
   - Check `GET https://cash-advance-non-travel.markwlsn.workers.dev/health` and confirm `webhooksReceived` and `instancesCreated` incremented.
   - In Table 2 (`tbliGywXHe6qMIm6`), confirm the new test row appears within seconds with:
     - `Approval Instance Code` (decoded GUID), `Request No`, `SourceID`
     - `Task ID` (clickable native URL), `Requester` (native User chip)
     - `Overall Status` = `Phase 1: Line & Dept Review`
     - `Team Head (if none, enter requester name) Approver` (User chip), `Start` (DateTime), and `Action = PENDING`.

### Phase C: Post-Test Cleanup Procedure
1. **Recall the Test Approval Request**:
   - Click the `Task ID` URL link to open the test request in Lark Approval and click **Recall** (canceling the in-flight request).
   - Within $\le 60\text{s}$ (or via `curl .../sync`), confirm Table 2 updates `Overall Status` to `Recalled`.
2. **Remove Test Records from Bitable**:
   - In Table 2 (`Step Approval Log`, `tbliGywXHe6qMIm6`), right-click the test row (`[E2E TEST - DO NOT PROCESS]`) and select **Delete record** (or via Bitable API `DELETE /open-apis/bitable/v1/apps/ZMxobOBv0aW8AosmOhflq4IagBe/tables/tbliGywXHe6qMIm6/records/{record_id}`).
   - In Table 1 (`Cash Advance Form`, `tblIbyc67hpYTyiI`), delete the test row via UI/API if permitted by synced-table permissions (note: if deleted from Table 1 first, the Worker will never recreate the Table 2 row).
3. **Final Baseline Verification**:
   - Verify only production record(s) remain in `tblIbyc67hpYTyiI` and `tbliGywXHe6qMIm6`, and `GET /health` reports `"status": "healthy"`.
