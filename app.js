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
    retryButton.className = "btn-secondary";
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
    skipButton.className = "btn-secondary";
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
    removeButton.className = "btn-secondary";
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
  const addViewIsActive = document.querySelector('#tabs [aria-current="page"]')?.dataset.tab === "add";
  previewSection.classList.toggle("hidden", !hasPreviewContent || !addViewIsActive);
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

  const savedCount = previewRows.length;

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
  renderDues();
  showAddSavedMessage(savedCount);
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
  ordersCount.textContent = plural(orders.length, "order");
  populateInvoiceCustomers();

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
    appendPillCell(
      tableRow,
      order.status.charAt(0).toUpperCase() + order.status.slice(1),
      order.status
    );
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
  const topItemsByQuantity = new Map();

  for (const order of orders) {
    const item = String(order.item).trim().toLowerCase();
    const quantity = Number(order.quantity);

    if (item && Number.isFinite(quantity)) {
      topItemsByQuantity.set(item, (topItemsByQuantity.get(item) || 0) + quantity);
    }
  }

  const rankedItems = Array.from(topItemsByQuantity, ([item, quantity]) => ({
    item,
    quantity
  })).sort((a, b) =>
    b.quantity - a.quantity || a.item.localeCompare(b.item)
  ).slice(0, 5);

  dashTotals.replaceChildren();
  appendDashboardTotal("Sales today", formatMoney(dashboard.salesToday));
  appendDashboardTotal("Sales this month", formatMoney(dashboard.salesMonth));
  appendDashboardTotal("Total dues", formatMoney(dashboard.totalDues));
  appendDashboardTotal("Customers with dues", String(dashboard.customersWithDues));

  renderRankedList(topCustomersList, dashboard.topCustomers, (customer) =>
    `${customer.name} - ${formatMoney(customer.total)}`
  );
  renderRankedList(topItemsList, rankedItems, (item) =>
    `${item.item} - ${item.quantity} sold`
  );

  const hasOrders = orders.length > 0;
  homeEmpty.classList.toggle("hidden", hasOrders);
  dashTotals.classList.toggle("hidden", !hasOrders);

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
      const customerStatus = customer.balance <= 0
        ? "paid"
        : customer.paid > 0 ? "partial" : "unpaid";
      appendPillCell(
        tableRow,
        formatMoney(customer.balance),
        customerStatus
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

/* ===== DUES ===== */

function daysBetween(fromStr, toStr) {
  const [fromYear, fromMonth, fromDay] = fromStr.split("-").map(Number);
  const [toYear, toMonth, toDay] = toStr.split("-").map(Number);
  const from = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const to = Date.UTC(toYear, toMonth - 1, toDay);
  return Math.round((to - from) / 86400000);
}

function orderAgeDays(order, today) {
  const start = order.due_date ? order.due_date : order.date;
  return Math.max(0, daysBetween(start, today));
}

function bucketFor(days) {
  if (days <= 7) {
    return "0-7";
  }

  if (days <= 30) {
    return "8-30";
  }

  return "31+";
}

function computeDues(orders, today) {
  const groups = new Map();

  for (const order of orders) {
    const balance = orderMoney(order.amount) - orderMoney(order.paid);

    if (balance <= 0) {
      continue;
    }

    const key = customerGroupKey(order.customer);

    if (!groups.has(key)) {
      groups.set(key, {
        name: String(order.customer).trim().replace(/\s+/g, " "),
        balance: 0,
        ageDays: 0,
        oldestUnpaid: ""
      });
    }

    const customer = groups.get(key);
    customer.balance += balance;
    customer.ageDays = Math.max(customer.ageDays, orderAgeDays(order, today));

    if (!customer.oldestUnpaid || order.date < customer.oldestUnpaid) {
      customer.oldestUnpaid = order.date;
    }
  }

  const buckets = { "0-7": [], "8-30": [], "31+": [] };

  for (const customer of groups.values()) {
    const entry = {
      name: customer.name,
      balance: roundMoney(customer.balance),
      ageDays: customer.ageDays,
      oldestUnpaid: customer.oldestUnpaid
    };
    buckets[bucketFor(entry.ageDays)].push(entry);
  }

  for (const entries of Object.values(buckets)) {
    entries.sort((a, b) =>
      b.balance - a.balance || a.name.localeCompare(b.name)
    );
  }

  return buckets;
}

function applyPayment(orders, customerName, amount, today) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return { ok: false, reason: "enter an amount above 0" };
  }

  const customerKey = customerGroupKey(customerName);
  const copiedOrders = orders.map((order) => ({ ...order }));
  const unpaidIndexes = [];
  let totalBalance = 0;

  copiedOrders.forEach((order, index) => {
    if (customerGroupKey(order.customer) !== customerKey) {
      return;
    }

    const balance = orderMoney(order.amount) - orderMoney(order.paid);

    if (balance > 0) {
      totalBalance += balance;
      unpaidIndexes.push(index);
    }
  });

  totalBalance = roundMoney(totalBalance);

  if (amount > totalBalance) {
    return { ok: false, reason: "more than balance due" };
  }

  unpaidIndexes.sort((first, second) => {
    const dateOrder = String(copiedOrders[first].date)
      .localeCompare(String(copiedOrders[second].date));
    return dateOrder || first - second;
  });

  let remaining = amount;

  for (const index of unpaidIndexes) {
    if (remaining <= 0) {
      break;
    }

    const order = copiedOrders[index];
    const orderAmount = orderMoney(order.amount);
    const currentPaid = orderMoney(order.paid);
    const balance = orderAmount - currentPaid;
    const applied = Math.min(balance, remaining);
    order.paid = roundMoney(currentPaid + applied);
    remaining = roundMoney(remaining - applied);

    if (order.paid >= orderAmount) {
      order.status = "paid";
    } else if (order.paid > 0) {
      order.status = "partial";
    } else {
      order.status = "unpaid";
    }
  }

  return { ok: true, orders: copiedOrders };
}

