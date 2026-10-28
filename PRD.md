# Auto Khata: Product Requirements Document (MVP)

**Version:** 0.1
**Status:** Draft for hackathon build
**Platform:** Desktop browser first (PC), responsive for mobile later

---

## 1. Problem

Small shop owners (kirana, general stores, local traders) track sales and credit ("khata", "udhaar") in notebooks, phone chats, or memory. Result: owners forget who owes money, lose track of how long a debt has been open, and chase payments awkwardly. Orders often arrive as messy WhatsApp messages, which are slow to record one by one.

## 2. Goal

Give a shop owner one simple, password-protected dashboard where they can:

1. Record sales and orders quickly, by typing or by importing a chat/text file.
2. See who owes how much, and for how long.
3. Send a payment reminder on WhatsApp in one click.
4. Generate an editable invoice as PDF.

## 3. Target User

- **Primary:** Owner of a small shop with 20 to 200 regular credit customers.
- **Skill level:** Uses WhatsApp and a smartphone daily. Comfortable with a PC browser for a dashboard. Not technical.

## 4. Scope

### In scope (MVP)

| # | Feature | Description |
|---|---------|-------------|
| F1 | Password lock | Owner sets a password once. Dashboard is hidden until it is entered. |
| F2 | Dashboard analytics | Totals: sales today and this month, total outstanding dues, number of customers with dues, top customers, top items. |
| F3 | Customer sales and debts | List of customers with total sales, amount paid, balance due, and oldest unpaid date. |
| F4 | Item correlation | Shows which items are often bought together (simple pair counts), e.g. "Atta + Oil in 18 orders". |
| F5 | Quick entry (text box) | Owner types an order in shorthand, e.g. `Ravi 2kg aata 1 tel oil pending`. Parsed and saved. |
| F6 | Text or chat file import | Upload a `.txt` (including a WhatsApp chat export). Parser turns lines into orders. Owner reviews before saving. |
| F7 | CSV export | All records downloadable as CSV that opens cleanly in Excel. |
| F8 | Reminders with due dates | Each credit sale can have a due date. Dashboard lists overdue and due-soon customers. |
| F9 | One-click WhatsApp reminder | Button opens `wa.me/<number>?text=<prefilled message>`. Owner taps Send in WhatsApp. |
| F10 | Editable invoice to PDF | Invoice auto-filled with shop name and bill lines. Owner can edit fields, then download PDF. |

### Out of scope (MVP)

- Automatic or scheduled WhatsApp sending (violates WhatsApp terms; reminders are manual by design)
- Live WhatsApp message sync or WhatsApp Web scraping
- Multi-user accounts, cloud login, or server-side database
- Payment gateway integration (UPI, Razorpay, etc.)
- GST calculation and filing
- Inventory stock counts and purchase tracking
- Native mobile app (responsive layout is a later step)

## 5. User Stories

1. As an owner, I set a password once so my customers' data is not visible to others using the PC.
2. As an owner, I type `Ravi 2kg aata 1 tel oil pending` and it appears as an order under Ravi, with balance due.
3. As an owner, I upload my day's chat export and review parsed lines before saving.
4. As an owner, I open "Dues" and see who owes money, sorted by how old the debt is.
5. As an owner, I click "Remind" next to a customer and WhatsApp opens with a polite message ready to send.
6. As an owner, I record a partial payment and the balance updates.
7. As an owner, I create an invoice for a customer, edit the shop name or a line item, and download it as PDF.
8. As an owner, I export all data to CSV and open it in Excel.

## 6. Functional Requirements

### 6.1 Access
- FR-1: On first launch, the app asks the owner to set a password (minimum 6 characters).
- FR-2: Subsequent launches require the password before any data is shown.
- FR-3: A "Lock" button returns to the password screen.
- FR-4: Password is stored as a salted SHA-256 hash, never in plain text.

### 6.2 Data
- FR-5: All data is stored in a single CSV-compatible structure in browser `localStorage`, with an Export and Import option for backup.
- FR-6: Each order record has: `id`, `date`, `customer`, `item`, `quantity`, `unit`, `amount`, `paid`, `due_date`, `status` (paid / partial / unpaid).
- FR-7: Each customer record has: `name`, `phone` (with country code, e.g. 91XXXXXXXXXX).

