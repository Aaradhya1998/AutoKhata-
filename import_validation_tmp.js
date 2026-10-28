(() => {
  const checks = [];
  const check = (name, passed, details = "") => checks.push({ name, passed: Boolean(passed), details });
  const today = "2026-10-28";

  check("clean line", cleanLine("\u200e  Ravi\u00a01kg\ufeff ") === "Ravi 1kg");
  const android = parseChatHeader("26/10/2026, 4:30 p.m. - Gupta: hi");
  const iphone = parseChatHeader("[25/10/2026, 10:15:30] Ravi: hello");
  const swapped = parseChatHeader("[10/25/26 10:15 pm] Ravi: hello");
  const invalidDate = parseChatHeader("31/31/2026, 10:15 - Ravi: 1kg aata");
  check("Android header", android.type === "message" && android.date === "2026-10-26" && android.sender === "Gupta" && android.text === "hi");
  check("iPhone header", iphone.type === "message" && iphone.date === "2026-10-25" && iphone.sender === "Ravi");
  check("date fallback", swapped.date === "2026-10-25" && invalidDate.date === "");
  check("header types", parseChatHeader("hello").type === "none" && parseChatHeader("28/10/2026, 09:15 - Messages are encrypted").type === "system");

  const accepted = importText("\u200e[25/10/2026, 10:15:30] Ravi: 2kg aata 100 pending", today, "", []);
  check("acceptance chat", accepted.mode === "chat" && accepted.rows.length === 1 && accepted.rows[0].customer === "Ravi" && accepted.rows[0].date === "2026-10-25" && accepted.rows[0].amount === 100);
  check("empty import", importText("", today, "", []).linesRead === 0 && importText("", today, "", []).mode === "plain");

  const plain = importText("Ravi 1kg sugar 45 pending\nhello", today, "", []);
  check("plain import", plain.mode === "plain" && plain.linesRead === 2 && plain.rows.length === 1 && plain.rows[0].date === today && plain.unparsed.length === 1);

  const geeta = "25/10/2026, 10:15 - Geeta: 1kg chawal 75 paid";
  const geetaOther = importText(geeta, today, "", []);
  const geetaOwn = importText(geeta, today, "Geeta", []);
  check("sender fallback", geetaOther.rows.length === 1 && geetaOther.rows[0].customer === "Geeta");
  check("own name suppression", geetaOwn.rows.length === 0 && geetaOwn.unparsed.length === 1 && geetaOwn.unparsed[0].reason.includes("from Geeta"));

  const continuation = importText("25/10/2026, 10:15 - Gupta: Ravi 1kg aata 50 pending\nSunita 1kg chini 40 paid", today, "", []);
  check("continuation", continuation.rows.length === 2 && continuation.rows[1].customer === "Sunita" && continuation.rows[1].date === "2026-10-25");

  const skipped = importText("28/10/2026, 09:15 - System message\n25/10/2026, 10:15 - Ravi: thanks\n25/10/2026, 10:16 - Ravi: <Media omitted>\n25/10/2026, 10:17 - Ravi: this message was deleted", today, "", []);
  check("skip rules", skipped.skipped === 4 && skipped.rows.length === 0 && skipped.unparsed.length === 0);

  const base = importText("Ravi 1kg sugar 45 pending", today, "", []);
  const deduped = importText("Ravi 1kg sugar 45 pending", today, "", base.rows);
  const fileDuplicates = importText("Ravi 1kg sugar 45 pending\nRavi 1kg sugar 45 pending", today, "", []);
  check("saved dedupe", deduped.rows.length === 0 && deduped.alreadySaved === 1);
  check("file duplicates kept", fileDuplicates.rows.length === 2 && fileDuplicates.alreadySaved === 0);
  check("order key normalization", orderKey({ date: today, customer: " Ravi   Kumar ", item: " AATA ", quantity: 1, unit: "KG", amount: 10 }) === `${today}|ravi kumar|aata|1|kg|10`);

  const manyRows = Array.from({ length: 501 }, (_, index) => `Ravi 1 item${index} 1 pending`).join("\n");
  const cappedRows = importText(manyRows, today, "", []);
  const manyFailures = Array.from({ length: 201 }, (_, index) => `hello${String.fromCharCode(65 + index % 26)}`).join("\n");
  const cappedFailures = importText(manyFailures, today, "", []);
  check("row cap", cappedRows.rows.length === 500 && cappedRows.rowsCapped === 501);
  check("unparsed cap", cappedFailures.unparsed.length === 200 && cappedFailures.unparsedCapped === 201);

  const request = new XMLHttpRequest();
  request.open("GET", "tests/chat_sample.txt", false);
  request.send();
  const sampleLines = request.responseText.trimEnd().split(/\r?\n/);
  const sample = importText(request.responseText, today, "Gupta", []);
  check("sample fixture", sampleLines.length === 11 && sample.mode === "chat" && sample.linesRead === 11 && sample.rows.length === 6 && sample.unparsed.length === 2 && sample.skipped === 4);

  const parserRequest = new XMLHttpRequest();
  parserRequest.open("GET", "tests/parser_test.txt", false);
  parserRequest.send();
  const parserCheck = runParserTests(parserRequest.responseText);
  check("parser unchanged", parserCheck.fields.customer.correct === 34 && parserCheck.fields.item.correct === 33);

  document.body.textContent = JSON.stringify({ passed: checks.every((entry) => entry.passed), checks, sample: { rows: sample.rows.length, unparsed: sample.unparsed.length, skipped: sample.skipped }, parserScores: parserCheck.fields });
})();
