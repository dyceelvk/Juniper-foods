// Juniper app (index.html, formerly menu.html): payload round-trips, QR encoder verification, WhatsApp order link, and view smoke tests.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- Minimal DOM/browser stand-ins (same style as the other Juniper tests) ----
const makeStorage = () => { const map = new Map(); return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map }; };
const localStorage = makeStorage(), sessionStorage = makeStorage();
const elements = {};
const element = id => elements[id] || (elements[id] = { id, innerHTML: '', textContent: '', className: '', value: '', open: false, href: '', listeners: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, removeAttribute() {}, focus() {}, setSelectionRange() {} });
['app', 'toast', 'output', 'wa-hint', 'send-order', 'order-sheet', 'link-details', 'reminders'].forEach(element);
const document = { getElementById: id => elements[id] || null, createElement: () => ({ getContext: () => null, style: {} }), body: { appendChild() {} } };
const location = { origin: 'https://dyceelvk.github.io', pathname: '/Juniper-foods/menu.html', hash: '', get href() { return `${this.origin}${this.pathname}${this.hash}`; } };
const windowListeners = {};
const window = { addEventListener: (name, fn) => { windowListeners[name] = fn; }, open() {}, scrollTo() {} };
const context = { console, document, window, location, localStorage, sessionStorage, navigator: {}, URL, URLSearchParams, TextEncoder, FormData: class {}, setTimeout: () => 1, clearTimeout() {}, Blob, prompt() {}, confirm: () => true };
vm.createContext(context);
vm.runInContext(code, context);
const api = window.JuniperQrMenu;
const app = elements.app, output = elements.output;
const listeners = app.listeners;
const click = (action, dataset = {}) => listeners.click({ target: { closest: selector => (selector === '[data-action]' ? { dataset: { ...dataset, action } } : null) }, preventDefault() {} });
const type = (dataset, value, type = 'text') => listeners.input({ target: { dataset, value, type, checked: Boolean(value) } });
const navigate = hash => { location.hash = hash; windowListeners.hashchange(); };
function check(condition, message) { if (!condition) throw new Error(message); }

// ---- WhatsApp number normalisation ----
check(api.whatsappDigits('0801 234 5678') === '2348012345678', 'Nigerian local numbers should become 234…');
check(api.whatsappDigits('+234 801 234 5678') === '2348012345678', 'international format should keep the country code');
check(api.whatsappDigits('8012345678') === '2348012345678', 'ten-digit local numbers should get the 234 prefix');
check(api.whatsappDigits('0044 7700 900123') === '447700900123', 'a 00 prefix should be dropped');
check(api.whatsappDigits('12345') === '' && api.whatsappDigits('abc') === '', 'short or empty numbers must be rejected');

// ---- Payload round trip with awkward characters ----
const menu = {
  name: "Mama Nkechi's Kitchen ~ Café & Grill!", whatsapp: '0801 234 5678', tagline: 'Wuse 2, Abuja · open 8am–9pm (daily)', pickup: true, delivery: false,
  categories: [
    { name: 'Rice & beans', items: [{ name: 'Jollof rice + chicken', price: '3500', note: '100% party style = smoky' }, { name: 'Ofada rice #1', price: 4200, note: '' }, { name: '', price: 1, note: 'ignored: no name' }] },
    { name: '', items: [{ name: 'Zobo (large)', price: '800.4', note: 'with ginger*' }] },
    { name: 'Empty category', items: [] }
  ]
};
const payload = api.encodePayload(menu);
check(/^[A-Za-z0-9%+!~._-]+$/.test(payload), `payload must only use URL-safe characters, got: ${payload}`);
check(!/[!~]{2}|~!/.test(payload.replace(/~[cik]!/g, '')) && /~k[0-9a-z]{3}$/.test(payload), 'payload must end with a 3-character checksum record');
const decoded = api.decodePayload(payload);
check(decoded.name === "Mama Nkechi's Kitchen ~ Café & Grill!" && decoded.whatsapp === '2348012345678' && decoded.tagline === 'Wuse 2, Abuja · open 8am–9pm (daily)', 'business details must survive the round trip');
check(decoded.pickup === true && decoded.delivery === false, 'service flags must survive the round trip');
check(decoded.categories.length === 2 && decoded.categories[0].name === 'Rice & beans' && decoded.categories[1].name === '', 'empty categories drop out, unnamed ones stay');
check(decoded.categories[0].items.length === 2 && decoded.categories[0].items[0].name === 'Jollof rice + chicken' && decoded.categories[0].items[0].price === 3500 && decoded.categories[0].items[0].note === '100% party style = smoky', 'items, prices, and notes must survive the round trip');
check(decoded.categories[1].items[0].name === 'Zobo (large)' && decoded.categories[1].items[0].price === 800 && decoded.categories[1].items[0].note === 'with ginger*', 'prices are rounded to whole naira');
const link = api.buildLink('https://dyceelvk.github.io/Juniper-foods/menu.html', menu, 'VIP 2');
const fragment = api.parseFragment(link);
check(fragment.m === payload && fragment.t === 'VIP+2', 'link fragment must carry the payload and the table');
check(api.decodePayload(api.parseFragment(api.buildLink('https://x.test/menu.html', menu)).m).name === decoded.name, 'links without a table still decode');
for (const broken of [payload.slice(0, -1), payload.slice(0, 40), payload.replace('Jollof', 'Jolof'), 'J2!x!2348012345678!!pd~i!A!1~k000', '']) {
  let threw = false;
  try { api.decodePayload(broken); } catch { threw = true; }
  check(threw, `damaged or unsupported payload must be rejected: ${broken.slice(0, 30)}`);
}
check(api.encodePayload({ ...menu, name: 'x'.repeat(200) }).length < api.encodePayload({ ...menu, name: 'x'.repeat(100) }).length + 10, 'oversized business names are clamped before encoding');
const wideMenu = { name: 'Big Buka', whatsapp: '2348000000000', categories: Array.from({ length: 20 }, (_, ci) => ({ name: `Cat ${ci}`, items: Array.from({ length: 10 }, (_, ii) => ({ name: `Item ${ci}-${ii}`, price: 100 })) })) };
const wideDecoded = api.decodePayload(api.encodePayload(wideMenu));
check(wideDecoded.categories.length <= api.LIMITS.categories && wideDecoded.categories.reduce((sum, category) => sum + category.items.length, 0) <= api.LIMITS.items, 'category and item limits must be enforced');