### 6.3 Quick Entry and Import
- FR-8: Quick entry parses lines of the form `<customer> <qty><unit> <item> [<amount>] [pending|paid]`.
- FR-9: Import accepts `.txt` files. Each line is parsed with the same parser as quick entry.
- FR-10: Unparsed lines are shown separately so the owner can fix or skip them.
- FR-11: Parsed rows appear in an editable preview. Nothing is saved until the owner confirms.

### 6.4 Dashboard
- FR-12: Shows: total sales (today, this month), total outstanding dues, count of customers with dues.
- FR-13: Shows a customer table: name, total sales, paid, balance, oldest unpaid date.
- FR-14: Shows item pairs bought together, ranked by count, top 10.

### 6.5 Dues and Reminders
- FR-15: Dues are grouped into buckets: 0-7 days, 8-30 days, 30+ days overdue.
- FR-16: Each customer with a balance has a "Remind" button.
- FR-17: The reminder message is editable before sending. Default text is polite and includes shop name, amount, and customer name.
- FR-18: "Send on WhatsApp" opens `https://wa.me/<phone>?text=<url-encoded message>` in a new tab.
- FR-19: The app never sends a message by itself.

### 6.6 Invoice
- FR-20: Owner selects a customer and a set of orders, then clicks "Create invoice".
- FR-21: Invoice shows shop name (from settings), customer name, date, line items, total, and amount due.
- FR-22: All invoice fields are editable before download.
- FR-23: "Download PDF" produces a PDF using the browser print dialog ("Save as PDF") or a small client-side library.

### 6.7 Export
- FR-24: "Export CSV" downloads all orders as a UTF-8 CSV with a header row.
- FR-25: CSV opens in Excel without manual column fixes.

## 7. Non-Functional Requirements

- **Simplicity:** No build step. Plain HTML, CSS, and JavaScript in a small set of files.
- **Performance:** Dashboard loads in under 1 second with 1,000 orders.
- **Offline:** Works without internet after the first load, except the reminder link and any external library.
- **Privacy:** No data leaves the device. No analytics or third-party tracking.
- **Accessibility:** Readable font size (16px minimum), high contrast, large buttons.
- **Browser support:** Latest Chrome and Edge on Windows.

## 8. Security Note

A password stored in the browser is a lock against casual access on a shared PC. It is not strong encryption. Anyone with access to the browser's developer tools or the stored data can bypass it. This must be stated clearly in the README and pitch. A future version can add encryption of stored data with the password as the key.

## 9. Success Metrics (for hackathon demo)

- Parser accuracy on a labeled test set of 40 lines: target at least 85% correct for customer, item, quantity, and amount.
- Time to record one order by quick entry: under 10 seconds.
- Demo flow completes in 2 minutes: set password, enter orders, see dues, click Remind, download invoice.

## 10. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Parser fails on messy Hinglish | Unparsed lines shown for manual fix. Test set reports accuracy honestly. |
| Browser data lost (cleared cache) | Export and Import backup buttons. Remind owner to export weekly. |
| Password seen as weak | State clearly it is a casual lock. Roadmap includes encryption. |
| PDF formatting varies | Use print-to-PDF with a print stylesheet. Test on one browser. |
| WhatsApp number missing country code | Validate phone field and prefill 91 for Indian numbers. |

## 11. Milestones (3-4 hour build)

1. **0:00-0:30** Project setup, password screen, local storage layer.
2. **0:30-1:30** Quick entry parser and order list.
3. **1:30-2:15** Dashboard analytics, customer table, item pairs.
4. **2:15-2:45** Dues buckets, reminder message, wa.me link.
5. **2:45-3:15** Invoice editor and PDF download.
6. **3:15-3:45** CSV export, txt import, parser accuracy test.
7. **3:45-4:00** README polish, demo rehearsal.

## 12. Open Questions

- Shop name and default reminder language: fixed setting or per-customer?
- Should the reminder default to Hindi, English, or Hinglish?
- Does the owner want partial payments logged as separate entries or as a running balance?
