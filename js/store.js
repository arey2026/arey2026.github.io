// =====================================================================
// AJRO HOUSE · Tienda pública
// =====================================================================
import { CONFIG } from './config.js';
import { getBackend, createStaticBackend } from './api.js';
import { ICONS } from './icons.js';
import { escapeHtml as h, money, resolveImage, debounce } from './utils.js';
import { presentationsOf, isSoldOut, presentationByKey } from './inventory.js';
import { DEFAULT_FILTERS, filterProducts, sortProducts, relatedProducts, brandsOf, searchableText } from './catalog.js';
import { loadCart, saveCart, resolveCart, maxQtyFor, buildWhatsAppMessage, cartLinesForMessage, whatsappUrl } from './cart.js';

const PAGE_SIZE = 24;
const FAV_KEY = 'ajro-favoritos';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  backend: null,
  products: [],
  bySku: new Map(),
  bestRank: new Map(),
  filters: structuredClone(DEFAULT_FILTERS),
  limit: PAGE_SIZE,
  selected: new Map(), // sku -> presentación elegida en la tarjeta
  favorites: loadFavorites(),
  cart: loadCart(),
  loadedAt: 0,
  lastFocus: null,
};

// ---------------------------------------------------------------------
// Utilidades de interfaz
// ---------------------------------------------------------------------
function loadFavorites() {
  try { return new Set(JSON.parse(localStorage.getItem(FAV_KEY) || '[]')); } catch { return new Set(); }
}
function saveFavorites() {
  try { localStorage.setItem(FAV_KEY, JSON.stringify([...state.favorites])); } catch { /* sin almacenamiento */ }
}

function imageOf(p) {
  const b = state.backend;
  return (b?.resolveTestImage && b.resolveTestImage(p.image)) || resolveImage(p.image, { siteRoot: './', storageBase: b?.storageBase || '' });
}

function toast(message, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  $('#toasts').appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
}

function waLink(text) {
  return whatsappUrl(CONFIG.WHATSAPP_NUMBER, text);
}

function injectIcons(root = document) {
  $$('[data-icon]', root).forEach((el) => { if (!el.dataset.iconDone) { el.innerHTML = ICONS[el.dataset.icon] || ''; el.dataset.iconDone = '1'; } });
}

// ---------------------------------------------------------------------
// Tarjeta de producto
// ---------------------------------------------------------------------
function selectedPresentation(p) {
  const pres = presentationsOf(p);
  const chosen = state.selected.get(p.sku);
  return pres.find((x) => x.key === chosen)
    || pres.find((x) => x.available === null || x.available > 0)
    || pres[0];
}

function availabilityText(p, pres) {
  if (p.status === 'Próximamente') return { text: 'Próximamente', cls: 'soon' };
  if (!pres) return { text: 'Consultar precio', cls: 'out' };
  if (pres.available === null) return { text: 'Consulta disponibilidad', cls: 'ask' };
  if (pres.available <= 0) return { text: 'Agotado', cls: 'out' };
  if (pres.available === 1) return { text: '¡Última unidad!', cls: 'low' };
  if (pres.available <= 3) return { text: `¡Últimas ${pres.available} unidades!`, cls: 'low' };
  return { text: 'Disponible', cls: 'ok' };
}

function badgesHtml(p) {
  const b = [];
  if (Number(p.discount_pct) > 0) b.push(`<span class="badge badge-offer">−${h(p.discount_pct)}%</span>`);
  if (p.is_new) b.push('<span class="badge badge-new">Nuevo</span>');
  if (p.status === 'Próximamente') b.push('<span class="badge badge-soon">Próximamente</span>');
  else if (isSoldOut(p)) b.push('<span class="badge badge-out">Agotado</span>');
  if (presentationsOf(p).some((x) => x.key !== 'botella')) b.push('<span class="badge badge-decant">Decant</span>');
  return b.join('');
}

function priceHtml(pres) {
  if (!pres) return '';
  const strike = pres.original > pres.price ? `<s>${money(pres.original)}</s>` : '';
  return `${strike}<strong>${money(pres.price)}</strong>`;
}

