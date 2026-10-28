import hashlib
import hmac
import math
import os
import re
import secrets
from functools import wraps

from flask import Flask, jsonify, render_template, request, session

from data import CUSTOMER_COLUMNS, ORDER_COLUMNS, DataStore


store = DataStore(os.environ.get("AUTOKHATA_DATA_DIR"))
server_settings = store.read_settings()

app = Flask(__name__, static_folder="static", static_url_path="")
app.config.update(
    SECRET_KEY=server_settings["session_secret"],
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Strict",
)


def api_error(message, status=400):
    return jsonify({"error": message}), status


def require_unlocked(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        if not session.get("unlocked"):
            return api_error("Locked", 401)
        return function(*args, **kwargs)

    return wrapped


def password_hash(password, salt):
    return hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )


def normalized_name(name):
    return " ".join(str(name).split()).casefold()


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate_order(value, position):
    if not isinstance(value, dict):
        raise ValueError(f"order {position}: must be an object")

    order = {column: value.get(column, "") for column in ORDER_COLUMNS}
    for field in ("id", "date", "customer", "item"):
        if not isinstance(order[field], str) or not order[field].strip():
            raise ValueError(f"order {position}: {field} is required")
    if not isinstance(order["unit"], str) or not isinstance(order["due_date"], str):
        raise ValueError(f"order {position}: unit and due_date must be text")
    for field in ("quantity", "amount", "paid"):
        if not finite_number(order[field]):
            raise ValueError(f"order {position}: {field} is not a number")
    if order["quantity"] <= 0:
        raise ValueError(f"order {position}: quantity must be greater than 0")
    if order["amount"] < 0 or order["paid"] < 0 or order["paid"] > order["amount"] + 0.01:
        raise ValueError(f"order {position}: payment values are invalid")
    if order["status"] not in ("paid", "partial", "unpaid"):
        raise ValueError(f"order {position}: status is invalid")
    return order


def validate_customer(value, position):
    if not isinstance(value, dict):
        raise ValueError(f"customer {position}: must be an object")
    customer = {column: value.get(column, "") for column in CUSTOMER_COLUMNS}
    if not isinstance(customer["name"], str) or not customer["name"].strip():
        raise ValueError(f"customer {position}: name is required")
    if not isinstance(customer["phone"], str):
        raise ValueError(f"customer {position}: phone must be text")
    return customer


def update_customer_names(orders):
    customers = store.read_customers()
    known = {normalized_name(customer["name"]) for customer in customers}
    changed = False
    for order in orders:
        key = normalized_name(order["customer"])
        if key and key not in known:
            customers.append({"name": order["customer"], "phone": ""})
            known.add(key)
            changed = True
    if changed:
        store.write_customers(customers)


@app.get("/")
def index():
    return render_template("index.html")


@app.get("/api/status")
def status():
    settings = store.read_settings()
    return jsonify(
        {
            "password_set": bool(settings.get("password_hash")),
            "unlocked": bool(session.get("unlocked")),
        }
    )


@app.post("/api/password/set")
def set_password():
    settings = store.read_settings()
    if settings.get("password_hash"):
        return api_error("Password is already set", 409)
    payload = request.get_json(silent=True) or {}
    password = payload.get("password", "")
    if not isinstance(password, str) or len(password) < 6:
        return api_error("Password must be at least 6 characters.")

    salt = secrets.token_bytes(16)
    settings["password_salt"] = salt.hex()
    settings["password_hash"] = password_hash(password, salt).hex()
    store.write_settings(settings)
    session.clear()
    session["unlocked"] = True
    return jsonify({"ok": True})


@app.post("/api/login")
def login():
    settings = store.read_settings()
    if not settings.get("password_hash") or not settings.get("password_salt"):
        return api_error("Password has not been set", 409)
    payload = request.get_json(silent=True) or {}
    password = payload.get("password", "")
    try:
        actual = password_hash(password, bytes.fromhex(settings["password_salt"]))
        expected = bytes.fromhex(settings["password_hash"])
    except (TypeError, ValueError):
        return api_error("Wrong password", 401)
    if not hmac.compare_digest(actual, expected):
        return api_error("Wrong password", 401)
    session.clear()
    session["unlocked"] = True
    return jsonify({"ok": True})


@app.post("/api/lock")
@require_unlocked
def lock():
    session.clear()
    return jsonify({"ok": True})


@app.route("/api/orders", methods=["GET", "POST"])
@require_unlocked
def orders_api():
    if request.method == "GET":
        return jsonify(store.read_orders())

    payload = request.get_json(silent=True)
    replace = isinstance(payload, dict) and payload.get("replace") is True
    values = payload.get("orders") if isinstance(payload, dict) else payload
    if not isinstance(values, list):
        return api_error("orders must be an array")
    try:
        incoming = [validate_order(value, index + 1) for index, value in enumerate(values)]
    except ValueError as error:
        return api_error(str(error))

    if replace:
        combined = incoming
    else:
        existing = store.read_orders()
        existing_ids = {order["id"] for order in existing}
        duplicate = next((order["id"] for order in incoming if order["id"] in existing_ids), None)
        if duplicate:
            return api_error(f"order id already exists: {duplicate}", 409)
        combined = existing + incoming

    ids = [order["id"] for order in combined]
    if len(ids) != len(set(ids)):
        return api_error("order ids must be unique")
    store.write_orders(combined)
    update_customer_names(combined)
    return jsonify({"ok": True, "count": len(incoming), "orders": combined})


