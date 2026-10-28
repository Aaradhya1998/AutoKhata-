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

lockScreen.classList.remove("hidden");
app.classList.add("hidden");
configureLockScreen();

if (!cryptoAvailable) {
  showError("This browser cannot run the password check. Use Chrome or Edge.");
  submitButton.disabled = true;
} else {
  passwordInput.focus();
}