function cardHtml(p) {
  const pres = presentationsOf(p);
  const sel = selectedPresentation(p);
  const avail = availabilityText(p, sel);
  const canBuy = p.status === 'Activo' && sel && (sel.available === null || sel.available > 0);
  const fav = state.favorites.has(p.sku);
  const img = imageOf(p);
  return `
  <article class="card" data-sku="${h(p.sku)}">
    <div class="card-media">
      <button class="card-image" type="button" data-action="open" data-sku="${h(p.sku)}" aria-label="Ver detalles de ${h(p.name)}">
        ${img ? `<img src="${h(img)}" alt="${h(p.name)}" loading="lazy" decoding="async" width="400" height="400">` : '<span class="no-image" aria-hidden="true">AJRO</span>'}
      </button>
      <div class="badges">${badgesHtml(p)}</div>
      <button class="fav-btn${fav ? ' active' : ''}" type="button" data-action="fav" data-sku="${h(p.sku)}" aria-pressed="${fav}" aria-label="${fav ? 'Quitar de' : 'Agregar a'} favoritos: ${h(p.name)}">${ICONS.heart}</button>
    </div>
    <div class="card-body">
      <p class="card-brand">${h(p.brand)}</p>
      <h3 class="card-name"><button type="button" data-action="open" data-sku="${h(p.sku)}">${h(p.name)}</button></h3>
      <p class="card-meta">${h(p.gender)} · ${h(p.perfume_type)}</p>
      ${p.description ? `<p class="card-desc">${h(p.description)}</p>` : ''}
      <div class="pres-options" role="group" aria-label="Presentación de ${h(p.name)}">
        ${pres.map((x) => {
          const off = x.available !== null && x.available <= 0;
          return `<button type="button" class="pres-btn${x.key === sel?.key ? ' selected' : ''}${off ? ' is-out' : ''}" data-action="pres" data-sku="${h(p.sku)}" data-key="${x.key}" aria-pressed="${x.key === sel?.key}" title="${off ? 'Agotado' : ''}">
            <span>${x.short}</span><em>${money(x.price)}</em></button>`;
        }).join('')}
      </div>
      <div class="card-foot">
        <div class="card-price">${priceHtml(sel)}</div>
        <span class="stock stock-${avail.cls}">${avail.text}</span>
      </div>
      <div class="card-actions">
        <button class="btn btn-gold btn-sm" type="button" data-action="add" data-sku="${h(p.sku)}" ${canBuy ? '' : 'disabled'}>
          ${canBuy ? `${ICONS.bag} Agregar` : (p.status === 'Próximamente' ? 'Próximamente' : 'Agotado')}
        </button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="open" data-sku="${h(p.sku)}">Detalles</button>
      </div>
    </div>
  </article>`;
}

function refreshCards(sku) {
  const p = state.bySku.get(sku);
  if (!p) return;
  $$(`.card[data-sku="${CSS.escape(sku)}"]`).forEach((el) => { el.outerHTML = cardHtml(p); });
}

// ---------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------
function visibleProducts() {
  return sortProducts(filterProducts(state.products, state.filters, state.favorites), state.filters.sort, state.bestRank);
}

function renderCatalog() {
  const list = visibleProducts();
  const grid = $('#product-grid');
  grid.setAttribute('aria-busy', 'false');
  const shown = list.slice(0, state.limit);
  if (!list.length) {
    grid.innerHTML = `<div class="empty-state"><p>No encontramos perfumes con esos criterios.</p>
      <button class="btn btn-outline" type="button" data-action="clear-filters">Limpiar filtros</button></div>`;
  } else {
    grid.innerHTML = shown.map(cardHtml).join('');
  }
  const total = state.products.filter((p) => p.status !== 'Inactivo').length;
  $('#results-count').textContent = list.length === total
    ? `${total} perfumes`
    : `${list.length} de ${total} perfumes`;
  const more = $('#load-more');
  more.hidden = list.length <= state.limit;
  more.textContent = `Ver más perfumes (${list.length - shown.length} restantes)`;
  renderChips();
}

function activeFilterChips() {
  const f = state.filters;
  const chips = [];
  if (f.q) chips.push({ label: `“${f.q}”`, clear: () => { f.q = ''; } });
  f.genders.forEach((g) => chips.push({ label: g, clear: () => { f.genders = f.genders.filter((x) => x !== g); } }));
  f.types.forEach((t) => chips.push({ label: t, clear: () => { f.types = f.types.filter((x) => x !== t); } }));
  if (f.brand) chips.push({ label: f.brand, clear: () => { f.brand = ''; } });
  if (f.presentation) chips.push({ label: presentationByKey(f.presentation).label, clear: () => { f.presentation = ''; } });
  if (f.min) chips.push({ label: `Desde ${money(f.min)}`, clear: () => { f.min = null; } });
  if (f.max) chips.push({ label: `Hasta ${money(f.max)}`, clear: () => { f.max = null; } });
  if (f.availability === 'available') chips.push({ label: 'Solo disponibles', clear: () => { f.availability = 'all'; } });
  if (f.availability === 'coming') chips.push({ label: 'Próximamente', clear: () => { f.availability = 'all'; } });
  if (f.offersOnly) chips.push({ label: 'Ofertas', clear: () => { f.offersOnly = false; } });
  if (f.favoritesOnly) chips.push({ label: 'Mis favoritos', clear: () => { f.favoritesOnly = false; } });
  return chips;
}

