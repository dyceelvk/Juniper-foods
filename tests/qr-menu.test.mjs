// Single-seller QR menu (menu.html): payload round-trips, QR encoder verification, WhatsApp order link, and view smoke tests.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const jsQR = require('jsqr');
const html = readFileSync(new URL('../menu.html', import.meta.url), 'utf8');
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1];

// ---- Minimal DOM/browser stand-ins (same style as the other Juniper tests) ----
const makeStorage = () => { const map = new Map(); return { getItem: key => (map.has(key) ? map.get(key) : null), setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map }; };
const localStorage = makeStorage(), sessionStorage = makeStorage();
const elements = {};
const element = id => elements[id] || (elements[id] = { id, innerHTML: '', textContent: '', className: '', value: '', open: false, href: '', listeners: {}, classList: { add() {}, remove() {}, toggle() {} }, addEventListener(name, fn) { this.listeners[name] = fn; }, setAttribute() {}, removeAttribute() {}, focus() {}, setSelectionRange() {} });
['app', 'toast', 'output', 'wa-hint', 'send-order', 'order-sheet', 'link-details'].forEach(element);
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

// ---- Trial status ----
const day = 86400000, now = Date.parse('2026-10-02T12:00:00Z');
check(api.trialStatus('', now).state === 'not-started', 'no start date means the trial has not started');
check(api.trialStatus(new Date(now - 3 * day).toISOString(), now).state === 'trial' && api.trialStatus(new Date(now - 3 * day).toISOString(), now).daysLeft === 11, 'trial days left should count down from 14');
check(api.trialStatus(new Date(now - 20 * day).toISOString(), now).state === 'ended', 'trial should end after the configured days');

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

console.log('QR menu payload round trip, QR encoder (all 40 versions), WhatsApp order link, seller setup, and customer views passed.');
