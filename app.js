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

lockButton.addEventListener("click", showLockScreen);

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
