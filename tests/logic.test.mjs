// Pruebas de la lógica de la tienda: búsqueda, filtros, orden, disponibilidad y carrito.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeText, escapeHtml, money, parseNumber, resolveImage } from '../js/utils.js';
import { availableUnits, presentationsOf, checkCapacity, effectivePrice, isSoldOut, stockAlerts, inventoryValue } from '../js/inventory.js';
import { DEFAULT_FILTERS, filterProducts, sortProducts, relatedProducts, searchableText } from '../js/catalog.js';
import { resolveCart, maxQtyFor, buildWhatsAppMessage, cartLinesForMessage, whatsappUrl } from '../js/cart.js';

const catalog = JSON.parse(readFileSync(new URL('../data/catalogo.json', import.meta.url), 'utf8'))
  .map((p) => ({ ...p, _search: searchableText(p) }));
const f = (over) => ({ ...structuredClone(DEFAULT_FILTERS), ...over });

const P = (over = {}) => ({
  sku: 'T-1', name: 'Prueba', brand: 'Marca', gender: 'Masculino', perfume_type: 'Diseñador', description: '',
  price_bottle: 3000, price_5ml: 250, price_10ml: 450, discount_pct: 0, stock_bottles: 1, stock_5ml: 0, stock_10ml: 0,
  decant_ml: 100, low_stock_threshold: 1, status: 'Activo', ...over,
});

test('utilidades: acentos, HTML, moneda, números e imágenes', () => {
  assert.equal(normalizeText('  ÁRABE  Niño '), 'arabe nino');
  assert.equal(escapeHtml('<img src=x onerror="a">'), '&lt;img src=x onerror=&quot;a&quot;&gt;');
  assert.equal(money(1234), 'L. 1,234');
  assert.equal(money(99.5), 'L. 99.50');
  assert.equal(parseNumber('L. 1,250.00'), 1250);
  assert.equal(parseNumber(''), null);
  assert.ok(Number.isNaN(parseNumber('abc')));
  assert.equal(resolveImage('images/A B.jpg', { siteRoot: '../' }), '../images/A%20B.jpg');
  assert.equal(resolveImage('foto.webp', { storageBase: 'https://x.supabase.co/storage/v1/object/public/b/' }), 'https://x.supabase.co/storage/v1/object/public/b/foto.webp');
  assert.equal(resolveImage('https://cdn/x.jpg'), 'https://cdn/x.jpg');
});

test('búsqueda sin importar mayúsculas ni acentos', () => {
  const r1 = filterProducts(catalog, f({ q: 'SAUVAGE' }));
  const r2 = filterProducts(catalog, f({ q: 'sauvage' }));
  assert.ok(r1.length >= 3);
  assert.equal(r1.length, r2.length);
  assert.equal(filterProducts(catalog, f({ q: 'arabe' })).length, filterProducts(catalog, f({ q: 'ÁRABE' })).length);
  assert.ok(filterProducts(catalog, f({ q: 'dior sauvage' })).every((p) => p.brand === 'Dior'));
});

test('filtros por categoría, tipo, marca, presentación y precio', () => {
  const fem = filterProducts(catalog, f({ genders: ['Femenino'] }));
  assert.ok(fem.length > 0 && fem.every((p) => p.gender === 'Femenino'));
  const arab = filterProducts(catalog, f({ types: ['Árabe'] }));
  assert.ok(arab.length > 0 && arab.every((p) => p.perfume_type === 'Árabe'));
  const ch = filterProducts(catalog, f({ brand: 'Carolina Herrera' }));
  assert.ok(ch.every((p) => p.brand === 'Carolina Herrera'));
  const d10 = filterProducts(catalog, f({ presentation: '10ml' }));
  assert.ok(d10.every((p) => Number(p.price_10ml) > 0));
  const cheap = filterProducts(catalog, f({ max: 2000 }));
  assert.ok(cheap.every((p) => Math.min(...presentationsOf(p).map((x) => x.price)) <= 2000));
  const coming = filterProducts(catalog, f({ availability: 'coming' }));
  assert.ok(coming.length > 0 && coming.every((p) => p.status === 'Próximamente'));
});