// ---- Order message and WhatsApp link ----
const lines = [{ name: 'Jollof rice + chicken', price: 3500, qty: 2 }, { name: 'Zobo (large)', price: 800, qty: 1 }];
const message = api.buildOrderMessage(decoded, lines, { mode: 'delivery', address: '12 Allen Avenue, Ikeja', customer: 'Ada', note: 'no pepper' });
check(message.includes("Hello Mama Nkechi's Kitchen ~ Café & Grill!") && message.includes('2 × Jollof rice + chicken — ₦7,000') && message.includes('Total: ₦7,800') && message.includes('Delivery to: 12 Allen Avenue, Ikeja') && message.includes('Name: Ada') && message.includes('Note: no pepper'), `order message must list items, total, delivery and notes:\n${message}`);
check(api.buildOrderMessage(decoded, lines, { mode: 'table', table: '5' }).includes('Table: 5') && api.buildOrderMessage(decoded, lines, { mode: 'pickup' }).includes('Pickup'), 'table and pickup modes must be stated');
const waLink = api.whatsappLink(decoded.whatsapp, message);
check(waLink.startsWith('https://wa.me/2348012345678?text=') && decodeURIComponent(waLink.split('?text=')[1]) === message, 'WhatsApp link must target the seller number with the full message');

// ---- Bank details: all-or-none, digits only, inside the link, and in the order message ----
const bankMenu = { ...menu, bankName: ' GTBank ', accountName: 'Nkechi Okoro', accountNumber: '0123 456 789' };
check(api.normalizeBank(bankMenu).accountNumber === '0123456789' && api.normalizeBank(bankMenu).bankName === 'GTBank', 'account numbers keep digits only and names are trimmed');
check(api.normalizeBank({ bankName: 'GTBank', accountName: 'N', accountNumber: '12345' }) === null && api.normalizeBank({ bankName: 'GTBank', accountName: '', accountNumber: '0123456789' }) === null && api.normalizeBank(undefined) === null, 'partial or non-10-digit bank details are dropped');
const bankDecoded = api.decodePayload(api.encodePayload(bankMenu));
check(bankDecoded.bank && bankDecoded.bank.accountNumber === '0123456789' && bankDecoded.bank.bankName === 'GTBank' && bankDecoded.bank.accountName === 'Nkechi Okoro' && bankDecoded.categories.length === decoded.categories.length && bankDecoded.name === decoded.name, 'bank details travel inside the link payload');
check(decoded.bank === null && !payload.includes('~b!') && api.encodePayload(bankMenu).includes('~b!GTBank!Nkechi+Okoro!0123456789'), 'menus without bank details stay bank-free; bank details take one compact record');
const transferMessage = api.buildOrderMessage(bankDecoded, lines, { mode: 'pickup', customer: 'Ada', pay: 'transfer', reference: 'JNP-7K3M' });
check(transferMessage.includes('Payment: bank transfer to 0123456789 (GTBank), reference JNP-7K3M'), 'transfer orders carry the account number and the reference');
check(api.buildOrderMessage(bankDecoded, lines, { mode: 'delivery', address: '1 Aba Road', pay: 'cash' }).includes('Payment: cash on delivery'), 'cash orders say cash on delivery');
check(!api.buildOrderMessage(decoded, lines, { mode: 'pickup', pay: 'transfer', reference: 'JNP-0000' }).includes('Payment:'), 'menus without bank details add no payment line');

// ---- Trial status ----
const day = 86400000, now = Date.parse('2026-10-02T12:00:00Z');
check(api.trialStatus('', now).state === 'not-started', 'no start date means the trial has not started');
check(api.trialStatus(new Date(now - 3 * day).toISOString(), now).state === 'trial' && api.trialStatus(new Date(now - 3 * day).toISOString(), now).daysLeft === 11, 'trial days left should count down from 14');
check(api.trialStatus(new Date(now - 20 * day).toISOString(), now).state === 'ended', 'trial should end after the configured days');

// ---- Customer reminder library ----
check(api.MESSAGE_LIBRARY.length >= 20 && api.MESSAGE_LIBRARY.every(message => message.text.length <= 160 && api.MESSAGE_SLOTS.some(([slot]) => slot === message.slot)), 'library should hold at least 20 SMS-length messages in known slots');
check(api.autoSlot(new Date(2026, 9, 5, 8)) === 'morning' && api.autoSlot(new Date(2026, 9, 5, 13)) === 'lunch' && api.autoSlot(new Date(2026, 9, 5, 19)) === 'evening' && api.autoSlot(new Date(2026, 9, 3, 12)) === 'weekend' && api.autoSlot(new Date(2026, 9, 5, 23)) === 'anytime', 'automatic slot should follow the time of day and the weekend');
const morning = api.pickMessage('auto', 'Mama Nkechi Kitchen', 0, new Date(2026, 9, 5, 8));
check(morning.slot === 'morning' && api.MESSAGE_LIBRARY.some(message => message.slot === 'morning' && message.text.replace('{name}', 'Mama Nkechi Kitchen') === morning.text), 'automatic pick should come from the morning pool');
check(api.pickMessage('evening', 'Mama Nkechi Kitchen', 0, new Date(2026, 9, 5, 8)).slot === 'evening', 'an explicit slot overrides the clock');
check(!api.pickMessage('missyou', 'Buka Express', 2, new Date(2026, 9, 5, 8)).text.includes('{name}'), 'placeholders must be replaced');
const seen = new Set(Array.from({ length: api.MESSAGE_LIBRARY.length }, (_, offset) => api.pickMessage('lunch', 'X', offset, new Date(2026, 9, 5, 13)).text));
check(seen.size === api.MESSAGE_LIBRARY.length, '"Another one" should walk through the whole library without repeats');
check(api.pickMessage('lunch', 'X', 0, new Date(2026, 9, 5, 13)).text === api.pickMessage('lunch', 'X', 0, new Date(2026, 9, 5, 14)).text && api.pickMessage('lunch', 'X', 0, new Date(2026, 9, 5, 13)).text !== api.pickMessage('lunch', 'X', 0, new Date(2026, 9, 6, 13)).text, 'the daily pick should be stable within a day and rotate the next day');
check(api.reminderText('👀 Psst... You hungry?', 'https://x.test/menu.html#m=abc').endsWith('order on WhatsApp: https://x.test/menu.html#m=abc'), 'reminder text should end with the menu link');

