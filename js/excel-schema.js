// =====================================================================
// AJRO HOUSE · Plantilla Excel: definición de columnas, generación,
// lectura y validación. Funciona igual en el navegador (panel admin) y
// en Node (scripts/build-excel.mjs). Recibe la librería ExcelJS como
// parámetro para no depender de cómo se cargó.
// =====================================================================
import { normalizeText, parseNumber } from './utils.js';

export const LISTS = {
  gender: ['Masculino', 'Femenino', 'Unisex'],
  perfume_type: ['Diseñador', 'Árabe', 'Nicho'],
  status: ['Activo', 'Inactivo', 'Próximamente'],
  bool: ['Sí', 'No'],
};

// Orden de columnas de la hoja "Inventario". Las 16 primeras son las
// solicitadas; las 4 últimas son complementarias (opcionales).
export const COLUMNS = [
  { key: 'sku', header: 'SKU', required: true, type: 'sku', width: 14,
    help: 'Código único del perfume. Solo letras, números, guion (-) o guion bajo (_). Ejemplo: AJ-0001. Es lo que identifica al producto: si el SKU ya existe se ACTUALIZA, si no existe se CREA.', example: 'AJ-0101' },
  { key: 'name', header: 'Nombre del perfume', required: true, type: 'text', max: 120, min: 2, width: 36,
    help: 'Nombre comercial del perfume (2 a 120 caracteres).', example: 'Sauvage Eau de Parfum' },
  { key: 'brand', header: 'Marca', required: true, type: 'text', max: 80, min: 1, width: 20,
    help: 'Casa o marca del perfume.', example: 'Dior' },
  { key: 'gender', header: 'Categoría', required: true, type: 'list', list: 'gender', width: 14,
    help: 'Elige de la lista: Masculino, Femenino o Unisex.', example: 'Masculino' },
  { key: 'perfume_type', header: 'Tipo de perfume', required: true, type: 'list', list: 'perfume_type', width: 16,
    help: 'Elige de la lista: Diseñador, Árabe o Nicho.', example: 'Diseñador' },
  { key: 'description', header: 'Descripción', type: 'text', max: 1000, width: 40,
    help: 'Descripción breve que verán los clientes (máximo 1000 caracteres). Opcional.', example: 'Eau de Parfum de 100 ml.' },
  { key: 'price_bottle', header: 'Precio botella sellada (L.)', type: 'money', width: 16,
    help: 'Precio en lempiras de la botella completa. Escribe 0 si no vendes la botella sellada.', example: 4900 },
  { key: 'stock_bottles', header: 'Existencias botellas selladas', type: 'int', width: 16,
    help: 'Cantidad de botellas selladas disponibles (número entero, 0 o más).', example: 2 },
  { key: 'price_5ml', header: 'Precio decant 5 ml (L.)', type: 'money', width: 15,
    help: 'Precio del decant de 5 ml. Escribe 0 si no ofreces esta presentación.', example: 365 },
  { key: 'stock_5ml', header: 'Decants 5 ml preparados', type: 'int', width: 15,
    help: 'Frascos de 5 ml YA LLENOS y listos para entregar. Si preparas los decants al momento, deja 0 y usa la columna de mililitros.', example: 0 },
  { key: 'price_10ml', header: 'Precio decant 10 ml (L.)', type: 'money', width: 15,
    help: 'Precio del decant de 10 ml. Escribe 0 si no ofreces esta presentación.', example: 705 },
  { key: 'stock_10ml', header: 'Decants 10 ml preparados', type: 'int', width: 15,
    help: 'Frascos de 10 ml YA LLENOS y listos para entregar.', example: 0 },
  { key: 'decant_ml', header: 'Mililitros disponibles para decants', type: 'decimal', width: 18,
    help: 'Total de perfume (en ml) de las botellas ABIERTAS que usas para decants. Ejemplo: una botella abierta de 100 ml de la que vendiste 15 ml = 85. No incluyas las botellas selladas.', example: 85 },
  { key: 'image', header: 'Imagen (archivo o URL)', type: 'text', max: 500, width: 34,
    help: 'Nombre del archivo de la foto subida en el panel (ej.: sauvage.jpg), una ruta del sitio (ej.: images/sauvage.jpg) o una URL completa https://...', example: 'sauvage-edp.jpg' },
  { key: 'featured', header: 'Producto destacado', type: 'bool', width: 12,
    help: 'Sí = aparece en la sección "Destacados" de la página principal.', example: 'No' },
  { key: 'status', header: 'Estado', required: true, type: 'list', list: 'status', width: 14,
    help: 'Activo = se vende. Inactivo = oculto en la tienda. Próximamente = visible pero aún no se puede comprar.', example: 'Activo' },
  { key: 'bottle_ml', header: 'Tamaño de botella (ml)', type: 'int', width: 13, min: 1, maxValue: 1000,
    help: 'Contenido de una botella sellada en ml (ej.: 100). Se usa al "abrir" una botella para decants.', example: 100 },
  { key: 'is_new', header: 'Nuevo lanzamiento', type: 'bool', width: 12,
    help: 'Sí = aparece en "Nuevos lanzamientos".', example: 'No' },
  { key: 'discount_pct', header: 'Descuento (%)', type: 'int', width: 11, maxValue: 90,
    help: 'Porcentaje de descuento para ofertas (0 a 90). Se aplica a todas las presentaciones.', example: 0 },
  { key: 'low_stock_threshold', header: 'Alerta existencias bajas', type: 'int', width: 13,
    help: 'Avisarme cuando queden esta cantidad de botellas o menos (por defecto 1).', example: 1 },
];

