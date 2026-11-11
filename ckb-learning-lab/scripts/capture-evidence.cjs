/* Optional browser verification. No browser dependency is added to the lab.
 * PLAYWRIGHT_MODULE=/absolute/path/to/playwright node scripts/capture-evidence.cjs --submit
 * --submit explicitly authorizes the missing initial mint and first 10-unit transfer.
 * Existing operations are inspected, never issued again.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const output = path.resolve(__dirname, '../../reports/week01/04_fungible_token');
const base = 'http://localhost:2507';
const maySubmit = process.argv.includes('--submit');
const get = async (route) => {
  const response = await fetch(base + route);
  const data = await response.json();
  assert.equal(response.ok, true, JSON.stringify(data));
  return data;
};
const rpc = async (method, params = []) => {
  const response = await fetch('http://127.0.0.1:8114', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id:1,jsonrpc:'2.0',method,params}) });
  const data = await response.json();
  assert.equal(data.error, undefined);
  return data.result;
};
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: {width: 1400, height: 1000} });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base);
    await page.waitForFunction(() => document.querySelector('#status').textContent === 'connected');
    await page.waitForFunction(() => document.querySelector('#refresh').disabled === false && document.querySelectorAll('#accounts .account').length === 2);
    const screenshot = async (name, locator) => {
      const file = path.join(output, name);
      if (!fs.existsSync(file)) await (locator || page).screenshot({ path: file, ...(locator ? {} : { fullPage: true }) });
    };
    await screenshot('01_devnet_wallet.png', page.locator('#accounts').locator('..'));
    await page.locator('#script-info').locator('..').evaluate(node => { if (node.tagName === 'DETAILS') node.open = true; });
    await screenshot('02_udt_configuration.png', page.locator('#script-info').locator('..'));
    let info = await get('/api/token/info');
    const wallet = await get('/api/wallet');
    const sender = wallet.accounts.find(account => account.account === 0).address;
    const receiver = wallet.accounts.find(account => account.account === 1).address;
    if (!info.token) {
      assert(maySubmit, 'Pass --submit to authorize the missing initial mint.');
      await page.locator('#create-token').click();
      await page.waitForFunction(() => document.querySelector('#selected-status')?.textContent === 'committed', null, {timeout: 90000});
      info = await get('/api/token/info');
      console.log('Mint committed:', info.token.mintTxHash);
    }
    await page.locator('#transaction-hash').fill(info.token.mintTxHash);
    await page.locator('#inspect-transaction').click();
    await page.waitForFunction(() => document.querySelector('#selected-status')?.textContent === 'committed');
    await screenshot('03_token_creation.png', page.locator('#transaction-detail'));
    const confirmedMint = await get('/api/token/transaction/' + info.token.mintTxHash);
    const alreadyTransferred = info.operations.find(operation => operation.kind === 'transfer');
    if (!alreadyTransferred) {
      const before = await get('/api/token/balance?address=' + sender);
      assert.equal(before.balance, '1000');
      assert.equal((await get('/api/token/balance?address=' + receiver)).balance, '0');
      await page.locator('#balance-address').fill(sender);
      await page.locator('#check-balance').click();
      await page.waitForFunction(() => document.querySelector('#balance-amount').textContent === '1000');
      await screenshot('04_token_balance.png', page.locator('#balance-form').locator('..'));
      assert(maySubmit, 'Pass --submit to authorize the missing first transfer.');
      await page.locator('#receiver').fill(receiver);
      await page.locator('#transfer-amount').fill('10');
      await page.waitForFunction(() => !document.querySelector('#transfer-fields').disabled);
      await page.locator('#transfer-form button[type=submit]').click();
      await page.waitForFunction((mint) => document.querySelector('#selected-hash').textContent !== mint && document.querySelector('#selected-status')?.textContent === 'committed', info.token.mintTxHash, {timeout: 90000});
      info = await get('/api/token/info');
    }
    const transfer = info.operations.find(operation => operation.kind === 'transfer');
    assert(transfer, 'No transfer recorded.');
    await page.locator('#transaction-hash').fill(transfer.hash);
    await page.locator('#inspect-transaction').click();
    await page.waitForFunction(() => document.querySelector('#selected-status')?.textContent === 'committed');
    await screenshot('05_token_transfer.png', page.locator('#transaction-detail'));
    await page.locator('#refresh').click();
    await page.waitForFunction(() => document.querySelector('#refresh').disabled === false);
    await screenshot('06_transaction_verified.png');
    const senderBalance = await get('/api/token/balance?address=' + sender);
    const receiverBalance = await get('/api/token/balance?address=' + receiver);
    assert.equal(senderBalance.balance, '990');
    assert.equal(receiverBalance.balance, '10');
    const verifiedTransfer = await get('/api/token/transaction/' + transfer.hash);
    assert.equal(confirmedMint.status, 'committed');
    assert.equal(verifiedTransfer.status, 'committed');
    const rawMint = await rpc('get_transaction', [info.token.mintTxHash]);
    const rawTransfer = await rpc('get_transaction', [transfer.hash]);
    assert.equal(rawMint.tx_status.status, 'committed');
    assert.equal(rawTransfer.tx_status.status, 'committed');
    assert.deepEqual(verifiedTransfer.outputs.filter(o => o.tokenAmount !== null).map(o => o.tokenAmount), ['10', '990']);
    // Navigation preserves form state and leaves completed assignment scripts intact.
    await page.locator('#transfer-amount').fill('17');
    for (const module of ['transfer', 'cell', 'dob', 'lock', 'token']) await page.locator('#tab-' + module).click();
    assert.equal(await page.locator('#transfer-amount').inputValue(), '17');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#selected-status')?.textContent === 'committed');
    assert.equal((await get('/api/token/info')).operations.length, 2);
    assert.deepEqual(errors, []);
    const evidence = { capturedAt: new Date().toISOString(), network: await get('/api/health'), wallet: await get('/api/wallet'), token: info, mint: confirmedMint, transfer: verifiedTransfer, senderBalance, receiverBalance, rawMint, rawTransfer, browserErrors: errors, operationCountAfterReload: 2 };
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify(evidence, null, 2) + '\n');
    console.log(JSON.stringify({ mint: confirmedMint.hash, mintBlock: confirmedMint.blockNumber, transfer: verifiedTransfer.hash, transferBlock: verifiedTransfer.blockNumber, senderBalance: senderBalance.balance, receiverBalance: receiverBalance.balance, browserErrors: errors }));
  } finally { await browser.close(); }
})().catch(error => {console.error(error);process.exitCode = 1;});
