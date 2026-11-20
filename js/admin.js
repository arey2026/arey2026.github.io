// =====================================================================
// AJRO HOUSE · Panel administrativo
// Todas las operaciones se validan además en el servidor (RLS + funciones SQL).
// =====================================================================
import { CONFIG } from './config.js';
import { getBackend } from './api.js';
import { escapeHtml as h, money, resolveImage, debounce, normalizeText, formatDate } from './utils.js';
import { availableUnits, stockAlerts, inventoryValue, isSoldOut } from './inventory.js';
import { buildWorkbook, parseWorkbook, buildImportPlan, toImportPayload, validateRow, validateNew, FIELD_LABELS } from './excel-schema.js';

const EXCELJS_URL = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const state = {
  backend: null,
  user: null,
  products: [],
  movements: [],
  orders: [],
  images: [],
  editing: null,
  importPlan: null,
  tab: 'resumen',
};

const KIND_LABELS = {
  entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', apertura: 'Apertura de botella',
  preparacion: 'Preparación de decants', venta: 'Venta', anulacion: 'Anulación', importacion: 'Importación',
};
const TAB_TITLES = { resumen: 'Resumen', productos: 'Productos', existencias: 'Existencias', pedidos: 'Pedidos', excel: 'Excel', imagenes: 'Imágenes' };

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
function toast(msg, type = 'info', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function imageOf(p) {
  const b = state.backend;
  return (b?.resolveTestImage && b.resolveTestImage(p.image)) || resolveImage(p.image, { siteRoot: '../', storageBase: b?.storageBase || '' });
}

const signed = (n, unit = '') => (n > 0 ? `+${n}${unit}` : n < 0 ? `${n}${unit}` : '—');
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

function show(viewId) {
  ['#view-loading', '#view-setup', '#view-login', '#view-denied', '#view-panel'].forEach((v) => { $(v).hidden = v !== viewId; });
}

let confirmResolver = null;
function confirmDialog(title, text, okLabel = 'Confirmar') {
  return new Promise((resolve) => {
    const d = $('#confirm-dialog');
    $('#cd-title').textContent = title;
    $('#cd-text').textContent = text;
    $('#cd-ok').textContent = okLabel;
    confirmResolver = resolve;
    d.showModal();
  });
}

function settleConfirm(ok) {
  const d = $('#confirm-dialog');
  if (d.open) d.close();
  if (confirmResolver) { const r = confirmResolver; confirmResolver = null; r(ok); }
}

async function busy(btn, label, fn) {
  const original = btn?.innerHTML;
  if (btn) { btn.disabled = true; btn.textContent = label; }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.innerHTML = original; } }
}

let excelJsPromise = null;
function loadExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (!excelJsPromise) {
    excelJsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = EXCELJS_URL;
      s.onload = () => resolve(window.ExcelJS);
      s.onerror = () => { excelJsPromise = null; reject(new Error('No se pudo cargar el módulo de Excel. Revisa tu conexión a internet.')); };
      document.head.appendChild(s);
    });
  }
  return excelJsPromise;
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------
// Autenticación
// ---------------------------------------------------------------------
async function route() {
  if (state.backend.mode === 'static') { show('#view-setup'); return; }
  const user = await state.backend.getUser();
  state.user = user;
  if (!user) { show('#view-login'); $('#login-email').focus(); return; }
  let admin = false;
  try { admin = await state.backend.isAdmin(); } catch (e) { toast(e.message, 'error'); }
  if (!admin) { $('#denied-email').textContent = user.email || ''; show('#view-denied'); return; }
  $('#user-email').textContent = user.email || '';
  $('#backend-mode').textContent = state.backend.mode === 'pglite' ? 'Modo de PRUEBAS local (PGlite)' : 'Conectado a Supabase';
  show('#view-panel');
  await refreshAll();
}

async function login(e) {
  e.preventDefault();
  const email = $('#login-email').value.trim();
  const password = $('#login-password').value;
  const err = $('#login-error');
  err.textContent = '';
  if (!email || !password) { err.textContent = 'Escribe tu correo y tu contraseña.'; return; }
  await busy($('#login-submit'), 'Verificando…', async () => {
    try {
      await state.backend.signIn(email, password);
      $('#login-password').value = '';
      await route();
    } catch (ex) {
      err.textContent = ex.message;
    }
  });
}

async function logout() {
  await state.backend.signOut();
  state.products = []; state.movements = []; state.orders = [];
  show('#view-login');
}

// ---------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------
async function refreshAll() {
  try {
    const [products, movements, orders] = await Promise.all([
      state.backend.listProducts(),
      state.backend.listMovements(300),
      state.backend.listOrders(200),
    ]);
    state.products = products;
    state.movements = movements;
    state.orders = orders;
    state.images = await state.backend.listImages().catch(() => []);
  } catch (e) {
    toast(`No se pudieron cargar los datos: ${e.message}`, 'error', 6000);
  }
  renderAll();
}

function renderAll() {
  renderStats();
  renderProducts();
  renderStock();
  renderMovements();
  renderOrders();
  renderImages();
  $('#brand-list').innerHTML = [...new Set(state.products.map((p) => p.brand))].sort().map((b) => `<option value="${h(b)}">`).join('');
  $('#image-list').innerHTML = state.images.map((i) => `<option value="${h(i.name)}">`).join('');
  const pending = state.orders.filter((o) => o.status === 'pendiente').length;
  $('#pending-pill').hidden = pending === 0;
  $('#pending-pill').textContent = pending;
}