export const FIELD_LABELS = Object.fromEntries(COLUMNS.map((c) => [c.key, c.header]));
const headerText = (c) => (c.required ? `${c.header} *` : c.header);
const colLetter = (i) => {
  let s = ''; let n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
};
const normHeader = (h) => normalizeText(String(h ?? '').replace(/\*/g, '')).replace(/[^a-z0-9]/g, '');
const HEADER_ALIASES = {
  sku: ['codigo', 'codigounico', 'skuocodigounico'],
  name: ['nombre', 'perfume'],
  gender: ['genero'],
  perfume_type: ['tipo'],
  price_bottle: ['preciobotella', 'preciobotellasellada'],
  stock_bottles: ['existenciasbotellas', 'botellas'],
  price_5ml: ['preciodecant5ml', 'precio5ml'],
  stock_5ml: ['existenciasdecants5ml', 'existenciasdedecantsde5ml', 'decants5ml'],
  price_10ml: ['preciodecant10ml', 'precio10ml'],
  stock_10ml: ['existenciasdecants10ml', 'existenciasdedecantsde10ml', 'decants10ml'],
  decant_ml: ['mililitrosdisponibles', 'mldisponibles', 'mililitrosdisponiblesparadecants'],
  image: ['imagen', 'nombredelarchivodeimagen', 'foto'],
  featured: ['destacado'],
  status: ['estadodelproducto'],
};

const BRAND = { black: 'FF111111', gold: 'FFC9A45C', ivory: 'FFF7F3EA', grey: 'FF3A3A3A', reqFill: 'FF2A2111' };
const MONEY_FMT = '"L." #,##0.00';
const MAX_ROWS = 2000;