test('ordenamiento por precio y alfabético', () => {
  const asc = sortProducts(catalog, 'price-asc');
  const low = (p) => Math.min(...presentationsOf(p).map((x) => x.price));
  for (let i = 1; i < asc.length; i++) assert.ok(low(asc[i - 1]) <= low(asc[i]));
  const az = sortProducts(catalog, 'name-asc');
  for (let i = 1; i < az.length; i++) assert.ok(az[i - 1].name.localeCompare(az[i].name, 'es', { sensitivity: 'base' }) <= 0);
  const rel = relatedProducts(catalog.find((p) => p.name === 'SAUVAGE DIOR PARFUM'), catalog);
  assert.ok(rel.length > 0 && rel.every((p) => p.sku !== 'AJ-0008'));
});

test('disponibilidad: botellas separadas del líquido; 5 y 10 ml comparten líquido', () => {
  const p = P({ stock_bottles: 2, decant_ml: 85, stock_5ml: 1 });
  assert.equal(availableUnits(p, 'botella'), 2);
  assert.equal(availableUnits(p, '5ml'), 1 + 17);
  assert.equal(availableUnits(p, '10ml'), 8);
  assert.equal(checkCapacity(p, 0, 1, 8), null, '1 preparado + 80 ml');
  assert.equal(checkCapacity(p, 0, 2, 8), null, '1 preparado + 5 ml + 80 ml = 85 ml exactos');
  assert.match(checkCapacity(p, 0, 3, 8), /no hay suficiente/);
  assert.match(checkCapacity(p, 3, 0, 0), /2 botella/);
  assert.equal(effectivePrice(3000, 15), 2550);
  assert.equal(isSoldOut(P({ stock_bottles: 0, decant_ml: 4 })), true);
  assert.deepEqual(stockAlerts(P({ stock_bottles: 0, decant_ml: 10 }), 20), ['Sin botellas selladas', 'Poco líquido para decants']);
  assert.equal(inventoryValue(P({ stock_bottles: 1, decant_ml: 20 })), 3000 + 20 * 45);
});

test('carrito: validación por producto, máximos y mensaje de WhatsApp', () => {
  const p = P({ sku: 'A', name: 'Perfume A', brand: 'Marca A', stock_bottles: 1, decant_ml: 20, discount_pct: 10 });
  const by = new Map([[p.sku, p]]);
  let items = [{ sku: 'A', presentation: '10ml', qty: 2 }];
  assert.equal(maxQtyFor(items, 'A', '5ml', p), 0, 'el líquido ya está comprometido');
  items = [{ sku: 'A', presentation: '10ml', qty: 1 }, { sku: 'A', presentation: '5ml', qty: 2 }, { sku: 'A', presentation: 'botella', qty: 1 }];
  const ok = resolveCart(items, by);
  assert.equal(ok.valid, true);
  assert.equal(ok.total, 405 + 2 * 225 + 2700);
  const over = resolveCart([...items, { sku: 'GONE', presentation: 'botella', qty: 1 }], by);
  assert.equal(over.valid, false);
  const tooMuch = resolveCart([{ sku: 'A', presentation: '10ml', qty: 3 }], by);
  assert.equal(tooMuch.valid, false);

  const msg = buildWhatsAppMessage({ lines: cartLinesForMessage(ok), total: ok.total, code: 'AJ-1', customer: 'Ana' });
  assert.match(msg, /Pedido N\.º AJ-1/);
  assert.match(msg, /1\) Perfume A\n {3}Marca: Marca A\n {3}Presentación: Decant 10 ml\n {3}Cantidad: 1\n {3}Precio unitario: L\. 405\n {3}Subtotal: L\. 405/);
  assert.match(msg, /TOTAL DEL PEDIDO: L\. 3,555/);
  const url = whatsappUrl('50496278653', msg);
  assert.ok(url.startsWith('https://wa.me/50496278653?text='));
  assert.ok(!url.includes('%250A'), 'los saltos de línea no quedan doblemente codificados');
  assert.equal(decodeURIComponent(url.split('text=')[1]), msg);
});
