# Integration Setup — xlwings Approval Gate + FastAPI Bridge

Two integration points external to the PowerShell pipeline itself.
Neither is required for Bronze extraction to run — the pipeline operates
end-to-end via `Run-Pipeline.ps1`. These integrations activate the
**approval gate (stage 09)** and the **staging load fallback (stage 11)**.

---

## Part 1 — xlwings Approval Gate

### What it does

Stage `09_approval.ps1` blocks pipeline execution per entity and watches
`review/{entity}/{RunId}/approval/` for a JSON file to appear.
The Excel dashboard is the interface through which a reviewer opens the
`review_package.xlsx`, inspects delta rows and validation flags, then
writes either `approved.json` or `rejected.json` to that directory.

The pipeline resumes automatically the moment the file lands.
No polling. No manual script re-invocation.

### Two separate concerns — approval gate vs. data operations

The Excel dashboard has two independent connection paths:

```
┌─────────────────────────────────────────────────────────────────┐
│  EXCEL DASHBOARD                                                 │
│                                                                  │
│  DATA OPERATIONS                     APPROVAL GATE              │
│  (fetch, schema, delta)              (stage 09 only)            │
│                                                                  │
│  pyfetch / xlwings-lite              VBA button (Option A)      │
│       │                              OR xlwings func (Option B) │
│       │ HTTP                              │                      │
│       ▼                                   │ file write (no HTTP) │
│  FastAPI :8000  ──► SQL Server            ▼                      │
│  (always required                    review/{entity}/{RunId}/    │
│   for data operations)               approval/approved.json      │
│                                           │                      │
│                                           ▼                      │
│                                      FileSystemWatcher           │
│                                      (Wait-ForApproval.ps1)      │
└─────────────────────────────────────────────────────────────────┘
```

**FastAPI is always required** for data operations regardless of which
approval option is chosen. The VBA button (Option A) only handles
the approval gate — it writes a JSON file directly to disk and has
no connection to FastAPI whatsoever. These are independent paths.

The Excel file and the pipeline must share the same filesystem path —
either running on the same machine or via a mapped network share.

### Option A — VBA button (approval gate only — no xlwings server required)

Open `review/{entity}/{RunId}/review_package.xlsx` in Excel.
Insert two buttons (Developer tab → Insert → Button):

**Approve button macro** — paste into the workbook's VBA module:

```vba
Sub ApproveRun()
    Dim approvalDir As String
    Dim entity As String
    Dim runId As String

    ' Read entity and RunId from named cells in the workbook
    entity = ThisWorkbook.Names("ENTITY_NAME").RefersToRange.Value
    runId  = ThisWorkbook.Names("RUN_ID").RefersToRange.Value

    approvalDir = ThisWorkbook.Path & "\approval\"

    ' Create the approval directory if needed
    On Error Resume Next
    MkDir approvalDir
    On Error GoTo 0

    ' Write approved.json
    Dim fNum As Integer
    fNum = FreeFile
    Open approvalDir & "approved.json" For Output As #fNum
    Print #fNum, "{"
    Print #fNum, "  ""entity"": """ & entity & ""","
    Print #fNum, "  ""run_id"": """ & runId & ""","
    Print #fNum, "  ""decision"": ""approved"","
    Print #fNum, "  ""timestamp"": """ & Format(Now, "yyyy-mm-ddThh:mm:ss") & """"
    Print #fNum, "}"
    Close #fNum

    MsgBox "Approved. Pipeline resuming for " & entity & ".", vbInformation
End Sub
```

**Reject button macro:**

```vba
Sub RejectRun()
    Dim reason As String
    reason = InputBox("Enter rejection reason:", "Reject Run")
    If reason = "" Then Exit Sub

    Dim approvalDir As String
    Dim entity As String
    Dim runId As String

    entity = ThisWorkbook.Names("ENTITY_NAME").RefersToRange.Value
    runId  = ThisWorkbook.Names("RUN_ID").RefersToRange.Value

    approvalDir = ThisWorkbook.Path & "\approval\"
    On Error Resume Next
    MkDir approvalDir
    On Error GoTo 0

    Dim fNum As Integer
    fNum = FreeFile
    Open approvalDir & "rejected.json" For Output As #fNum
    Print #fNum, "{"
    Print #fNum, "  ""entity"": """ & entity & ""","
    Print #fNum, "  ""run_id"": """ & runId & ""","
    Print #fNum, "  ""decision"": ""rejected"","
    Print #fNum, "  ""reason"": """ & reason & ""","
    Print #fNum, "  ""timestamp"": """ & Format(Now, "yyyy-mm-ddThh:mm:ss") & """"
    Print #fNum, "}"
    Close #fNum

    MsgBox "Rejected. Pipeline will abort for " & entity & ".", vbExclamation
End Sub
```