@app.post("/api/payments")
@require_unlocked
def payments_api():
    payload = request.get_json(silent=True) or {}
    order_id = payload.get("order_id")
    amount = payload.get("amount")
    if not isinstance(order_id, str) or not finite_number(amount) or amount <= 0:
        return api_error("A valid order_id and payment amount above 0 are required")

    orders = store.read_orders()
    target = next((order for order in orders if order["id"] == order_id), None)
    if target is None:
        return api_error("Order not found", 404)
    balance = float(target["amount"]) - float(target["paid"])
    if amount > balance + 0.01:
        return api_error("Payment is more than balance due")
    target["paid"] = round(float(target["paid"]) + amount, 2)
    target["status"] = "paid" if target["paid"] >= float(target["amount"]) else "partial"
    store.write_orders(orders)
    return jsonify({"ok": True, "order": target})


@app.route("/api/customers", methods=["GET", "POST"])
@require_unlocked
def customers_api():
    if request.method == "POST":
        payload = request.get_json(silent=True)
        values = payload.get("customers") if isinstance(payload, dict) else payload
        if not isinstance(values, list):
            return api_error("customers must be an array")
        try:
            customers = [
                validate_customer(value, index + 1)
                for index, value in enumerate(values)
            ]
        except ValueError as error:
            return api_error(str(error))
        store.write_customers(customers)
        return jsonify({"ok": True, "customers": customers})

    customers = store.read_customers()
    orders = store.read_orders()
    grouped = {}
    for customer in customers:
        grouped[normalized_name(customer["name"])] = {
            "name": customer["name"],
            "phone": customer["phone"],
            "total": 0.0,
            "paid": 0.0,
            "balance": 0.0,
            "oldest_unpaid": "",
        }
    for order in orders:
        key = normalized_name(order["customer"])
        if key not in grouped:
            grouped[key] = {
                "name": order["customer"],
                "phone": "",
                "total": 0.0,
                "paid": 0.0,
                "balance": 0.0,
                "oldest_unpaid": "",
            }
        customer = grouped[key]
        customer["total"] += float(order["amount"])
        customer["paid"] += float(order["paid"])
        balance = float(order["amount"]) - float(order["paid"])
        if balance > 0 and (
            not customer["oldest_unpaid"] or order["date"] < customer["oldest_unpaid"]
        ):
            customer["oldest_unpaid"] = order["date"]
    result = []
    for customer in grouped.values():
        customer["total"] = round(customer["total"], 2)
        customer["paid"] = round(customer["paid"], 2)
        customer["balance"] = round(customer["total"] - customer["paid"], 2)
        result.append(customer)
    result.sort(key=lambda customer: customer["name"].casefold())
    return jsonify(result)


@app.route("/api/settings", methods=["GET", "POST"])
@require_unlocked
def settings_api():
    settings = store.read_settings()
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        shop_name = payload.get("shop_name", "")
        if not isinstance(shop_name, str):
            return api_error("shop_name must be text")
        settings["shop_name"] = shop_name.strip()
        store.write_settings(settings)
    return jsonify(
        {
            "shop_name": settings.get("shop_name", ""),
            "default_language": settings.get("default_language", "en"),
        }
    )


GSTIN_REGEX = re.compile(r"^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$")


@app.route("/api/gst", methods=["GET", "POST"])
@require_unlocked
def gst_api():
    settings = store.read_settings()
    if request.method == "POST":
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict):
            return api_error("Invalid payload")

        gst_enabled = payload.get("gst_enabled", settings.get("gst_enabled", False))
        if not isinstance(gst_enabled, bool):
            return api_error("gst_enabled must be a boolean")

        gstin = payload.get("gstin", settings.get("gstin", ""))
        if not isinstance(gstin, str):
            return api_error("gstin must be text")
        gstin = gstin.strip()
        if gstin and not GSTIN_REGEX.match(gstin):
            return api_error("Invalid GSTIN format")

        raw_rates = payload.get("gst_rates", settings.get("gst_rates", {}))
        if not isinstance(raw_rates, dict):
            return api_error("gst_rates must be an object")

        gst_rates = {}
        for item, rate in raw_rates.items():
            if not isinstance(item, str) or not item.strip():
                return api_error("Item name must be text")
            if isinstance(rate, bool) or not isinstance(rate, (int, float)):
                try:
                    rate = float(rate)
                except (TypeError, ValueError):
                    return api_error(f"Rate for {item} must be a number")
            if not math.isfinite(rate) or rate < 0 or rate > 40:
                return api_error("rates must be numbers from 0 to 40")
            gst_rates[item.strip()] = rate

        interstate = payload.get(
            "interstate",
            payload.get("interstate_default", settings.get("interstate", False)),
        )
        if not isinstance(interstate, bool):
            return api_error("interstate must be a boolean")

        settings["gst_enabled"] = gst_enabled
        settings["gstin"] = gstin
        settings["gst_rates"] = gst_rates
        settings["interstate"] = interstate
        store.write_settings(settings)

    return jsonify(
        {
            "gst_enabled": bool(settings.get("gst_enabled", False)),
            "gstin": str(settings.get("gstin", "")),
            "gst_rates": settings.get("gst_rates", {})
            if isinstance(settings.get("gst_rates"), dict)
            else {},
            "interstate": bool(settings.get("interstate", False)),
            "interstate_default": bool(settings.get("interstate", False)),
        }
    )


if __name__ == "__main__":
    url = "http://127.0.0.1:5000"
    print(f"Auto Khata is running at {url}", flush=True)
    app.run(host="127.0.0.1", port=5000, debug=False)
