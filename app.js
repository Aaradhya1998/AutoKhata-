/* Password lock is casual protection for a shared PC. It is not encryption. Data in localStorage is readable via browser developer tools. */

/* ===== STORAGE LAYER ===== */

/*
  order = { id, date, customer, item, quantity, unit, amount, paid, due_date, status }
  status is "paid" | "partial" | "unpaid"
  customer = { name, phone }
  phone includes country code, for example "91XXXXXXXXXX"
*/

const KEYS = {
  orders: "autokhata.orders",
  customers: "autokhata.customers",
  settings: "autokhata.settings"
};

const Store = {
  KEYS,

  defaults(name) {
    if (name === "orders" || name === "customers") {
      return [];
    }

    if (name === "settings") {
      return {
        shop_name: "",
        password_salt: "",
        password_hash: "",
        default_language: "en"
      };
    }

    return null;
  },

  load(name) {
    const fallback = this.defaults(name);
    const key = this.KEYS[name];

    if (!key) {
      return fallback;
    }

    try {
      const saved = localStorage.getItem(key);
      return saved === null ? fallback : JSON.parse(saved);
    } catch (error) {
      return fallback;
    }
  },

  save(name, value) {
    const key = this.KEYS[name];

    if (!key) {
      return;
    }

    localStorage.setItem(key, JSON.stringify(value));
  },

  newId() {
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    return `${Date.now().toString(36)}${randomSuffix}`;
  }
};

/* ===== AUTH ===== */

