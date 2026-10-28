import argparse
import filecmp
import os
import random
import shutil
import tempfile
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path

import pandas as pd


SEED = 42
ORDER_COLUMNS = [
    "id",
    "date",
    "customer",
    "item",
    "quantity",
    "unit",
    "amount",
    "paid",
    "due_date",
    "status",
]
CUSTOMER_COLUMNS = ["name", "phone"]

FIRST_NAMES = [
    "Aarav", "Aditi", "Ajay", "Akash", "Amit", "Anil", "Anita", "Anjali",
    "Arjun", "Bhavna", "Deepak", "Divya", "Farhan", "Geeta", "Gopal",
    "Imran", "Ishita", "Jaya", "Kabir", "Kavita", "Kiran", "Komal", "Manoj",
    "Meena", "Mohan", "Naina", "Neha", "Nikhil", "Pankaj", "Pooja", "Pradeep",
    "Priya", "Rahul", "Rajesh", "Rakesh", "Rani", "Ravi", "Reena", "Ritika",
    "Rohan", "Sahil", "Sanjay", "Seema", "Shalini", "Sohan", "Sunita", "Suresh",
    "Tanvi", "Tarun", "Usha", "Varun", "Vijay", "Vikas", "Vimla", "Yash",
    "Zoya", "Harish", "Leela", "Mukesh", "Nisha",
]
SURNAME_INITIALS = "KMSRPDTGJBNVLAHCWYF"

# Each tuple is (quantity, unit, typical price in rupees).
ITEM_OPTIONS = {
    "aata": [(1, "kg", 52), (2, "kg", 104), (5, "kg", 250)],
    "chini": [(500, "g", 25), (1, "kg", 48), (2, "kg", 96)],
    "tel": [(500, "ml", 85), (1, "l", 160), (2, "l", 315)],
    "dal": [(500, "g", 70), (1, "kg", 135), (2, "kg", 265)],
    "chawal": [(1, "kg", 70), (5, "kg", 335)],
    "doodh": [(500, "ml", 32), (1, "l", 60), (2, "l", 118)],
    "anda": [(6, "pcs", 42), (1, "dozen", 80), (2, "dozen", 158)],
    "biscuit": [(1, "packet", 20), (2, "packet", 40), (3, "packet", 58)],
    "chai patti": [(250, "g", 65), (500, "g", 125), (1, "kg", 240)],
    "sabun": [(1, "pcs", 38), (3, "pcs", 110), (6, "pcs", 215)],
    "namak": [(1, "kg", 25), (2, "kg", 48)],
    "besan": [(500, "g", 55), (1, "kg", 105), (2, "kg", 205)],
    "masala": [(1, "packet", 35), (2, "packet", 68), (3, "packet", 100)],
}


def parse_args():
    parser = argparse.ArgumentParser(description="Generate deterministic Auto Khata demo data.")
    parser.add_argument(
        "--date",
        type=date.fromisoformat,
        default=date.today(),
        help="Demo date in YYYY-MM-DD format (default: today).",
    )
    parser.add_argument("--orders", type=int, default=500, help="Number of orders (default: 500).")
    parser.add_argument("--customers", type=int, default=60, help="Number of customers (default: 60).")
    return parser.parse_args()