let chipHandlers = [];
function renderChips() {
  chipHandlers = activeFilterChips();
  $('#active-chips').innerHTML = chipHandlers.map((c, i) =>
    `<button type="button" class="chip" data-chip="${i}" aria-label="Quitar filtro ${h(c.label)}">${h(c.label)} ${ICONS.close}</button>`).join('');
  const n = chipHandlers.filter((c) => !c.label.startsWith('“')).length;
  const badge = $('#filter-badge');
  badge.hidden = n === 0;
  badge.textContent = n;
}

function syncControls() {
  const f = state.filters;
  $('#search-input').value = f.q;
  $('#sort-select').value = f.sort;
  $$('input[name="gender"]').forEach((i) => { i.checked = f.genders.includes(i.value); });
  $$('input[name="type"]').forEach((i) => { i.checked = f.types.includes(i.value); });
  $('#brand-select').value = f.brand;
  $('#presentation-select').value = f.presentation;
  $('#price-min').value = f.min ?? '';
  $('#price-max').value = f.max ?? '';
  $$('input[name="availability"]').forEach((i) => { i.checked = i.value === f.availability; });
  $('#offers-only').checked = f.offersOnly;
  $('#favorites-only').checked = f.favoritesOnly;
}

function applyFilters(changes = {}, { scroll = false, reset = false } = {}) {
  if (reset) state.filters = { ...structuredClone(DEFAULT_FILTERS), sort: state.filters.sort };
  Object.assign(state.filters, changes);
  state.limit = PAGE_SIZE;
  syncControls();
  renderCatalog();
  if (scroll) $('#catalogo').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderBrands() {
  const sel = $('#brand-select');
  sel.innerHTML = '<option value="">Todas las marcas</option>' +
    brandsOf(state.products).map(([b, n]) => `<option value="${h(b)}">${h(b)} (${n})</option>`).join('');
  sel.value = state.filters.brand;
}

// ---------------------------------------------------------------------
// Página principal: estadísticas, categorías y secciones
// ---------------------------------------------------------------------
function renderHeroStats() {
  const visible = state.products.filter((p) => p.status !== 'Inactivo');
  const brands = new Set(visible.map((p) => p.brand)).size;
  const decantPrices = visible.flatMap((p) => presentationsOf(p).filter((x) => x.key !== 'botella').map((x) => x.price));
  const stats = [[visible.length, 'fragancias'], [brands, 'marcas']];
  if (decantPrices.length) stats.push([money(Math.min(...decantPrices)), 'decants desde']);
  $('#hero-stats').innerHTML = stats.map(([n, l]) => `<div><dt>${h(l)}</dt><dd>${h(n)}</dd></div>`).join('');
}

const CATEGORY_TILES = [
  { label: 'Masculinos', hint: 'Fragancias para él', preset: { genders: ['Masculino'] }, image: 'assets/categoria-masculinos.webp' },
  { label: 'Femeninos', hint: 'Fragancias para ella', preset: { genders: ['Femenino'] }, image: 'assets/categoria-femeninos.webp' },
  { label: 'Unisex', hint: 'Para compartir', preset: { genders: ['Unisex'] } },
  { label: 'Árabes', hint: 'Intensas y envolventes', preset: { types: ['Árabe'] } },
  { label: 'Diseñador', hint: 'Las grandes casas', preset: { types: ['Diseñador'] } },
  { label: 'Decants', hint: 'Prueba en 5 y 10 ml', preset: { presentation: '5ml' } },
];

function renderCategories() {
  const used = new Set();
  const tiles = CATEGORY_TILES.map((t, i) => {
    const f = { ...structuredClone(DEFAULT_FILTERS), ...t.preset };
    const list = sortProducts(filterProducts(state.products, f), 'recommended');
    if (!list.length) return '';
    let img = t.image || '';
    if (!img) {
      // Foto de un perfume de la categoría que no se haya usado en otra tarjeta
      const pick = list.find((p) => p.image && !used.has(p.image) && p.status === 'Activo') || list.find((p) => p.image);
      if (pick) { used.add(pick.image); img = imageOf(pick); }
    }
    return `<button type="button" class="category-tile reveal${t.image ? ' is-photo' : ''}" data-tile="${i}">
      ${img ? `<img src="${h(img)}" alt="" loading="lazy" decoding="async">` : ''}
      <span class="tile-text"><strong>${h(t.label)}</strong><small>${h(t.hint)} · ${list.length} ${list.length === 1 ? 'perfume' : 'perfumes'}</small></span>
      <span class="tile-arrow" aria-hidden="true">${ICONS.arrow}</span>
    </button>`;
  }).join('');
  $('#category-grid').innerHTML = tiles;
}

function renderRails() {
  const active = state.products.filter((p) => p.status !== 'Inactivo');
  const rails = {
    featured: { section: '#destacados', list: active.filter((p) => p.featured) },
    offers: { section: '#ofertas', list: active.filter((p) => Number(p.discount_pct) > 0 && p.status === 'Activo') },
    new: { section: '#nuevos', list: active.filter((p) => p.is_new) },
    best: { section: '#mas-vendidos', list: [...state.bestRank.keys()].map((s) => state.bySku.get(s)).filter((p) => p && p.status === 'Activo') },
  };
  Object.entries(rails).forEach(([key, { section, list }]) => {
    const el = $(section);
    const items = key === 'best' ? list.slice(0, 8) : sortProducts(list, 'recommended').slice(0, 8);
    el.hidden = items.length === 0;
    $(`[data-rail="${key}"]`).innerHTML = items.map(cardHtml).join('');
  });
}

// ---------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------
function toggleFavorite(sku) {
  if (state.favorites.has(sku)) state.favorites.delete(sku);
  else state.favorites.add(sku);
  saveFavorites();
  refreshCards(sku);
  updateCounters();
  if (state.filters.favoritesOnly) renderCatalog();
  const btn = $(`#product-modal .fav-btn[data-sku="${CSS.escape(sku)}"]`);
  if (btn) { const on = state.favorites.has(sku); btn.classList.toggle('active', on); btn.setAttribute('aria-pressed', on); }
}

function updateCounters() {
  const favCount = [...state.favorites].filter((s) => state.bySku.has(s)).length;
  const fc = $('#favorites-count');
  fc.hidden = favCount === 0; fc.textContent = favCount;
  const qty = state.cart.reduce((s, i) => s + i.qty, 0);
  const cc = $('#cart-count');
  cc.hidden = qty === 0; cc.textContent = qty;
}

// ---------------------------------------------------------------------
// Carrito
// ---------------------------------------------------------------------
function addToCart(sku, key, qty = 1) {
  const p = state.bySku.get(sku);
  if (!p) return;
  const pres = presentationsOf(p).find((x) => x.key === key);
  if (!pres) return;
  const line = state.cart.find((i) => i.sku === sku && i.presentation === key);
  const current = line ? line.qty : 0;
  const max = maxQtyFor(state.cart, sku, key, p);
  if (current + qty > max) {
    toast(max === 0 ? 'Esta presentación está agotada.' : `Solo hay ${max} disponible(s) en esta presentación.`, 'warn');
    if (max <= current) return;
    qty = max - current;
  }
  if (line) line.qty += qty;
  else state.cart.push({ sku, presentation: key, qty });
  saveCart(state.cart);
  updateCounters();
  renderCart();
  toast(`${p.name} (${pres.short}) agregado al carrito.`, 'ok');
  const btn = $('#cart-button');
  btn.classList.remove('bump'); void btn.offsetWidth; btn.classList.add('bump');
}

function setQty(sku, key, qty) {
  const line = state.cart.find((i) => i.sku === sku && i.presentation === key);
  if (!line) return;
  const p = state.bySku.get(sku);
  const max = p ? maxQtyFor(state.cart, sku, key, p) : 0;
  if (qty > max) { toast(`Solo hay ${max} disponible(s).`, 'warn'); qty = max; }
  if (qty < 1) state.cart = state.cart.filter((i) => i !== line);
  else line.qty = qty;
  saveCart(state.cart);
  updateCounters();
  renderCart();
}

function renderCart() {
  const body = $('#cart-body');
  const foot = $('#cart-foot');
  const resolved = resolveCart(state.cart, state.bySku);
  if (!state.cart.length) {
    body.innerHTML = `<div class="cart-empty">${ICONS.bag}<p>Tu carrito está vacío.</p>
      <button class="btn btn-outline" type="button" data-action="close-cart-browse">Explorar catálogo</button></div>`;
    foot.hidden = true;
    return;
  }
  foot.hidden = false;
  body.innerHTML = `<ul class="cart-lines">${resolved.lines.map((l) => {
    const p = l.product;
    const label = presentationByKey(l.presentation)?.label || l.presentation;
    const img = p ? imageOf(p) : '';
    return `<li class="cart-line${l.problem ? ' has-problem' : ''}">
      <div class="cart-thumb">${img ? `<img src="${h(img)}" alt="" loading="lazy">` : ''}</div>
      <div class="cart-info">
        <strong>${h(p?.name || l.sku)}</strong>
        <span>${h(p?.brand || '')} · ${h(label)}</span>
        <span class="unit">${l.pres ? money(l.unitPrice) + ' c/u' : ''}</span>
        ${l.problem ? `<span class="problem">${h(l.problem)}</span>` : ''}
        <div class="qty" role="group" aria-label="Cantidad">
          <button type="button" class="qty-btn" data-action="qty" data-sku="${h(l.sku)}" data-key="${l.presentation}" data-delta="-1" aria-label="Restar uno">${ICONS.minus}</button>
          <span aria-live="polite">${l.qty}</span>
          <button type="button" class="qty-btn" data-action="qty" data-sku="${h(l.sku)}" data-key="${l.presentation}" data-delta="1" aria-label="Sumar uno">${ICONS.plus}</button>
        </div>
      </div>
      <div class="cart-side">
        <strong>${money(l.subtotal)}</strong>
        <button type="button" class="link-btn" data-action="remove" data-sku="${h(l.sku)}" data-key="${l.presentation}">${ICONS.trash}<span>Eliminar</span></button>
      </div>
    </li>`;
  }).join('')}</ul>
  <button type="button" class="link-btn clear-cart" data-action="clear-cart">Vaciar carrito</button>`;
  $('#cart-total').textContent = money(resolved.total);
  const btn = $('#checkout-button');
  btn.disabled = !resolved.valid;
  btn.title = resolved.valid ? '' : 'Quita o ajusta los productos no disponibles para continuar.';
}

async function checkout() {
  const resolved = resolveCart(state.cart, state.bySku);
  if (!resolved.valid) { toast('Revisa tu carrito: hay productos no disponibles.', 'warn'); return; }
  const btn = $('#checkout-button');
  const customer = $('#customer-name').value.trim();
  const note = $('#customer-note').value.trim();
  // Se abre la ventana antes de esperar a la red para evitar bloqueadores de ventanas.
  const win = window.open('', '_blank');
  btn.disabled = true;
  const original = btn.innerHTML;
  btn.textContent = 'Preparando tu pedido…';
  let lines = cartLinesForMessage(resolved);
  let total = resolved.total;
  let code = null;
  try {
    const order = await state.backend.createOrder(
      state.cart.map(({ sku, presentation, qty }) => ({ sku, presentation, qty })), customer, note);
    if (order) {
      code = order.code;
      total = Number(order.total);
      lines = order.items.map((i) => ({ name: i.name, brand: i.brand, label: i.label, qty: i.qty, unit_price: Number(i.unit_price), subtotal: Number(i.subtotal) }));
    }
  } catch (e) {
    if (win) win.close();
    btn.innerHTML = original;
    btn.disabled = false;
    toast(e.message || 'No se pudo registrar el pedido.', 'error');
    await loadProducts(true);
    return;
  }
  const url = whatsappUrl(CONFIG.WHATSAPP_NUMBER, buildWhatsAppMessage({ lines, total, code, customer, note, businessName: CONFIG.BUSINESS_NAME }));
  if (win && !win.closed) { win.opener = null; win.location.href = url; } else { location.href = url; }
  btn.innerHTML = original;
  btn.disabled = false;
  $('#cart-body').insertAdjacentHTML('afterbegin', `<div class="cart-success" role="status">
    ${ICONS.check}<div><strong>¡Pedido listo${code ? ` (${h(code)})` : ''}!</strong>
    <p>Se abrió WhatsApp con el detalle. Envía el mensaje y te confirmaremos la disponibilidad.</p>
    <button type="button" class="btn btn-outline btn-sm" data-action="clear-cart">Vaciar carrito</button></div></div>`);
}

// ---------------------------------------------------------------------
// Paneles (carrito, filtros, detalle)
// ---------------------------------------------------------------------
function openLayer(el) {
  state.lastFocus = document.activeElement;
  $('#overlay').hidden = false;
  el.hidden = false;
  document.body.classList.add('no-scroll');
  requestAnimationFrame(() => { el.classList.add('open'); $('#overlay').classList.add('open'); });
  const focusable = el.querySelector('button, [href], input, select');
  focusable?.focus({ preventScroll: true });
}

function closeLayers() {
  ['#cart-drawer', '#product-modal'].forEach((s) => {
    const el = $(s);
    if (!el.hidden) { el.classList.remove('open'); setTimeout(() => { el.hidden = true; }, 250); }
  });
  $('#filters-panel').classList.remove('open');
  $('#filters-toggle').setAttribute('aria-expanded', 'false');
  $('#overlay').classList.remove('open');
  setTimeout(() => { $('#overlay').hidden = true; }, 250);
  document.body.classList.remove('no-scroll');
  const url = new URL(location.href);
  if (url.searchParams.has('producto')) {
    url.searchParams.delete('producto');
    history.replaceState(null, '', url.pathname + url.search + url.hash);
  }
  state.lastFocus?.focus?.({ preventScroll: true });
}

function openCart() {
  renderCart();
  openLayer($('#cart-drawer'));
}

function openProduct(sku) {
  const p = state.bySku.get(sku);
  if (!p || p.status === 'Inactivo') return;
  const pres = presentationsOf(p);
  const sel = selectedPresentation(p);
  const avail = availabilityText(p, sel);
  const canBuy = p.status === 'Activo' && sel && (sel.available === null || sel.available > 0);
  const img = imageOf(p);
  const related = relatedProducts(p, state.products);
  const fav = state.favorites.has(p.sku);
  const ask = waLink(`Hola, AJRO HOUSE. Quisiera más información sobre ${p.name} (${p.brand}).`);
  $('#product-content').innerHTML = `
    <div class="pm-grid">
      <div class="pm-media">${img ? `<img src="${h(img)}" alt="${h(p.name)}">` : '<span class="no-image">AJRO</span>'}
        <div class="badges">${badgesHtml(p)}</div></div>
      <div class="pm-info">
        <p class="card-brand">${h(p.brand)}</p>
        <h2 id="pm-name">${h(p.name)}</h2>
        <p class="card-meta">${h(p.gender)} · ${h(p.perfume_type)}${p.bottle_ml ? ` · Botella de ${h(p.bottle_ml)} ml` : ''}</p>
        ${p.description ? `<p class="pm-desc">${h(p.description)}</p>` : ''}
        <h3 class="pm-label">Presentación</h3>
        <div class="pm-pres" role="radiogroup" aria-label="Presentación">
          ${pres.map((x) => {
            const st = availabilityText(p, x);
            return `<button type="button" role="radio" class="pm-pres-btn${x.key === sel?.key ? ' selected' : ''}" aria-checked="${x.key === sel?.key}" data-action="pm-pres" data-sku="${h(p.sku)}" data-key="${x.key}">
              <span>${x.label}</span><span class="pm-pres-price">${priceHtml(x)}</span><small class="stock-${st.cls}">${st.text}</small></button>`;
          }).join('') || '<p>Consulta precios por WhatsApp.</p>'}
        </div>
        <div class="pm-buy">
          <div class="qty" role="group" aria-label="Cantidad">
            <button type="button" class="qty-btn" data-action="pm-qty" data-delta="-1" aria-label="Restar uno">${ICONS.minus}</button>
            <span id="pm-qty">1</span>
            <button type="button" class="qty-btn" data-action="pm-qty" data-delta="1" aria-label="Sumar uno">${ICONS.plus}</button>
          </div>
          <button class="btn btn-gold" type="button" data-action="pm-add" data-sku="${h(p.sku)}" ${canBuy ? '' : 'disabled'}>${canBuy ? `${ICONS.bag} Agregar al carrito` : avail.text}</button>
          <button class="fav-btn inline${fav ? ' active' : ''}" type="button" data-action="fav" data-sku="${h(p.sku)}" aria-pressed="${fav}" aria-label="Favorito">${ICONS.heart}</button>
        </div>
        <p class="pm-stock stock-${avail.cls}">${avail.text}</p>
        <a class="pm-ask" href="${h(ask)}" target="_blank" rel="noopener">${ICONS.whatsapp} Consultar por WhatsApp</a>
      </div>
    </div>
    ${related.length ? `<div class="pm-related"><h3>También te puede gustar</h3><div class="product-rail compact">${related.map(cardHtml).join('')}</div></div>` : ''}`;
  const modal = $('#product-modal');
  if (modal.hidden) openLayer(modal);
  modal.querySelector('.modal-card').scrollTop = 0;
  const url = new URL(location.href);
  url.searchParams.set('producto', p.sku);
  history.replaceState(null, '', url.pathname + url.search + url.hash);
}

// ---------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------
function bindEvents() {
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action], [data-tile], [data-chip], .js-whatsapp');
    if (!t) return;
    if (t.classList.contains('js-whatsapp')) {
      e.preventDefault();
      window.open(waLink(t.dataset.waText || 'Hola, AJRO HOUSE.'), '_blank', 'noopener');
      return;
    }
    if (t.dataset.tile !== undefined) {
      applyFilters(CATEGORY_TILES[Number(t.dataset.tile)].preset, { scroll: true, reset: true });
      return;
    }
    if (t.dataset.chip !== undefined) {
      chipHandlers[Number(t.dataset.chip)]?.clear();
      applyFilters();
      return;
    }
    const { action, sku, key } = t.dataset;
    switch (action) {
      case 'open': openProduct(sku); break;
      case 'fav': toggleFavorite(sku); break;
      case 'pres': state.selected.set(sku, key); refreshCards(sku); break;
      case 'add': { const p = state.bySku.get(sku); const sel = selectedPresentation(p); if (sel) addToCart(sku, sel.key); break; }
      case 'pm-pres': state.selected.set(sku, key); refreshCards(sku); openProduct(sku); break;
      case 'pm-qty': { const el = $('#pm-qty'); el.textContent = Math.min(20, Math.max(1, Number(el.textContent) + Number(t.dataset.delta))); break; }
      case 'pm-add': { const p = state.bySku.get(sku); const sel = selectedPresentation(p); if (sel) addToCart(sku, sel.key, Number($('#pm-qty').textContent)); break; }
      case 'qty': { const l = state.cart.find((i) => i.sku === sku && i.presentation === key); if (l) setQty(sku, key, l.qty + Number(t.dataset.delta)); break; }
      case 'remove': setQty(sku, key, 0); break;
      case 'clear-cart': state.cart = []; saveCart(state.cart); updateCounters(); renderCart(); break;
      case 'close-cart-browse': closeLayers(); $('#catalogo').scrollIntoView({ behavior: 'smooth' }); break;
      case 'clear-filters': applyFilters({}, { reset: true }); break;
      case 'reload': location.reload(); break;
      default: break;
    }
  });

  $('#cart-button').addEventListener('click', openCart);
  $('#cart-close').addEventListener('click', closeLayers);
  $('#product-close').addEventListener('click', closeLayers);
  $('#overlay').addEventListener('click', closeLayers);
  $('#product-modal').addEventListener('click', (e) => { if (e.target.id === 'product-modal') closeLayers(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLayers(); });
  $('#checkout-button').addEventListener('click', checkout);

  $('#favorites-button').addEventListener('click', () => {
    if (![...state.favorites].some((s) => state.bySku.has(s))) {
      toast('Aún no tienes favoritos. Toca el corazón de un perfume para guardarlo.');
      return;
    }
    applyFilters({ favoritesOnly: true }, { scroll: true });
  });
  $('#search-shortcut').addEventListener('click', () => {
    $('#catalogo').scrollIntoView({ behavior: 'smooth' });
    setTimeout(() => $('#search-input').focus({ preventScroll: true }), 400);
  });
  $('#decants-cta').addEventListener('click', () => applyFilters({ presentation: '5ml' }, { scroll: true, reset: true }));

  const search = debounce((v) => applyFilters({ q: v }), 180);
  $('#search-input').addEventListener('input', (e) => search(e.target.value.trim()));
  $('#sort-select').addEventListener('change', (e) => applyFilters({ sort: e.target.value }));
  $('#brand-select').addEventListener('change', (e) => applyFilters({ brand: e.target.value }));
  $('#presentation-select').addEventListener('change', (e) => applyFilters({ presentation: e.target.value }));
  $$('input[name="gender"]').forEach((i) => i.addEventListener('change', () =>
    applyFilters({ genders: $$('input[name="gender"]:checked').map((x) => x.value) })));
  $$('input[name="type"]').forEach((i) => i.addEventListener('change', () =>
    applyFilters({ types: $$('input[name="type"]:checked').map((x) => x.value) })));
  $$('input[name="availability"]').forEach((i) => i.addEventListener('change', () => applyFilters({ availability: i.value })));
  $('#offers-only').addEventListener('change', (e) => applyFilters({ offersOnly: e.target.checked }));
  $('#favorites-only').addEventListener('change', (e) => applyFilters({ favoritesOnly: e.target.checked }));
  const price = debounce(() => {
    const v = (id) => { const n = $(id).value; return n === '' ? null : Math.max(0, Number(n)); };
    applyFilters({ min: v('#price-min'), max: v('#price-max') });
  }, 350);
  $('#price-min').addEventListener('input', price);
  $('#price-max').addEventListener('input', price);
  $('#clear-filters').addEventListener('click', () => applyFilters({}, { reset: true }));
  $('#load-more').addEventListener('click', () => { state.limit += PAGE_SIZE; renderCatalog(); });

  $('#filters-toggle').addEventListener('click', () => {
    $('#filters-panel').classList.add('open');
    $('#filters-toggle').setAttribute('aria-expanded', 'true');
    $('#overlay').hidden = false;
    requestAnimationFrame(() => $('#overlay').classList.add('open'));
    document.body.classList.add('no-scroll');
  });
  $('#filters-close').addEventListener('click', closeLayers);
  $('#filters-apply').addEventListener('click', () => { closeLayers(); $('#catalogo').scrollIntoView({ behavior: 'smooth' }); });

  const toggle = $('#menu-toggle');
  toggle.addEventListener('click', () => {
    const open = document.body.classList.toggle('menu-open');
    toggle.setAttribute('aria-expanded', open);
  });
  $$('#main-nav a').forEach((a) => a.addEventListener('click', () => {
    document.body.classList.remove('menu-open');
    toggle.setAttribute('aria-expanded', 'false');
  }));

  const header = $('.site-header');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Volver a consultar el inventario al regresar a la pestaña (si pasó más de 1 minuto)
  document.addEventListener('visibilitychange', () => {
    if (state.backend && state.loadedAt && document.visibilityState === 'visible' && Date.now() - state.loadedAt > 60000) loadProducts(true);
  });
}