// ---------------------------------------------------------------------
// Generar libro (plantilla vacía o exportación del inventario)
// ---------------------------------------------------------------------
export function buildWorkbook(ExcelJS, products = [], { exportedAt = new Date(), example = false, markExport = true } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AJRO HOUSE';
  wb.created = exportedAt;
  wb.title = 'Inventario AJRO HOUSE';

  const ws = wb.addWorksheet('Inventario', {
    views: [{ state: 'frozen', xSplit: 2, ySplit: 1 }],
    properties: { tabColor: { argb: BRAND.gold } },
  });
  ws.columns = COLUMNS.map((c) => ({ header: headerText(c), key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.height = 42;
  header.eachCell((cell, i) => {
    const col = COLUMNS[i - 1];
    cell.font = { bold: true, color: { argb: col.required ? BRAND.gold : BRAND.ivory }, size: 11, name: 'Calibri' };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: col.required ? BRAND.reqFill : BRAND.black } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = { bottom: { style: 'medium', color: { argb: BRAND.gold } } };
    cell.note = { texts: [{ text: (col.required ? 'OBLIGATORIO. ' : 'Opcional. ') + col.help }] };
  });

  const rows = example ? [exampleRow()] : products;
  rows.forEach((p) => {
    const values = {};
    COLUMNS.forEach((c) => { values[c.key] = toCellValue(c, p[c.key]); });
    ws.addRow(values);
  });

  COLUMNS.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    if (c.type === 'money') col.numFmt = MONEY_FMT;
    if (c.type === 'decimal') col.numFmt = '#,##0.0" ml"';
    if (c.type === 'int') col.numFmt = '0';
    col.alignment = { vertical: 'middle', wrapText: c.key === 'description' };
  });
  for (let r = 2; r <= ws.rowCount; r++) {
    if (r % 2 === 0) {
      ws.getRow(r).eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9F6EF' } };
      });
    }
  }

  ws.autoFilter = { from: 'A1', to: `${colLetter(COLUMNS.length - 1)}1` };

  // Validaciones de datos (listas desplegables y números)
  const listRange = { gender: '$A$2:$A$4', perfume_type: '$B$2:$B$4', status: '$C$2:$C$4', bool: '$D$2:$D$3' };
  COLUMNS.forEach((c, i) => {
    const L = colLetter(i);
    const range = `${L}2:${L}${MAX_ROWS + 1}`;
    let dv = null;
    if (c.type === 'list') dv = { type: 'list', allowBlank: true, formulae: [`Listas!${listRange[c.list]}`] };
    if (c.type === 'bool') dv = { type: 'list', allowBlank: true, formulae: [`Listas!${listRange.bool}`] };
    if (c.type === 'int') dv = { type: 'whole', operator: 'between', allowBlank: true, formulae: [c.min ?? 0, c.maxValue ?? 100000] };
    if (c.type === 'money' || c.type === 'decimal') dv = { type: 'decimal', operator: 'between', allowBlank: true, formulae: [0, 10000000] };
    if (c.type === 'sku') dv = { type: 'textLength', operator: 'between', allowBlank: true, formulae: [2, 40] };
    if (!dv) return;
    ws.dataValidations.add(range, {
      ...dv,
      showErrorMessage: true,
      errorStyle: 'stop',
      errorTitle: 'Valor no válido',
      error: shortText(c.help, 220), // Excel admite como máximo 225 caracteres
      showInputMessage: true,
      promptTitle: c.header.slice(0, 32),
      prompt: shortText(c.help, 250),
    });
  });

  // Hoja de instrucciones
  buildInstructions(wb);

  // Hoja auxiliar de listas (oculta) + fecha de exportación
  const ls = wb.addWorksheet('Listas', { state: 'hidden' });
  ls.getRow(1).values = ['Categoría', 'Tipo de perfume', 'Estado', 'Sí/No', 'Exportado'];
  const max = Math.max(...Object.values(LISTS).map((l) => l.length));
  for (let i = 0; i < max; i++) {
    ls.getRow(i + 2).values = [LISTS.gender[i], LISTS.perfume_type[i], LISTS.status[i], LISTS.bool[i]];
  }
  ls.getCell('E2').value = products.length && !example && markExport ? exportedAt.toISOString() : '';

  // Instrucciones primero a la vista, pero el inventario es la hoja activa
  wb.views = [{ activeTab: 0 }];
  return wb;
}

function shortText(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, cut.lastIndexOf(' ')) + '…';
}

function exampleRow() {
  return Object.fromEntries(COLUMNS.map((c) => [c.key, c.example]));
}

function toCellValue(col, v) {
  if (v === null || v === undefined || v === '') return null;
  if (col.type === 'bool') return v === true || v === 'Sí' ? 'Sí' : 'No';
  if (col.type === 'money' || col.type === 'decimal' || col.type === 'int') return Number(v);
  return String(v);
}