**Named cells to add to the workbook** (Insert → Name → Define):

| Name | Refers to | Value written by |
|---|---|---|
| `ENTITY_NAME` | a cell in a metadata sheet | `08_report.ps1` writes it into the workbook |
| `RUN_ID` | a cell in a metadata sheet | `08_report.ps1` writes it into the workbook |

`08_report.ps1` should write these values into a hidden `_Meta` sheet when
assembling `review_package.xlsx` so the VBA macros can read them without
manual entry.

### Option B — xlwings server (if xlwings is already installed)

If the team already runs the xlwings server for the dashboard, the
`approve_entity` / `reject_entity` Python functions from the README
can be registered as xlwings functions and called via the ribbon:

```python
# In dashboard/xlwings_main.py — add these two functions
import xlwings as xw

@xw.func
def approve_entity_xw(entity: str, run_id: str):
    """Called from Excel via xlwings ribbon button."""
    import json, os
    from datetime import datetime
    approval_dir = f"review/{entity}/{run_id}/approval"
    os.makedirs(approval_dir, exist_ok=True)
    with open(f"{approval_dir}/approved.json", "w") as f:
        json.dump({"entity": entity, "run_id": run_id,
                   "decision": "approved",
                   "timestamp": datetime.now().isoformat()}, f)

@xw.func
def reject_entity_xw(entity: str, run_id: str, reason: str = ""):
    """Called from Excel via xlwings ribbon button."""
    import json, os
    from datetime import datetime
    approval_dir = f"review/{entity}/{run_id}/approval"
    os.makedirs(approval_dir, exist_ok=True)
    with open(f"{approval_dir}/rejected.json", "w") as f:
        json.dump({"entity": entity, "run_id": run_id,
                   "decision": "rejected", "reason": reason,
                   "timestamp": datetime.now().isoformat()}, f)
```

Start the xlwings server then import functions into Excel via the
xlwings ribbon (Import Functions). The buttons call these via
`=approve_entity_xw(ENTITY_NAME, RUN_ID)` in a button-linked cell.

### xlwings / pyfetch — data operation connection

The dashboard data operations (`fetch_entity_data`, `fetch_hubspot_properties`,
`fetch_schema`, etc. in `xlwings_main.py`) all call FastAPI via `pyfetch`:

```
Excel cell / button
  └── xlwings-lite (Python runs in browser WASM or local xlwings server)
        └── pyfetch(url)  →  HTTP GET/POST
              └── FastAPI bridge (:8000)
                    └── pyodbc  →  SQL Server (:1433)
```

This path is **always active** for data operations regardless of how the
approval gate is configured. The FastAPI server must be running and
reachable at the `API URL` value in `parameters.xlsx` for any dashboard
data function to work.

If using **xlwings-lite** (WASM / browser execution): Python runs inside
the spreadsheet environment — `pyfetch` is available natively and no
local xlwings server process is needed. The FastAPI bridge is still
required as the SQL Server proxy.

If using **xlwings classic** (local server): `xlwings runserver` starts
a local process. `pyfetch` is replaced by `requests` in that context,
but the FastAPI bridge call chain is identical.

### Parameters sheet layout (`parameters.xlsx`)

The main dashboard workbook. `get_connection_params()` in `dashboard/modules/params.py`
reads from a sheet where column A contains the label and column B the value.
Exact label strings are case-sensitive:

```
A                           B
─────────────────────────── ────────────────────────────────────────
DATABASE CONNECTION DETAILS
API URL                     http://localhost:8000
HOST                        <SQL Server hostname>
DATABASE                    CRMICALPS
USER NAME                   sa
PASSWORD                    <leave blank for Trusted_Connection>
PORT                        1433
DBTYPE                      mssql
SCHEMA                      dbo
HUBSPOT_API_KEY             <Bearer token>
HUBSPOT_API_URL             https://api.hubapi.com
POSTGRESQL_HOST             <PostgreSQL hostname>
POSTGRESQL_PORT             5432
POSTGRESQL_DATABASE         icalps_pipeline
POSTGRESQL_USER             <pipeline user>
POSTGRESQL_PASSWORD         <do not commit — set via env var>
```