// ---- QR encoder: capacity table, decoder round trips, masks ----
const byteCapacityL = [17, 32, 53, 78, 106, 134, 154, 192, 230, 271, 321, 367, 425, 458, 520, 586, 644, 718, 792, 858, 929, 1003, 1091, 1171, 1273, 1367, 1465, 1528, 1628, 1732, 1840, 1952, 2068, 2188, 2303, 2431, 2563, 2699, 2809, 2953];
for (let version = 1; version <= 40; version++) {
  const filler = 'a'.repeat(byteCapacityL[version - 1]);
  check(api.encodeQr(filler).version === version, `version ${version} must hold ${byteCapacityL[version - 1]} bytes`);
  if (version < 40) check(api.encodeQr(`${filler}a`).version === version + 1, `one byte over version ${version} must move to the next version`);
}
let tooLong = false;
try { api.encodeQr('a'.repeat(2954)); } catch { tooLong = true; }
check(tooLong, 'links beyond version 40 must be rejected with a clear error');
function decodeMatrix(matrix) {
  const quiet = 4, scale = 4, size = matrix.length, width = (size + quiet * 2) * scale;
  const data = new Uint8ClampedArray(width * width * 4).fill(255);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (matrix[y][x]) {
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) { const index = (((y + quiet) * scale + dy) * width + (x + quiet) * scale + dx) * 4; data[index] = data[index + 1] = data[index + 2] = 0; }
  }
  return jsQR(data, width, width);
}
// Version 23 is skipped only because jsQR cannot read any version-23 symbol (the reference python-qrcode output fails the same way);
// the encoder output is verified bit-for-bit against python-qrcode separately.
for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22, 25, 28, 30, 33, 36, 40]) {
  const text = `https://x.io/menu.html#m=J1!Mama+Nkechi!2348012345678!~i!Jollof+rice!2500~k${'x'.repeat(3000)}`.slice(0, byteCapacityL[version - 1]);
  const matrix = api.encodeQr(text);
  const result = decodeMatrix(matrix);
  check(matrix.version === version && result && result.data === text, `version ${version} QR must decode back to the same link (mask ${matrix.mask})`);
}
const unicodeLink = 'https://x.io/menu.html#m=J1!Caf%C3%A9+%E2%82%A6!2348012345678!~k0a1';
for (let mask = 0; mask < 8; mask++) {
  const result = decodeMatrix(api.encodeQr(unicodeLink, { mask }));
  check(result && result.data === unicodeLink, `mask ${mask} must produce a readable code`);
}
const realLink = api.buildLink('https://dyceelvk.github.io/Juniper-foods/menu.html', { name: 'Mama Nkechi Kitchen', whatsapp: '08012345678', tagline: 'Wuse 2, Abuja', categories: [
  { name: 'Rice', items: [{ name: 'Jollof rice', price: 2500 }, { name: 'Fried rice', price: 2500, note: 'with plantain' }, { name: 'White rice & stew', price: 2000 }] },
  { name: 'Swallow & soups', items: [{ name: 'Eba & egusi', price: 2500 }, { name: 'Pounded yam & efo riro', price: 3500 }, { name: 'Amala & ewedu', price: 2500 }] },
  { name: 'Proteins', items: [{ name: 'Chicken', price: 2000 }, { name: 'Beef', price: 1000 }, { name: 'Fish', price: 1800 }] },
  { name: 'Drinks', items: [{ name: 'Zobo', price: 800 }, { name: 'Chapman', price: 1500 }, { name: 'Bottled water', price: 300 }] }
] }, '5');
const realMatrix = api.encodeQr(realLink);
const realResult = decodeMatrix(realMatrix);
check(realResult && realResult.data === realLink, 'a realistic 12-item menu link must scan');
check(realMatrix.version <= 14, `a realistic 12-item menu should stay a medium-density code, got version ${realMatrix.version} for ${realLink.length} characters`);
check(api.qrSvg(realMatrix, 'qr', 200).startsWith('<svg id="qr"') && api.qrDensity(realMatrix.version).cm >= 3, 'SVG output and print-size guidance must be available');