def make_customers(count):
    if count < 24:
        raise ValueError("--customers must be at least 24 so every dues bucket can contain 8 customers")
    if count > len(FIRST_NAMES) * len(SURNAME_INITIALS):
        raise ValueError("--customers is larger than the supported fictional name set")

    rows = []
    for index in range(count):
        first_name = FIRST_NAMES[index % len(FIRST_NAMES)]
        initial_index = (index // len(FIRST_NAMES) + index) % len(SURNAME_INITIALS)
        name = f"{first_name} {SURNAME_INITIALS[initial_index]}"
        ten_digit_number = 9_100_000_000 + index + 1
        rows.append({"name": name, "phone": f"91{ten_digit_number:010d}"})
    return rows


def choose_product(rng, item):
    quantity, unit, typical_price = rng.choice(ITEM_OPTIONS[item])
    price_change = rng.choice([-4, -3, -2, -1, 0, 0, 0, 1, 2, 3, 4])
    return quantity, unit, max(1, typical_price + price_change)


def make_order(rng, customer, item, order_date, status):
    quantity, unit, amount = choose_product(rng, item)
    if status == "paid":
        paid = amount
        due_date = ""
    elif status == "partial":
        paid = max(1, min(amount - 1, round(amount * rng.choice([0.25, 0.5, 0.75]))))
        due_date = (order_date + timedelta(days=7)).isoformat()
    else:
        paid = 0
        due_date = (order_date + timedelta(days=7)).isoformat()

    return {
        "id": "",
        "date": order_date.isoformat(),
        "customer": customer,
        "item": item,
        "quantity": quantity,
        "unit": unit,
        "amount": amount,
        "paid": paid,
        "due_date": due_date,
        "status": status,
    }


def cohort_layout(customer_count):
    size = min(10, customer_count // 3)
    return {
        "0-7": range(0, size),
        "8-30": range(size, size * 2),
        "31+": range(size * 2, size * 3),
    }


def credit_age_for_customer(rng, customer_index, cohorts):
    if customer_index in cohorts["0-7"]:
        return rng.randint(7, 14)
    if customer_index in cohorts["8-30"]:
        return rng.randint(15, 37)
    if customer_index in cohorts["31+"]:
        return rng.randint(38, 89)
    return rng.randint(7, 89)


def signature(row):
    return row["customer"], row["item"], row["date"]


def add_unique_order(rows, signatures, row):
    if signature(row) in signatures:
        return False
    rows.append(row)
    signatures.add(signature(row))
    return True


def generate_orders(rng, demo_date, order_count, customers):
    cohorts = cohort_layout(len(customers))
    minimum_count = sum(len(values) for values in cohorts.values()) + 120 + 30 + 40 + 5
    if order_count < minimum_count:
        raise ValueError(
            f"--orders must be at least {minimum_count} for the requested buckets, pairs, partials, and duplicates"
        )

    rows = []
    signatures = set()
    customer_names = [customer["name"] for customer in customers]
    items = list(ITEM_OPTIONS)

    # Give 8-10 dedicated customers an outstanding balance in each displayed bucket.
    for bucket_name, indexes in cohorts.items():
        for offset, customer_index in enumerate(indexes):
            if bucket_name == "0-7":
                days_ago = 7 + offset % 8
            elif bucket_name == "8-30":
                days_ago = 15 + (offset * 2) % 23
            else:
                days_ago = 40 + (offset * 4) % 50
            row = make_order(
                rng,
                customer_names[customer_index],
                items[(customer_index + offset) % len(items)],
                demo_date - timedelta(days=days_ago),
                "unpaid",
            )
            add_unique_order(rows, signatures, row)

    # Thirty same-customer/same-date appearances for each requested item pair.
    for pair_offset, pair in enumerate((("aata", "tel"), ("chini", "chai patti"))):
        for event in range(30):
            customer_index = (event + pair_offset * 17) % len(customers)
            days_ago = event
            order_date = demo_date - timedelta(days=days_ago)
            for item in pair:
                row = make_order(rng, customer_names[customer_index], item, order_date, "paid")
                if not add_unique_order(rows, signatures, row):
                    raise RuntimeError("Could not create a unique required item-pair order")

    # Keep the number of fully paid orders older than 30 days close to the demo brief.
    older_paid_index = 0
    while older_paid_index < 30:
        customer_index = (older_paid_index + 31) % len(customers)
        days_ago = 89 if older_paid_index == 0 else 31 + (older_paid_index * 2) % 59
        item = items[(older_paid_index * 7 + 2) % len(items)]
        row = make_order(
            rng,
            customer_names[customer_index],
            item,
            demo_date - timedelta(days=days_ago),
            "paid",
        )
        if add_unique_order(rows, signatures, row):
            older_paid_index += 1

    # Exactly forty partial-payment rows.
    partial_index = 0
    while partial_index < 40:
        customer_index = partial_index % len(customers)
        days_ago = credit_age_for_customer(rng, customer_index, cohorts)
        item = items[(partial_index * 5 + 3) % len(items)]
        row = make_order(
            rng,
            customer_names[customer_index],
            item,
            demo_date - timedelta(days=days_ago),
            "partial",
        )
        if add_unique_order(rows, signatures, row):
            partial_index += 1

    # Reserve five final rows as intentional duplicate-looking copies.
    target_before_duplicates = order_count - 5
    filler_index = 0
    while len(rows) < target_before_duplicates:
        customer_index = filler_index % len(customers) if filler_index < len(customers) else rng.randrange(len(customers))
        status = "paid" if rng.random() < 0.58 else "unpaid"
        if status == "paid":
            days_ago = rng.randint(0, 29)
        else:
            days_ago = credit_age_for_customer(rng, customer_index, cohorts)
        row = make_order(
            rng,
            customer_names[customer_index],
            rng.choice(items),
            demo_date - timedelta(days=days_ago),
            status,
        )
        if add_unique_order(rows, signatures, row):
            filler_index += 1

    duplicate_sources = [row for row in rows if row["status"] == "paid"][:5]
    if len(duplicate_sources) != 5:
        raise RuntimeError("Not enough paid orders to create duplicate-looking rows")
    rows.extend({**row} for row in duplicate_sources)

    for index, row in enumerate(rows, start=1):
        row["id"] = f"O{index:04d}"
    return rows


def dues_bucket_counts(orders_frame, demo_date):
    balances = orders_frame[orders_frame["amount"] > orders_frame["paid"]].copy()
    oldest_age = {}
    for row in balances.itertuples(index=False):
        start = date.fromisoformat(row.due_date or row.date)
        age = max(0, (demo_date - start).days)
        oldest_age[row.customer] = max(oldest_age.get(row.customer, 0), age)

    counts = Counter()
    for age in oldest_age.values():
        if age <= 7:
            counts["0-7"] += 1
        elif age <= 30:
            counts["8-30"] += 1
        else:
            counts["31+"] += 1
    return counts


def pair_count(orders_frame, first, second):
    count = 0
    for _, group in orders_frame.groupby(["customer", "date"]):
        present = set(group["item"])
        if first in present and second in present:
            count += 1
    return count


def run_checks(orders_frame, customers_frame, demo_date):
    failures = []

    expected_status = orders_frame.apply(
        lambda row: "paid" if row["paid"] == row["amount"] else ("partial" if row["paid"] > 0 else "unpaid"),
        axis=1,
    )
    if not expected_status.equals(orders_frame["status"]):
        failures.append("one or more status values do not match paid and amount")
    if not customers_frame["phone"].is_unique:
        failures.append("customer phone numbers are not unique")

    for row in orders_frame.itertuples(index=False):
        expected_due = (date.fromisoformat(row.date) + timedelta(days=7)).isoformat()
        if row.due_date not in ("", expected_due):
            failures.append(f"order {row.id} has an invalid due_date")
            break
        if row.status == "paid" and row.due_date != "":
            failures.append(f"cash order {row.id} should have a blank due_date")
            break
        if row.status != "paid" and row.due_date != expected_due:
            failures.append(f"credit order {row.id} should be due exactly 7 days after its date")
            break

    known_customers = set(customers_frame["name"])
    if not set(orders_frame["customer"]).issubset(known_customers):
        failures.append("an order references a customer missing from customers.csv")
    if set(customers_frame["name"]) - set(orders_frame["customer"]):
        failures.append("one or more customers have no demo orders")
    if orders_frame[["amount", "quantity"]].isna().any().any():
        failures.append("an amount or quantity is empty")
    if (orders_frame[["amount", "quantity"]] <= 0).any().any():
        failures.append("an amount or quantity is not above zero")

    expected_ids = [f"O{index:04d}" for index in range(1, len(orders_frame) + 1)]
    if orders_frame["id"].tolist() != expected_ids:
        failures.append("order IDs are not sequential")

    buckets = dues_bucket_counts(orders_frame, demo_date)
    for bucket in ("0-7", "8-30", "31+"):
        if buckets[bucket] < 8:
            failures.append(f"dues bucket {bucket} contains fewer than 8 customers")

    for first, second in (("aata", "tel"), ("chini", "chai patti")):
        if pair_count(orders_frame, first, second) < 30:
            failures.append(f"item pair {first} + {second} appears fewer than 30 times")

    if (orders_frame["status"] == "partial").sum() != 40:
        failures.append("partial-payment order count is not 40")
    older_paid = orders_frame[
        (orders_frame["status"] == "paid")
        & (orders_frame["date"].map(date.fromisoformat) <= demo_date - timedelta(days=30))
    ]
    if len(older_paid) < 30:
        failures.append("there are fewer than 30 fully paid older orders")

    duplicate_count = len(orders_frame) - len(
        orders_frame.drop_duplicates(subset=["customer", "item", "date"])
    )
    if duplicate_count != 5:
        failures.append(f"expected 5 duplicate-looking orders, found {duplicate_count}")
    return failures


def next_backup_directory(data_dir):
    timestamp = datetime.now().replace(microsecond=0)
    while True:
        candidate = data_dir / f"backup_{timestamp:%Y%m%d_%H%M%S}"
        if not candidate.exists():
            return candidate
        timestamp += timedelta(seconds=1)


def back_up_current_files(data_dir):
    sources = [data_dir / "orders.csv", data_dir / "customers.csv"]
    missing = [str(path) for path in sources if not path.is_file()]
    if missing:
        raise RuntimeError(f"Cannot back up missing file(s): {', '.join(missing)}")

    backup_dir = next_backup_directory(data_dir)
    backup_dir.mkdir(parents=False, exist_ok=False)
    try:
        for source in sources:
            destination = backup_dir / source.name
            shutil.copy2(source, destination)
            if not filecmp.cmp(source, destination, shallow=False):
                raise RuntimeError(f"Backup verification failed for {source.name}")
    except Exception:
        # Leave any partial backup visible for diagnosis, but never overwrite live data.
        raise
    return backup_dir


def write_frame_atomic(frame, destination):
    descriptor, temp_name = tempfile.mkstemp(
        prefix=f"{destination.stem}-demo-",
        suffix=".tmp",
        dir=destination.parent,
    )
    os.close(descriptor)
    try:
        frame.to_csv(temp_name, columns=list(frame.columns), encoding="utf-8", index=False)
        os.replace(temp_name, destination)
    finally:
        if os.path.exists(temp_name):
            os.unlink(temp_name)


def create_parser_answer_key_if_missing(project_dir):
    answer_path = project_dir / "tests" / "parser_answer_key.csv"
    if answer_path.exists():
        return False

    source_path = project_dir / "tests" / "parser_test.txt"
    rows = []
    if source_path.exists():
        for raw_line in source_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#"):
                continue
            parts = [part.strip() for part in line.split("||")]
            if len(parts) == 2 and parts[1] == "FAIL":
                rows.append({
                    "input": parts[0],
                    "expected_result": "FAIL",
                    "expected_customer": "",
                    "expected_status": "",
                    "expected_items": "",
                })
            elif len(parts) >= 4:
                rows.append({
                    "input": parts[0],
                    "expected_result": "OK",
                    "expected_customer": parts[1],
                    "expected_status": parts[2],
                    "expected_items": parts[3],
                })
    frame = pd.DataFrame(
        rows,
        columns=["input", "expected_result", "expected_customer", "expected_status", "expected_items"],
    )
    frame.to_csv(answer_path, encoding="utf-8", index=False)
    return True


def print_summary(orders_frame, customers_frame, demo_date, backup_dir):
    balances = orders_frame["amount"] - orders_frame["paid"]
    buckets = dues_bucket_counts(orders_frame, demo_date)
    statuses = orders_frame["status"].value_counts()
    print(f"Backup folder: {backup_dir}")
    print(f"Demo date: {demo_date.isoformat()}")
    print(f"Order count: {len(orders_frame)}")
    print(f"Customer count: {len(customers_frame)}")
    print(f"Total sales: Rs {orders_frame['amount'].sum():,.2f}")
    print(f"Total unpaid: Rs {balances.sum():,.2f}")
    print(
        "Customers by dues bucket: "
        f"0-7={buckets['0-7']}, 8-30={buckets['8-30']}, 31+={buckets['31+']}"
    )
    print(
        "Status counts: "
        f"paid={statuses.get('paid', 0)}, "
        f"partial={statuses.get('partial', 0)}, "
        f"unpaid={statuses.get('unpaid', 0)}"
    )


def main():
    args = parse_args()
    project_dir = Path(__file__).resolve().parent
    data_dir = project_dir / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    rng = random.Random(SEED)
    customer_rows = make_customers(args.customers)
    order_rows = generate_orders(rng, args.date, args.orders, customer_rows)
    customers_frame = pd.DataFrame(customer_rows, columns=CUSTOMER_COLUMNS)
    orders_frame = pd.DataFrame(order_rows, columns=ORDER_COLUMNS)

    failures = run_checks(orders_frame, customers_frame, args.date)
    if failures:
        print("CHECKS FAILED")
        for failure in failures:
            print(f"- {failure}")
        raise SystemExit(1)

    backup_dir = back_up_current_files(data_dir)
    write_frame_atomic(orders_frame, data_dir / "orders.csv")
    write_frame_atomic(customers_frame, data_dir / "customers.csv")
    created_answer_key = create_parser_answer_key_if_missing(project_dir)

    print_summary(orders_frame, customers_frame, args.date, backup_dir)
    if created_answer_key:
        print("Created tests/parser_answer_key.csv")
    print("CHECKS PASSED")


if __name__ == "__main__":
    main()