// ---------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------
function renderStats() {
  const ps = state.products;
  const active = ps.filter((p) => p.status === 'Activo');
  const soldOut = active.filter((p) => isSoldOut(p));
  const low = active.filter((p) => !isSoldOut(p) && stockAlerts(p, CONFIG.LOW_DECANT_ML).length);
  const value = ps.reduce((s, p) => s + inventoryValue(p), 0);
  const liquid = ps.reduce((s, p) => s + num(p.decant_ml), 0);
  const bottles = ps.reduce((s, p) => s + num(p.stock_bottles), 0);
  const pending = state.orders.filter((o) => o.status === 'pendiente').length;
  const confirmed = state.orders.filter((o) => o.status === 'confirmado');
  const stats = [
    ['Perfumes registrados', ps.length, ''],
    ['Productos activos', active.length, ''],
    ['Agotados', soldOut.length, soldOut.length ? 'warn' : ''],
    ['Pocas existencias', low.length, low.length ? 'warn' : ''],
    ['Botellas selladas', bottles, ''],
    ['Líquido para decants', `${liquid.toLocaleString('es-HN')} ml`, ''],
    ['Valor estimado del inventario', money(value), 'gold', 'A precio de venta, sin descuentos.'],
    ['Pedidos pendientes', pending, pending ? 'gold' : ''],
    ['Ventas confirmadas', `${confirmed.length} · ${money(confirmed.reduce((s, o) => s + num(o.total), 0))}`, '', 'Suma de pedidos confirmados registrados en el sistema.'],
  ];
  $('#stats').innerHTML = stats.map(([label, value, cls, title]) =>
    `<div class="stat ${cls}" ${title ? `title="${h(title)}"` : ''}><span>${h(label)}</span><strong>${h(value)}</strong></div>`).join('');

  const alerts = ps.filter((p) => p.status !== 'Inactivo')
    .map((p) => ({ p, a: stockAlerts(p, CONFIG.LOW_DECANT_ML) }))
    .filter((x) => x.a.length)
    .sort((x, y) => x.p.name.localeCompare(y.p.name));
  $('#alerts-list').innerHTML = alerts.length
    ? `<ul class="list">${alerts.slice(0, 40).map(({ p, a }) => `<li><button class="link" data-action="movement" data-id="${p.id}">${h(p.name)}</button>
        <span class="tags">${a.map((t) => `<span class="tag warn">${h(t)}</span>`).join('')}</span></li>`).join('')}</ul>
        ${alerts.length > 40 ? `<p class="muted small">…y ${alerts.length - 40} más (ver pestaña Existencias).</p>` : ''}`
    : '<p class="muted">No hay alertas de existencias.</p>';

  const recent = state.movements.slice(0, 10);
  $('#recent-moves').innerHTML = recent.length
    ? `<ul class="list">${recent.map((m) => `<li><span><strong>${h(KIND_LABELS[m.kind])}</strong> · ${h(m.product_name)}</span>
        <span class="muted small">${h(formatDate(m.created_at))}</span></li>`).join('')}</ul>`
    : '<p class="muted">Aún no hay movimientos registrados.</p>';
}

// ---------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------
function renderProducts() {
  const q = normalizeText($('#prod-search').value);
  const status = $('#prod-status').value;
  const alert = $('#prod-alert').value;
  const list = state.products.filter((p) => {
    if (q && !normalizeText(`${p.sku} ${p.name} ${p.brand}`).includes(q)) return false;
    if (status && p.status !== status) return false;
    if (alert === 'soldout' && !isSoldOut(p)) return false;
    if (alert === 'low' && !stockAlerts(p, CONFIG.LOW_DECANT_ML).length) return false;
    if (alert === 'featured' && !p.featured) return false;
    if (alert === 'offer' && !(num(p.discount_pct) > 0)) return false;
    return true;
  }).sort((a, b) => a.name.localeCompare(b.name));
  $('#prod-count').textContent = `${list.length} de ${state.products.length} perfumes`;
  $('#products-table tbody').innerHTML = list.map((p) => {
    const img = imageOf(p);
    const prices = [['Bot.', p.price_bottle], ['5 ml', p.price_5ml], ['10 ml', p.price_10ml]]
      .filter(([, v]) => num(v) > 0).map(([l, v]) => `${l} ${money(v)}`).join('<br>') || '<span class="muted">Sin precio</span>';
    return `<tr>
      <td>${img ? `<img class="thumb" src="${h(img)}" alt="" loading="lazy">` : '<span class="thumb empty"></span>'}</td>
      <td class="mono">${h(p.sku)}</td>
      <td><strong>${h(p.name)}</strong><br><span class="muted small">${h(p.brand)}${num(p.discount_pct) ? ` · <span class="tag gold">−${h(p.discount_pct)}%</span>` : ''}${p.is_new ? ' · <span class="tag">Nuevo</span>' : ''}</span></td>
      <td class="small">${h(p.gender)}<br><span class="muted">${h(p.perfume_type)}</span></td>
      <td class="small nowrap">${prices}</td>
      <td class="small nowrap">${num(p.stock_bottles)} bot. · ${num(p.decant_ml)} ml${num(p.stock_5ml) || num(p.stock_10ml) ? `<br>${num(p.stock_5ml)}×5 ml · ${num(p.stock_10ml)}×10 ml` : ''}${isSoldOut(p) ? '<br><span class="tag warn">Agotado</span>' : ''}</td>
      <td><button class="status-btn st-${normalizeText(p.status)}" data-action="cycle-status" data-id="${p.id}" title="Cambiar estado">${h(p.status)}</button></td>
      <td><button class="star${p.featured ? ' on' : ''}" data-action="toggle-featured" data-id="${p.id}" aria-pressed="${p.featured}" aria-label="Destacado">★</button></td>
      <td class="nowrap actions">
        <button class="btn btn-sm" data-action="edit" data-id="${p.id}">Editar</button>
        <button class="btn btn-sm" data-action="movement" data-id="${p.id}">Inventario</button>
        <button class="btn btn-sm btn-danger-ghost" data-action="delete" data-id="${p.id}" aria-label="Eliminar ${h(p.name)}">Eliminar</button>
      </td></tr>`;
  }).join('') || '<tr><td colspan="9" class="muted center-text">No hay perfumes con esos filtros.</td></tr>';
}