async function hashPassword(salt, password) {
  const bytes = new TextEncoder().encode(salt + password);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function makeSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isFirstLaunch() {
  return Store.load("settings").password_hash === "";
}

async function setPassword(password) {
  if (password.length < 6) {
    throw new Error("Password must be at least 6 characters.");
  }

  const settings = Store.load("settings");
  const salt = makeSalt();
  settings.password_salt = salt;
  settings.password_hash = await hashPassword(salt, password);
  Store.save("settings", settings);
}

async function checkPassword(password) {
  const settings = Store.load("settings");

  if (!settings.password_salt || !settings.password_hash) {
    return false;
  }

  return (await hashPassword(settings.password_salt, password)) === settings.password_hash;
}

/* ===== PARSER ===== */

const UNITS = [
  "kg", "g", "gm", "l", "ltr", "litre", "ml", "dozen", "dz",
  "pkt", "packet", "pc", "pcs", "piece"
];

function todayLocal() {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function titleCaseWords(words) {
  return words.map((word) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
  ).join(" ");
}

function parseLine(text) {
  const normalized = String(text).trim().replace(/\s+/g, " ");

  if (!normalized) {
    return { ok: false, reason: "empty line" };
  }

  const tokens = normalized.split(" ");
  const statusWords = {
    pending: "unpaid",
    unpaid: "unpaid",
    udhaar: "unpaid",
    baki: "unpaid",
    baaki: "unpaid",
    paid: "paid",
    cash: "paid"
  };
  const lastToken = tokens[tokens.length - 1].toLowerCase();
  const status = statusWords[lastToken] || "unpaid";

  if (statusWords[lastToken]) {
    tokens.pop();
  }

  const firstQuantityIndex = tokens.findIndex((token) => /^\d/.test(token));

  if (firstQuantityIndex === 0) {
    return { ok: false, reason: "no customer name" };
  }

  if (firstQuantityIndex === -1) {
    return { ok: false, reason: "no items" };
  }

  const customerTokens = tokens.slice(0, firstQuantityIndex);

  if (customerTokens.length === 0) {
    return { ok: false, reason: "no customer name" };
  }

  const customer = titleCaseWords(customerTokens);
  const rows = [];
  let index = firstQuantityIndex;

  while (index < tokens.length) {
    const quantityText = tokens[index];
    const quantityMatch = quantityText.match(/^(\d+(?:\.\d+)?)([a-z]*)$/i);

    if (!quantityMatch) {
      return { ok: false, reason: `invalid quantity: ${quantityText}` };
    }

    const quantity = Number(quantityMatch[1]);
    let unit = quantityMatch[2].toLowerCase();
    index += 1;

    if (unit && !UNITS.includes(unit)) {
      return { ok: false, reason: `unknown unit: ${unit}` };
    }

    if (!unit && index < tokens.length && UNITS.includes(tokens[index].toLowerCase())) {
      unit = tokens[index].toLowerCase();
      index += 1;
    }

    const itemTokens = [];

    while (index < tokens.length && !/^\d/.test(tokens[index])) {
      itemTokens.push(tokens[index].toLowerCase());
      index += 1;
    }

    if (itemTokens.length === 0) {
      return { ok: false, reason: "missing item name" };
    }

    let amount = 0;

    if (index < tokens.length && /^\d+(?:\.\d+)?$/.test(tokens[index])) {
      const isLastToken = index === tokens.length - 1;
      const nextTokenStartsWithDigit = !isLastToken && /^\d/.test(tokens[index + 1]);

      if (isLastToken || nextTokenStartsWithDigit) {
        amount = Number(tokens[index]);
        index += 1;
      }
    }

    rows.push({
      id: Store.newId(),
      date: todayLocal(),
      customer,
      item: itemTokens.join(" "),
      quantity,
      unit,
      amount,
      paid: status === "paid" ? amount : 0,
      due_date: "",
      status
    });
  }

  if (rows.length === 0) {
    return { ok: false, reason: "no items" };
  }

  return { ok: true, rows };
}

function sameValues(actual, expected) {
  return actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

function describeExpected(expected) {
  if (expected.fail) {
    return "FAIL";
  }

  const items = expected.items.map((item) =>
    `${item.item},${item.quantity},${item.unit},${item.amount}`
  ).join(" ; ");
  return `${expected.customer} || ${expected.status} || ${items}`;
}

function describeActual(actual) {
  if (!actual.ok) {
    return `FAIL (${actual.reason})`;
  }

  const firstRow = actual.rows[0];
  const items = actual.rows.map((row) =>
    `${row.item},${row.quantity},${row.unit},${row.amount}`
  ).join(" ; ");
  return `${firstRow.customer} || ${firstRow.status} || ${items}`;
}

function formatParserResults(results) {
  const lines = [
    `Total lines read: ${results.totalLines}`,
    `Lines labeled with values: ${results.valueLines}`,
    `FAIL lines: ${results.failLines}`,
    ""
  ];

  for (const field of ["customer", "status", "item", "quantity", "unit", "amount"]) {
    const score = results.fields[field];
    lines.push(`${field}: ${score.correct} / ${score.total} (${score.percent}%)`);
  }

  lines.push(
    "",
    `FAIL lines correctly rejected: ${results.failCorrect} / ${results.failLines}`,
    "",
    "Misses:"
  );

  if (results.misses.length === 0) {
    lines.push("None");
  } else {
    results.misses.forEach((miss, index) => {
      lines.push(
        `${index + 1}. Input: ${miss.input}`,
        `   Expected: ${miss.expected}`,
        `   Returned: ${miss.returned}`,
        `   Fields missed: ${miss.fields.join(", ")}`
      );
    });
  }

  return lines.join("\n");
}

function runParserTests(text) {
  const testLines = String(text).split(/\r?\n/).filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("#");
  });
  const fieldNames = ["customer", "status", "item", "quantity", "unit", "amount"];
  const fieldCorrect = Object.fromEntries(fieldNames.map((field) => [field, 0]));
  const misses = [];
  let valueLines = 0;
  let failLines = 0;
  let failCorrect = 0;

  for (const line of testLines) {
    const parts = line.split(" || ").map((part) => part.trim());
    const input = parts[0];
    const actual = parseLine(input);

    if (parts[1] === "FAIL") {
      failLines += 1;

      if (!actual.ok) {
        failCorrect += 1;
      } else {
        misses.push({
          input,
          expected: "FAIL",
          returned: describeActual(actual),
          fields: ["FAIL rejection"]
        });
      }

      continue;
    }

    valueLines += 1;
    const expected = {
      fail: false,
      customer: parts[1],
      status: parts[2],
      items: parts[3].split(" ; ").map((itemText) => {
        const itemParts = itemText.split(",").map((part) => part.trim());
        return {
          item: itemParts[0],
          quantity: Number(itemParts[1]),
          unit: itemParts[2],
          amount: Number(itemParts[3])
        };
      })
    };
    const correct = Object.fromEntries(fieldNames.map((field) => [field, false]));

    if (actual.ok) {
      correct.customer = actual.rows.every((row) => row.customer === expected.customer);
      correct.status = actual.rows.every((row) => row.status === expected.status);
      correct.item = sameValues(
        actual.rows.map((row) => row.item),
        expected.items.map((item) => item.item)
      );
      correct.quantity = sameValues(
        actual.rows.map((row) => row.quantity),
        expected.items.map((item) => item.quantity)
      );
      correct.unit = sameValues(
        actual.rows.map((row) => row.unit),
        expected.items.map((item) => item.unit)
      );
      correct.amount = sameValues(
        actual.rows.map((row) => row.amount),
        expected.items.map((item) => item.amount)
      );
    }

    const missedFields = fieldNames.filter((field) => !correct[field]);

    for (const field of fieldNames) {
      if (correct[field]) {
        fieldCorrect[field] += 1;
      }
    }

    if (missedFields.length > 0) {
      misses.push({
        input,
        expected: describeExpected(expected),
        returned: describeActual(actual),
        fields: missedFields
      });
    }
  }

  const fields = Object.fromEntries(fieldNames.map((field) => {
    const correct = fieldCorrect[field];
    const percent = valueLines === 0 ? 0 : Number((correct / valueLines * 100).toFixed(1));
    return [field, { correct, total: valueLines, percent }];
  }));
  const results = {
    totalLines: testLines.length,
    valueLines,
    failLines,
    fields,
    failCorrect,
    misses
  };

  results.output = formatParserResults(results);
  console.table(misses);
  return results;
}

/* ===== ORDERS UI ===== */

let previewRows = [];
let unparsedLines = [];

function createPreviewInput(row, field, type) {
  const input = document.createElement("input");
  input.type = type;
  input.dataset.field = field;
  input.value = Number.isNaN(row[field]) ? "" : row[field];

  if (type === "number") {
    input.step = "any";

    if (field === "amount" || field === "paid") {
      input.min = "0";
    }
  }

  input.addEventListener("input", () => {
    if (type === "number") {
      row[field] = input.value === "" ? NaN : Number(input.value);
    } else {
      row[field] = input.value;
    }
  });

  return input;
}

function appendInputCell(tableRow, input) {
  const cell = document.createElement("td");
  cell.appendChild(input);
  tableRow.appendChild(cell);
}

function renderUnparsedLines() {
  unparsedArea.replaceChildren();

  unparsedLines.forEach((line, index) => {
    const container = document.createElement("div");
    container.className = "unparsed-line";

    const reason = document.createElement("p");
    reason.className = "unparsed-reason";
    reason.textContent = `Could not parse: ${line.reason}`;

    const input = document.createElement("input");
    input.type = "text";
    input.value = line.text;

    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.textContent = "Retry";
    retryButton.addEventListener("click", () => {
      const result = parseLine(input.value);

      if (result.ok) {
        previewRows.push(...result.rows);
        unparsedLines.splice(index, 1);
      } else {
        line.text = input.value;
        line.reason = result.reason;
      }

      previewError.textContent = "";
      renderPreview();
    });

    const skipButton = document.createElement("button");
    skipButton.type = "button";
    skipButton.textContent = "Skip";
    skipButton.addEventListener("click", () => {
      unparsedLines.splice(index, 1);
      previewError.textContent = "";
      renderPreview();
    });

    container.append(reason, input, retryButton, skipButton);
    unparsedArea.appendChild(container);
  });
}

function renderPreview() {
  previewBody.replaceChildren();

  previewRows.forEach((row, index) => {
    const tableRow = document.createElement("tr");

    appendInputCell(tableRow, createPreviewInput(row, "date", "date"));
    appendInputCell(tableRow, createPreviewInput(row, "customer", "text"));
    appendInputCell(tableRow, createPreviewInput(row, "item", "text"));
    appendInputCell(tableRow, createPreviewInput(row, "quantity", "number"));
    appendInputCell(tableRow, createPreviewInput(row, "unit", "text"));
    appendInputCell(tableRow, createPreviewInput(row, "amount", "number"));

    const paidInput = createPreviewInput(row, "paid", "number");
    appendInputCell(tableRow, paidInput);

    const statusCell = document.createElement("td");
    const statusSelect = document.createElement("select");

    for (const status of ["unpaid", "partial", "paid"]) {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      option.selected = row.status === status;
      statusSelect.appendChild(option);
    }

    statusSelect.addEventListener("change", () => {
      row.status = statusSelect.value;

      if (row.status === "paid") {
        row.paid = row.amount;
        paidInput.value = Number.isNaN(row.paid) ? "" : row.paid;
      } else if (row.status === "unpaid") {
        row.paid = 0;
        paidInput.value = "0";
      }
    });
    statusCell.appendChild(statusSelect);
    tableRow.appendChild(statusCell);

    appendInputCell(tableRow, createPreviewInput(row, "due_date", "date"));

    const removeCell = document.createElement("td");
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.textContent = "Remove";
    removeButton.addEventListener("click", () => {
      previewRows.splice(index, 1);
      previewError.textContent = "";
      renderPreview();
    });
    removeCell.appendChild(removeButton);
    tableRow.appendChild(removeCell);

    previewBody.appendChild(tableRow);
  });

  renderUnparsedLines();
  const hasPreviewContent = previewRows.length > 0 || unparsedLines.length > 0;
  previewSection.classList.toggle("hidden", !hasPreviewContent);
}

function addEntryToPreview() {
  const lines = entryText.value.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    const result = parseLine(line);

    if (result.ok) {
      previewRows.push(...result.rows);
    } else {
      unparsedLines.push({ text: line, reason: result.reason });
    }
  }

  entryText.value = "";
  previewError.textContent = "";
  renderPreview();
}