function setupReveal() {
  if (!('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    $$('.reveal').forEach((el) => el.classList.add('is-visible'));
    return;
  }
  const io = new IntersectionObserver((entries) => entries.forEach((en) => {
    if (en.isIntersecting) { en.target.classList.add('is-visible'); io.unobserve(en.target); }
  }), { rootMargin: '0px 0px -40px 0px' });
  const observe = () => $$('.reveal:not(.is-visible)').forEach((el) => io.observe(el));
  observe();
  return observe;
}

// ---------------------------------------------------------------------
// Carga de datos
// ---------------------------------------------------------------------
let observeReveal = () => {};

async function loadProducts(silent = false) {
  try {
    const list = await state.backend.listProducts();
    state.products = list
      .filter((p) => p.status !== 'Inactivo')
      .map((p) => ({ ...p, _search: searchableText(p) }));
    state.bySku = new Map(state.products.map((p) => [p.sku, p]));
    state.loadedAt = Date.now();
    try {
      const best = await state.backend.bestSellers(8);
      state.bestRank = new Map(best.map((b, i) => [b.sku, i]));
    } catch { state.bestRank = new Map(); }
    renderBrands();
    renderHeroStats();
    renderCategories();
    renderRails();
    renderCatalog();
    renderCart();
    updateCounters();
    observeReveal();
  } catch (e) {
    console.error(e);
    // Si la base de datos no responde (p. ej. proyecto en pausa), mostrar el
    // catálogo de respaldo en modo de solo consulta en lugar de una página vacía.
    if (!silent && state.backend.mode === 'supabase') {
      state.backend = createStaticBackend();
      toast('Mostrando el catálogo de referencia. Confirma disponibilidad por WhatsApp.', 'warn');
      return loadProducts(true);
    }
    if (!silent) {
      $('#product-grid').innerHTML = `<div class="empty-state"><p>No pudimos cargar el catálogo. Revisa tu conexión e inténtalo de nuevo.</p>
        <button class="btn btn-outline" type="button" data-action="reload">Reintentar</button></div>`;
      $('#results-count').textContent = '';
    }
  }
}

async function init() {
  $('#year').textContent = new Date().getFullYear();
  $('#menu-toggle').innerHTML = ICONS.menu;
  $('#search-shortcut').innerHTML = ICONS.search;
  $('#favorites-button').insertAdjacentHTML('afterbegin', ICONS.heart);
  $('#cart-button').insertAdjacentHTML('afterbegin', ICONS.bag);
  $$('#cart-close, #product-close, #filters-close').forEach((b) => { b.innerHTML = ICONS.close; });
  $('.search-icon').innerHTML = ICONS.search;
  $('.filters-icon').innerHTML = ICONS.filter;
  injectIcons();
  bindEvents();
  observeReveal = setupReveal() || (() => {});

  state.backend = await getBackend();
  await loadProducts();
  const sku = new URLSearchParams(location.search).get('producto');
  if (sku) openProduct(sku.toUpperCase());
}

init();