// ---- Seller setup view ----
check(app.innerHTML.includes('Your business') && app.innerHTML.includes('Your menu') && output.innerHTML.includes('Your code appears here'), 'first visit should show the setup editor and the readiness checklist');
check(output.innerHTML.includes('₦10,000') && output.innerHTML.includes('14-day free trial'), 'plan card should show the configurable price and trial');
type({ bind: 'name' }, 'Mama Nkechi Kitchen');
type({ bind: 'whatsapp' }, '0801 234 5678');
check(elements['wa-hint'].textContent.includes('+2348012345678'), 'WhatsApp hint should confirm the normalised number');
check(output.innerHTML.includes('Your code appears here'), 'no QR until the menu has an item');
click('load-sample');
check(app.innerHTML.includes('Pounded yam') && output.innerHTML.includes('<svg id="menu-qr"') && output.innerHTML.includes('SCAN TO ORDER'), 'sample menu should render items and a QR code');
check(output.innerHTML.includes('Print it at least') && output.innerHTML.includes('Preview as a customer'), 'QR panel should include print guidance and a preview link');
check(!output.innerHTML.includes('only works on this computer'), 'a public address must not trigger the local-address warning');
const saved = JSON.parse(localStorage.map.get('juniper.qrmenu.v1'));
check(saved.name === 'Mama Nkechi Kitchen' && saved.categories.length === 4 && saved.trialStartedAt, 'draft and trial start must be saved locally');
check(output.innerHTML.includes('Free trial · 14 days left'), 'plan card should show the running trial');
const reminders = elements.reminders;
check(reminders.innerHTML.includes('Remind your customers') && reminders.innerHTML.includes('Share on WhatsApp') && reminders.innerHTML.includes('#m='), 'reminder card should appear with a share button and the menu link once the menu is ready');
const firstReminder = reminders.innerHTML.match(/id="reminder-text">([^<]+)</)[1];
click('another-reminder');
check(reminders.innerHTML.match(/id="reminder-text">([^<]+)</)[1] !== firstReminder, '"Another one" should change the message');
click('reminder-slot', { slot: 'missyou' });
check(/misses you|been a while|stomach called/.test(reminders.innerHTML) && reminders.innerHTML.includes('aria-pressed="true">Miss you'), 'choosing a mood should pick from that pool');
type({ bind: 'shortLink' }, 'https://bit.ly/mama-nkechi');
check(reminders.innerHTML.includes('https://bit.ly/mama-nkechi') && !reminders.innerHTML.includes('#m='), 'a short link should replace the long menu link in reminders');
type({ bind: 'shortLink' }, '');
type({ bind: 'table' }, '7');
check(output.innerHTML.includes('TABLE 7') && /#m=[^"]+&amp;t=7/.test(output.innerHTML), 'table number should be shown and added to the link');
type({ bind: 'linkBase' }, 'http://localhost:4173/menu.html');
check(output.innerHTML.includes('only works on this computer'), 'a localhost address must warn before printing');
type({ bind: 'linkBase' }, '');
type({ ci: '0', ii: '0', prop: 'price' }, '2700', 'number');
const previewLink = output.innerHTML.match(/href="([^"]+#m=[^"]+)"/)[1].replace(/&amp;/g, '&');
check(api.decodePayload(api.parseFragment(previewLink).m).categories[0].items[0].price === 2700, 'edited prices should flow into the generated link');

// ---- Customer view ----
navigate(previewLink.slice(previewLink.indexOf('#')));
check(app.innerHTML.includes('<h1>Mama Nkechi Kitchen</h1>') && app.innerHTML.includes('Table 7') && app.innerHTML.includes('Jollof rice') && app.innerHTML.includes('₦2,700'), 'customer view should render the seller, table, and items from the link alone');
check(!app.innerHTML.includes('Your business') && !app.innerHTML.includes('Order on WhatsApp'), 'customer view hides the editor and the order bar until something is added');
check(app.innerHTML.includes('Make a QR menu for your own food business'), 'customer view should invite other sellers');
click('inc', { key: '0-0' }); click('inc', { key: '0-0' }); click('inc', { key: '3-0' });
check(app.innerHTML.includes('3 items') && app.innerHTML.includes('₦6,200') && app.innerHTML.includes('Order on WhatsApp'), 'cart bar should total the selected items');
check(JSON.parse([...sessionStorage.map.values()][0])['0-0'] === 2, 'cart should persist for the session');
click('open-sheet');
const sendHref = app.innerHTML.match(/id="send-order" href="([^"]+)"/)[1].replace(/&amp;/g, '&');
const sentMessage = decodeURIComponent(sendHref.split('?text=')[1]);
check(sendHref.startsWith('https://wa.me/2348012345678?text=') && sentMessage.includes('2 × Jollof rice — ₦5,400') && sentMessage.includes('1 × Zobo — ₦800') && sentMessage.includes('Total: ₦6,200') && sentMessage.includes('Table: 7'), `order sheet must link to the seller WhatsApp with the order:\n${sentMessage}`);
check(app.innerHTML.includes('Serve at table 7') && app.innerHTML.includes('Delivery'), 'order sheet should offer the table, pickup, and delivery options');
listeners.change({ target: { dataset: { order: 'mode' }, value: 'delivery' } });
check(elements['order-sheet'].innerHTML.includes('Delivery address') && elements['order-sheet'].innerHTML.includes('aria-disabled="true"'), 'delivery without an address must disable sending');
type({ order: 'address' }, '12 Allen Avenue, Ikeja');
check(elements['send-order'].href.includes(encodeURIComponent('Delivery to: 12 Allen Avenue, Ikeja')), 'typing the address should update the WhatsApp link live');
click('dec', { key: '0-0' }); click('dec', { key: '0-0' }); click('dec', { key: '3-0' });
check(!app.innerHTML.includes('Order on WhatsApp'), 'emptying the cart should hide the order bar');

// ---- Broken links and going back to setup ----
navigate('#m=J1!Broken!2348012345678!!pd~i!Rice!1000~k000');
check(app.innerHTML.includes("couldn't open this menu") && app.innerHTML.includes('damaged'), 'a tampered link should show a friendly error');
navigate('');
check(app.innerHTML.includes('Your business') && app.innerHTML.includes('Mama Nkechi Kitchen'), 'returning without a payload should reopen the saved editor');

// ---- Without Supabase config there is no publish button and #s= links explain themselves ----
check(!output.innerHTML.includes('Publish menu') && api.hosting() === null, 'link-mode builds must not show publishing');
navigate('#s=mama-nkechi-7k3');
check(app.innerHTML.includes('cannot open published menus'), 'link-mode builds should explain they cannot open hosted menus');
navigate('');