function validatePreviewRow(row, index) {
  row.customer = String(row.customer).trim();
  row.item = String(row.item).trim();

  if (!row.customer) {
    return `Row ${index + 1}: customer is required.`;
  }

  if (!row.item) {
    return `Row ${index + 1}: item is required.`;
  }

  if (!Number.isFinite(row.quantity) || row.quantity <= 0) {
    return `Row ${index + 1}: quantity must be greater than 0.`;
  }

  if (!Number.isFinite(row.amount) || row.amount < 0) {
    return `Row ${index + 1}: amount must be 0 or more.`;
  }

  if (!String(row.date).trim()) {
    return `Row ${index + 1}: date is required.`;
  }

  if (row.status === "paid") {
    row.paid = row.amount;
  } else if (row.status === "unpaid") {
    row.paid = 0;
  } else if (row.status === "partial") {
    if (!Number.isFinite(row.paid) || row.paid <= 0 || row.paid >= row.amount) {
      return `Row ${index + 1}: partial paid amount must be greater than 0 and less than the amount.`;
    }
  } else {
    return `Row ${index + 1}: status is invalid.`;
  }

  row.unit = String(row.unit).trim();
  row.due_date = String(row.due_date).trim();
  return "";
}

function normalizedCustomerName(name) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function confirmAndSavePreview() {
  for (let index = 0; index < previewRows.length; index += 1) {
    const error = validatePreviewRow(previewRows[index], index);

    if (error) {
      previewError.textContent = error;
      renderPreview();
      return;
    }
  }

  if (unparsedLines.length > 0 &&
      !window.confirm("Unparsed lines will be discarded. Continue?")) {
    return;
  }

  const loadedCustomers = Store.load("customers");
  const customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];

  for (const row of previewRows) {
    const customerKey = normalizedCustomerName(row.customer);
    const existing = customers.find((customer) =>
      normalizedCustomerName(customer.name) === customerKey
    );

    if (existing) {
      row.customer = existing.name;
    } else {
      row.customer = row.customer.replace(/\s+/g, " ");
      customers.push({ name: row.customer, phone: "" });
    }
  }

  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  orders.push(...previewRows);
  Store.save("customers", customers);
  Store.save("orders", orders);

  previewRows = [];
  unparsedLines = [];
  previewError.textContent = "";
  renderPreview();
  renderOrders();
  renderDashboard();
}