function nextSku() {
  const nums = state.products.map((p) => /^AJ-(\d+)$/.exec(p.sku)).filter(Boolean).map((m) => Number(m[1]));
  return `AJ-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')}`;
}

function openProductForm(product = null) {
  state.editing = product;
  const f = $('#product-form');
  f.reset();
  $('#pd-errors').innerHTML = '';
  $('#pd-title').textContent = product ? `Editar: ${product.name}` : 'Nuevo perfume';
  const defaults = { status: 'Activo', gender: 'Masculino', perfume_type: 'Diseñador', low_stock_threshold: 1, discount_pct: 0, sku: nextSku() };
  const data = product || defaults;
  ['sku', 'name', 'brand', 'gender', 'perfume_type', 'description', 'price_bottle', 'price_5ml', 'price_10ml', 'bottle_ml',
    'discount_pct', 'low_stock_threshold', 'status', 'image'].forEach((k) => {
    if (f.elements[k]) f.elements[k].value = data[k] ?? '';
  });
  f.elements.featured.checked = Boolean(data.featured);
  f.elements.is_new.checked = Boolean(data.is_new);
  $('#pd-stock-new').hidden = Boolean(product);
  $('#pd-stock-existing').hidden = !product;
  if (product) {
    $('#pd-stock-existing').innerHTML = `Existencias actuales: <strong>${num(product.stock_bottles)}</strong> botella(s) sellada(s),
      <strong>${num(product.decant_ml)} ml</strong> para decants, ${num(product.stock_5ml)} decant(s) de 5 ml y ${num(product.stock_10ml)} de 10 ml preparados.
      Para cambiarlas usa <em>Inventario</em> (queda registrado en el historial).`;
  }
  updateImagePreview();
  $('#product-dialog').showModal();
  f.elements[product ? 'name' : 'sku'].focus();
}

function updateImagePreview() {
  const v = $('#product-form').elements.image.value.trim();
  const img = $('#pd-preview');
  const src = v ? imageOf({ image: v }) : '';
  img.hidden = !src;
  if (src) img.src = src;
}

async function saveProduct(e) {
  e.preventDefault();
  const f = $('#product-form');
  const raw = {};
  ['sku', 'name', 'brand', 'gender', 'perfume_type', 'description', 'price_bottle', 'price_5ml', 'price_10ml', 'bottle_ml',
    'discount_pct', 'low_stock_threshold', 'status', 'image', 'stock_bottles', 'decant_ml', 'stock_5ml', 'stock_10ml']
    .forEach((k) => { raw[k] = f.elements[k]?.value ?? ''; });
  raw.featured = f.elements.featured.checked ? 'Sí' : 'No';
  raw.is_new = f.elements.is_new.checked ? 'Sí' : 'No';
  const { data, errors } = validateRow(raw);
  if (!state.editing) errors.push(...validateNew(data));
  const dup = state.products.find((p) => p.sku === data.sku && p.id !== state.editing?.id);
  if (dup) errors.push({ field: 'SKU', message: `El SKU ${data.sku} ya pertenece a "${dup.name}".` });
  if (errors.length) {
    $('#pd-errors').innerHTML = errors.map((x) => `<li><strong>${h(x.field)}:</strong> ${h(x.message)}</li>`).join('');
    return;
  }
  // Campos vacíos -> valores por defecto
  const payload = {
    ...data,
    description: data.description ?? '',
    image: data.image ?? '',
    price_bottle: data.price_bottle ?? 0, price_5ml: data.price_5ml ?? 0, price_10ml: data.price_10ml ?? 0,
    discount_pct: data.discount_pct ?? 0, low_stock_threshold: data.low_stock_threshold ?? 1,
  };
  if (state.editing) {
    ['stock_bottles', 'decant_ml', 'stock_5ml', 'stock_10ml'].forEach((k) => delete payload[k]);
  } else {
    ['stock_bottles', 'decant_ml', 'stock_5ml', 'stock_10ml'].forEach((k) => { payload[k] = payload[k] ?? 0; });
  }
  await busy($('#pd-save'), 'Guardando…', async () => {
    try {
      if (state.editing) await state.backend.updateProduct(state.editing.id, payload);
      else await state.backend.insertProduct(payload);
      $('#product-dialog').close();
      toast(state.editing ? 'Perfume actualizado.' : 'Perfume registrado. Ya aparece en la tienda.', 'ok');
      await refreshAll();
    } catch (ex) {
      $('#pd-errors').innerHTML = `<li>${h(ex.message)}</li>`;
    }
  });
}