function buildInstructions(wb) {
  const ws = wb.addWorksheet('Instrucciones', { properties: { tabColor: { argb: BRAND.black } } });
  ws.columns = [{ width: 34 }, { width: 14 }, { width: 80 }, { width: 24 }];
  const title = ws.addRow(['AJRO HOUSE · Instrucciones del inventario']);
  title.font = { bold: true, size: 18, color: { argb: BRAND.gold } };
  title.height = 30;
  ws.mergeCells('A1:D1');
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.black } };

  const para = (text, opts = {}) => {
    const r = ws.addRow([text]);
    ws.mergeCells(`A${r.number}:D${r.number}`);
    r.getCell(1).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).font = { size: 11, ...opts };
    r.height = Math.max(18, Math.ceil(text.length / 120) * 16);
    return r;
  };
  const heading = (text) => {
    ws.addRow([]);
    const r = para(text, { bold: true, size: 13, color: { argb: 'FF8A6A2B' } });
    r.getCell(1).border = { bottom: { style: 'thin', color: { argb: BRAND.gold } } };
  };

  heading('1. Cómo funciona');
  para('• Cada fila de la hoja "Inventario" es un perfume. El SKU (código único) identifica al perfume.');
  para('• Si el SKU ya existe en la tienda, el perfume se ACTUALIZA. Si no existe, se REGISTRA como nuevo. Nunca se duplica.');
  para('• Las columnas marcadas con * (encabezado dorado) son obligatorias para perfumes nuevos.');
  para('• Una celda VACÍA en un perfume que ya existe significa "no cambiar": se conserva el valor actual. Para quitar una presentación escribe 0 en su precio.');
  para('• No cambies el nombre de los encabezados ni elimines la fila 1. El orden de las columnas puede variar.');

  heading('2. Botellas selladas y decants (no se mezclan)');
  para('• "Existencias botellas selladas": botellas cerradas que vendes completas.');
  para('• "Mililitros disponibles para decants": perfume de las botellas que ya ABRISTE para decants. Si tienes dos botellas abiertas con 85 ml y 40 ml, escribe 125.');
  para('• "Decants 5 ml / 10 ml preparados": frascos ya llenos. Al vender un decant se usan primero los preparados y luego el líquido.');
  para('• Ejemplo: abres una botella de 100 ml → escribe 100. Al confirmar la venta de un decant de 5 ml quedan 95; al vender otro de 10 ml quedan 85. El sistema no permite vender más mililitros de los disponibles.');
  para('• Para pasar una botella sellada al líquido de decants usa el botón "Abrir botella" del panel (resta 1 botella y suma su contenido en ml).');

  heading('3. Fotografías');
  para('• Opción A (recomendada): en el panel, pestaña "Imágenes", sube las fotos. Luego escribe en la columna "Imagen" el nombre exacto del archivo (ej.: sauvage-edp.jpg).');
  para('• Opción B: una foto que ya está en la carpeta images/ del sitio, escrita como images/nombre.jpg.');
  para('• Opción C: una dirección completa que empiece con https://');

  heading('4. Cómo importar');
  para('1) Entra al panel administrativo → pestaña "Excel".  2) Pulsa "IMPORTAR INVENTARIO DESDE EXCEL" y elige este archivo (.xlsx).');
  para('3) Revisa la vista previa: perfumes nuevos, modificados (con el antes y el después), sin cambios y errores.');
  para('4) Si hay errores, corrígelos en Excel y vuelve a importar, o importa solo las filas válidas. 5) Pulsa "Confirmar importación".');
  para('• La importación es "todo o nada": si algo falla en el servidor no se guarda ningún cambio.');
  para('• Recomendación: exporta el inventario justo antes de editarlo. Si el archivo es antiguo y hubo ventas después, el panel te lo advertirá para no sobrescribir existencias.');

  heading('5. Descripción de cada columna');
  const head = ws.addRow(['Columna', 'Obligatoria', 'Qué escribir', 'Ejemplo']);
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: BRAND.ivory } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BRAND.black } };
  });
  COLUMNS.forEach((c) => {
    const r = ws.addRow([c.header, c.required ? 'Sí' : 'No', c.help, String(c.example)]);
    r.getCell(3).alignment = { wrapText: true, vertical: 'top' };
    r.getCell(1).font = { bold: true };
    r.height = Math.max(18, Math.ceil(c.help.length / 85) * 15);
  });

  heading('6. Errores frecuentes');
  para('• "Falta el SKU" / "SKU repetido en el archivo": cada fila necesita un código distinto.');
  para('• "Valor no válido en Categoría/Tipo/Estado": usa exactamente las opciones de la lista desplegable.');
  para('• "Debe ser un número entero mayor o igual a 0": no escribas texto ni negativos en existencias.');
  para('• "Encabezado no reconocido": no cambies los nombres de la fila 1 (puedes descargar una plantilla nueva desde el panel).');
}

// ---------------------------------------------------------------------
// Leer y validar un archivo .xlsx
// ---------------------------------------------------------------------
function cellToPlain(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'object') {
    if (v instanceof Date) return v.toISOString();
    if ('result' in v) return cellToPlain(v.result);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('text' in v) return v.text; // hipervínculo
    if ('error' in v) return null;
  }
  return v;
}

/**
 * Lee el libro y devuelve { rows, errors, warnings, exportedAt, unknownHeaders }.
 * rows: [{ rowNumber, data: {key: valor|null} }] solo con filas válidas.
 */