function cancelPreview() {
  previewRows = [];
  unparsedLines = [];
  previewError.textContent = "";
  renderPreview();
}

function appendOrderCell(tableRow, value) {
  const cell = document.createElement("td");
  cell.textContent = value;
  tableRow.appendChild(cell);
}

function renderOrders() {
  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const newestFirst = orders.map((order, index) => ({ order, index })).sort((a, b) => {
    const dateOrder = String(b.order.date).localeCompare(String(a.order.date));
    return dateOrder || b.index - a.index;
  });

  ordersBody.replaceChildren();
  ordersCount.textContent = `${orders.length} orders`;

  if (newestFirst.length === 0) {
    const tableRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.textContent = "No orders yet";
    tableRow.appendChild(cell);
    ordersBody.appendChild(tableRow);
    return;
  }

  for (const entry of newestFirst) {
    const tableRow = document.createElement("tr");
    const order = entry.order;
    appendOrderCell(tableRow, order.date);
    appendOrderCell(tableRow, order.customer);
    appendOrderCell(tableRow, order.item);
    appendOrderCell(tableRow, order.quantity);
    appendOrderCell(tableRow, order.amount);
    appendOrderCell(tableRow, order.paid);
    appendOrderCell(tableRow, order.status);
    appendOrderCell(tableRow, order.due_date);
    ordersBody.appendChild(tableRow);
  }
}