// ---- Hosted menus: a second page instance built with Supabase config and a fake Data API ----
const fakeDb = { rows: new Map(), failWith: '', takenOnce: false, calls: [] };
const jsonResponse = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
const fakeFetch = async (url, init = {}) => {
  fakeDb.calls.push({ url, init });
  if (fakeDb.failWith === 'network') throw new TypeError('Failed to fetch');
  check(init.headers.apikey === 'public-anon-key' && init.headers.Authorization === 'Bearer public-anon-key', 'requests must carry the anon key');
  check(url.startsWith('https://example.supabase.co/rest/v1/rpc/'), `only RPC endpoints may be called: ${url}`);
  if (url.includes('/rpc/get_qr_menu?p_slug=')) {
    const row = fakeDb.rows.get(decodeURIComponent(url.split('p_slug=')[1]));
    return jsonResponse(200, row ? { slug: row.slug, name: row.name, whatsapp: row.whatsapp, tagline: row.tagline, pickup: row.pickup, delivery: row.delivery, categories: row.categories, bank: row.bank || { bankName: '', accountName: '', accountNumber: '' }, verified: false, version: row.version, updated_at: 'now' } : null);
  }
  if (url.endsWith('/rpc/save_qr_menu') && init.method === 'POST') {
    const { p_slug, p_edit_key, p_menu } = JSON.parse(init.body);
    check(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p_slug) && p_edit_key.length >= 16 && Array.isArray(p_menu.categories), 'publish requests must be well formed');
    const existing = fakeDb.rows.get(p_slug);
    if (fakeDb.takenOnce && !existing) { fakeDb.takenOnce = false; return jsonResponse(403, { code: '42501', message: 'This link name is already taken, or your edit key does not match it.' }); }
    if (existing && existing.key !== p_edit_key) return jsonResponse(403, { code: '42501', message: 'This link name is already taken, or your edit key does not match it.' });
    const row = { ...p_menu, slug: p_slug, key: p_edit_key, version: existing ? existing.version + 1 : 1 };
    fakeDb.rows.set(p_slug, row);
    return jsonResponse(200, { slug: p_slug, version: row.version, updated_at: 'now' });
  }
  return jsonResponse(404, { message: 'unknown route' });
};
function hostedSession(fetchImpl = fakeFetch) {
  const local = makeStorage(), session = makeStorage(), nodes = {};
  const node = id => nodes[id] || (nodes[id] = { ...element(`hosted-${id}`), id, listeners: {} });
  ['app', 'toast', 'output', 'wa-hint', 'bank-hint', 'send-order', 'order-sheet', 'link-details', 'reminders', 'account', 'publish-box'].forEach(node);
  const loc = { origin: 'https://juniper-foods.vercel.app', pathname: '/menu.html', hash: '', get href() { return `${this.origin}${this.pathname}${this.hash}`; } };
  const winListeners = {};
  const win = { addEventListener: (name, fn) => { winListeners[name] = fn; }, open() {}, scrollTo() {}, JUNIPER_CONFIG: { supabaseUrl: 'https://example.supabase.co/', supabaseKey: 'public-anon-key' } };
  const ctx = { console, document: { getElementById: id => nodes[id] || null, createElement: () => ({ getContext: () => null, style: {} }), body: { appendChild() {} } }, window: win, location: loc, localStorage: local, sessionStorage: session, navigator: {}, URL, URLSearchParams, TextEncoder, FormData: class {}, setTimeout: () => 1, clearTimeout() {}, Blob, prompt() {}, confirm: () => true, fetch: fetchImpl, crypto: globalThis.crypto, AbortController, history: { replaceState() { loc.hash = ''; } } };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  const l = nodes.app.listeners;
  return {
    api: win.JuniperQrMenu, app: nodes.app, output: nodes.output, reminders: nodes.reminders, nodes, local, session,
    click: (action, dataset = {}) => l.click({ target: { closest: selector => (selector === '[data-action]' ? { dataset: { ...dataset, action } } : null) }, preventDefault() {} }),
    type: (dataset, value, type = 'text') => l.input({ target: { dataset, value, type, checked: Boolean(value) } }),
    navigate: async hash => { loc.hash = hash; winListeners.hashchange(); await win.JuniperQrMenu.pending(); },
    submit: fields => l.submit({ preventDefault() {}, target: { id: 'account-form', querySelector: selector => ({ value: fields[selector.match(/name=(\w+)/)[1]] ?? '' }) } }),
    change: (dataset, value) => l.change({ target: { dataset, value } })
  };
}
const settle = async () => { for (let i = 0; i < 60; i++) await new Promise(resolve => setImmediate(resolve)); };
const hosted = hostedSession();
check(hosted.api.hosting().url === 'https://example.supabase.co', 'config from the build must be picked up (trailing slash trimmed)');
check(hosted.api.cleanSlug(' Mama-Nkechi-7k3 ') === 'mama-nkechi-7k3' && hosted.api.cleanSlug('bad slug') === '' && hosted.api.cleanSlug('ab') === '' && hosted.api.cleanSlug('-x-') === '', 'slugs are lowercase words joined by single dashes');
check(hosted.api.slugBase("Mama Nkechi's Kitchen & Grill") === 'mama-nkechi-kitchen' && hosted.api.slugBase('!!!') === 'menu', 'slug base keeps up to three real words');
check(/^[23456789a-hj-kmnp-z]{26}$/.test(hosted.api.randomToken(26)) && hosted.api.randomToken(8) !== hosted.api.randomToken(8), 'edit keys are long random tokens without look-alike characters');