export async function parseWorkbook(ExcelJS, buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Inventario') || wb.worksheets.find((w) => w.state !== 'hidden');
  const result = { rows: [], errors: [], warnings: [], exportedAt: null, unknownHeaders: [], sheetName: ws?.name };
  if (!ws) {
    result.errors.push({ row: 0, field: '', message: 'El archivo no contiene hojas.' });
    return result;
  }

  const ls = wb.getWorksheet('Listas');
  const exp = ls ? cellToPlain(ls.getCell('E2').value) : null;
  if (exp && !Number.isNaN(Date.parse(exp))) result.exportedAt = new Date(exp);

  // Identificar encabezados por nombre (no por posición)
  const colMap = {};
  ws.getRow(1).eachCell((cell, colNumber) => {
    const h = normHeader(cellToPlain(cell.value));
    if (!h) return;
    const col = COLUMNS.find((c) => normHeader(c.header) === h || (HEADER_ALIASES[c.key] || []).includes(h));
    if (col) colMap[col.key] = colNumber;
    else result.unknownHeaders.push(String(cellToPlain(cell.value)));
  });
  const missing = COLUMNS.filter((c) => c.required && !colMap[c.key]);
  if (!colMap.sku) {
    result.errors.push({ row: 1, field: 'SKU', message: 'No se encontró la columna "SKU" en la fila 1. Usa la plantilla oficial.' });
    return result;
  }
  if (missing.length) {
    result.warnings.push({ row: 1, field: '', message: `Faltan columnas: ${missing.map((m) => m.header).join(', ')}. Solo se podrán actualizar perfumes existentes.` });
  }

  const seen = new Map();
  const last = Math.min(ws.rowCount, MAX_ROWS + 1);
  for (let r = 2; r <= last; r++) {
    const row = ws.getRow(r);
    const raw = {};
    let empty = true;
    for (const c of COLUMNS) {
      if (!colMap[c.key]) { raw[c.key] = undefined; continue; }
      const v = cellToPlain(row.getCell(colMap[c.key]).value);
      raw[c.key] = v;
      if (v !== null && v !== undefined && String(v).trim() !== '') empty = false;
    }
    if (empty) continue;

    const { data, errors } = validateRow(raw);
    errors.forEach((e) => result.errors.push({ row: r, sku: data.sku, ...e }));
    if (data.sku) {
      if (seen.has(data.sku)) {
        result.errors.push({ row: r, sku: data.sku, field: 'SKU', message: `SKU repetido en el archivo (también en la fila ${seen.get(data.sku)}).` });
        continue;
      }
      seen.set(data.sku, r);
    }
    if (!errors.length) result.rows.push({ rowNumber: r, data });
  }
  if (ws.rowCount > MAX_ROWS + 1) {
    result.warnings.push({ row: 0, field: '', message: `Solo se leyeron las primeras ${MAX_ROWS} filas.` });
  }
  return result;
}

/** Valida y normaliza una fila. Los campos vacíos quedan en null ("no cambiar"). */
export function validateRow(raw) {
  const data = {};
  const errors = [];
  const err = (c, message) => errors.push({ field: c.header, message });

  for (const c of COLUMNS) {
    const v = raw[c.key];
    const isEmpty = v === undefined || v === null || String(v).trim() === '';
    if (isEmpty) { data[c.key] = null; continue; }
    const s = String(v).trim();

    switch (c.type) {
      case 'sku': {
        const sku = s.toUpperCase().replace(/\s+/g, '-');
        if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(sku)) err(c, `SKU no válido "${s}". Usa letras, números, - o _ (2 a 40 caracteres).`);
        data.sku = sku;
        break;
      }
      case 'text':
        if (c.min && s.length < c.min) err(c, `Debe tener al menos ${c.min} caracteres.`);
        if (c.max && s.length > c.max) err(c, `Máximo ${c.max} caracteres (tiene ${s.length}).`);
        data[c.key] = s;
        break;
      case 'list': {
        const opt = LISTS[c.list].find((o) => normalizeText(o) === normalizeText(s));
        if (!opt) err(c, `Valor no válido "${s}". Opciones: ${LISTS[c.list].join(', ')}.`);
        data[c.key] = opt ?? s;
        break;
      }
      case 'bool': {
        const n = normalizeText(s);
        if (['si', 'yes', 'true', '1', 'x'].includes(n)) data[c.key] = true;
        else if (['no', 'false', '0'].includes(n)) data[c.key] = false;
        else { err(c, `Escribe "Sí" o "No" (se encontró "${s}").`); data[c.key] = null; }
        break;
      }
      case 'money':
      case 'decimal':
      case 'int': {
        const n = parseNumber(v);
        if (n === null) { data[c.key] = null; break; }
        if (Number.isNaN(n) || n < 0) { err(c, `Debe ser un número mayor o igual a 0 (se encontró "${s}").`); break; }
        if (c.type === 'int' && !Number.isInteger(n)) { err(c, `Debe ser un número entero (se encontró "${s}").`); break; }
        if (c.min !== undefined && n < c.min) { err(c, `Debe ser al menos ${c.min}.`); break; }
        if (c.maxValue !== undefined && n > c.maxValue) { err(c, `Debe ser como máximo ${c.maxValue}.`); break; }
        data[c.key] = c.type === 'decimal' ? Math.round(n * 10) / 10 : c.type === 'money' ? Math.round(n * 100) / 100 : n;
        break;
      }
      default:
        data[c.key] = s;
    }
  }
  if (!data.sku) errors.push({ field: 'SKU', message: 'Falta el SKU.' });
  return { data, errors };
}