async function uploadFormImage(file) {
  try {
    const name = await uploadImageFile(file);
    $('#product-form').elements.image.value = name;
    updateImagePreview();
    toast(`Foto subida: ${name}`, 'ok');
    state.images = await state.backend.listImages().catch(() => state.images);
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function cycleStatus(id) {
  const p = state.products.find((x) => x.id === id);
  const order = ['Activo', 'Inactivo', 'Próximamente'];
  const next = order[(order.indexOf(p.status) + 1) % order.length];
  try {
    await state.backend.updateProduct(id, { status: next });
    toast(`${p.name}: ${next}.`, 'ok');
    await refreshAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleFeatured(id) {
  const p = state.products.find((x) => x.id === id);
  try {
    await state.backend.updateProduct(id, { featured: !p.featured });
    await refreshAll();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteProduct(id) {
  const p = state.products.find((x) => x.id === id);
  const ok = await confirmDialog('Eliminar perfume',
    `¿Eliminar "${p.name}" (${p.sku}) de forma permanente? El historial de movimientos se conserva. Si solo quieres ocultarlo de la tienda, cambia su estado a "Inactivo".`,
    'Eliminar definitivamente');
  if (!ok) return;
  try {
    await state.backend.deleteProduct(id);
    toast('Perfume eliminado.', 'ok');
    await refreshAll();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------------------------------------------------------------
// Existencias y movimientos
// ---------------------------------------------------------------------
function renderStock() {
  const q = normalizeText($('#stock-search').value);
  const onlyAlerts = $('#stock-alerts-only').checked;
  const rows = state.products
    .filter((p) => (!q || normalizeText(`${p.sku} ${p.name} ${p.brand}`).includes(q)))
    .map((p) => ({ p, a: stockAlerts(p, CONFIG.LOW_DECANT_ML) }))
    .filter((x) => !onlyAlerts || x.a.length)
    .sort((x, y) => x.p.name.localeCompare(y.p.name));
  $('#stock-table tbody').innerHTML = rows.map(({ p, a }) => `<tr class="${p.status === 'Inactivo' ? 'dim' : ''}">
    <td class="mono">${h(p.sku)}</td>
    <td>${h(p.name)}<br><span class="muted small">${h(p.brand)}${p.bottle_ml ? ` · ${h(p.bottle_ml)} ml/botella` : ''}</span></td>
    <td class="num">${num(p.stock_bottles)}</td>
    <td class="num">${num(p.decant_ml)}</td>
    <td class="num">${num(p.stock_5ml)}</td>
    <td class="num">${num(p.stock_10ml)}</td>
    <td class="num">${num(p.price_5ml) > 0 ? availableUnits(p, '5ml') : '—'} / ${num(p.price_10ml) > 0 ? availableUnits(p, '10ml') : '—'}</td>
    <td>${a.map((t) => `<span class="tag warn">${h(t)}</span>`).join(' ')}</td>
    <td class="nowrap"><button class="btn btn-sm" data-action="movement" data-id="${p.id}">Movimiento</button>
      ${num(p.stock_bottles) > 0 ? `<button class="btn btn-sm" data-action="open-bottle" data-id="${p.id}">Abrir botella</button>` : ''}</td>
  </tr>`).join('') || '<tr><td colspan="9" class="muted center-text">Sin resultados.</td></tr>';
}

function renderMovements() {
  const kind = $('#moves-kind').value;
  const rows = state.movements.filter((m) => !kind || m.kind === kind).slice(0, 300);
  $('#moves-table tbody').innerHTML = rows.map((m) => `<tr>
    <td class="small nowrap">${h(formatDate(m.created_at))}</td>
    <td>${h(m.product_name)}<br><span class="muted small mono">${h(m.sku)}</span></td>
    <td><span class="tag k-${m.kind}">${h(KIND_LABELS[m.kind] || m.kind)}</span></td>
    <td class="num">${signed(m.bottles_delta)}</td>
    <td class="num">${signed(Number(m.decant_ml_delta))}</td>
    <td class="num">${signed(m.stock_5ml_delta)}</td>
    <td class="num">${signed(m.stock_10ml_delta)}</td>
    <td class="small nowrap">${m.bottles_after} bot. · ${Number(m.decant_ml_after)} ml</td>
    <td class="small">${h(m.note || '')}</td>
  </tr>`).join('') || '<tr><td colspan="9" class="muted center-text">Sin movimientos.</td></tr>';
}

function openStockDialog(id = null, kind = 'entrada') {
  const sel = $('#sd-product');
  sel.innerHTML = state.products.slice().sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => `<option value="${p.id}">${h(p.name)} · ${h(p.sku)}</option>`).join('');
  if (id) sel.value = id;
  const f = $('#stock-form');
  f.reset();
  if (id) sel.value = id;
  f.querySelector(`input[name="kind"][value="${kind}"]`).checked = true;
  $('#sd-error').textContent = '';
  updateStockDialog();
  $('#stock-dialog').showModal();
}

function stockDialogValues() {
  const f = $('#stock-form');
  const p = state.products.find((x) => x.id === f.elements.product.value);
  const kind = f.elements.kind.value;
  const v = (n) => num(f.elements[n].value);
  let d = { bottles: 0, ml: 0, s5: 0, s10: 0 };
  if (kind === 'entrada') d = { bottles: v('bottles'), ml: v('ml'), s5: v('s5'), s10: v('s10') };
  if (kind === 'salida') d = { bottles: -v('bottles'), ml: -v('ml'), s5: -v('s5'), s10: -v('s10') };
  if (kind === 'ajuste' && p) {
    const target = (n, cur) => (f.elements[n].value === '' ? cur : v(n));
    d = {
      bottles: target('bottles', num(p.stock_bottles)) - num(p.stock_bottles),
      ml: Math.round((target('ml', num(p.decant_ml)) - num(p.decant_ml)) * 10) / 10,
      s5: target('s5', num(p.stock_5ml)) - num(p.stock_5ml),
      s10: target('s10', num(p.stock_10ml)) - num(p.stock_10ml),
    };
  }
  if (kind === 'apertura' && p) d = { bottles: -v('count'), ml: v('count') * num(p.bottle_ml), s5: 0, s10: 0 };
  if (kind === 'preparacion') {
    const size = v('size'); const n = v('pcount');
    d = { bottles: 0, ml: -size * n, s5: size === 5 ? n : 0, s10: size === 10 ? n : 0 };
  }
  return { p, kind, d, note: f.elements.note.value.trim() };
}

function updateStockDialog() {
  const { p, kind, d } = stockDialogValues();
  const help = {
    entrada: 'Suma existencias (compra o reposición). Escribe solo lo que entra.',
    salida: 'Resta existencias (rotura, regalo, venta fuera de la tienda…). Escribe cantidades positivas.',
    ajuste: 'Escribe las cantidades CORRECTAS según tu conteo físico. Los campos vacíos no cambian.',
    apertura: 'Resta botellas selladas y suma su contenido al líquido para decants.',
    preparacion: 'Pasa líquido a frascos de decant ya llenos.',
  };
  $('#sd-help').textContent = help[kind];
  $('#sd-qty').hidden = !['entrada', 'salida', 'ajuste'].includes(kind);
  $('#sd-open').hidden = kind !== 'apertura';
  $('#sd-prepare').hidden = kind !== 'preparacion';
  if (!p) { $('#sd-current').innerHTML = ''; return; }
  $('#sd-current').innerHTML = `Actual: <strong>${num(p.stock_bottles)}</strong> botella(s) · <strong>${num(p.decant_ml)} ml</strong> · ${num(p.stock_5ml)}×5 ml · ${num(p.stock_10ml)}×10 ml${p.bottle_ml ? ` <span class="muted">(botella de ${p.bottle_ml} ml)</span>` : ' <span class="muted">(sin tamaño de botella registrado)</span>'}`;
  const after = {
    b: num(p.stock_bottles) + d.bottles, ml: Math.round((num(p.decant_ml) + d.ml) * 10) / 10,
    s5: num(p.stock_5ml) + d.s5, s10: num(p.stock_10ml) + d.s10,
  };
  const bad = after.b < 0 || after.ml < 0 || after.s5 < 0 || after.s10 < 0;
  $('#sd-preview').innerHTML = `Resultado: <strong>${after.b}</strong> botella(s) · <strong>${after.ml} ml</strong> · ${after.s5}×5 ml · ${after.s10}×10 ml
    ${bad ? '<br><span class="tag warn">No hay existencias suficientes para este movimiento.</span>' : ''}`;
  $('#sd-save').disabled = bad;
}

async function saveMovement(e) {
  e.preventDefault();
  const { p, kind, d, note } = stockDialogValues();
  const f = $('#stock-form');
  if (!p) return;
  $('#sd-error').textContent = '';
  await busy($('#sd-save'), 'Registrando…', async () => {
    try {
      if (kind === 'apertura') await state.backend.openBottle(p.id, num(f.elements.count.value), note);
      else if (kind === 'preparacion') await state.backend.prepareDecants(p.id, num(f.elements.size.value), num(f.elements.pcount.value), note);
      else await state.backend.adjustStock(p.id, kind, d, note);
      $('#stock-dialog').close();
      toast('Movimiento registrado.', 'ok');
      await refreshAll();
    } catch (ex) {
      $('#sd-error').textContent = ex.message;
    }
  });
}

// ---------------------------------------------------------------------
// Pedidos
// ---------------------------------------------------------------------
function renderOrders() {
  const st = $('#orders-status').value;
  const q = normalizeText($('#orders-search').value);
  const list = state.orders.filter((o) => (!st || o.status === st)
    && (!q || normalizeText(`${o.code} ${o.customer_name || ''}`).includes(q)));
  $('#orders-list').innerHTML = list.map((o) => `<article class="order card">
    <div class="order-head">
      <div><strong class="mono">${h(o.code)}</strong> <span class="tag st-${o.status}">${h(o.status)}</span></div>
      <span class="muted small">${h(formatDate(o.created_at))}</span>
    </div>
    ${o.customer_name ? `<p class="small">Cliente: <strong>${h(o.customer_name)}</strong></p>` : ''}
    ${o.note ? `<p class="small muted">Comentario: ${h(o.note)}</p>` : ''}
    <table class="table compact"><tbody>${(o.items || []).map((i) => `<tr>
      <td>${h(i.name)} <span class="muted small">· ${h(i.brand)}</span></td><td>${h(i.label)}</td>
      <td class="num">${h(i.qty)} × ${money(i.unit_price)}</td><td class="num"><strong>${money(i.subtotal)}</strong></td></tr>`).join('')}</tbody></table>
    <div class="order-foot">
      <strong>Total: ${money(o.total)}</strong>
      <div class="row-actions">
        ${o.status === 'pendiente' ? `<button class="btn btn-gold btn-sm" data-action="confirm-order" data-id="${o.id}">Confirmar venta</button>` : ''}
        ${o.status !== 'cancelado' ? `<button class="btn btn-sm btn-danger-ghost" data-action="cancel-order" data-id="${o.id}">Cancelar</button>` : ''}
      </div>
    </div>
  </article>`).join('') || '<p class="muted">No hay pedidos en esta vista.</p>';
}

async function confirmOrder(id, btn) {
  const o = state.orders.find((x) => x.id === id);
  const ok = await confirmDialog('Confirmar venta', `¿Confirmar el pedido ${o.code} por ${money(o.total)}? Se descontarán las existencias correspondientes.`, 'Confirmar venta');
  if (!ok) return;
  await busy(btn, 'Confirmando…', async () => {
    try {
      await state.backend.confirmOrder(id);
      toast(`Pedido ${o.code} confirmado. Existencias actualizadas.`, 'ok');
      await refreshAll();
    } catch (e) { toast(e.message, 'error', 7000); }
  });
}

async function cancelOrder(id, btn) {
  const o = state.orders.find((x) => x.id === id);
  const extra = o.status === 'confirmado' ? ' Las existencias descontadas se devolverán al inventario.' : '';
  const ok = await confirmDialog('Cancelar pedido', `¿Cancelar el pedido ${o.code}?${extra}`, 'Cancelar pedido');
  if (!ok) return;
  await busy(btn, 'Cancelando…', async () => {
    try {
      await state.backend.cancelOrder(id);
      toast(`Pedido ${o.code} cancelado.`, 'ok');
      await refreshAll();
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------------
// Excel: plantilla, exportación e importación
// ---------------------------------------------------------------------
async function downloadTemplate(btn) {
  await busy(btn, 'Generando…', async () => {
    try {
      const ExcelJS = await loadExcelJS();
      const wb = buildWorkbook(ExcelJS, []);
      downloadBlob(new Blob([await wb.xlsx.writeBuffer()]), 'Plantilla_Inventario_AJRO_HOUSE.xlsx');
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function exportExcel(btn) {
  await busy(btn, 'Generando…', async () => {
    try {
      const ExcelJS = await loadExcelJS();
      await refreshAll();
      const sorted = state.products.slice().sort((a, b) => a.sku.localeCompare(b.sku));
      const wb = buildWorkbook(ExcelJS, sorted, { exportedAt: new Date() });
      downloadBlob(new Blob([await wb.xlsx.writeBuffer()]), `Inventario_AJRO_HOUSE_${today()}.xlsx`);
      toast(`Exportados ${sorted.length} perfumes.`, 'ok');
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function handleImportFile(file) {
  const box = $('#import-preview');
  if (!file) return;
  if (!/\.xlsx$/i.test(file.name)) { toast('Elige un archivo de Excel con extensión .xlsx.', 'error'); return; }
  if (file.size > 10 * 1024 * 1024) { toast('El archivo es demasiado grande (máximo 10 MB).', 'error'); return; }
  box.innerHTML = '<div class="card"><p>Leyendo el archivo…</p></div>';
  try {
    const ExcelJS = await loadExcelJS();
    await refreshAll();
    const parsed = await parseWorkbook(ExcelJS, await file.arrayBuffer());
    const plan = buildImportPlan(parsed, state.products);
    // Imágenes que no existen en el almacenamiento
    const known = new Set(state.images.map((i) => i.name));
    [...plan.added, ...plan.modified].forEach((it) => {
      const img = it.data.image;
      if (img && !img.includes('/') && !/^https?:/i.test(img) && state.backend.mode !== 'pglite' && !known.has(img)) {
        plan.warnings.push({ row: it.rowNumber, sku: it.data.sku, field: 'Imagen', message: `La foto "${img}" no está en la pestaña Imágenes. Súbela con ese mismo nombre.` });
      }
    });
    // Archivo antiguo: hubo movimientos después de exportarlo
    plan.staleMoves = 0;
    if (parsed.exportedAt && plan.modified.some((m) => m.stockChanged)) {
      plan.staleMoves = await state.backend.countMovementsSince(parsed.exportedAt).catch(() => 0);
    }
    plan.fileName = file.name;
    plan.exportedAt = parsed.exportedAt;
    plan.unknownHeaders = parsed.unknownHeaders;
    state.importPlan = plan;
    renderImportPreview();
  } catch (e) {
    box.innerHTML = `<div class="card error-card"><h2>No se pudo leer el archivo</h2><p>${h(e.message)}</p><p class="muted">Verifica que sea un archivo .xlsx guardado desde Excel y que use la plantilla de AJRO HOUSE.</p></div>`;
  }
}

function fmtVal(key, v) {
  if (v === null || v === undefined || v === '') return '<span class="muted">(vacío)</span>';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (key.startsWith('price')) return money(v);
  return h(v);
}

function renderImportPreview() {
  const plan = state.importPlan;
  const box = $('#import-preview');
  if (!plan) { box.innerHTML = ''; return; }
  const total = plan.added.length + plan.modified.length;
  const errRows = new Set(plan.errors.map((e) => e.row)).size;
  box.innerHTML = `<div class="card preview">
    <div class="card-head"><h2>Vista previa: ${h(plan.fileName)}</h2><button class="btn btn-sm" data-action="cancel-import">Descartar</button></div>
    ${plan.exportedAt ? `<p class="muted small">Archivo exportado desde el panel: ${h(formatDate(plan.exportedAt))}</p>` : ''}
    <div class="chips">
      <span class="chip ok">${plan.added.length} nuevos</span>
      <span class="chip gold">${plan.modified.length} modificados</span>
      <span class="chip">${plan.unchanged.length} sin cambios</span>
      <span class="chip ${plan.errors.length ? 'bad' : ''}">${plan.errors.length} errores${errRows ? ` en ${errRows} fila(s)` : ''}</span>
      <span class="chip ${plan.warnings.length ? 'warn' : ''}">${plan.warnings.length} advertencias</span>
    </div>
    ${plan.staleMoves > 0 ? `<div class="alert warn"><strong>Atención:</strong> desde que se exportó este archivo se registraron ${plan.staleMoves} movimiento(s) de inventario (ventas, entradas…). Si importas las existencias de este archivo podrías sobrescribir esos cambios. Revisa las columnas de existencias o exporta un archivo nuevo.</div>` : ''}
    ${plan.unknownHeaders?.length ? `<p class="muted small">Columnas ignoradas: ${h(plan.unknownHeaders.join(', '))}</p>` : ''}

    ${plan.errors.length ? `<details open><summary>Errores (${plan.errors.length}) — estas filas NO se importarán</summary>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Fila</th><th>SKU</th><th>Columna</th><th>Problema</th></tr></thead><tbody>
      ${plan.errors.map((e) => `<tr><td class="num">${e.row || '—'}</td><td class="mono">${h(e.sku || '')}</td><td>${h(e.field)}</td><td>${h(e.message)}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}

    ${plan.warnings.length ? `<details><summary>Advertencias (${plan.warnings.length})</summary>
      <div class="table-wrap"><table class="table compact"><tbody>
      ${plan.warnings.map((e) => `<tr><td class="num">${e.row || '—'}</td><td class="mono">${h(e.sku || '')}</td><td>${h(e.field)}</td><td>${h(e.message)}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}

    ${plan.added.length ? `<details open><summary>Perfumes nuevos (${plan.added.length})</summary>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Fila</th><th>SKU</th><th>Perfume</th><th>Marca</th><th>Precios</th><th>Existencias</th><th>Estado</th></tr></thead><tbody>
      ${plan.added.map(({ rowNumber, data: d }) => `<tr><td class="num">${rowNumber}</td><td class="mono">${h(d.sku)}</td><td>${h(d.name)}</td><td>${h(d.brand)}</td>
        <td class="small">${[d.price_bottle, d.price_5ml, d.price_10ml].map((v) => (num(v) ? money(v) : '—')).join(' / ')}</td>
        <td class="small">${num(d.stock_bottles)} bot. · ${num(d.decant_ml)} ml</td><td>${h(d.status)}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}

    ${plan.modified.length ? `<details open><summary>Perfumes que se actualizarán (${plan.modified.length})</summary>
      <div class="table-wrap"><table class="table compact"><thead><tr><th>Fila</th><th>SKU</th><th>Perfume</th><th>Cambios (antes → después)</th></tr></thead><tbody>
      ${plan.modified.map(({ rowNumber, data: d, existing, changes, stockChanged }) => `<tr${stockChanged ? ' class="hl"' : ''}><td class="num">${rowNumber}</td><td class="mono">${h(d.sku)}</td><td>${h(existing.name)}</td>
        <td class="small">${changes.map((c) => `<div><strong>${h(FIELD_LABELS[c.key])}:</strong> ${fmtVal(c.key, c.from)} → ${fmtVal(c.key, c.to)}</div>`).join('')}</td></tr>`).join('')}
      </tbody></table></div></details>` : ''}

    <div class="import-actions">
      ${plan.errors.length && total ? `<label class="check"><input type="checkbox" id="import-skip-errors"> Importar solo las ${total} fila(s) válidas e ignorar las filas con errores</label>` : ''}
      ${plan.staleMoves > 0 ? '<label class="check"><input type="checkbox" id="import-stale-ok"> Entiendo que este archivo es anterior a los últimos movimientos</label>' : ''}
      <button class="btn btn-gold" data-action="confirm-import" ${total ? '' : 'disabled'}>Confirmar importación (${total})</button>
      ${total ? '' : '<p class="muted small">No hay cambios para importar.</p>'}
    </div>
  </div>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function confirmImport(btn) {
  const plan = state.importPlan;
  if (!plan) return;
  if (plan.errors.length && !$('#import-skip-errors')?.checked) {
    toast('Hay filas con errores. Corrígelas en Excel o marca la casilla para importar solo las válidas.', 'warn', 6000);
    return;
  }
  if (plan.staleMoves > 0 && !$('#import-stale-ok')?.checked) {
    toast('Confirma que revisaste la advertencia sobre el archivo antiguo.', 'warn', 6000);
    return;
  }
  const rows = [...plan.added, ...plan.modified].map((x) => toImportPayload(x.data));
  await busy(btn, 'Importando…', async () => {
    try {
      const r = await state.backend.importProducts(rows);
      state.importPlan = null;
      $('#import-preview').innerHTML = `<div class="card success-card"><h2>Importación completada</h2>
        <p><strong>${r.inserted}</strong> perfume(s) nuevo(s), <strong>${r.updated}</strong> actualizado(s), ${r.unchanged} sin cambios.
        ${plan.errors.length ? `Se omitieron ${new Set(plan.errors.map((e) => e.row)).size} fila(s) con errores.` : ''}</p>
        <p class="muted">Los cambios ya están guardados en la base de datos y visibles en la tienda.</p></div>`;
      toast('Importación completada.', 'ok');
      await refreshAll();
    } catch (e) {
      toast(`La importación no se realizó (no se guardó ningún cambio): ${e.message}`, 'error', 9000);
    }
  });
}

async function backupJson(btn) {
  await busy(btn, 'Preparando…', async () => {
    try {
      const [products, movements, orders] = await Promise.all([
        state.backend.listProducts(), state.backend.listMovements(100000), state.backend.listOrders(100000),
      ]);
      const blob = new Blob([JSON.stringify({ generado: new Date().toISOString(), products, movements, orders }, null, 1)], { type: 'application/json' });
      downloadBlob(blob, `Copia_AJRO_HOUSE_${today()}.json`);
    } catch (e) { toast(e.message, 'error'); }
  });
}

// ---------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------
function safeFileName(name) {
  const base = normalizeText(name.replace(/\.[^.]+$/, '')).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'foto';
  return `${base}.webp`;
}

/** Reduce la foto a máx. 1200 px y la convierte a WebP antes de subirla. */
async function optimizeImage(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error(`${file.name}: formato no admitido (usa JPG, PNG o WebP).`);
  if (file.size > 15 * 1024 * 1024) throw new Error(`${file.name}: supera 15 MB.`);
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1200 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', 0.85));
  return new File([blob], safeFileName(file.name), { type: 'image/webp' });
}

async function uploadImageFile(file) {
  const optimized = await optimizeImage(file);
  return state.backend.uploadImage(optimized, optimized.name);
}

async function uploadImages(files) {
  const log = $('#upload-log');
  log.innerHTML = '';
  for (const file of files) {
    const line = document.createElement('div');
    line.textContent = `Subiendo ${file.name}…`;
    log.appendChild(line);
    try {
      const name = await uploadImageFile(file);
      line.innerHTML = `✓ ${h(file.name)} → <strong class="mono">${h(name)}</strong>`;
    } catch (e) {
      line.innerHTML = `<span class="bad">✗ ${h(e.message)}</span>`;
    }
  }
  state.images = await state.backend.listImages().catch(() => state.images);
  renderImages();
}

function renderImages() {
  const q = normalizeText($('#images-search').value);
  const used = new Set(state.products.map((p) => p.image));
  const list = state.images.filter((i) => !q || normalizeText(i.name).includes(q));
  $('#image-grid').innerHTML = list.map((i) => `<figure class="img-item">
    <img src="${h(imageOf({ image: i.name }))}" alt="" loading="lazy">
    <figcaption><span class="mono small" title="${h(i.name)}">${h(i.name)}</span>
      <span class="row-actions"><button class="btn btn-sm" data-action="copy-image" data-name="${h(i.name)}">Copiar nombre</button>
      ${used.has(i.name) ? '<span class="tag">En uso</span>' : `<button class="btn btn-sm btn-danger-ghost" data-action="delete-image" data-name="${h(i.name)}">Eliminar</button>`}</span>
    </figcaption></figure>`).join('') || '<p class="muted">No hay fotografías subidas todavía.</p>';
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
function switchTab(tab) {
  state.tab = tab;
  $$('.tabs [role="tab"]').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $$('.tab-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  $('#tab-title').textContent = TAB_TITLES[tab];
  document.body.classList.remove('side-open');
  history.replaceState(null, '', `#${tab}`);
}

function bind() {
  $('#login-form').addEventListener('submit', login);
  $$('.tabs [role="tab"]').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('side-open'));

  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-action], [data-close], [data-dialog-value]');
    if (!t) return;
    if (t.hasAttribute('data-close')) { t.closest('dialog').close(); return; }
    if (t.dataset.dialogValue) { settleConfirm(t.dataset.dialogValue === 'ok'); return; }
    const { action, id } = t.dataset;
    switch (action) {
      case 'logout': await logout(); break;
      case 'refresh': await busy(t, 'Actualizando…', refreshAll); toast('Datos actualizados.', 'ok'); break;
      case 'new-product': openProductForm(); break;
      case 'edit': openProductForm(state.products.find((p) => p.id === id)); break;
      case 'delete': await deleteProduct(id); break;
      case 'cycle-status': await cycleStatus(id); break;
      case 'toggle-featured': await toggleFeatured(id); break;
      case 'movement': openStockDialog(id); break;
      case 'new-movement': openStockDialog(); break;
      case 'open-bottle': openStockDialog(id, 'apertura'); break;
      case 'confirm-order': await confirmOrder(id, t); break;
      case 'cancel-order': await cancelOrder(id, t); break;
      case 'download-template': await downloadTemplate(t); break;
      case 'export-excel': await exportExcel(t); break;
      case 'import-excel': $('#import-file').value = ''; $('#import-file').click(); break;
      case 'cancel-import': state.importPlan = null; renderImportPreview(); break;
      case 'confirm-import': await confirmImport(t); break;
      case 'backup-json': await backupJson(t); break;
      case 'copy-image':
        try { await navigator.clipboard.writeText(t.dataset.name); toast('Nombre copiado.', 'ok'); } catch { toast(t.dataset.name); }
        break;
      case 'delete-image':
        if (await confirmDialog('Eliminar fotografía', `¿Eliminar "${t.dataset.name}" del almacenamiento? No se puede deshacer.`, 'Eliminar')) {
          try { await state.backend.deleteImage(t.dataset.name); state.images = await state.backend.listImages(); renderImages(); } catch (ex) { toast(ex.message, 'error'); }
        }
        break;
      default: break;
    }
  });

  // Escape o cierre del diálogo de confirmación = cancelar
  $('#confirm-dialog').addEventListener('cancel', () => settleConfirm(false));
  $('#confirm-dialog').addEventListener('close', () => settleConfirm(false));
  $('#product-form').addEventListener('submit', saveProduct);
  $('#product-form').elements.image.addEventListener('input', debounce(updateImagePreview, 300));
  $('#pd-image-file').addEventListener('change', (e) => { if (e.target.files[0]) uploadFormImage(e.target.files[0]); });
  $('#stock-form').addEventListener('submit', saveMovement);
  $('#stock-form').addEventListener('input', updateStockDialog);
  $('#stock-form').addEventListener('change', updateStockDialog);
  $('#import-file').addEventListener('change', (e) => handleImportFile(e.target.files[0]));

  $('#prod-search').addEventListener('input', debounce(renderProducts, 150));
  $('#prod-status').addEventListener('change', renderProducts);
  $('#prod-alert').addEventListener('change', renderProducts);
  $('#stock-search').addEventListener('input', debounce(renderStock, 150));
  $('#stock-alerts-only').addEventListener('change', renderStock);
  $('#moves-kind').addEventListener('change', renderMovements);
  $('#orders-status').addEventListener('change', renderOrders);
  $('#orders-search').addEventListener('input', debounce(renderOrders, 150));
  $('#images-search').addEventListener('input', debounce(renderImages, 150));
  $('#images-input').addEventListener('change', (e) => uploadImages([...e.target.files]));
  const dz = $('#dropzone');
  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.remove('over'); uploadImages([...e.dataTransfer.files]); });
}

async function init() {
  bind();
  try {
    state.backend = await getBackend();
  } catch (e) {
    show('#view-setup');
    toast(e.message, 'error');
    return;
  }
  state.backend.onAuthChange((user) => {
    if (!user && !$('#view-panel').hidden) show('#view-login');
  });
  const initialTab = location.hash.slice(1);
  if (TAB_TITLES[initialTab]) switchTab(initialTab);
  await route();
}

init();