hosted.type({ bind: 'name' }, 'Mama Nkechi Kitchen');
hosted.type({ bind: 'whatsapp' }, '0801 234 5678');
hosted.click('load-sample');
check(hosted.output.innerHTML.includes('Make this code permanent') && hosted.output.innerHTML.includes('data-action="publish"') && hosted.output.innerHTML.includes('#s=mama-nkechi-kitchen-7k3'), 'hosted builds offer publishing with an example link');
check(/href="[^"]+#m=/.test(hosted.output.innerHTML), 'before publishing the QR still carries the menu inside the link');
check(hosted.reminders.innerHTML.includes('publish your menu'), 'reminders nudge towards publishing while the link is long');
fakeDb.takenOnce = true;
await hosted.click('publish');
const hostedDraft = JSON.parse(hosted.local.map.get('juniper.qrmenu.v1'));
check(/^mama-nkechi-kitchen-[23456789a-hj-kmnp-z]{3}$/.test(hostedDraft.slug) && hostedDraft.editKey.length === 26 && hostedDraft.publishedAt && hostedDraft.publishedSum, `publishing should store the slug and edit key locally (got ${hostedDraft.slug})`);
check(fakeDb.calls.filter(call => call.url.endsWith('/rpc/save_qr_menu')).length === 2, 'a taken name should be retried with a fresh suffix');
check(fakeDb.rows.get(hostedDraft.slug).categories.length === 4 && fakeDb.rows.get(hostedDraft.slug).whatsapp === '2348012345678', 'the normalised menu is what gets published');
const permanentLink = `https://juniper-foods.vercel.app/#s=${hostedDraft.slug}`; // the app lives at the site root, so codes use the short address
check(hosted.output.innerHTML.includes('Published — this code is permanent') && hosted.output.innerHTML.includes(`href="${permanentLink}"`) && !/#m=/.test(hosted.output.innerHTML), 'after publishing the QR and preview use the short permanent link');
check(hosted.reminders.innerHTML.includes(permanentLink) && !hosted.reminders.innerHTML.includes('#m='), 'reminders use the permanent link too');
check(hosted.api.encodeQr(permanentLink).version <= 5, 'permanent links fit in a simple QR');
hosted.type({ bind: 'table' }, '4');
check(hosted.output.innerHTML.includes(`href="${permanentLink}&amp;t=4"`), 'table codes add the table to the permanent link');
hosted.type({ bind: 'table' }, '');
hosted.type({ ci: '0', ii: '0', prop: 'price' }, '2900', 'number');
check(hosted.output.innerHTML.includes('You have unpublished changes') && hosted.output.innerHTML.includes('Publish changes') && hosted.output.innerHTML.includes(`href="${permanentLink}"`), 'edits after publishing are flagged, the link stays the same');
await hosted.click('publish');
check(fakeDb.rows.get(hostedDraft.slug).version === 2 && fakeDb.rows.get(hostedDraft.slug).categories[0].items[0].price === 2900 && hosted.output.innerHTML.includes('Published — this code is permanent'), 'publishing again updates the same slug with the same key');
fakeDb.rows.get(hostedDraft.slug).key = 'someone-else-holds-the-key-now';
hosted.type({ ci: '0', ii: '0', prop: 'price' }, '3100', 'number');
await hosted.click('publish');
check(hosted.output.innerHTML.includes("edit key doesn't match") && hosted.output.innerHTML.includes('data-action="publish-new"'), 'a key mismatch is explained and offers a new link');
await hosted.click('publish-new');
const movedDraft = JSON.parse(hosted.local.map.get('juniper.qrmenu.v1'));
check(movedDraft.slug !== hostedDraft.slug && fakeDb.rows.get(movedDraft.slug).version === 1 && hosted.output.innerHTML.includes(movedDraft.slug) && !hosted.output.innerHTML.includes('publish-new'), 'publishing under a new link creates a fresh slug');
fakeDb.failWith = 'network';
hosted.type({ ci: '0', ii: '0', prop: 'price' }, '3200', 'number');
await hosted.click('publish');
check(hosted.output.innerHTML.includes("Couldn't reach Juniper's server") && hosted.output.innerHTML.includes('Publish changes'), 'network failures keep the changes and say so');
fakeDb.failWith = '';

// ---- Customers opening a published menu ----
await hosted.navigate(`#s=${movedDraft.slug}&t=3`);
check(hosted.app.innerHTML.includes('<h1>Mama Nkechi Kitchen</h1>') && hosted.app.innerHTML.includes('Table 3') && hosted.app.innerHTML.includes('₦3,100') && hosted.app.innerHTML.includes('Zobo'), 'customers see the published menu fetched by slug');
check(hosted.session.map.has(`juniper.qrmenu.hosted.${movedDraft.slug}`), 'the fetched menu is cached for this tab');
hosted.click('inc', { key: '0-0' });
check(hosted.app.innerHTML.includes('Order on WhatsApp') && [...hosted.session.map.keys()].some(key => key.startsWith('juniper.qrmenu.cart.')), 'ordering works exactly like link mode');
await hosted.navigate('');
await hosted.navigate('#s=nobody-here-9z9');
check(hosted.app.innerHTML.includes('no longer published'), 'an unknown slug gets a clear message');
await hosted.navigate('#s=Bad Slug!');
check(hosted.app.innerHTML.includes('not valid'), 'malformed slugs are rejected before any request');
fakeDb.failWith = 'network';
await hosted.navigate(`#s=${movedDraft.slug}`);
check(hosted.app.innerHTML.includes('<h1>Mama Nkechi Kitchen</h1>'), 'a cached menu still shows when the network is down');
hosted.session.map.clear();
await hosted.navigate('');
await hosted.navigate(`#s=${movedDraft.slug}`);
check(hosted.app.innerHTML.includes('load this menu. Check your internet') && hosted.app.innerHTML.includes('data-action="retry"'), 'no cache and no network gives a retry screen');
fakeDb.failWith = '';
hosted.click('retry');
await hosted.api.pending();
check(hosted.app.innerHTML.includes('<h1>Mama Nkechi Kitchen</h1>'), 'retry reloads the menu');

// ---- Seller accounts: sign up → username is the permanent code → bank details → customer pays by transfer ----
// A tiny stand-in for Supabase Auth (GoTrue) + the account RPCs, enforcing the same rules as the migration.
const auth = { users: new Map(), tokens: new Map(), sellers: new Map(), menus: new Map(), confirm: false, calls: [] };
const authSession = user => { const token = `tok-${auth.tokens.size + 1}`; auth.tokens.set(token, user.id); return { access_token: token, refresh_token: `ref-${token}`, expires_in: 3600, token_type: 'bearer', user: { id: user.id, email: user.email, user_metadata: user.metadata } }; };
const authMenu = row => ({ slug: row.slug, name: row.menu.name, whatsapp: row.menu.whatsapp, tagline: row.menu.tagline, pickup: row.menu.pickup, delivery: row.menu.delivery, categories: row.menu.categories, bank: row.menu.bank || { bankName: '', accountName: '', accountNumber: '' }, verified: Boolean(row.owner), version: row.version, updated_at: 'now' });
const authFetch = async (url, init = {}) => {
  const path = url.replace('https://example.supabase.co', ''); auth.calls.push(`${init.method || 'GET'} ${path}`);
  const body = init.body ? JSON.parse(init.body) : {};
  check(init.headers.apikey === 'public-anon-key', 'every request carries the anon key');
  const bearer = String(init.headers.Authorization || '').replace('Bearer ', ''); const uid = auth.tokens.get(bearer) || null;
  if (path.startsWith('/auth/v1/signup')) {
    check(path.includes('redirect_to=https%3A%2F%2Fjuniper-foods.vercel.app%2F') && body.data.username && body.data.name, 'sign-up sends the page as redirect target and keeps name/username/phone in metadata');
    if (auth.users.has(body.email)) return jsonResponse(400, { code: 400, msg: 'User already registered' });
    const user = { id: `user-${auth.users.size + 1}`, email: body.email, password: body.password, metadata: body.data }; auth.users.set(body.email, user);
    return auth.confirm ? jsonResponse(200, { id: user.id, email: user.email, confirmation_sent_at: 'now' }) : jsonResponse(200, authSession(user));
  }
  if (path.startsWith('/auth/v1/token?grant_type=password')) { const user = auth.users.get(body.email); return user && user.password === body.password ? jsonResponse(200, authSession(user)) : jsonResponse(400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }); }
  if (path.startsWith('/auth/v1/logout')) return { ok: true, status: 204, text: async () => '' };
  if (path.startsWith('/auth/v1/user')) { const user = [...auth.users.values()].find(entry => entry.id === uid); return user ? jsonResponse(200, { id: user.id, email: user.email, user_metadata: user.metadata }) : jsonResponse(401, { msg: 'invalid token' }); }
  if (path === '/rest/v1/rpc/my_qr_seller') { if (!uid) return jsonResponse(401, { message: 'permission denied' }); const me = auth.sellers.get(uid); return jsonResponse(200, me ? { id: uid, ...me, phoneVerified: false, menus: [...auth.menus.values()].filter(row => row.owner === uid).map(authMenu) } : null); }
  if (path === '/rest/v1/rpc/register_qr_seller') {
    if (!uid) return jsonResponse(401, { message: 'permission denied' });
    if (auth.sellers.has(uid)) return jsonResponse(200, { id: uid, ...auth.sellers.get(uid), phoneVerified: false, menus: [] });
    if ([...auth.sellers.values()].some(entry => entry.username === body.p_username)) return jsonResponse(409, { code: '23505', message: 'That username is taken. Try another one.' });
    auth.sellers.set(uid, { username: body.p_username, name: body.p_name, phone: body.p_phone }); return jsonResponse(200, { id: uid, ...auth.sellers.get(uid), phoneVerified: false, menus: [] });
  }
  if (path.startsWith('/rest/v1/rpc/get_qr_menu?p_slug=')) { const row = auth.menus.get(decodeURIComponent(path.split('p_slug=')[1])); return jsonResponse(200, row ? authMenu(row) : null); }
  if (path === '/rest/v1/rpc/save_qr_menu') {
    const { p_slug, p_edit_key, p_menu } = body; const existing = auth.menus.get(p_slug);
    if (existing) { if (!((existing.key && existing.key === p_edit_key) || (uid && existing.owner === uid))) return jsonResponse(403, { code: '42501', message: 'taken or key mismatch' }); existing.menu = p_menu; existing.version += 1; existing.owner = existing.owner || uid; return jsonResponse(200, { slug: p_slug, version: existing.version }); }
    if ([...auth.sellers.entries()].some(([id, entry]) => entry.username === p_slug && id !== uid)) return jsonResponse(403, { code: '42501', message: 'belongs to another seller' });
    auth.menus.set(p_slug, { slug: p_slug, key: p_edit_key, owner: uid, menu: p_menu, version: 1 }); return jsonResponse(200, { slug: p_slug, version: 1 });
  }
  return jsonResponse(404, { message: `unknown ${path}` });
};
const acct = hostedSession(authFetch);
check(acct.app.innerHTML.includes('id="account-form"') && ['name', 'username', 'phone', 'email', 'password'].every(name => acct.app.innerHTML.includes(`name="${name}"`)), 'hosted builds open with the create-account form (name, username, phone, email, password)');
check(!app.innerHTML.includes('id="account-form"') && app.innerHTML.includes('Sign-up is not switched on for this address yet'), 'link-mode builds show no sign-up form but say plainly why');
acct.submit({ name: 'Nkechi Okoro', username: 'Mama Nkechi!', phone: '0801 234 5678', email: 'nkechi@gmail.com', password: 'longenough1' }); await settle();
check(acct.nodes.account.outerHTML.includes('Pick a username') && auth.users.size === 0, 'bad usernames are explained before anything is sent');
acct.submit({ name: 'Nkechi Okoro', username: 'Mama-Nkechi', phone: '0801 234 5678', email: 'nkechi@gmail.com', password: 'longenough1' }); await settle();
check(auth.sellers.get('user-1')?.username === 'mama-nkechi' && auth.sellers.get('user-1').phone === '2348012345678', 'sign-up creates the auth user and registers the seller (username lowercased, phone normalised)');
check(acct.app.innerHTML.includes('@mama-nkechi') && acct.app.innerHTML.includes('https://juniper-foods.vercel.app/#s=mama-nkechi') && acct.app.innerHTML.includes('Your permanent code'), 'the permanent code appears on the profile right after sign-up');
check(acct.api.seller().username === 'mama-nkechi' && acct.api.session().access_token && acct.local.map.has('juniper.qrmenu.session.v1'), 'the session is kept on this device');
check(acct.app.innerHTML.includes('value="2348012345678"') && acct.app.innerHTML.includes('id="bank-number"'), 'the account phone prefills WhatsApp and the bank fields are in step 1');
acct.type({ bind: 'name' }, 'Mama Nkechi Kitchen');
acct.type({ bind: 'bankName' }, 'GTBank'); acct.type({ bind: 'accountNumber' }, '0123-456-789');
check(acct.nodes['bank-hint'].textContent.includes('Fill in all three'), 'incomplete bank details are flagged live');
acct.type({ bind: 'accountName' }, 'Nkechi Okoro');
check(acct.nodes['bank-hint'].textContent.includes('0123456789 · GTBank · Nkechi Okoro'), 'complete bank details are confirmed live');
acct.click('load-sample');
check(acct.output.innerHTML.includes('your permanent link is') && acct.output.innerHTML.includes('#s=mama-nkechi</code>'), 'the publish box promises the username link');
await acct.click('publish'); await settle();
const ownedRow = auth.menus.get('mama-nkechi');
check(ownedRow && ownedRow.owner === 'user-1' && ownedRow.menu.bank.accountNumber === '0123456789' && auth.calls.filter(call => call.endsWith('/rpc/save_qr_menu')).length === 1, 'signed-in sellers publish straight under their username with bank details, no retries');
check(acct.output.innerHTML.includes('Published — this code is permanent') && acct.output.innerHTML.includes('href="https://juniper-foods.vercel.app/#s=mama-nkechi"') && acct.nodes.account.outerHTML.includes('Your permanent code is live'), 'QR, preview and account card all use the username link');
check(auth.calls.slice(-3).some(call => call.startsWith('POST /rest/v1/rpc/save_qr_menu')) && JSON.parse(acct.local.map.get('juniper.qrmenu.v1')).slug === 'mama-nkechi', 'the draft remembers the username slug');

