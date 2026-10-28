# Auto Khata: Product Requirements Document

**Version:** 0.2  
**Status:** Implemented MVP  
**Platform:** Local Windows PC, Chrome or Edge  
**Architecture:** Flask server on `127.0.0.1`, pandas-managed CSV storage, plain HTML/CSS/JavaScript frontend

## 1. Problem

Small shop owners often track sales and credit (khata or udhaar) in notebooks, chat messages, or memory. Orders are slow to record, outstanding balances are easy to forget, and following up on old debts is awkward.

## 2. Product Goal

Auto Khata gives one shop owner a simple local application where they can:

1. Record sales quickly from shorthand text or a `.txt`/WhatsApp chat export.
2. Review parsed orders before saving anything.
3. See sales, balances, customers with dues, and debt age.
4. Record full or partial payments.
5. prepare a WhatsApp reminder without sending it automatically.
6. Create an editable invoice and save it through the browser print dialog.
7. Export CSV files and make or restore a JSON backup.

## 3. Target User

- Owner of a small shop with approximately 20 to 200 regular customers.
- Comfortable with WhatsApp and basic browser use, but not expected to manage technical systems.
- Uses one Windows PC as the primary ledger device.

## 4. Scope

### In scope

| Feature | Current requirement |
|---|---|
| Local password lock | First-run password setup, login, session-based unlock, and manual Lock button. |
| Quick entry | Parse shorthand order lines and show an editable preview. |
| Text/chat import | Parse plain order lines and supported WhatsApp export timestamps. |
| Orders and customers | Persist exact order and customer record shapes in CSV files. |
| Dashboard | Sales today/month, dues, customers with dues, top customers, top items, and item pairs. |
| Dues and payments | Group debts by age and record full or partial payments. |
| Reminders | Build an editable message and open a `wa.me` link for manual sending. |
| Invoice | Select orders, edit invoice fields, and use print-to-PDF. |
| Data tools | Export orders/customers CSV and download/restore JSON backups. |
| Settings | Persist the shop name. |

### Out of scope

- Automatic or scheduled WhatsApp sending.
- WhatsApp Web scraping or live message sync.
- Cloud hosting, device sync, and multi-user accounts.
- A database server; storage remains local CSV/JSON files.
- Exposing Flask to the LAN or internet.
- GST filing, payment gateways, and inventory management.
- Encryption of the ledger files.
- Password reset or recovery.
- Native mobile applications.

## 5. Functional Requirements

### 5.1 Access and session

- **FR-1:** On first use, the server accepts a new password only when it contains at least 6 characters.
- **FR-2:** The dashboard and all ledger API routes remain unavailable until the Flask session is unlocked.
- **FR-3:** The Lock button clears the unlocked session and returns to the password screen.
- **FR-4:** The server stores a random salt and an `hashlib.scrypt` password hash in `data/settings.json`. It never stores the plain password.
- **FR-5:** Wrong login attempts return a clear error without revealing hash, salt, or diagnostic details.
- **FR-6:** The server binds to `127.0.0.1:5000` only.

### 5.2 Server data

- **FR-7:** Orders persist in `data/orders.csv`, managed through pandas.
- **FR-8:** An order has exactly: `id`, `date`, `customer`, `item`, `quantity`, `unit`, `amount`, `paid`, `due_date`, `status`.
- **FR-9:** Order status is `paid`, `partial`, or `unpaid`.
- **FR-10:** Customers persist in `data/customers.csv` with exactly `name` and `phone`.
- **FR-11:** Phone numbers include a country code when used for WhatsApp, for example `91XXXXXXXXXX`.
- **FR-12:** Shop name, password salt/hash, default language, and the generated Flask session secret persist in `data/settings.json`.
- **FR-13:** CSV and settings writes use a temporary file followed by replacement of the destination file.
- **FR-14:** Empty CSV files are created on first run with their required header rows.

### 5.3 Quick entry and import

- **FR-15:** Quick entry parses lines shaped like `<customer> <qty><unit> <item> [<amount>] [pending|paid]`.
- **FR-16:** A supported line may contain multiple item/quantity groups, producing multiple preview rows.
- **FR-17:** `.txt` import accepts plain order lines and supported WhatsApp chat exports.
- **FR-18:** Unparsed lines appear separately so the owner can retry or skip them.
- **FR-19:** Parsed rows appear in an editable preview.
- **FR-20:** Import and quick entry must not save an order until the owner chooses Confirm and save.

### 5.4 Dashboard and customers

- **FR-21:** The Home tab shows sales today, sales this month, total outstanding dues, and the number of customers with dues.
- **FR-22:** The Home tab ranks up to five top customers by sales and five top items by quantity.
- **FR-23:** Item pairs bought by the same customer on the same date are ranked by occurrence.
- **FR-24:** The Customers tab shows customer name, total sales, paid amount, balance due, and oldest unpaid date.
- **FR-25:** When there are no orders, Home shows an empty state that links to Add orders.