function normalizePhone(input) {
  const digits = String(input).replace(/\D/g, "");

  if (digits.length === 10) {
    return `91${digits}`;
  }

  if (digits.length === 12 && digits.startsWith("91")) {
    return digits;
  }

  return "";
}

function buildReminderMessage(name, balance, shopName) {
  const shop = String(shopName).trim() || "hamari dukaan";
  return `Namaste ${name} ji, ${shop} se yaad dila rahe hain ki aapka ${formatMoney(balance)} baaki hai. Kripya jaldi bhugtan kar dein. Dhanyavaad.`;
}

function buildWaUrl(phone, message) {
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

function closeActionPanel() {
  actionPanel.replaceChildren();
  actionPanel.classList.add("hidden");
}

function appendActionCloseButton() {
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.textContent = "Close";
  closeButton.className = "btn-secondary";
  closeButton.addEventListener("click", closeActionPanel);
  actionPanel.appendChild(closeButton);
}

function openReminderPanel(customer) {
  actionPanel.replaceChildren();
  actionPanel.classList.remove("hidden");

  const heading = document.createElement("h3");
  heading.textContent = `Remind ${customer.name}`;

  const phoneLabel = document.createElement("label");
  phoneLabel.htmlFor = "reminder-phone";
  phoneLabel.textContent = "Phone";

  const phoneInput = document.createElement("input");
  phoneInput.id = "reminder-phone";
  phoneInput.type = "tel";
  const loadedCustomers = Store.load("customers");
  const customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
  const matchingCustomer = customers.find((entry) =>
    customerGroupKey(entry.name) === customerGroupKey(customer.name)
  );
  phoneInput.value = matchingCustomer ? matchingCustomer.phone : "";

  const messageLabel = document.createElement("label");
  messageLabel.htmlFor = "reminder-message";
  messageLabel.textContent = "Message";

  const messageInput = document.createElement("textarea");
  messageInput.id = "reminder-message";
  const settings = Store.load("settings");
  messageInput.value = buildReminderMessage(customer.name, customer.balance, settings.shop_name);

  const error = document.createElement("p");
  error.className = "action-error";
  error.setAttribute("role", "alert");

  const sendButton = document.createElement("button");
  sendButton.type = "button";
  sendButton.textContent = "Send on WhatsApp";
  sendButton.className = "btn-primary";
  sendButton.addEventListener("click", () => {
    const phone = normalizePhone(phoneInput.value);

    if (!phone) {
      error.textContent = "Enter a 10-digit mobile number or a number starting with 91";
      return;
    }

    if (!messageInput.value.trim()) {
      error.textContent = "Enter a message";
      return;
    }

    const currentCustomers = Store.load("customers");
    const updatedCustomers = Array.isArray(currentCustomers) ? currentCustomers : [];
    let savedCustomer = updatedCustomers.find((entry) =>
      customerGroupKey(entry.name) === customerGroupKey(customer.name)
    );

    if (!savedCustomer) {
      savedCustomer = { name: customer.name, phone: "" };
      updatedCustomers.push(savedCustomer);
    }

    savedCustomer.phone = phone;
    Store.save("customers", updatedCustomers);
    window.open(buildWaUrl(phone, messageInput.value), "_blank", "noopener");
  });

  actionPanel.append(
    heading,
    phoneLabel,
    phoneInput,
    messageLabel,
    messageInput,
    error,
    sendButton
  );
  appendActionCloseButton();
}

function openPaymentPanel(customer) {
  actionPanel.replaceChildren();
  actionPanel.classList.remove("hidden");

  const heading = document.createElement("h3");
  heading.textContent = `Record payment for ${customer.name}`;

  const balance = document.createElement("p");
  balance.textContent = `Balance due: ${formatMoney(customer.balance)}`;

  const amountLabel = document.createElement("label");
  amountLabel.htmlFor = "payment-amount";
  amountLabel.textContent = "Payment amount";

  const amountInput = document.createElement("input");
  amountInput.id = "payment-amount";
  amountInput.type = "number";
  amountInput.step = "any";
  amountInput.min = "0";

  const error = document.createElement("p");
  error.className = "action-error";
  error.setAttribute("role", "alert");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save payment";
  saveButton.className = "btn-primary";
  saveButton.addEventListener("click", () => {
    const amount = amountInput.value === "" ? NaN : Number(amountInput.value);
    const loadedOrders = Store.load("orders");
    const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
    const result = applyPayment(orders, customer.name, amount, todayLocal());

    if (!result.ok) {
      error.textContent = result.reason;
      return;
    }

    Store.save("orders", result.orders);
    closeActionPanel();
    renderDues();
    renderDashboard();
    renderOrders();
  });

  actionPanel.append(heading, balance, amountLabel, amountInput, error, saveButton);
  appendActionCloseButton();
}

function appendDuesHeader(table) {
  const head = document.createElement("thead");
  const row = document.createElement("tr");

  for (const label of ["Customer", "Phone", "Balance due", "Oldest unpaid date", "Remind"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    row.appendChild(cell);
  }
  head.appendChild(row);
  table.appendChild(head);
}

function renderDues() {
  const loadedOrders = Store.load("orders");
  const loadedCustomers = Store.load("customers");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
  const phoneByCustomer = new Map(customers.map((customer) => [
    customerGroupKey(customer.name),
    customer.phone
  ]));
  const buckets = computeDues(orders, todayLocal());
  const bucketTitles = [
    { key: "0-7", title: "0-7 days" },
    { key: "8-30", title: "8-30 days" },
    { key: "31+", title: "30+ days overdue" }
  ];

  duesBuckets.replaceChildren();

  for (const bucket of bucketTitles) {
    const block = document.createElement("div");
    block.className = "dues-bucket";

    const heading = document.createElement("h3");
    heading.textContent = bucket.title;

    const table = document.createElement("table");
    appendDuesHeader(table);
    const body = document.createElement("tbody");

    if (buckets[bucket.key].length === 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 5;
      cell.textContent = "None";
      row.appendChild(cell);
      body.appendChild(row);
    } else {
      for (const customer of buckets[bucket.key]) {
        const row = document.createElement("tr");
        appendDashboardCell(row, customer.name);
        appendDashboardCell(
          row,
          phoneByCustomer.get(customerGroupKey(customer.name)) || "-"
        );
        appendDashboardCell(row, formatMoney(customer.balance), "amount-due");
        appendDashboardCell(row, customer.oldestUnpaid);

        const remindCell = document.createElement("td");
        const remindButton = document.createElement("button");
        remindButton.type = "button";
        remindButton.textContent = "Remind";
        remindButton.className = "btn-primary";
        remindButton.addEventListener("click", () => openReminderPanel(customer));
        remindCell.appendChild(remindButton);
        row.appendChild(remindCell);

        body.appendChild(row);
      }
    }

    table.appendChild(body);
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap";
    tableWrap.appendChild(table);
    block.append(heading, tableWrap);
    duesBuckets.appendChild(block);
  }
}

function loadSettingsUi() {
  const settings = Store.load("settings");
  shopNameInput.value = settings.shop_name;
  shopSaved.textContent = "";
}

function saveShopName() {
  const settings = Store.load("settings");
  settings.shop_name = shopNameInput.value.trim();
  Store.save("settings", settings);
  shopNameInput.value = settings.shop_name;
  shopSaved.textContent = "Saved";
}

function clearDuesForLock() {
  duesBuckets.replaceChildren();
  closeActionPanel();
  shopNameInput.value = "";
  shopSaved.textContent = "";
}

/* ===== INVOICE ===== */

function buildInvoiceData(orders, customerName, selectedIds, shopName, today) {
  const customerKey = customerGroupKey(customerName);
  const selected = new Set(Array.from(selectedIds, (id) => String(id)));
  const matches = orders.map((order, index) => ({ order, index })).filter((entry) =>
    customerGroupKey(entry.order.customer) === customerKey &&
    selected.has(String(entry.order.id))
  ).sort((a, b) => {
    const dateOrder = String(a.order.date).localeCompare(String(b.order.date));
    return dateOrder || a.index - b.index;
  });

  const lines = matches.map((entry) => ({
    item: entry.order.item,
    quantity: entry.order.quantity,
    unit: entry.order.unit,
    amount: entry.order.amount
  }));
  const paid = roundMoney(matches.reduce((sum, entry) =>
    sum + orderMoney(entry.order.paid), 0
  ));

  return {
    shop: String(shopName || "").trim(),
    customer: customerName,
    date: today,
    lines,
    paid
  };
}

function invoiceTotals(lines, paid) {
  const total = roundMoney(lines.reduce((sum, line) => {
    const amount = Number(line.amount);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0));
  const paidNumber = Number(paid);
  const validPaid = Number.isFinite(paidNumber) ? paidNumber : 0;

  return {
    total,
    due: roundMoney(total - validPaid)
  };
}

function resetInvoiceCustomer() {
  invoiceCustomer.replaceChildren();
  const option = document.createElement("option");
  option.value = "";
  option.textContent = "Choose customer";
  invoiceCustomer.appendChild(option);
}

function populateInvoiceCustomers() {
  const previousKey = customerGroupKey(invoiceCustomer.value);
  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const names = new Map();

  for (const order of orders) {
    const key = customerGroupKey(order.customer);

    if (!names.has(key)) {
      names.set(key, String(order.customer).trim().replace(/\s+/g, " "));
    }
  }

  resetInvoiceCustomer();
  const sortedNames = Array.from(names.entries()).sort((a, b) =>
    a[1].localeCompare(b[1])
  );

  for (const [key, name] of sortedNames) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    option.selected = key === previousKey;
    invoiceCustomer.appendChild(option);
  }

  if (invoiceCustomer.value) {
    renderInvoiceOrders();
  } else {
    invoiceOrders.replaceChildren();
  }
}

function renderInvoiceOrders() {
  invoiceOrders.replaceChildren();
  invoiceError.textContent = "";

  if (!invoiceCustomer.value) {
    return;
  }

  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const customerKey = customerGroupKey(invoiceCustomer.value);
  const matches = orders.filter((order) =>
    customerGroupKey(order.customer) === customerKey
  );

  if (matches.length === 0) {
    const message = document.createElement("p");
    message.textContent = "No orders";
    invoiceOrders.appendChild(message);
    return;
  }

  for (const order of matches) {
    const label = document.createElement("label");
    label.className = "invoice-order-choice";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.dataset.orderId = order.id;
    const balance = roundMoney(orderMoney(order.amount) - orderMoney(order.paid));
    checkbox.checked = balance > 0;

    const description = document.createElement("span");
    const quantityAndUnit = `${order.quantity} ${order.unit}`.trim();
    description.textContent = `${order.date} - ${order.item} - ${quantityAndUnit} - ${formatMoney(orderMoney(order.amount))} - Balance: ${formatMoney(balance)}`;

    label.append(checkbox, description);
    invoiceOrders.appendChild(label);
  }
}

function createInvoiceLineInput(type, field, value) {
  const input = document.createElement("input");
  input.type = type;
  input.dataset.field = field;
  input.value = value;

  if (type === "number") {
    input.step = "any";

    if (field === "amount") {
      input.min = "0";
    }
  }

  return input;
}

function appendInvoiceLineCell(tableRow, input) {
  const cell = document.createElement("td");
  cell.appendChild(input);
  tableRow.appendChild(cell);
}

function renderInvoiceLines(lines) {
  invBody.replaceChildren();

  for (const line of lines) {
    const row = document.createElement("tr");
    appendInvoiceLineCell(row, createInvoiceLineInput("text", "item", line.item));
    appendInvoiceLineCell(row, createInvoiceLineInput("number", "quantity", line.quantity));
    appendInvoiceLineCell(row, createInvoiceLineInput("text", "unit", line.unit));
    appendInvoiceLineCell(row, createInvoiceLineInput("number", "amount", line.amount));
    invBody.appendChild(row);
  }
}

function currentInvoiceLines() {
  return Array.from(invBody.rows, (row) => ({
    item: row.querySelector('[data-field="item"]').value,
    quantity: row.querySelector('[data-field="quantity"]').value,
    unit: row.querySelector('[data-field="unit"]').value,
    amount: row.querySelector('[data-field="amount"]').value
  }));
}

function updateInvoiceTotals() {
  const totals = invoiceTotals(currentInvoiceLines(), invPaid.value);
  invTotal.textContent = formatMoney(totals.total);
  invDue.textContent = formatMoney(totals.due);
}

function createInvoice() {
  const selectedIds = Array.from(
    invoiceOrders.querySelectorAll('input[type="checkbox"]:checked'),
    (checkbox) => checkbox.dataset.orderId
  );

  if (!invoiceCustomer.value || selectedIds.length === 0) {
    invoiceError.textContent = "Choose a customer and tick at least one order";
    return;
  }

  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const settings = Store.load("settings");
  const invoice = buildInvoiceData(
    orders,
    invoiceCustomer.value,
    selectedIds,
    settings.shop_name,
    todayLocal()
  );

  invoiceError.textContent = "";
  invShop.value = invoice.shop;
  invCustomerName.value = invoice.customer;
  invDate.value = invoice.date;
  invPaid.value = invoice.paid;
  renderInvoiceLines(invoice.lines);
  updateInvoiceTotals();
  invoiceSheet.classList.remove("hidden");
}

function closeInvoiceSheet() {
  invoiceSheet.classList.add("hidden");
  invShop.value = "";
  invCustomerName.value = "";
  invDate.value = "";
  invPaid.value = "";
  invTotal.textContent = "";
  invDue.textContent = "";
  invBody.replaceChildren();
}

function printInvoice() {
  const originalTitle = document.title;
  const invoiceTitle = `Invoice - ${invCustomerName.value} - ${invDate.value}`;
  const restoreTitle = () => {
    document.title = originalTitle;
  };

  window.addEventListener("afterprint", restoreTitle, { once: true });
  document.title = invoiceTitle;
  window.print();
  restoreTitle();
}

function clearInvoiceForLock() {
  closeInvoiceSheet();
  invoiceOrders.replaceChildren();
  resetInvoiceCustomer();
  invoiceError.textContent = "";
}

/* ===== DATA ===== */

function csvEscape(value) {
  let text = value === null || value === undefined ? "" : String(value);

  if (/^[=+\-@]/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}

function csvNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function ordersToCsv(orders) {
  const lines = ["id,date,customer,item,quantity,unit,amount,paid,due_date,status"];

  for (const order of orders) {
    lines.push([
      csvEscape(order.id),
      csvEscape(order.date),
      csvEscape(order.customer),
      csvEscape(order.item),
      csvNumber(order.quantity),
      csvEscape(order.unit),
      csvNumber(order.amount),
      csvNumber(order.paid),
      csvEscape(order.due_date),
      csvEscape(order.status)
    ].join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

function customersToCsv(customers) {
  const lines = ["name,phone"];

  for (const customer of customers) {
    lines.push([
      csvEscape(customer.name),
      csvEscape(customer.phone)
    ].join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

function downloadFile(filename, text, mimeType) {
  const content = mimeType.startsWith("text/csv") ? `\uFEFF${text}` : text;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setDataMessage(message, className) {
  dataMessage.textContent = message;
  dataMessage.className = className;
}

function exportOrdersCsv() {
  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  downloadFile(
    `autokhata-orders-${todayLocal()}.csv`,
    ordersToCsv(orders),
    "text/csv;charset=utf-8"
  );

  if (orders.length === 0) {
    setDataMessage("No orders yet. File has only the header.", "msg-ok");
  } else {
    setDataMessage(`Exported ${orders.length} rows.`, "msg-ok");
  }
}

function exportCustomersCsv() {
  const loadedCustomers = Store.load("customers");
  const customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
  downloadFile(
    `autokhata-customers-${todayLocal()}.csv`,
    customersToCsv(customers),
    "text/csv;charset=utf-8"
  );
  setDataMessage(`Exported ${customers.length} rows.`, "msg-ok");
}

function buildBackup(orders, customers, settings, today) {
  return {
    format: "autokhata-backup",
    version: 1,
    exported_on: today,
    shop_name: settings.shop_name,
    orders,
    customers
  };
}

function downloadBackup() {
  const loadedOrders = Store.load("orders");
  const loadedCustomers = Store.load("customers");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  const customers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
  const settings = Store.load("settings");
  const backup = buildBackup(orders, customers, settings, todayLocal());
  downloadFile(
    `autokhata-backup-${todayLocal()}.json`,
    JSON.stringify(backup, null, 2),
    "application/json"
  );
  setDataMessage(
    `Backup downloaded: ${orders.length} orders, ${customers.length} customers.`,
    "msg-ok"
  );
}

function validateBackup(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj) ||
      obj.format !== "autokhata-backup") {
    return { ok: false, reason: "This file is not an Auto Khata backup." };
  }

  if (obj.version !== 1) {
    return { ok: false, reason: "This backup version is not supported." };
  }

  if (!Array.isArray(obj.orders)) {
    return { ok: false, reason: "orders must be an array" };
  }

  if (!Array.isArray(obj.customers)) {
    return { ok: false, reason: "customers must be an array" };
  }

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const statuses = ["paid", "partial", "unpaid"];
  const orders = [];

  for (let index = 0; index < obj.orders.length; index += 1) {
    const source = obj.orders[index];
    const position = index + 1;

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return { ok: false, reason: `order ${position}: is not an object` };
    }

    if (typeof source.id !== "string" || !source.id.trim()) {
      return { ok: false, reason: `order ${position}: id is required` };
    }

    if (typeof source.date !== "string" || !source.date.trim()) {
      return { ok: false, reason: `order ${position}: date is required` };
    }

    if (!datePattern.test(source.date)) {
      return { ok: false, reason: `order ${position}: date is invalid` };
    }

    if (typeof source.customer !== "string" || !source.customer.trim()) {
      return { ok: false, reason: `order ${position}: customer is required` };
    }

    if (typeof source.item !== "string" || !source.item.trim()) {
      return { ok: false, reason: `order ${position}: item is required` };
    }

    if (typeof source.due_date !== "string" ||
        (source.due_date !== "" && !datePattern.test(source.due_date))) {
      return { ok: false, reason: `order ${position}: due_date is invalid` };
    }

    if (typeof source.quantity !== "number" || !Number.isFinite(source.quantity)) {
      return { ok: false, reason: `order ${position}: quantity is not a number` };
    }

    if (typeof source.amount !== "number" || !Number.isFinite(source.amount)) {
      return { ok: false, reason: `order ${position}: amount is not a number` };
    }

    if (typeof source.paid !== "number" || !Number.isFinite(source.paid)) {
      return { ok: false, reason: `order ${position}: paid is not a number` };
    }

    if (source.amount < 0) {
      return { ok: false, reason: `order ${position}: amount must be 0 or more` };
    }

    if (source.paid < 0) {
      return { ok: false, reason: `order ${position}: paid must be 0 or more` };
    }

    if (source.paid > source.amount + 0.01) {
      return { ok: false, reason: `order ${position}: paid is more than amount` };
    }

    if (!statuses.includes(source.status)) {
      return { ok: false, reason: `order ${position}: status is invalid` };
    }

    if (typeof source.unit !== "string") {
      return { ok: false, reason: `order ${position}: unit must be text` };
    }

    orders.push({
      id: source.id,
      date: source.date,
      customer: source.customer,
      item: source.item,
      quantity: source.quantity,
      unit: source.unit,
      amount: source.amount,
      paid: source.paid,
      due_date: source.due_date,
      status: source.status
    });
  }

  const customers = [];

  for (let index = 0; index < obj.customers.length; index += 1) {
    const source = obj.customers[index];
    const position = index + 1;

    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return { ok: false, reason: `customer ${position}: is not an object` };
    }

    if (typeof source.name !== "string" || !source.name.trim()) {
      return { ok: false, reason: `customer ${position}: name is required` };
    }

    if (typeof source.phone !== "string") {
      return { ok: false, reason: `customer ${position}: phone must be text` };
    }

    customers.push({ name: source.name, phone: source.phone });
  }

  const ids = new Set();

  for (const order of orders) {
    if (ids.has(order.id)) {
      return { ok: false, reason: `duplicate order id: ${order.id}` };
    }

    ids.add(order.id);
  }

  if (Object.prototype.hasOwnProperty.call(obj, "shop_name") &&
      typeof obj.shop_name !== "string") {
    return { ok: false, reason: "shop_name must be text" };
  }

  return {
    ok: true,
    orders,
    customers,
    shop_name: obj.shop_name
  };
}

function refreshAfterRestore() {
  renderOrders();
  renderDashboard();
  renderDues();
  populateInvoiceCustomers();
  loadSettingsUi();
}

function restoreBackupFile() {
  const file = backupFile.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    let parsed;

    try {
      parsed = JSON.parse(reader.result);
    } catch (error) {
      setDataMessage("This file is not a valid backup (not JSON).", "msg-error");
      backupFile.value = "";
      return;
    }

    const result = validateBackup(parsed);

    if (!result.ok) {
      setDataMessage(result.reason, "msg-error");
      backupFile.value = "";
      return;
    }

    const loadedOrders = Store.load("orders");
    const loadedCustomers = Store.load("customers");
    const currentOrders = Array.isArray(loadedOrders) ? loadedOrders : [];
    const currentCustomers = Array.isArray(loadedCustomers) ? loadedCustomers : [];
    const confirmed = window.confirm(
      `Replace current data with this backup? It has ${result.orders.length} orders and ${result.customers.length} customers. Your current data has ${currentOrders.length} orders and ${currentCustomers.length} customers. This cannot be undone.`
    );

    if (!confirmed) {
      setDataMessage("Restore cancelled.", "msg-ok");
      backupFile.value = "";
      return;
    }

    Store.save("orders", result.orders);
    Store.save("customers", result.customers);

    if (typeof result.shop_name === "string") {
      const settings = Store.load("settings");
      settings.shop_name = result.shop_name;
      Store.save("settings", settings);
    }

    refreshAfterRestore();
    setDataMessage(
      `Restored ${result.orders.length} orders and ${result.customers.length} customers.`,
      "msg-ok"
    );
    backupFile.value = "";
  });
  reader.addEventListener("error", () => {
    setDataMessage("This backup file could not be read.", "msg-error");
    backupFile.value = "";
  });
  reader.readAsText(file);
}

function clearDataForLock() {
  dataMessage.textContent = "";
  dataMessage.className = "";
  backupFile.value = "";
}

/* ===== IMPORT ===== */

const MAX_IMPORT_ROWS = 500;
const MAX_UNPARSED = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function cleanLine(line) {
  return String(line)
    .replace(/[\u200e\u200f\u202a-\u202e\ufeff]/g, "")
    .replace(/[\u202f\u00a0]/g, " ")
    .trim();
}

function validChatDate(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

function formatChatDate(first, second, yearText) {
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
  let day = Number(first);
  let month = Number(second);

  if (!validChatDate(year, month, day)) {
    day = Number(second);
    month = Number(first);

    if (!validChatDate(year, month, day)) {
      return "";
    }
  }

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function chatHeaderResult(dateParts, rest) {
  const date = formatChatDate(dateParts[0], dateParts[1], dateParts[2]);
  const message = rest.match(/^([^:]{1,60}):\s*(.*)$/);

  if (message && message[1].trim()) {
    return {
      type: "message",
      date,
      sender: message[1].trim(),
      text: message[2]
    };
  }

  return { type: "system", date };
}

function parseChatHeader(line) {
  const android = line.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{2}(?:\d{2})?),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:[ap]\.?m\.?)?\s+-\s+(.*)$/i
  );

  if (android) {
    return chatHeaderResult(android.slice(1, 4), android[7]);
  }

  const iphone = line.match(
    /^\[(\d{1,2})\/(\d{1,2})\/(\d{2}(?:\d{2})?),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:[ap]\.?m\.?)?\]\s*(.*)$/i
  );

  if (iphone) {
    return chatHeaderResult(iphone.slice(1, 4), iphone[7]);
  }

  return { type: "none" };
}

function orderKey(order) {
  const customer = String(order.customer).trim().replace(/\s+/g, " ").toLowerCase();
  const item = String(order.item).trim().toLowerCase();
  const unit = String(order.unit).toLowerCase();
  return [
    order.date,
    customer,
    item,
    order.quantity,
    unit,
    order.amount
  ].join("|");
}

function normalizedImportName(name) {
  return String(name).trim().replace(/\s+/g, " ").toLowerCase();
}

function importText(text, today, myName, existingOrders) {
  const lines = String(text).split(/\r?\n/).map(cleanLine).filter(Boolean);
  const headers = lines.map(parseChatHeader);
  const mode = headers.some((header) =>
    header.type === "message" || header.type === "system"
  ) ? "chat" : "plain";
  let rows = [];
  let unparsed = [];
  let skipped = 0;
  let alreadySaved = 0;

  if (mode === "plain") {
    for (const line of lines) {
      const result = parseLine(line);

      if (result.ok) {
        for (const row of result.rows) {
          row.date = today;
        }

        rows.push(...result.rows);
      } else {
        unparsed.push({ text: line, reason: result.reason });
      }
    }
  } else {
    let currentSender = "";
    let currentDate = "";
    const ownName = normalizedImportName(myName);

    for (let index = 0; index < lines.length; index += 1) {
      const header = headers[index];
      let entryText;

      if (header.type === "system") {
        skipped += 1;
        currentSender = "";
        continue;
      }

      if (header.type === "message") {
        currentSender = header.sender;
        currentDate = header.date;
        entryText = header.text.trim();
      } else {
        if (!currentSender) {
          skipped += 1;
          continue;
        }

        entryText = lines[index];
      }

      if (/^<?media omitted>?$/i.test(entryText) ||
          /^this message was deleted$/i.test(entryText) ||
          /^you deleted this message$/i.test(entryText) ||
          entryText === "null" ||
          !/\d/.test(entryText)) {
        skipped += 1;
        continue;
      }

      let result = parseLine(entryText);

      if (!result.ok && /^\d/.test(entryText) && /^\p{L}/u.test(currentSender) &&
          normalizedImportName(currentSender) !== ownName) {
        result = parseLine(`${currentSender} ${entryText}`);
      }

      if (!result.ok) {
        unparsed.push({
          text: entryText,
          reason: `${result.reason} (from ${currentSender}, ${currentDate || today})`
        });
        continue;
      }

      for (const row of result.rows) {
        row.date = currentDate || today;
      }

      rows.push(...result.rows);
    }
  }

  const savedKeys = new Set(existingOrders.map(orderKey));
  rows = rows.filter((row) => {
    if (savedKeys.has(orderKey(row))) {
      alreadySaved += 1;
      return false;
    }

    return true;
  });

  const rowsCapped = rows.length > MAX_IMPORT_ROWS ? rows.length : 0;
  const unparsedCapped = unparsed.length > MAX_UNPARSED ? unparsed.length : 0;

  if (rowsCapped) {
    rows = rows.slice(0, MAX_IMPORT_ROWS);
  }

  if (unparsedCapped) {
    unparsed = unparsed.slice(0, MAX_UNPARSED);
  }

  return {
    mode,
    linesRead: lines.length,
    rows,
    unparsed,
    skipped,
    alreadySaved,
    rowsCapped,
    unparsedCapped
  };
}

/* ===== NAV ===== */

function plural(number, word) {
  return `${number} ${word}${number === 1 ? "" : "s"}`;
}

function appendPillCell(tableRow, text, status) {
  const cell = document.createElement("td");
  const pill = document.createElement("span");
  const safeStatus = ["paid", "partial", "unpaid"].includes(status)
    ? status
    : "unpaid";
  pill.className = `pill pill-${safeStatus}`;
  pill.textContent = text;
  cell.appendChild(pill);
  tableRow.appendChild(cell);
}

function clearAddMessage() {
  addMessage.replaceChildren();
  addMessage.className = "";
}

function showAddSavedMessage(count) {
  addMessage.replaceChildren();
  addMessage.className = "msg-ok";
  addMessage.appendChild(document.createTextNode(`Saved ${plural(count, "order")}.`));

  const viewButton = document.createElement("button");
  viewButton.type = "button";
  viewButton.className = "btn-secondary";
  viewButton.textContent = "View orders";
  viewButton.addEventListener("click", () => showView("customers"));
  addMessage.appendChild(viewButton);
}

function showView(name) {
  for (const element of viewElements) {
    const emptyPreview = element.id === "preview-section" &&
      previewRows.length === 0 && unparsedLines.length === 0;
    element.classList.remove("view-hidden");
    element.classList.toggle(
      "hidden",
      element.dataset.view !== name || emptyPreview
    );
  }

  for (const button of tabButtons) {
    if (button.dataset.tab === name) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  }

  const loadedOrders = Store.load("orders");
  const orders = Array.isArray(loadedOrders) ? loadedOrders : [];
  homeEmpty.classList.toggle("hidden", orders.length > 0);
  dashTotals.classList.toggle("hidden", orders.length === 0);
  window.scrollTo(0, 0);
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
const shopNameInput = document.getElementById("shop-name");
const shopSave = document.getElementById("shop-save");
const shopSaved = document.getElementById("shop-saved");
const duesBuckets = document.getElementById("dues-buckets");
const actionPanel = document.getElementById("action-panel");
const invoiceCustomer = document.getElementById("invoice-customer");
const invoiceOrders = document.getElementById("invoice-orders");
const invoiceCreate = document.getElementById("invoice-create");
const invoiceError = document.getElementById("invoice-error");
const invoiceSheet = document.getElementById("invoice-sheet");
const invShop = document.getElementById("inv-shop");
const invCustomerName = document.getElementById("inv-customer-name");
const invDate = document.getElementById("inv-date");
const invBody = document.getElementById("inv-body");
const invTotal = document.getElementById("inv-total");
const invPaid = document.getElementById("inv-paid");
const invDue = document.getElementById("inv-due");
const invPrint = document.getElementById("inv-print");
const invClose = document.getElementById("inv-close");
const exportOrdersButton = document.getElementById("export-orders");
const exportCustomersButton = document.getElementById("export-customers");
const backupDownloadButton = document.getElementById("backup-download");
const backupFile = document.getElementById("backup-file");
const dataMessage = document.getElementById("data-message");
const importFile = document.getElementById("import-file");
const importMyName = document.getElementById("import-myname");
const importMessage = document.getElementById("import-message");
const tabButtons = Array.from(document.querySelectorAll("#tabs [data-tab]"));
const viewElements = Array.from(document.querySelectorAll("[data-view]"));
const homeEmpty = document.getElementById("home-empty");
const homeAddFirst = document.getElementById("home-add-first");
const addMessage = document.getElementById("add-message");

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
  loadSettingsUi();
  renderDues();
  showView("home");
}

function setImportMessage(message, className) {
  importMessage.textContent = message;
  importMessage.className = className;
}

function importChosenFile() {
  const file = importFile.files[0];

  if (!file) {
    return;
  }

  if (file.size > MAX_FILE_BYTES) {
    setImportMessage("File is too large (limit 5 MB).", "msg-error");
    importFile.value = "";
    return;
  }

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const loadedOrders = Store.load("orders");
    const existingOrders = Array.isArray(loadedOrders) ? loadedOrders : [];
    const result = importText(
      reader.result,
      todayLocal(),
      importMyName.value,
      existingOrders
    );

    if (result.linesRead === 0) {
      setImportMessage("No lines found in this file.", "msg-error");
      importFile.value = "";
      return;
    }

    previewRows.push(...result.rows);
    unparsedLines.push(...result.unparsed);
    renderPreview();

    const modeLabel = result.mode === "chat" ? "WhatsApp chat" : "plain text";
    let summary = `${modeLabel}: ${result.linesRead} lines read; ${result.rows.length} rows added to the preview; ${result.unparsed.length} lines need a fix; ${result.skipped} skipped; ${result.alreadySaved} already saved.`;

    if (result.rowsCapped) {
      summary += ` ${result.rowsCapped} rows were found; only the first ${MAX_IMPORT_ROWS} rows were loaded. Import the file in parts.`;
    }

    if (result.unparsedCapped) {
      summary += ` ${result.unparsedCapped} fix lines were found; only the first ${MAX_UNPARSED} were loaded. Import the file in parts.`;
    }

    setImportMessage(summary, "msg-ok");
    importFile.value = "";
  });
  reader.addEventListener("error", () => {
    setImportMessage("Could not read the file.", "msg-error");
    importFile.value = "";
  });
  reader.readAsText(file);
}