// Customer: bank transfer with a reference, or cash
await acct.navigate('#s=mama-nkechi');
check(acct.app.innerHTML.includes('<h1>Mama Nkechi Kitchen</h1>'), 'customers open the username link');
acct.click('inc', { key: '0-0' }); acct.click('open-sheet');
const sheet = acct.app.innerHTML;
check(sheet.includes('Transfer ₦2,500 to') && sheet.includes('<strong>0123456789</strong>') && sheet.includes('GTBank · Nkechi Okoro') && /JNP-[2-9A-HJ-KMNP-Z]{4}/.test(sheet) && sheet.includes('data-action="copy-account"'), 'checkout shows the account, a copy button and an order reference');
const transferHref = decodeURIComponent(sheet.match(/id="send-order" href="([^"]+)"/)[1].replace(/&amp;/g, '&'));
check(/Payment: bank transfer to 0123456789 \(GTBank\), reference JNP-[2-9A-HJ-KMNP-Z]{4}/.test(transferHref), 'the WhatsApp order carries the same reference');
acct.change({ order: 'pay' }, 'cash');
const cashSheet = acct.nodes['order-sheet'].innerHTML;
check(decodeURIComponent(cashSheet.match(/id="send-order" href="([^"]+)"/)[1].replace(/&amp;/g, '&')).includes('Payment: cash on pickup') && !cashSheet.includes('Transfer ₦') && cashSheet.includes('value="cash" data-order="pay" checked'), 'choosing cash drops the account box and says cash');
await acct.navigate('');

// Sign out, then a fresh device signs in and gets the published menu back without any edit key
await acct.click('sign-out'); await settle();
check(!acct.api.session() && acct.app.innerHTML.includes('id="account-form"') && !acct.local.map.has('juniper.qrmenu.session.v1'), 'signing out forgets the session');
const device2 = hostedSession(authFetch);
device2.click('account-mode', { mode: 'signin' });
device2.submit({ email: 'nkechi@gmail.com', password: 'nope' }); await settle();
check(device2.nodes.account.outerHTML.includes('Invalid login credentials'), 'a wrong password is reported');
device2.submit({ email: 'nkechi@gmail.com', password: 'longenough1' }); await settle();
const device2Draft = JSON.parse(device2.local.map.get('juniper.qrmenu.v1'));
check(device2.app.innerHTML.includes('@mama-nkechi') && device2Draft.name === 'Mama Nkechi Kitchen' && device2Draft.slug === 'mama-nkechi' && device2Draft.accountNumber === '0123456789' && !device2Draft.editKey, 'a new device loads the published menu and bank details from the account');
check(device2.output.innerHTML.includes('Published — this code is permanent'), 'ownership counts as published, no edit key needed');
device2.type({ bind: 'tagline' }, 'Wuse 2 · open daily');
await device2.click('publish'); await settle();
check(auth.menus.get('mama-nkechi').version === 2 && auth.menus.get('mama-nkechi').menu.tagline === 'Wuse 2 · open daily', 'the new device publishes changes by ownership');

// A menu published anonymously before the account existed moves to the username; the old code keeps updating
const device3 = hostedSession(authFetch);
device3.type({ bind: 'name' }, 'Chop Life Buka'); device3.type({ bind: 'whatsapp' }, '08099887766'); device3.click('load-sample');
await device3.click('publish'); await settle();
const anonSlug = [...auth.menus.keys()].find(key => key.startsWith('chop-life-buka'));
check(anonSlug && auth.menus.get(anonSlug).owner === null, 'anonymous publishing still works without an account');
device3.submit({ name: 'Tunde Bello', username: 'tunde', phone: '', email: 'tunde@gmail.com', password: 'longenough3' }); await settle();
check(device3.app.innerHTML.includes('@tunde') && device3.output.innerHTML.includes('Move this menu to your permanent code') && device3.output.innerHTML.includes('Publish under my username'), 'after signing up the publish box offers to move the menu to the username');
await device3.click('publish'); await settle();
check(auth.menus.get('tunde')?.owner === 'user-2' && auth.menus.get(anonSlug).version === 2 && device3.output.innerHTML.includes('#s=tunde"') && device3.nodes.account.outerHTML.includes('Your permanent code is live'), 'the menu moves to the username and the old link is refreshed too');

// Username clashes and the email-confirmation path
const device4 = hostedSession(authFetch);
device4.submit({ name: 'Other Person', username: 'tunde', phone: '', email: 'other@gmail.com', password: 'longenough4' }); await settle();
check(device4.nodes.account.outerHTML.includes('Choose your username') && device4.nodes.account.outerHTML.includes('username is taken') && auth.users.has('other@gmail.com'), 'a taken username asks for another one after the account is created');
device4.submit({ username: 'other-kitchen', name: 'Other Person', phone: '' }); await settle();
check(auth.sellers.get('user-3')?.username === 'other-kitchen' && device4.app.innerHTML.includes('@other-kitchen'), 'the second username choice registers');
auth.confirm = true;
const device5 = hostedSession(authFetch);
device5.submit({ name: 'Bola Ade', username: 'bola', phone: '', email: 'bola@gmail.com', password: 'longenough5' }); await settle();
check(device5.nodes.account.outerHTML.includes('open the email we sent to bola@gmail.com') && device5.local.map.has('juniper.qrmenu.pending-signup.v1'), 'confirm-email projects explain the next step and keep the sign-up details');
const bola = authSession(auth.users.get('bola@gmail.com'));
await device5.navigate(`#access_token=${bola.access_token}&refresh_token=${bola.refresh_token}&expires_in=3600&token_type=bearer&type=signup`); await settle();
check(auth.sellers.get('user-4')?.username === 'bola' && device5.app.innerHTML.includes('@bola') && !device5.local.map.has('juniper.qrmenu.pending-signup.v1'), 'the email link signs in and registers the pending username');

console.log('QR menu payload round trip, QR encoder (all 40 versions), WhatsApp order link, customer reminders, seller setup, customer views, hosted (Supabase) publishing, seller accounts, and bank-transfer checkout passed.');
