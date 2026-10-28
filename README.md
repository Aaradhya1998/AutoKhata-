# Auto Khata

A lite, password-protected khata (credit ledger) for small shops. Record orders by typing or importing a chat file, see who owes what and for how long, send a WhatsApp reminder in one click, and create an editable invoice as PDF.
THIS WAS BUILT DURING 6 HOUR PROMPTWARS 
##PROMPTWARS X KICKTOTECH X HACK2SKILL X GOOGLE FOR DEVLOPERS X JSPM UNIVERSITY 

## Features

- Password lock for the dashboard
- Dashboard with sales totals, dues, top customers, and item pairs
- Customer sales and debts table with oldest unpaid date
- Quick entry text box and `.txt` import (including WhatsApp chat exports)
- Dues grouped by age: 0-7, 8-30, 30+ days
- One-click WhatsApp reminder with editable message
- Editable invoice with shop name, downloadable as PDF
- CSV export that opens in Excel

## Quick Start

1. Download or clone this folder.
2. Open `index.html` in Chrome or Edge.
3. Set a password on first launch.
4. Go to Settings and enter your shop name.
5. Add orders with the quick entry box, or import a `.txt` file.

No install step is needed. Works offline after first load.

## Quick Entry Format

```
<customer> <quantity><unit> <item> [amount] [pending|paid]
```

Examples:

```
Ravi 2kg aata 1 tel oil pending
Sunita 500g chini 40 paid
Mohan 1 dozen anda 60 pending
```

Lines that cannot be parsed are shown separately so you can fix them.

## WhatsApp Chat Import

1. In WhatsApp, open a chat, tap the menu, choose Export chat, then Without media.
2. Save the `.txt` file.
3. In Auto Khata, choose Import and select the file.
4. Review the parsed rows, fix any mistakes, then confirm.

Nothing is saved until you confirm.

## Reminders

Click Remind next to a customer. The app opens WhatsApp with a prefilled message. You tap Send. The app never sends messages on its own. This is deliberate, to stay within WhatsApp's terms.

## Backup

Your data lives in this browser only. Use Export CSV and Backup regularly. Clearing browser data will erase the ledger.

## Security Note

The password is a casual lock for a shared PC, not strong encryption. Anyone with access to browser developer tools or the stored data can get around it. Do not rely on it to protect highly sensitive information.

## Limits (MVP)

- Single device. No sync between PC and phone yet.
- No automatic WhatsApp sending.
- No GST, payments, or inventory counts.
- Parser handles common shorthand. Unusual wording may need manual correction.

## Parser Accuracy

Tested on a labeled set of 40 sample lines (see `tests/parser_test.txt`).

| Field | Accuracy |
|-------|----------|
| Customer | TBD |
| Item | TBD |
| Quantity | TBD |
| Amount | TBD |

Fill this table after running the test. Report honest numbers, including misses.

## Project Structure

```
auto-khata/
├── index.html      # App shell and screens
├── style.css       # Layout and print styles for invoice
├── app.js          # Storage, parser, dashboard, reminders, invoice
├── tests/
│   └── parser_test.txt   # 40 labeled sample lines
├── PRD.md
├── DFD.md
└── README.md
```

## Roadmap

- Encrypted storage using the password as the key
- Phone access over local network
- Scheduled reminder list (manual send still)
- Hindi and Hinglish reminder templates selectable per customer

## Tech Stack

HTML, CSS, and vanilla JavaScript. Optional client-side PDF library. 