function clearImportForLock() {
  importMessage.textContent = "";
  importMessage.className = "";
  importMyName.value = "";
  importFile.value = "";
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

entryAdd.addEventListener("click", () => {
  clearAddMessage();
  addEntryToPreview();
});
entryText.addEventListener("keydown", (event) => {
  if (event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    entryAdd.click();
  }
});
previewConfirm.addEventListener("click", confirmAndSavePreview);
previewCancel.addEventListener("click", cancelPreview);
shopSave.addEventListener("click", saveShopName);
invoiceCustomer.addEventListener("change", renderInvoiceOrders);
invoiceCreate.addEventListener("click", createInvoice);
invBody.addEventListener("input", updateInvoiceTotals);
invPaid.addEventListener("input", updateInvoiceTotals);
invPrint.addEventListener("click", printInvoice);
invClose.addEventListener("click", closeInvoiceSheet);
exportOrdersButton.addEventListener("click", exportOrdersCsv);
exportCustomersButton.addEventListener("click", exportCustomersCsv);
backupDownloadButton.addEventListener("click", downloadBackup);
backupFile.addEventListener("change", restoreBackupFile);
importFile.addEventListener("change", importChosenFile);
homeAddFirst.addEventListener("click", () => showView("add"));

for (const button of tabButtons) {
  button.addEventListener("click", () => showView(button.dataset.tab));
}

lockButton.addEventListener("click", () => {
  clearOrdersUiForLock();
  clearDashboardForLock();
  clearDuesForLock();
  clearInvoiceForLock();
  clearDataForLock();
  clearImportForLock();
  clearAddMessage();
  showView("home");
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
