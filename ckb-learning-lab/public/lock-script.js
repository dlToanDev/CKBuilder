"use strict";
(() => {
  const STORAGE = "ckbuilder.lock.submission.v1";
  const lock = { ready: false, loaded: false, busy: false, refreshing: false, inspecting: false, info: null, intent: null, selectedHash: null, destinationInitialized: false };
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE));
    if (saved && ["create", "test-unauthorized", "spend"].includes(saved.kind) && /^[A-Za-z0-9_-]{8,100}$/.test(saved.key) && saved.body && typeof saved.body === "object") lock.intent = saved;
  } catch { /* Active-page retries still retain the original request. */ }
  const feedback = (id, text, kind = "") => { $(id).textContent = text; $(id).className = `feedback ${kind}`; };
  const node = (tag, text) => { const result = document.createElement(tag); if (text !== undefined) result.textContent = text; return result; };
  const transactions = () => lock.info?.transactions || [];
  const pending = () => transactions().filter((tx) => !["committed", "rejected"].includes(tx.status));
  function remember(intent) {
    lock.intent = intent;
    try { if (intent) sessionStorage.setItem(STORAGE, JSON.stringify(intent)); else sessionStorage.removeItem(STORAGE); } catch { /* In-memory retry remains available. */ }
  }
  function selectedPoint() {
    try { return JSON.parse($("lock-cell").value); } catch { return null; }
  }
  function selectedTest() {
    const point = selectedPoint();
    return (lock.info?.tests || []).slice().reverse().find((test) => test.outPoint.txHash === point?.txHash && test.outPoint.index === point?.index);
  }
  function metadata(id, entries) {
    $(id).replaceChildren();
    for (const [label, value] of entries) $(id).append(node("dt", label), node("dd", value ?? "—"));
  }
  function controls() {
    const disabled = !lock.ready || lock.busy || lock.refreshing || Boolean(lock.intent) || pending().length > 0;
    $("lock-create-fields").disabled = disabled;
    $("lock-test-fields").disabled = disabled || !selectedPoint();
    $("lock-spend-fields").disabled = disabled || !selectedPoint() || !selectedTest()?.passed;
    $("lock-refresh").disabled = lock.busy || lock.refreshing;
    $("lock-retry").hidden = !lock.intent;
    $("lock-retry").disabled = lock.busy || lock.refreshing;
    $("lock-spend-input").textContent = selectedPoint() ? `Input: ${selectedPoint().txHash}:${selectedPoint().index} · Signer: Account #0` : "Select a live locked Cell in Step 3.";
  }
  function renderTest(test) {
    if (!test) {
      feedback("lock-test-result", "No authorization test recorded for this Cell.");
      $("lock-test-proof").textContent = "No authorization test has run.";
      return;
    }
    feedback("lock-test-result", test.passed ? `Expected authorization failure verified · ${test.signer} · Cell remained live after the test · ${test.testedAt}` : `Test inconclusive: the node did not return the expected input-lock error. ${test.actualError?.message || "The unauthorized script unexpectedly succeeded."}`, test.passed ? "success" : "error");
    $("lock-test-proof").textContent = JSON.stringify(test, null, 2);
  }
  function renderTransaction(tx) {
    lock.selectedHash = tx.hash;
    $("lock-hash").value = tx.hash;
    const output = tx.outputs[0];
    metadata("lock-transaction-meta", [["Transaction hash", tx.hash], ["Status", tx.status], ["Block number", tx.blockNumber], ["Input Cell", tx.operation?.input ? `${tx.operation.input.txHash}:${tx.operation.input.index}` : null], ["Destination", output?.destination || tx.operation?.receiver], ["New output Cell", output ? `${tx.hash}:${output.index} (${output.status})` : "Not observed on chain"], ["Original Cell", tx.originalCell ? `${tx.originalCell.status}${tx.originalCell.consumedByCommittedTransaction ? " · consumed by this committed transaction" : ""}` : null], ["Rejection", tx.reason]]);
    const labels = { authorizedTransactionCommitted: "Authorized transaction committed", originalCellNoLongerLive: "Original locked Cell no longer live, with committed spend evidence", newOutputExists: "New output exists in committed transaction", newOutputLive: "New output is live", correctLockScriptUsed: "Correct Lock Script used", unauthorizedFailedAsExpected: "Unauthorized spending failed for the expected reason" };
    $("lock-checks").replaceChildren();
    for (const [key, label] of Object.entries(labels)) {
      const value = tx.checks[key];
      const item = node("li", `${value === true ? "✓" : value === false ? "✗" : "…"} ${label}${value === null ? " (not verified / not applicable)" : ""}`);
      item.className = value === true ? "success" : value === false ? "error" : "muted";
      $("lock-checks").append(item);
    }
    $("lock-transaction-json").textContent = JSON.stringify(tx, null, 2);
    feedback("lock-inspect-result", tx.verified ? "All five learning checks passed; the new output is also live." : `RPC status: ${tx.status}. Refresh pending transactions; review each check below.`, tx.verified ? "success" : tx.status === "rejected" ? "error" : "");
  }
  async function inspect(hash) {
    if (!HASH_PATTERN.test(hash) || lock.inspecting) return;
    lock.inspecting = true;
    try { renderTransaction(await api(`/api/lock-script/transaction/${hash}`)); }
    catch (error) { feedback("lock-inspect-result", error.message, "error"); }
    finally { lock.inspecting = false; }
  }
  function renderInfo() {
    const info = lock.info;
    metadata("lock-info", [["Account #0 address", info.address], ["Code hash", info.lock.codeHash], ["Hash type", info.lock.hashType], ["Script args (owner Blake160)", info.lock.args], ["Script hash", info.scriptHash], ["Minimum Cell capacity", `${info.minimumCapacityCkb} CKB`], ["Lesson data", info.dataHex], ["Fee rate", `${info.feeRateShannonPerKb} Shannon / 1000 bytes`]]);
    $("lock-dependencies").textContent = JSON.stringify({ deploymentMatched: info.deploymentMatched, dependencies: info.dependencies }, null, 2);
    $("lock-capacity-hint").textContent = `Minimum ${info.minimumCapacityCkb} CKB including one marker byte. Funding pays fees separately at ${info.feeRateShannonPerKb} Shannon / 1000 bytes.`;
    const previous = $("lock-cell").value;
    $("lock-cell").replaceChildren(new Option("Select a live locked Cell", ""));
    for (const tx of transactions()) {
      if (tx.operation?.kind === "create" && tx.status === "committed" && tx.outputs[0]?.status === "live") $("lock-cell").add(new Option(`${tx.hash}:0 · ${tx.outputs[0].capacityCkb} CKB`, JSON.stringify({ txHash: tx.hash, index: 0 })));
    }
    if (Array.from($("lock-cell").options).some((option) => option.value === previous && previous)) $("lock-cell").value = previous;
    else if ($("lock-cell").options.length > 1) $("lock-cell").selectedIndex = 1;
    const destination = $("lock-destination").value;
    $("lock-destination-account").replaceChildren(new Option("Enter address below", ""));
    for (const account of info.accounts) $("lock-destination-account").add(new Option(`Account #${account.account} · ${short(account.address)}`, account.address));
    if (!lock.destinationInitialized) {
      $("lock-destination").value = info.accounts.find((account) => account.account === 1)?.address || "";
      lock.destinationInitialized = true;
    } else $("lock-destination").value = destination;
    $("lock-destination-account").value = info.accounts.some((account) => account.address === $("lock-destination").value) ? $("lock-destination").value : "";
    $("lock-history-body").replaceChildren();
    $("lock-history").hidden = !transactions().length;
    $("lock-history-message").textContent = transactions().length ? `${pending().length} pending / unknown. Status and Cell liveness come from Devnet RPC. Inspect any recorded transaction.` : "No Lock Script transactions recorded. Submission requires an explicit click.";
    for (const tx of transactions().slice().reverse()) {
      const row = node("tr");
      for (const text of [tx.operation.kind, short(tx.hash), "0", tx.status, tx.blockNumber ?? "—"]) row.append(node("td", text));
      row.children[1].title = tx.hash;
      const action = node("td"); const button = node("button", "Inspect"); button.type = "button";
      button.addEventListener("click", () => inspect(tx.hash)); action.append(button); row.append(action);
      $("lock-history-body").append(row);
    }
    renderTest(selectedTest());
    const selected = transactions().find((tx) => tx.hash === lock.selectedHash);
    if (selected) renderTransaction(selected);
  }
  async function refresh() {
    if (lock.refreshing || lock.busy) return;
    lock.loaded = true; lock.refreshing = true; controls();
    try {
      lock.info = await api("/api/lock-script/info"); lock.ready = true;
      renderInfo();
      // Read responses never submit or discard an uncertain request. A retry
      // must recover the same journal entry using its original key and body.
      feedback("lock-message", lock.intent ? "A request needs recovery. Retry same submission reuses its original key and payload." : pending().length ? "Waiting for confirmation. Polling only reads transaction status." : "Connected. Create, Test and Spend run only when clicked.");
    } catch (error) { lock.ready = false; feedback("lock-message", error.message, "error"); }
    finally { lock.refreshing = false; controls(); }
  }
  async function submit(kind, body) {
    if (lock.busy || lock.refreshing) return;
    const intent = lock.intent || { kind, body, key: uuid() };
    remember(intent); lock.busy = true; controls();
    const target = intent.kind === "create" ? "lock-create-result" : intent.kind === "spend" ? "lock-spend-result" : "lock-test-result";
    feedback(target, intent.kind === "test-unauthorized" ? "Running authorized control and unauthorized dry-run…" : "Preparing, signing and submitting transaction…");
    try {
      const result = await api(`/api/lock-script/${intent.kind}`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": intent.key }, body: JSON.stringify(intent.body) });
      if (intent.kind === "test-unauthorized") {
        if (!result.test) throw new Error("Incomplete authorization response; retry the same request.");
        renderTest(result.test); remember(null);
      } else {
        if (!result.transaction?.hash) throw new Error("Incomplete submission response; retry the same request.");
        renderTransaction(result.transaction);
        if (result.transaction.status !== "unknown") remember(null);
        feedback(target, `Transaction ${result.transaction.hash} · output index 0 · status ${result.transaction.status}${result.message ? ` · ${result.message}` : ""}`, result.transaction.status === "rejected" ? "error" : "");
      }
    } catch (error) {
      if (error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status) && !["IDEMPOTENCY_CONFLICT", "OPERATION_IN_PROGRESS", "INPUT_NOT_LIVE"].includes(error.code)) remember(null);
      feedback(target, error.message, "error");
    } finally { lock.busy = false; await refresh(); controls(); }
  }
  $("lock-create-form").addEventListener("submit", (event) => { event.preventDefault(); submit("create", { ownerAccount: Number($("lock-owner").value), capacity: $("lock-capacity").value }); });
  $("lock-test-form").addEventListener("submit", (event) => { event.preventDefault(); submit("test-unauthorized", { outPoint: selectedPoint() }); });
  $("lock-spend-form").addEventListener("submit", (event) => { event.preventDefault(); submit("spend", { outPoint: selectedPoint(), receiver: $("lock-destination").value.trim() }); });
  $("lock-cell").addEventListener("change", () => { renderTest(selectedTest()); controls(); });
  $("lock-destination-account").addEventListener("change", () => { if ($("lock-destination-account").value) $("lock-destination").value = $("lock-destination-account").value; lock.destinationInitialized = true; });
  $("lock-destination").addEventListener("input", () => { lock.destinationInitialized = true; $("lock-destination-account").value = (lock.info?.accounts || []).some((account) => account.address === $("lock-destination").value) ? $("lock-destination").value : ""; });
  $("lock-inspect-form").addEventListener("submit", (event) => { event.preventDefault(); inspect($("lock-hash").value.trim()); });
  $("lock-refresh").addEventListener("click", refresh);
  $("refresh").addEventListener("click", () => { if (lock.loaded) refresh(); });
  $("lock-retry").addEventListener("click", () => { if (lock.intent) submit(lock.intent.kind, lock.intent.body); });
  new MutationObserver(() => { if (!$("panel-lock").hidden) refresh(); }).observe($("panel-lock"), { attributes: true, attributeFilter: ["hidden"] });
  setInterval(() => { if (lock.loaded && (pending().length || lock.intent)) refresh(); }, 3000);
  controls();
})();