function clearOrdersUiForLock() {
  previewRows = [];
  unparsedLines = [];
  entryText.value = "";
  previewBody.replaceChildren();
  unparsedArea.replaceChildren();
  ordersBody.replaceChildren();
  ordersCount.textContent = "";
  previewError.textContent = "";
  previewSection.classList.add("hidden");
}

/* ===== DASHBOARD ===== */

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function orderMoney(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function customerGroupKey(name) {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

function dashboardItemName(item) {
  return String(item).trim().toLowerCase();
}

function computeDashboard(orders, today) {
  const customerMap = new Map();
  const itemCounts = new Map();
  const purchaseGroups = new Map();
  const month = today.slice(0, 7);
  let salesToday = 0;
  let salesMonth = 0;
  let totalDues = 0;

  for (const order of orders) {
    const amount = orderMoney(order.amount);
    const paid = orderMoney(order.paid);
    const balance = amount - paid;
    const date = String(order.date);
    const customerKey = customerGroupKey(order.customer);
    const displayName = String(order.customer).trim().replace(/\s+/g, " ");
    const item = dashboardItemName(order.item);

    if (date === today) {
      salesToday += amount;
    }

    if (date.startsWith(month)) {
      salesMonth += amount;
    }

    if (balance > 0) {
      totalDues += balance;
    }

    if (!customerMap.has(customerKey)) {
      customerMap.set(customerKey, {
        name: displayName,
        total: 0,
        paid: 0,
        oldestUnpaid: ""
      });
    }

    const customer = customerMap.get(customerKey);
    customer.total += amount;
    customer.paid += paid;

    if (balance > 0 && (!customer.oldestUnpaid || date < customer.oldestUnpaid)) {
      customer.oldestUnpaid = date;
    }

    if (item) {
      itemCounts.set(item, (itemCounts.get(item) || 0) + 1);

      const groupKey = `${customerKey}\u0000${date}`;

      if (!purchaseGroups.has(groupKey)) {
        purchaseGroups.set(groupKey, new Set());
      }

      purchaseGroups.get(groupKey).add(item);
    }
  }

  const customersWithDues = Array.from(customerMap.values()).filter((customer) =>
    customer.total - customer.paid > 0
  ).length;
  const customers = Array.from(customerMap.values(), (customer) => ({
    name: customer.name,
    total: roundMoney(customer.total),
    paid: roundMoney(customer.paid),
    balance: roundMoney(customer.total - customer.paid),
    oldestUnpaid: customer.oldestUnpaid
  })).sort((a, b) =>
    b.balance - a.balance || a.name.localeCompare(b.name)
  );

  const topCustomers = customers.map((customer) => ({
    name: customer.name,
    total: customer.total
  })).sort((a, b) =>
    b.total - a.total || a.name.localeCompare(b.name)
  ).slice(0, 5);

  const topItems = Array.from(itemCounts, ([item, count]) => ({ item, count }))
    .sort((a, b) => b.count - a.count || a.item.localeCompare(b.item))
    .slice(0, 5);

  const pairCounts = new Map();

  for (const itemSet of purchaseGroups.values()) {
    const items = Array.from(itemSet).sort((a, b) => a.localeCompare(b));

    for (let first = 0; first < items.length; first += 1) {
      for (let second = first + 1; second < items.length; second += 1) {
        const key = `${items[first]}\u0000${items[second]}`;
        pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
      }
    }
  }

  const pairs = Array.from(pairCounts, ([key, count]) => {
    const [a, b] = key.split("\u0000");
    return { a, b, count };
  }).sort((a, b) =>
    b.count - a.count || a.a.localeCompare(b.a) || a.b.localeCompare(b.b)
  ).slice(0, 10);

  return {
    salesToday: roundMoney(salesToday),
    salesMonth: roundMoney(salesMonth),
    totalDues: roundMoney(totalDues),
    customersWithDues,
    customers,
    topCustomers,
    topItems,
    pairs
  };
}

function formatMoney(number) {
  return `₹${number.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function appendDashboardTotal(label, value) {
  const box = document.createElement("div");
  box.className = "dash-total";

  const title = document.createElement("span");
  title.textContent = label;

  const total = document.createElement("strong");
  total.textContent = value;

  box.append(title, total);
  dashTotals.appendChild(box);
}

function renderRankedList(list, entries, textForEntry) {
  list.replaceChildren();

  if (entries.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No data yet";
    list.appendChild(item);
    return;
  }

  for (const entry of entries) {
    const item = document.createElement("li");
    item.textContent = textForEntry(entry);
    list.appendChild(item);
  }
}

function appendDashboardCell(tableRow, value, className = "") {
  const cell = document.createElement("td");
  cell.textContent = value;

  if (className) {
    cell.className = className;
  }

  tableRow.appendChild(cell);
}

function renderDashboard() {
  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const dashboard = computeDashboard(orders, todayLocal());

  dashTotals.replaceChildren();
  appendDashboardTotal("Sales today", formatMoney(dashboard.salesToday));
  appendDashboardTotal("Sales this month", formatMoney(dashboard.salesMonth));
  appendDashboardTotal("Total dues", formatMoney(dashboard.totalDues));
  appendDashboardTotal("Customers with dues", String(dashboard.customersWithDues));

  renderRankedList(topCustomersList, dashboard.topCustomers, (customer) =>
    `${customer.name} - ${formatMoney(customer.total)}`
  );
  renderRankedList(topItemsList, dashboard.topItems, (item) =>
    `${item.item} - ${item.count} orders`
  );

  customersBody.replaceChildren();

  if (dashboard.customers.length === 0) {
    const tableRow = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 5;
    cell.textContent = "No customers yet";
    tableRow.appendChild(cell);
    customersBody.appendChild(tableRow);
  } else {
    for (const customer of dashboard.customers) {
      const tableRow = document.createElement("tr");
      appendDashboardCell(tableRow, customer.name);
      appendDashboardCell(tableRow, formatMoney(customer.total));
      appendDashboardCell(tableRow, formatMoney(customer.paid));
      appendDashboardCell(
        tableRow,
        formatMoney(customer.balance),
        customer.balance > 0 ? "amount-due" : ""
      );
      appendDashboardCell(tableRow, customer.oldestUnpaid || "-");
      customersBody.appendChild(tableRow);
    }
  }

  pairsNote.textContent = "Items count as bought together when the same customer buys them on the same date.";
  pairsList.replaceChildren();

  if (dashboard.pairs.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No pairs yet";
    pairsList.appendChild(item);
  } else {
    for (const pair of dashboard.pairs) {
      const item = document.createElement("li");
      item.textContent = `${pair.a} + ${pair.b} - in ${pair.count} orders`;
      pairsList.appendChild(item);
    }
  }
}

function clearDashboardForLock() {
  dashTotals.replaceChildren();
  topCustomersList.replaceChildren();
  topItemsList.replaceChildren();
  customersBody.replaceChildren();
  pairsList.replaceChildren();
}

/* ===== UI WIRING ===== */

const lockScreen = document.getElementById("lock-screen");
const app = document.getElementById("app");
const lockForm = document.getElementById("lock-form");
const passwordLabel = document.getElementById("password-label");
const passwordInput = document.getElementById("password");
const confirmGroup = document.getElementById("confirm-group");
const confirmPasswordInput = document.getElementById("confirm-password");
const submitButton = document.getElementById("submit-password");
const lockButton = document.getElementById("lock-button");
const lockError = document.getElementById("lock-error");
const parserTestFile = document.getElementById("parser-test-file");
const parserResults = document.getElementById("parser-results");
const entryText = document.getElementById("entry-text");
const entryAdd = document.getElementById("entry-add");
const previewSection = document.getElementById("preview-section");
const previewBody = document.getElementById("preview-body");
const unparsedArea = document.getElementById("unparsed-area");
const previewError = document.getElementById("preview-error");
const previewConfirm = document.getElementById("preview-confirm");
const previewCancel = document.getElementById("preview-cancel");
const ordersBody = document.getElementById("orders-body");
const ordersCount = document.getElementById("orders-count");
const dashTotals = document.getElementById("dash-totals");
const topCustomersList = document.getElementById("top-customers");
const topItemsList = document.getElementById("top-items");
const customersBody = document.getElementById("customers-body");
const pairsNote = document.getElementById("pairs-note");
const pairsList = document.getElementById("pairs-list");

let unlocked = false;
const cryptoAvailable = Boolean(window.crypto && window.crypto.subtle);

function showError(message) {
  lockError.textContent = message;
}

function clearInputs() {
  passwordInput.value = "";
  confirmPasswordInput.value = "";
}

function configureLockScreen() {
  const firstLaunch = isFirstLaunch();
  passwordLabel.textContent = firstLaunch
    ? "Set a password (minimum 6 characters)"
    : "Enter password";
  confirmGroup.classList.toggle("hidden", !firstLaunch);
  confirmPasswordInput.required = firstLaunch;
  passwordInput.autocomplete = firstLaunch ? "new-password" : "current-password";
}

function showLockScreen() {
  unlocked = false;
  app.classList.add("hidden");
  lockScreen.classList.remove("hidden");
  clearInputs();
  showError("");
  configureLockScreen();
  passwordInput.focus();
}

function unlock() {
  unlocked = true;
  lockScreen.classList.add("hidden");
  app.classList.remove("hidden");
  clearInputs();
  showError("");
  renderOrders();
  renderDashboard();
}

lockForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!cryptoAvailable) {
    showError("This browser cannot run the password check. Use Chrome or Edge.");
    submitButton.disabled = true;
    return;
  }

  showError("");

  const password = passwordInput.value;
  submitButton.disabled = true;

  try {
    if (isFirstLaunch()) {
      if (password.length < 6) {
        showError("Password must be at least 6 characters.");
        return;
      }

      if (password !== confirmPasswordInput.value) {
        showError("Passwords do not match.");
        return;
      }

      await setPassword(password);
      unlock();
      return;
    }

    if (await checkPassword(password)) {
      unlock();
    } else {
      showError("Wrong password");
      passwordInput.value = "";
      passwordInput.focus();
    }
  } catch (error) {
    showError("The password check could not be completed.");
  } finally {
    submitButton.disabled = !cryptoAvailable;
  }
});

entryAdd.addEventListener("click", addEntryToPreview);
previewConfirm.addEventListener("click", confirmAndSavePreview);
previewCancel.addEventListener("click", cancelPreview);

lockButton.addEventListener("click", () => {
  clearOrdersUiForLock();
  clearDashboardForLock();
  showLockScreen();
});

parserTestFile.addEventListener("change", () => {
  const file = parserTestFile.files[0];

  if (!file) {
    parserResults.textContent = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const results = runParserTests(reader.result);
    parserResults.textContent = results.output;
  });
  reader.addEventListener("error", () => {
    parserResults.textContent = "Could not read the parser test file.";
  });
  reader.readAsText(file);
});

lockScreen.classList.remove("hidden");
app.classList.add("hidden");
configureLockScreen();

if (!cryptoAvailable) {
  showError("This browser cannot run the password check. Use Chrome or Edge.");
  submitButton.disabled = true;
} else {
  passwordInput.focus();
}