### 5.5 Dues, payments, and reminders

- **FR-26:** Outstanding balances are grouped by the oldest applicable date into `0-7 days`, `8-30 days`, and `30+ days overdue` buckets.
- **FR-27:** A payment may be full or partial and cannot exceed the outstanding balance.
- **FR-28:** Customer-level payments are allocated to the oldest unpaid orders first.
- **FR-29:** Each customer with a balance has a Remind action.
- **FR-30:** The reminder text and phone number are editable before the link is opened.
- **FR-31:** The app opens `https://wa.me/<phone>?text=<encoded-message>` in a new tab.
- **FR-32:** Auto Khata never sends a WhatsApp message automatically.

### 5.6 Invoice

- **FR-33:** The owner selects a customer and one or more of that customer's orders.
- **FR-34:** The invoice shows shop name, customer, date, line items, total, paid, and amount due.
- **FR-35:** Invoice fields are editable without changing saved orders or settings.
- **FR-36:** Download PDF opens the browser print dialog, where the owner can choose Save as PDF.
- **FR-37:** Print styling hides navigation, controls, developer tools, and all non-invoice content.

### 5.7 Export, backup, and settings

- **FR-38:** Orders and customers can be downloaded as UTF-8 CSV files with header rows.
- **FR-39:** CSV output must open cleanly in Excel.
- **FR-40:** A JSON backup contains orders, customers, and non-sensitive application settings used by the frontend.
- **FR-41:** Restore validates the selected JSON before replacing server-backed data.
- **FR-42:** Restoring a browser-era backup does not replace the server password hash or session secret.
- **FR-43:** The shop name can be read and updated through server settings.

## 6. API Requirements

| Method and path | Purpose | Access |
|---|---|---|
| `GET /` | Serve the application | Public |
| `GET /api/status` | Report password/session state | Public |
| `POST /api/password/set` | Set first password | Public only before a password exists |
| `POST /api/login` | Validate password and unlock session | Public |
| `POST /api/lock` | Clear session | Unlocked session |
| `GET /api/orders` | List orders | Unlocked session |
| `POST /api/orders` | Add or replace validated orders | Unlocked session |
| `POST /api/payments` | Apply a payment to one order | Unlocked session |
| `GET /api/customers` | Return customer details and aggregates | Unlocked session |
| `POST /api/customers` | Replace validated customer records | Unlocked session |
| `GET /api/settings` | Return safe frontend settings | Unlocked session |
| `POST /api/settings` | Update shop name | Unlocked session |

## 7. Non-Functional Requirements

- **Local operation:** Core ledger functionality works without internet. WhatsApp requires internet when its link is opened.
- **Privacy:** No analytics, tracking, CDN, or automatic external data transfer.
- **Accessibility:** Minimum 16px base text, high contrast, large controls, keyboard-compatible forms, and labelled inputs.
- **Compatibility:** Latest Chrome and Edge on Windows.
- **Simplicity:** No frontend build step and no JavaScript framework.
- **Durability:** Server data survives browser refresh and server restart.
- **Capacity:** Designed for a single owner and a small local ledger, not concurrent multi-user writes.

## 8. Security Model

The password is a casual lock for a shared PC, not encryption. The signed Flask session controls access through the UI/API, but orders and customers remain readable as plaintext CSV files to anyone with filesystem access. The server must remain bound to `127.0.0.1` until authentication, CSRF protection, transport security, and deployment hardening are designed for network use.

## 9. Acceptance Criteria

1. `python app.py` prints the local URL and starts on `127.0.0.1:5000`.
2. First run shows password creation; fewer than 6 characters is rejected.
3. Wrong login is rejected and correct login opens Home.
4. Locked data API calls return HTTP 401.
5. Confirmed quick-entry/import rows appear in `data/orders.csv` with the exact header.
6. Shop name, customers, orders, and password configuration survive restart.
7. Payments update paid amount and status without exceeding balance.
8. CSV exports contain headers and open in Excel.
9. Invoice print preview contains only the printable invoice.
10. No plain password is stored in project files.

## 10. Known Limitations and Planned Work

- The old root frontend remains as a temporary browser-only compatibility copy; Flask serves `templates/` and `static/`.
- Old browser `localStorage` is not migrated automatically.
- The frontend currently uses an in-memory cache and often saves complete order/customer arrays.
- Some frontend save handlers update the UI before the asynchronous server write completes.
- The payment UI should be consolidated around `/api/payments` instead of also using full-array order replacement.
- Formal pytest and browser automation suites are not yet committed.
- Documentation and code should be reviewed again before deleting the legacy root frontend.

## 11. Success Measures

- Parser test set remains at or above 85% accuracy for customer, item, quantity, and amount.
- A normal order can be entered and confirmed in under 10 seconds.
- The core demonstration—login, add order, view dues, prepare reminder, create invoice—can be completed in under 2 minutes.
