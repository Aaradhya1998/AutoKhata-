# Auto Khata

Auto Khata is a local credit ledger for small shops. It records orders from shorthand text or chat exports, tracks customer balances, prepares WhatsApp reminders, and creates editable invoices.

The current application runs through a Flask server on the owner's Windows PC. Flask listens only at `http://127.0.0.1:5000`, and pandas stores orders and customers in local CSV files. The frontend remains plain HTML, CSS, and JavaScript.

Built during the 6-hour Promptwars x Hack2Skill x KickToTech hackathon (Google for Developers, JSPM University).

## Current Features

- First-run password setup, login, and manual Lock button.
- Quick-entry shorthand parser with an editable preview before saving.
- Plain `.txt` and WhatsApp chat-export import.
- Separate retry/skip handling for unparsed lines.
- Orders list with dates, quantities, amounts, payments, status, and due dates.
- Dashboard totals for today/month sales, dues, and customers with dues.
- Top customers, top items, and items bought together.
- Customer table with sales, paid amount, balance, and oldest unpaid date.
- Dues grouped into 0-7, 8-30, and 30+ day buckets.
- Full and partial payment recording, allocated oldest debt first in the customer payment UI.
- Editable WhatsApp reminder and phone number before opening `wa.me`.
- Editable invoice with browser print-to-PDF.
- Orders and customers CSV export.
- JSON backup download and restore.
- Persistent shop-name setting.
- Six-tab interface: Home, Add orders, Dues, Customers, Invoice, and Settings.

## Technology

- Python 3.10+
- Flask
- pandas
- HTML5, CSS, and vanilla JavaScript
- CSV and JSON files; no database
- Browser print dialog for PDF output
- No npm, frontend framework, CDN, or build step

## Quick Start

From Windows PowerShell in the project directory:

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python app.py
```

If PowerShell does not allow activation:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe app.py
```

The terminal prints:

```text
Auto Khata is running at http://127.0.0.1:5000
```

Open that address in Chrome or Edge and leave the terminal running. Do not open the root `index.html` for normal server-backed use.

The server intentionally binds to `127.0.0.1`, so other devices cannot connect to it.

## First Run

1. Start `app.py`.
2. Open `http://127.0.0.1:5000`.
3. Create a password containing at least 6 characters.
4. The dashboard opens after the server stores a random salt and scrypt hash.

The plain password is never written to disk. There is no password reset flow, so keep the password and a backup of the `data` folder.

## Quick Entry Format

```text
<customer> <quantity><unit> <item> [amount] [pending|paid]
```

Examples:

```text
Ravi 2kg aata 120 pending
Sunita 500g chini 40 paid
Mohan 1 dozen anda 60 pending
Sunita 2kg aata 90 1kg chini 45 pending
```

Rules:

- One line can contain multiple items. Each item becomes an order row.
- If no status is present, the order defaults to unpaid.
- Unpaid words include `pending`, `unpaid`, `udhaar`, `baki`, and `baaki`.
- Paid words include `paid` and `cash`.
- A missing amount becomes 0 and can be corrected in the preview.
- Supported units include kg, g, gm, l, ltr, litre, ml, dozen, dz, pkt, packet, pc, pcs, and piece.
- Nothing is persisted until Confirm and save is selected.

## Text and WhatsApp Import

In Add orders, choose a `.txt` file containing either plain order lines or a WhatsApp chat export. For a chat export, the optional “My name in the chat” field can exclude the owner's own messages.

Recognized messages are passed through the same order parser. Parsed orders enter the editable preview; failed lines appear separately for retry or skip. Selecting a file never saves orders by itself.

## Dues and Payments

- Debt age uses `due_date` when present and otherwise uses the order date.
- A customer appears in the bucket of their oldest outstanding order.
- A payment must be greater than 0 and cannot exceed the balance.
- Full payment changes an order to `paid`; a smaller payment changes it to `partial`.

## Reminders

Select Remind next to a customer with a balance. The message and phone number can be edited before Auto Khata opens WhatsApp.

A 10-digit Indian number receives the `91` country code automatically. Auto Khata does not send messages itself; the owner reviews and sends the message in WhatsApp.

## Invoice

1. Open Invoice and choose a customer.
2. Select one or more orders.
3. Select Create invoice.
4. Edit the shop name, customer, date, lines, paid amount, or totals if necessary.
5. Select Download PDF and choose Save as PDF in the browser print dialog.

Invoice edits do not alter saved orders or settings.

