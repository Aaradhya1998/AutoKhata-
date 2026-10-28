(async () => {
  const checks = [];
  const check = (name, passed, details = "") => checks.push({ name, passed: Boolean(passed), details });
  const waitFor = async (test) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      if (test()) return true;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return false;
  };

  await waitFor(() => passwordLabel.textContent.startsWith("Set a password"));
  check("first-run lock", !lockScreen.classList.contains("hidden") && !confirmGroup.classList.contains("hidden"));

  passwordInput.value = "abc";
  confirmPasswordInput.value = "abc";
  lockForm.requestSubmit();
  await waitFor(() => lockError.textContent !== "");
  check("short password rejected", lockError.textContent.includes("at least 6"));

  passwordInput.value = "secret1";
  confirmPasswordInput.value = "secret1";
  lockForm.requestSubmit();
  await waitFor(() => !app.classList.contains("hidden"));
  check("password unlock", !app.classList.contains("hidden") && (await apiFetch("/api/status")).unlocked);

  entryText.value = "Ravi 1kg sugar 45 pending";
  entryAdd.click();
  previewConfirm.click();
  await Store.writeChains.orders;
  await Store.writeChains.customers;
  const savedOrders = await apiFetch("/api/orders");
  check("quick entry persisted", savedOrders.length === 1 && savedOrders[0].customer === "Ravi");

  showView("settings");
  shopNameInput.value = "Gupta Store";
  shopSave.click();
  await Store.writeChains.settings;
  check("shop saved", (await apiFetch("/api/settings")).shop_name === "Gupta Store");

  lockButton.click();
  await waitFor(() => !lockScreen.classList.contains("hidden"));
  const lockedResponse = await fetch("/api/orders");
  check("lock and 401", lockedResponse.status === 401 && app.classList.contains("hidden"));

  passwordInput.value = "wrong";
  lockForm.requestSubmit();
  await waitFor(() => lockError.textContent === "Wrong password");
  check("wrong password", lockError.textContent === "Wrong password");

  passwordInput.value = "secret1";
  lockForm.requestSubmit();
  await waitFor(() => !app.classList.contains("hidden"));
  check("correct password reloads data", Store.load("orders").length === 1 && Store.load("settings").shop_name === "Gupta Store");

  document.body.textContent = JSON.stringify({ passed: checks.every((entry) => entry.passed), checks });
})();