The `API URL` row is the FastAPI bridge base URL.
When running locally: `http://localhost:8000`.
When using Render: `https://ic-d-load-db-bridge.onrender.com`.

### Reviewer workflow (stage 09 in practice)

1. `08_report.ps1` writes `review/{entity}/{RunId}/review_package.xlsx`
2. Pipeline prints: `Waiting for approval: review/Company/20260327_120000/review_package.xlsx`
3. Reviewer opens the workbook — four sheets: `_Delta`, `_Structural`, `_Format`, `_Fuzzy`
4. Reviewer inspects flagged rows, checks encoding fixes log, format scores
5. Reviewer clicks **Approve** or **Reject** button
6. `Wait-ForApproval.ps1` FileSystemWatcher fires, pipeline resumes or throws
7. Repeat for each entity (sequential — one at a time)

---

## Part 2 — FastAPI Bridge

### What it does

The FastAPI server (`dashboard/server/main.py`) is the HTTP bridge between
the Excel dashboard and the SQL Server database. It also exposes
`POST /export-to-postgres` which `Invoke-StagingLoad.ps1` calls as a
fallback when the DuckDB postgres extension is unavailable.

The PowerShell pipeline's **primary** load path does not require the
FastAPI server — it uses the DuckDB postgres extension directly.
The server is only needed for:
- The fallback in `11_load.ps1` (`$env:ICALPS_API_URL` set)
- The xlwings dashboard (schema discovery, ad-hoc query, HubSpot property fetch)

### Local development setup

```bash
# From the repo root
cd dashboard
pip install -r requirements.txt

# Start with auto-reload
uvicorn dashboard.server.main:app --reload --port 8000
```

Server available at `http://localhost:8000`.
Swagger UI at `http://localhost:8000/docs`.

### Environment variables (server-side)

The server reads SQL Server credentials from query parameters (passed by
`build_api_url()` in `params.py`). No server-side env vars are required
for the basic query bridge.

For the `/export-to-postgres` endpoint, the server needs PostgreSQL access:

```bash
# Set before starting uvicorn, or in a .env file
export PG_HOST=localhost
export PG_PORT=5432
export PG_DATABASE=icalps_pipeline
export PG_USER=pipeline_user
export PG_PASSWORD=<password>
```

### Endpoints consumed by this pipeline

| Endpoint | Method | Called by | Purpose |
|---|---|---|---|
| `POST /export-to-postgres` | POST | `Invoke-StagingLoad.ps1` (fallback) | Load approved parquet rows to staging tables |
| `GET /query` | GET | xlwings dashboard | Ad-hoc SQL query execution |
| `GET /schema` | GET | xlwings dashboard | Table and column discovery |
| `GET /tables` | GET | xlwings dashboard | List database tables |
| `GET /preview` | GET | xlwings dashboard | Row preview for a table |

### Production deployment (Render)

Service name: `ic-d-load-db-bridge`
Defined in `dashboard/server/render.yaml`:

```yaml
startCommand: uvicorn dashboard.server.main:app --host 0.0.0.0 --port $PORT
```

Render assigns `$PORT` automatically. The public URL will be:
`https://ic-d-load-db-bridge.onrender.com`

Set this as `API URL` in `parameters.xlsx` and as `$env:ICALPS_API_URL`
when running the pipeline against production:

```powershell
$env:ICALPS_API_URL = "https://ic-d-load-db-bridge.onrender.com"
.\Run-Pipeline.ps1 -RunId 20260327_120000
```

### IP whitelist (production only)

The `render.yaml` has a commented-out `ipAllowList` block.
For production, restrict access to the office IP or VPN range
in the Render dashboard (Settings → IP Allow List).

Without a whitelist the API is public — the SQL Server credentials
pass through query parameters and are visible in server logs.

### Health check

```powershell
# Verify the bridge is reachable before running the pipeline
Invoke-RestMethod -Uri "$env:ICALPS_API_URL/" -Method Get
# Expected: { "status": "ok" } or similar root response
```
