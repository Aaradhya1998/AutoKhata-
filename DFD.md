# Auto Khata: Data Flow Diagram

All processing happens in the browser. There is no server and no database. The only external hand-off is the WhatsApp link, which the owner taps.

## Level 0: Context Diagram

```mermaid
flowchart LR
    Owner([Shop Owner])
    Customer([Customer])
    WA[WhatsApp app]
    AK((Auto Khata<br/>browser app))
    File[(Local files<br/>.txt in / .csv out / .pdf out)]

    Owner -- password, orders, payments, invoice edits --> AK
    AK -- dashboard, dues, invoice preview --> Owner
    Owner -- chat export .txt --> AK
    AK -- CSV and PDF downloads --> File
    AK -- wa.me link with prefilled message --> WA
    WA -- message sent by owner --> Customer
```

## Level 1: Main Processes

```mermaid
flowchart TB
    subgraph Input
        P1[1.0 Password check]
        P2[2.0 Quick entry<br/>and text import]
        P3[3.0 Parse lines<br/>into orders]
    end

    subgraph Storage
        D1[(D1 Orders<br/>localStorage)]
        D2[(D2 Customers<br/>localStorage)]
        D3[(D3 Settings<br/>shop name, password hash)]
    end

    subgraph Processing
        P4[4.0 Record payment<br/>update balance]
        P5[5.0 Compute dashboard<br/>and dues buckets]
        P6[6.0 Item pair<br/>correlation]
    end

    subgraph Output
        P7[7.0 Build reminder<br/>and wa.me link]
        P8[8.0 Build invoice<br/>and PDF]
        P9[9.0 Export CSV]
    end

    Owner([Owner]) --> P1
    P1 -- hash compare --> D3
    P1 -- unlocked --> P2
    Owner --> P2
    P2 --> P3
    P3 -- confirmed rows --> D1
    P3 -- new names --> D2
    Owner --> P4
    P4 --> D1
    D1 --> P5
    D2 --> P5
    D1 --> P6
    P5 --> Owner
    P6 --> Owner
    D2 --> P7
    D1 --> P7
    P7 -- wa.me URL --> WA([WhatsApp])
    D1 --> P8
    D3 --> P8
    P8 --> Owner
    D1 --> P9
    D2 --> P9
    P9 --> CSVFile[(CSV file)]
```

## Process Descriptions

| ID | Process | Input | Output | Notes |
|----|---------|-------|--------|-------|
| 1.0 | Password check | Typed password | Unlock or deny | Compare SHA-256 with salt. Set on first run. |
| 2.0 | Quick entry and import | Text box line or `.txt` file | Raw lines | Import shows unparsed lines separately. |
| 3.0 | Parse lines | Raw line | Order row or error | Regex: customer, qty, unit, item, amount, status. Owner confirms before save. |
| 4.0 | Record payment | Customer, amount | Updated paid and balance | Supports partial payments. |
| 5.0 | Dashboard and dues | Orders, customers | Totals, dues buckets | Buckets: 0-7, 8-30, 30+ days. |
| 6.0 | Item correlation | Orders grouped by bill or day | Item pair counts | Simple pair count, top 10. |
| 7.0 | Reminder | Customer, balance, shop name | Prefilled wa.me URL | Message editable. Owner taps Send. |
| 8.0 | Invoice | Customer orders, shop settings | Editable invoice, PDF | Print-to-PDF or client-side library. |
| 9.0 | CSV export | All orders and customers | CSV file | UTF-8 with header row. |

## Data Stores

| Store | Fields | Persistence |
|-------|--------|-------------|
| D1 Orders | id, date, customer, item, quantity, unit, amount, paid, due_date, status | localStorage (key: `autokhata.orders`) |
| D2 Customers | name, phone | localStorage (key: `autokhata.customers`) |
| D3 Settings | shop_name, password_salt, password_hash, default_language | localStorage (key: `autokhata.settings`) |

## Trust Boundaries

- Browser to local storage: data stays on the device.
- Browser to WhatsApp: only a URL is opened. No data is sent by the app.
- Browser to file system: owner-initiated downloads only.
