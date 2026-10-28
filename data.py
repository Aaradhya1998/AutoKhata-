import json
import os
import secrets
import tempfile
import threading
from pathlib import Path

import pandas as pd


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
TEXT_ORDER_COLUMNS = ["id", "date", "customer", "item", "unit", "due_date", "status"]
NUMBER_ORDER_COLUMNS = ["quantity", "amount", "paid"]


class DataStore:
    def __init__(self, data_dir=None):
        self.data_dir = Path(data_dir or Path(__file__).with_name("data"))
        self.orders_path = self.data_dir / "orders.csv"
        self.customers_path = self.data_dir / "customers.csv"
        self.settings_path = self.data_dir / "settings.json"
        self._lock = threading.RLock()
        self._ensure_files()

    def _ensure_files(self):
        with self._lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            if not self.orders_path.exists():
                self._write_csv(self.orders_path, pd.DataFrame(columns=ORDER_COLUMNS))
            if not self.customers_path.exists():
                self._write_csv(self.customers_path, pd.DataFrame(columns=CUSTOMER_COLUMNS))

            settings = self._read_settings_file()
            changed = False
            defaults = {
                "shop_name": "",
                "password_salt": "",
                "password_hash": "",
                "default_language": "en",
                "session_secret": "",
            }
            for key, value in defaults.items():
                if key not in settings:
                    settings[key] = value
                    changed = True
            if not settings["session_secret"]:
                settings["session_secret"] = secrets.token_hex(32)
                changed = True
            if changed or not self.settings_path.exists():
                self._write_json(self.settings_path, settings)

    def _write_csv(self, path, frame):
        fd, temp_name = tempfile.mkstemp(
            prefix=f"{path.stem}-",
            suffix=".tmp",
            dir=self.data_dir,
        )
        os.close(fd)
        try:
            frame.to_csv(temp_name, index=False, encoding="utf-8")
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def _write_json(self, path, value):
        fd, temp_name = tempfile.mkstemp(
            prefix=f"{path.stem}-",
            suffix=".tmp",
            dir=self.data_dir,
        )
        os.close(fd)
        try:
            with open(temp_name, "w", encoding="utf-8") as handle:
                json.dump(value, handle, ensure_ascii=False, indent=2)
                handle.write("\n")
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.unlink(temp_name)

    def _read_settings_file(self):
        if not self.settings_path.exists():
            return {}
        try:
            with self.settings_path.open("r", encoding="utf-8") as handle:
                value = json.load(handle)
            return value if isinstance(value, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def read_orders(self):
        with self._lock:
            frame = pd.read_csv(
                self.orders_path,
                dtype={column: "string" for column in TEXT_ORDER_COLUMNS},
                keep_default_na=False,
            )
            frame = frame.reindex(columns=ORDER_COLUMNS, fill_value="")
            for column in TEXT_ORDER_COLUMNS:
                frame[column] = frame[column].fillna("").astype(str)
            for column in NUMBER_ORDER_COLUMNS:
                frame[column] = pd.to_numeric(frame[column], errors="coerce").fillna(0)

            records = []
            for record in frame.to_dict(orient="records"):
                for column in NUMBER_ORDER_COLUMNS:
                    number = float(record[column])
                    record[column] = int(number) if number.is_integer() else number
                records.append({column: record[column] for column in ORDER_COLUMNS})
            return records

    def write_orders(self, orders):
        with self._lock:
            rows = [
                {column: order.get(column, "") for column in ORDER_COLUMNS}
                for order in orders
            ]
            frame = pd.DataFrame(rows, columns=ORDER_COLUMNS)
            self._write_csv(self.orders_path, frame)

    def read_customers(self):
        with self._lock:
            frame = pd.read_csv(
                self.customers_path,
                dtype="string",
                keep_default_na=False,
            )
            frame = frame.reindex(columns=CUSTOMER_COLUMNS, fill_value="")
            for column in CUSTOMER_COLUMNS:
                frame[column] = frame[column].fillna("").astype(str)
            return [
                {column: record[column] for column in CUSTOMER_COLUMNS}
                for record in frame.to_dict(orient="records")
            ]

    def write_customers(self, customers):
        with self._lock:
            rows = [
                {column: customer.get(column, "") for column in CUSTOMER_COLUMNS}
                for customer in customers
            ]
            frame = pd.DataFrame(rows, columns=CUSTOMER_COLUMNS)
            self._write_csv(self.customers_path, frame)

    def read_settings(self):
        with self._lock:
            return dict(self._read_settings_file())

    def write_settings(self, settings):
        with self._lock:
            self._write_json(self.settings_path, dict(settings))