## Server Data

Runtime data is stored in:

```text
data/orders.csv
data/customers.csv
data/settings.json
```

Orders use this exact header:

```text
id,date,customer,item,quantity,unit,amount,paid,due_date,status
```

Customers use:

```text
name,phone
```

`settings.json` stores the shop name, default language, password salt/hash, and generated Flask session secret. CSV and JSON changes are written to temporary files and committed with an atomic replacement.

## Export and Backup

The Settings tab can:

- Export orders CSV.
- Export customers CSV.
- Download a JSON application backup.
- Restore a compatible JSON backup.

The server's password hash and session secret are not replaced by a frontend backup restore. For a complete machine-level backup, stop the server and copy the entire `data` folder.

## Legacy Browser Version

The root `index.html`, `style.css`, and `app.js` are the previous browser-only version and remain temporarily for migration safety. They use browser `localStorage` and are not the frontend served by Flask.

The server uses:

```text
templates/index.html
static/style.css
static/app.js
```

Existing browser `localStorage` records are not migrated automatically. Export a backup from the old version before removing it. Importing or validating old backup data should be done deliberately.

## Security Model

The password is a casual lock for a shared PC. It is not encryption. Flask stores a salted scrypt hash rather than the plain password, and protected API routes require an unlocked signed session.

Anyone with filesystem access can still read `orders.csv`, `customers.csv`, and most settings. Do not expose the current server to a network or use it for highly sensitive information.

A page refresh may remain unlocked while the current Flask session cookie is valid. Selecting Lock clears the session.

## Project Structure

```text
auto-khata/
|-- app.py                 # Flask routes, password and session handling
|-- data.py                # pandas CSV/JSON persistence
|-- requirements.txt       # Flask and pandas
|-- templates/
|   `-- index.html         # Flask-served application shell
|-- static/
|   |-- style.css          # Screen and invoice print styles
|   `-- app.js             # Parser, UI modules, and API-backed Store
|-- data/
|   |-- orders.csv
|   |-- customers.csv
|   `-- settings.json
|-- tests/
|   |-- parser_test.txt
|   `-- chat_sample.txt
|-- PRD.md
|-- DFD.md
|-- README.md
|-- index.html             # Legacy browser-only copy
|-- style.css              # Legacy browser-only copy
`-- app.js                 # Legacy localStorage copy
```

## API Summary

Public routes:

- `GET /`
- `GET /api/status`
- `POST /api/password/set`
- `POST /api/login`

Routes requiring an unlocked session:

- `POST /api/lock`
- `GET`, `POST /api/orders`
- `POST /api/payments`
- `GET`, `POST /api/customers`
- `GET`, `POST /api/settings`

## Parser Accuracy

The hand-run parser fixture contains 40 lines in `tests/parser_test.txt`: 35 expected successes and 5 expected rejections.

| Field | Correct | Accuracy |
|---|---:|---:|
| Customer | 34 / 35 | 97.1% |
| Item | 33 / 35 | 94.3% |
| Quantity | 35 / 35 | 100% |
| Unit | 35 / 35 | 100% |
| Amount | 35 / 35 | 100% |

All 5 intentionally invalid lines were rejected, and 33 of 35 valid lines had every labelled field correct. These are authored fixtures, not results from a production shop dataset.

## Current Limitations

- Single PC and single owner; no synchronization or concurrent-user design.
- No automatic WhatsApp sending or WhatsApp scraping.
- No GST, payment gateway, inventory, or order deletion UI.
- No due-soon view separate from the existing age buckets.
- Ledger CSV files are not encrypted.
- The frontend cache often sends complete order/customer arrays when saving.
- Some UI save handlers update the screen before the asynchronous request finishes.
- `/api/payments` exists, but customer payment handling should be fully consolidated around it.
- No committed pytest or browser automation suite yet.
- Parser behavior is shorthand-oriented; complex Hindi sentences, currency notation, and comma-formatted amounts may require manual correction.

## Recommended Next Work

1. Add pytest coverage for authentication, locked routes, CSV persistence, payments, and restart behavior.
2. Await server writes before displaying success in the frontend.
3. Route all payment updates through `/api/payments`.
4. Add a reviewed migration tool for legacy browser backups.
5. Add friendly recovery messages for malformed CSV/JSON files.
6. Remove the legacy root frontend only after migration approval.

## Documentation

- `PRD.md` defines the current product requirements and acceptance criteria.
- `DFD.md` documents browser, API, storage, and external data flows.
