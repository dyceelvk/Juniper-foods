import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../preview.html', import.meta.url), 'utf8');
const inlineScript = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
assert.ok(inlineScript, 'inline app script exists');

const buyer = { name: 'Test Buyer', email: 'buyer@example.com', role: 'buyer', approved: true };
const riders = {
  rNear: { id: 'rNear', name: 'Ada Rider', ownerEmail: 'ada@example.com', phone: '+2348012345678', vehicle: 'Motorcycle', serviceArea: 'Yaba', latitude: 6.5254, longitude: 3.3792, serviceRadiusKm: 2, baseFee: 1500, active: true, available: true },
  rFar: { id: 'rFar', name: 'Bola Rider', ownerEmail: 'bola@example.com', phone: '+2348098765432', vehicle: 'Bicycle', serviceArea: 'Ikeja', latitude: 6.60, longitude: 3.40, serviceRadiusKm: 1, baseFee: 1000, active: true, available: true },
  rNoPin: { id: 'rNoPin', name: 'Chidi Rider', ownerEmail: 'chidi@example.com', vehicle: 'Car', serviceArea: 'Lagos Central', serviceRadiusKm: 10, active: true, available: true },
  rPaused: { id: 'rPaused', name: 'Dami Rider', vehicle: 'Van', serviceArea: 'Lekki', latitude: 6.45, longitude: 3.55, serviceRadiusKm: 20, active: true, available: false }
};
const storage = new Map(Object.entries({
  'juniper.v2.user': buyer,
  'juniper.v2.accounts': [buyer],
  'juniper.v2.riders': riders,
  'juniper.v2.cart': { 'suya-bowl': 1 }
}).map(([key, value]) => [key, JSON.stringify(value)]));
const localStorage = {
  getItem: key => storage.has(key) ? storage.get(key) : null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: key => storage.delete(key)
};
const listeners = {};
const app = { innerHTML: '', addEventListener: (name, handler) => { listeners[name] = handler; } };
const toast = { textContent: '', classList: { add() {}, remove() {} } };
const searchInput = { focus() {}, setSelectionRange() {} };
const document = { getElementById: id => id === 'app' ? app : id === 'toast' ? toast : id === 'rider-search' ? searchInput : null };
const location = { origin: 'http://test.local', pathname: '/', hash: '#/riders' };
let locationRequests = 0;
const navigator = { geolocation: { getCurrentPosition: success => { locationRequests++; success({ coords: { latitude: 6.5244, longitude: 3.3792 } }); } } };
const window = { addEventListener: (name, handler) => { listeners[`window:${name}`] = handler; }, open() {} };
class FormDataStub { constructor(form) { this.fields = form.fields || {}; } get(key) { return this.fields[key] ?? null; } }
const context = { console, document, window, location, navigator, localStorage, URL, URLSearchParams, TextEncoder, FormData: FormDataStub, setTimeout: () => 1, clearTimeout() {}, Blob, XMLSerializer: function () {} };
vm.createContext(context);
vm.runInContext(inlineScript, context);

const setRoute = hash => { location.hash = hash; listeners['window:hashchange'](); };
const click = (action, dataset = {}) => listeners.click({ target: { closest: selector => selector === '[data-scroll]' ? null : selector === '[data-action]' ? { dataset: { ...dataset, action } } : null } });

assert.equal(locationRequests, 0, 'the app must not request location before the user asks');
setRoute('#/riders');
assert.match(app.innerHTML, /Find a delivery rider/);
assert.match(app.innerHTML, /Search name, neighborhood, or transport/);
assert.match(app.innerHTML, /Ada Rider/);
assert.match(app.innerHTML, /Bola Rider/);
assert.match(app.innerHTML, /Chidi Rider/);
assert.doesNotMatch(app.innerHTML, /Dami Rider/, 'paused riders must not appear in available search');

listeners.input({ target: { id: 'rider-search', value: 'ikeja', selectionStart: 5 } });
assert.match(app.innerHTML, /Bola Rider/);
assert.doesNotMatch(app.innerHTML, /Ada Rider/, 'search should filter by rider service area');
listeners.input({ target: { id: 'rider-search', value: '', selectionStart: 0 } });

click('use-location');
assert.equal(locationRequests, 1, 'location should only be requested after the location button is clicked');
assert.match(app.innerHTML, /Within service area/);
assert.match(app.innerHTML, /Outside service area/);
assert.match(app.innerHTML, /No map pin/);
assert.match(app.innerHTML, /Coverage unverified/);

setRoute('#/riders?from=checkout');
assert.match(app.innerHTML, /Selected · use this rider/);
assert.match(app.innerHTML, /Outside delivery range/);
click('select-rider-for-delivery', { id: 'rNear' });
assert.equal(location.hash, '/checkout', 'choosing a rider from checkout should return to checkout');
setRoute(location.hash);
assert.match(app.innerHTML, /Nearest available rider/);
assert.match(app.innerHTML, /href="#\/rider-profile\/rNear"/, 'checkout profile link should use the public rider-profile route');

setRoute('#/rider-profile/rNear');
assert.match(app.innerHTML, /Approved delivery rider/);
setRoute('#/rider/rNear');
assert.match(app.innerHTML, /Approved delivery rider/, 'legacy rider links should still resolve to the public profile');

console.log('Rider directory, text search, explicit geolocation, coverage filtering, checkout selection, and profile links passed.');
