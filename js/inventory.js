// Reglas de inventario compartidas (tienda, panel y pruebas).
// Deben coincidir con las funciones SQL de supabase/schema.sql.

export const PRESENTATIONS = [
  { key: 'botella', label: 'Botella sellada', short: 'Sellado', priceField: 'price_bottle' },
  { key: '5ml', label: 'Decant 5 ml', short: '5 ml', priceField: 'price_5ml', ml: 5, stockField: 'stock_5ml' },
  { key: '10ml', label: 'Decant 10 ml', short: '10 ml', priceField: 'price_10ml', ml: 10, stockField: 'stock_10ml' },
];

export const presentationByKey = (key) => PRESENTATIONS.find((p) => p.key === key);

/** Precio con descuento, redondeado al lempira (igual que _effective_price en SQL). */
export function effectivePrice(price, discountPct = 0) {
  const p = Number(price) || 0;
  const d = Number(discountPct) || 0;
  return Math.round((p * (100 - d)) / 100);
}

/**
 * Unidades vendibles por presentación.
 * Si el producto no tiene control de existencias (catálogo de respaldo
 * sin base de datos) devuelve null = "consultar disponibilidad".
 */
export function availableUnits(product, key) {
  if (product.stock_tracking === false) return null;
  const ml = Number(product.decant_ml) || 0;
  if (key === 'botella') return Math.max(0, Number(product.stock_bottles) || 0);
  if (key === '5ml') return (Number(product.stock_5ml) || 0) + Math.floor(ml / 5);
  if (key === '10ml') return (Number(product.stock_10ml) || 0) + Math.floor(ml / 10);
  return 0;
}

/** Presentaciones que el producto ofrece (precio > 0) con precio final y disponibilidad. */
export function presentationsOf(product) {
  return PRESENTATIONS
    .filter((pr) => Number(product[pr.priceField]) > 0)
    .map((pr) => {
      const original = Number(product[pr.priceField]);
      const price = effectivePrice(original, product.discount_pct);
      return { ...pr, original, price, available: availableUnits(product, pr.key) };
    });
}

export function isPurchasable(product) {
  return product.status === 'Activo' && presentationsOf(product).some((p) => p.available === null || p.available > 0);
}

export function isSoldOut(product) {
  if (product.stock_tracking === false) return false;
  const pres = presentationsOf(product);
  return pres.length === 0 || pres.every((p) => p.available <= 0);
}

export function lowestPrice(product) {
  const prices = presentationsOf(product).map((p) => p.price);
  return prices.length ? Math.min(...prices) : 0;
}

/**
 * Verifica si se pueden vender q_b botellas, q5 decants de 5 ml y q10 de 10 ml
 * a la vez (5 y 10 ml comparten el líquido). Devuelve null si alcanza o un mensaje.
 */
export function checkCapacity(product, qBottles = 0, q5 = 0, q10 = 0) {
  if (product.stock_tracking === false) return null;
  if (qBottles > (Number(product.stock_bottles) || 0)) {
    return `${product.name}: solo hay ${product.stock_bottles} botella(s) sellada(s).`;
  }
  const mlNeeded = Math.max(q5 - (Number(product.stock_5ml) || 0), 0) * 5
    + Math.max(q10 - (Number(product.stock_10ml) || 0), 0) * 10;
  if (mlNeeded > (Number(product.decant_ml) || 0)) {
    return `${product.name}: no hay suficiente perfume para los decants solicitados.`;
  }
  return null;
}

/** Alertas de existencias para el panel. */
export function stockAlerts(product, lowMl = 20) {
  const offersBottle = Number(product.price_bottle) > 0;
  const offersDecant = Number(product.price_5ml) > 0 || Number(product.price_10ml) > 0;
  const bottles = Number(product.stock_bottles) || 0;
  const decantUnits = availableUnits(product, '5ml');
  const alerts = [];
  if (offersBottle && bottles === 0) alerts.push('Sin botellas selladas');
  else if (offersBottle && bottles <= (Number(product.low_stock_threshold) || 0)) alerts.push('Pocas botellas');
  if (offersDecant && decantUnits === 0) alerts.push('Sin perfume para decants');
  else if (offersDecant && (Number(product.decant_ml) || 0) < lowMl
    && (Number(product.stock_5ml) || 0) + (Number(product.stock_10ml) || 0) === 0) alerts.push('Poco líquido para decants');
  return alerts;
}

/** Valor estimado del inventario a precio de venta (sin descuentos). */
export function inventoryValue(product) {
  const bottles = (Number(product.stock_bottles) || 0) * (Number(product.price_bottle) || 0);
  const prepared = (Number(product.stock_5ml) || 0) * (Number(product.price_5ml) || 0)
    + (Number(product.stock_10ml) || 0) * (Number(product.price_10ml) || 0);
  // Precio por ml del decant de 10 ml (o del de 5 ml si no existe)
  const perMl = Number(product.price_10ml) > 0 ? Number(product.price_10ml) / 10
    : Number(product.price_5ml) > 0 ? Number(product.price_5ml) / 5 : 0;
  const liquid = (Number(product.decant_ml) || 0) * perMl;
  return Math.round(bottles + prepared + liquid);
}