/** Requisitos adicionales para perfumes NUEVOS (no existen en la base de datos). */
export function validateNew(data) {
  const errors = [];
  COLUMNS.filter((c) => c.required).forEach((c) => {
    if (data[c.key] === null || data[c.key] === undefined) errors.push({ field: c.header, message: `"${c.header}" es obligatorio para un perfume nuevo.` });
  });
  const anyPrice = ['price_bottle', 'price_5ml', 'price_10ml'].some((k) => Number(data[k]) > 0);
  if (!anyPrice && data.status === 'Activo') errors.push({ field: 'Precios', message: 'Indica al menos un precio mayor que 0 (botella, 5 ml o 10 ml).' });
  return errors;
}

const comparable = (key, v) => {
  if (v === null || v === undefined) return '';
  const col = COLUMNS.find((c) => c.key === key);
  if (col && ['money', 'decimal', 'int'].includes(col.type)) return String(Number(v));
  if (col && col.type === 'bool') return String(Boolean(v));
  return String(v).trim();
};

/** Diferencias entre un producto existente y una fila del Excel (solo campos no vacíos). */
export function diffProduct(existing, data) {
  const changes = [];
  for (const c of COLUMNS) {
    if (c.key === 'sku') continue;
    const next = data[c.key];
    if (next === null || next === undefined) continue;
    if (comparable(c.key, existing[c.key]) !== comparable(c.key, next)) {
      changes.push({ key: c.key, field: c.header, from: existing[c.key], to: next });
    }
  }
  return changes;
}

/**
 * Compara el archivo con los productos actuales y clasifica cada fila.
 * Devuelve { added, modified, unchanged, errors, warnings }.
 */
export function buildImportPlan(parsed, currentProducts) {
  const bySku = new Map(currentProducts.map((p) => [String(p.sku).toUpperCase(), p]));
  const plan = { added: [], modified: [], unchanged: [], errors: [...parsed.errors], warnings: [...parsed.warnings] };
  for (const { rowNumber, data } of parsed.rows) {
    const existing = bySku.get(data.sku);
    if (!existing) {
      const errs = validateNew(data);
      if (errs.length) { errs.forEach((e) => plan.errors.push({ row: rowNumber, sku: data.sku, ...e })); continue; }
      plan.added.push({ rowNumber, data });
      continue;
    }
    const changes = diffProduct(existing, data);
    if (!changes.length) { plan.unchanged.push({ rowNumber, data, existing }); continue; }
    const stockKeys = ['stock_bottles', 'stock_5ml', 'stock_10ml', 'decant_ml'];
    const stockChanged = changes.some((ch) => stockKeys.includes(ch.key));
    plan.modified.push({ rowNumber, data, existing, changes, stockChanged });
  }
  for (const item of [...plan.added, ...plan.modified]) {
    const d = { ...(item.existing || {}), ...Object.fromEntries(Object.entries(item.data).filter(([, v]) => v !== null)) };
    const offersDecant = Number(d.price_5ml) > 0 || Number(d.price_10ml) > 0;
    if (offersDecant && !(Number(d.decant_ml) > 0) && !(Number(d.stock_5ml) > 0) && !(Number(d.stock_10ml) > 0)) {
      plan.warnings.push({ row: item.rowNumber, sku: d.sku, field: 'Decants', message: 'Tiene precio de decant pero 0 ml y 0 decants preparados: se mostrará como agotado en decants.' });
    }
  }
  plan.errors.sort((a, b) => a.row - b.row);
  return plan;
}

/** Convierte la fila validada al objeto que espera import_products() en la base de datos. */
export function toImportPayload(data) {
  const out = {};
  for (const c of COLUMNS) out[c.key] = data[c.key] ?? null;
  return out;
}
