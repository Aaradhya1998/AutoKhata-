# Auto Khata

A lite, password-protected khata (credit ledger) for small shops. I built it to record orders by typing, see who owes what and for how long, send a WhatsApp reminder, and make an invoice as PDF.

It runs in the browser on a PC. No server, no installation, no database. It is plain HTML, CSS and JavaScript.

## What works now

- Password lock. I set a password on first launch, and the app asks for it on every open. A Lock button returns to the password screen.
- Quick entry. I type an order line, check it in an editable preview, and save only after I confirm.
- Orders list with date, customer, item, quantity, amount, paid, status and due date.
- Dashboard with sales today, sales this month, total dues, customers with dues, top customers, top items, and items bought together.
- Customers table with total sales, paid, balance and oldest unpaid date.
- Dues grouped by age: 0-7, 8-30 and 31+ days.
- Pay button to record a full or partial payment. Payments go to the oldest unpaid orders first.
- Remind button that opens WhatsApp with a ready message. I can edit the message and the phone number first.
- Settings with the shop name.
- Editable invoice. I pick a customer and orders, edit any field, and download a PDF.

## Not built yet

- `.txt` and WhatsApp chat import
- CSV export for Excel
- Backup and restore
- A list of customers whose payment is due soon (only overdue age is shown)
- A delete button for orders

## Quick Start

1. Download or clone this folder.
2. Open `index.html` in Chrome or Edge.
3. Set a password (minimum 6 characters).
4. In Settings, enter the shop name and click Save.
5. Type orders in the quick entry box.

Works offline. The only outside link is the WhatsApp link, which opens when I click a button.

## Quick Entry Format

```
<customer> <quantity><unit> <item> [amount] [pending|paid]
```

Examples:

```
Ravi 2kg aata 120 pending
Sunita 500g chini 40 paid
Mohan 1 dozen anda 60 pending
Sunita 2kg aata 90 1kg chini 45 pending
```

Rules:

- One line can hold several items. Each item becomes its own order row.
- A line with no status word is saved as unpaid. Status words: pending, unpaid, udhaar, baki, baaki (unpaid) and paid, cash (paid).
- A missing amount becomes 0. I can fix it in the preview.
- Known units: kg, g, gm, l, ltr, litre, ml, dozen, dz, pkt, packet, pc, pcs, piece.
- A line the parser cannot read is shown separately so I can fix it or skip it. Nothing is saved until I click Confirm and save.

## Dues and Payments

- An order's age counts from its due date if one is set, otherwise from its order date.
- A customer goes into the bucket of their oldest unpaid order.
- A payment cannot be more than the customer's balance, and cannot be 0 or empty.

## Reminders

Click Remind next to a customer. The app opens WhatsApp with a ready message, in Hinglish by default. I can edit the message before sending. I tap Send myself. The app never sends a message on its own. This is deliberate, to stay within WhatsApp's terms.

A 10-digit Indian mobile number gets 91 added automatically. The number is saved with the customer.

## Invoice

1. In the Invoice section, choose a customer and tick the orders to include.
2. Click Create invoice. Shop name, customer, date, lines, paid and amount due are all editable.
3. Click Download PDF, and in the print dialog choose "Save as PDF".

Editing an invoice does not change the saved orders or settings. It only changes that one bill.

## Security Note

The password is a casual lock for a shared PC. It is not encryption. Anyone who opens the browser developer tools can read the stored data. Do not rely on it for highly sensitive information.

If I forget the password, the only way back in is to clear the `autokhata.settings` key in the browser's local storage. That also removes the shop name.

## Backup

My data lives in this browser only. Clearing browser data erases the ledger. A backup feature is not built yet. For now, the data can be copied from the browser's local storage by hand.

## Parser Accuracy

I tested the parser on 40 sample lines in `tests/parser_test.txt`: 35 labeled with correct values and 5 that should be rejected. The test lines were written by me, so these numbers are probably higher than what real shop messages would score.

| Field | Correct | Accuracy |
|-------|---------|----------|
| Customer | 34 / 35 | 97.1% |
| Item | 33 / 35 | 94.3% |
| Quantity | 35 / 35 | 100% |
| Unit | 35 / 35 | 100% |
| Amount | 35 / 35 | 100% |

- Lines that should be rejected and were rejected: 5 / 5.
- Lines where every field was correct: 33 / 35.

The two misses:

- `Ravi 2kg aata Rs 120 pending`: the parser read the item as "aata rs".
- `Ravi ko 2kg aata dena 120 pending`: the parser read the customer as "Ravi Ko" and the item as "aata dena".

I have not yet tested on real messages from a shop.

## Limits

- Single device. No sync between PC and phone.
- No automatic WhatsApp sending. No WhatsApp scraping.
- No GST, no payments gateway, no inventory counts.
- The parser handles common shorthand. Hindi sentences, "Rs" or "₹" signs, and amounts like 1,200 are not supported.
- Items are matched by exact spelling. "aata" and "atta" count as different items in the dashboard.
- "Bought together" means the same customer bought both items on the same date. There are no bill numbers.
- Tested on Chrome and Edge on Windows only.

## Project Structure

```
auto-khata/
├── index.html      # App shell and screens
├── style.css       # Layout and print styles for the invoice
├── app.js          # Storage, password, parser, dashboard, dues, reminders, invoice
├── tests/
│   └── parser_test.txt   # 40 labeled sample lines
├── PRD.md
├── DFD.md
└── README.md
```

Data is stored in browser local storage under three keys: `autokhata.orders`, `autokhata.customers` and `autokhata.settings`.

To run the parser test, unlock the app, open Developer tools at the bottom of the page, and choose `tests/parser_test.txt`.

## Roadmap

- `.txt` and WhatsApp chat import with an editable preview
- CSV export that opens in Excel, plus backup and restore
- Due-soon list
- Delete and edit for saved orders
- Encrypted storage using the password as the key
- Phone access over the local network
- Hindi and English reminder templates

## Tech Stack

HTML, CSS and vanilla JavaScript. No backend, no build step, no external libraries. PDF is made through the browser's print dialog.
