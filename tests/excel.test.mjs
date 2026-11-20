// Pruebas del sistema Excel: plantilla, lectura, validación, vista previa
// e importación real a la base de datos (PGlite con supabase/schema.sql).
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { PGlite } from '@electric-sql/pglite';
import { buildWorkbook, parseWorkbook, buildImportPlan, toImportPayload, COLUMNS } from '../js/excel-schema.js';
import { availableUnits, presentationsOf } from '../js/inventory.js';

const ADMIN = '11111111-1111-1111-1111-111111111111';
let db;
const admin = (fn) => db.transaction(async (tx) => {
  await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [ADMIN]);
  await tx.exec('set local role authenticated');
  return fn(tx);
});
const listProducts = async () => (await admin((tx) => tx.query('select * from products order by sku'))).rows
  .map((p) => ({ ...p, price_bottle: Number(p.price_bottle), price_5ml: Number(p.price_5ml), price_10ml: Number(p.price_10ml), decant_ml: Number(p.decant_ml) }));
const toBuffer = async (wb) => Buffer.from(await wb.xlsx.writeBuffer());

before(async () => {
  db = new PGlite();
  await db.exec(readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
  await db.exec(readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
  await db.query(`insert into auth.users values ($1,'admin@test')`, [ADMIN]);
  await db.query(`insert into admins (user_id) values ($1)`, [ADMIN]);
});

test('la plantilla tiene las hojas, encabezados, validaciones y formato de moneda', async () => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(readFileSync(new URL('../plantilla/Plantilla_Inventario_AJRO_HOUSE.xlsx', import.meta.url)));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ['Inventario', 'Instrucciones', 'Listas']);
  const ws = wb.getWorksheet('Inventario');
  const headers = ws.getRow(1).values.slice(1);
  assert.equal(headers.length, COLUMNS.length);
  assert.equal(headers[0], 'SKU *');
  assert.ok(ws.autoFilter, 'tiene filtros automáticos');
  assert.equal(ws.getColumn(7).numFmt, '"L." #,##0.00');
  const dv = ws.dataValidations.model;
  assert.ok(Object.keys(dv).length >= 10, 'tiene validaciones');
});

test('el inventario inicial (93 perfumes) se importa y aparece en el catálogo público', async () => {
  const buf = readFileSync(new URL('../plantilla/Inventario_Inicial_AJRO_HOUSE.xlsx', import.meta.url));
  const parsed = await parseWorkbook(ExcelJS, buf);
  assert.equal(parsed.errors.length, 0, JSON.stringify(parsed.errors.slice(0, 3)));
  assert.equal(parsed.rows.length, 93);
  const plan = buildImportPlan(parsed, []);
  assert.equal(plan.added.length, 93);
  const res = await admin((tx) => tx.query('select import_products($1::jsonb) as r',
    [JSON.stringify(plan.added.map((a) => toImportPayload(a.data)))]));
  assert.deepEqual(res.rows[0].r, { inserted: 93, updated: 0, unchanged: 0 });
  // Lo que ve un visitante anónimo
  const pub = await db.transaction(async (tx) => { await tx.exec('set local role anon'); return tx.query(`select sku, status from products`); });
  assert.equal(pub.rows.length, 91, 'los 2 duplicados quedan inactivos y ocultos');
});

test('flujo completo: exportar, editar en Excel, vista previa y actualización por SKU', async () => {
  const current = await listProducts();
  const exported = buildWorkbook(ExcelJS, current, { exportedAt: new Date() });
  // Simular edición en Excel
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await toBuffer(exported));
  const ws = wb.getWorksheet('Inventario');
  const col = (key) => COLUMNS.findIndex((c) => c.key === key) + 1;
  ws.getRow(2).getCell(col('price_bottle')).value = 4100;            // AJ-0001 cambia precio
  ws.getRow(2).getCell(col('stock_bottles')).value = 3;              // y existencias
  ws.getRow(2).getCell(col('decant_ml')).value = 100;
  ws.getRow(3).getCell(col('name')).value = '';                      // vacío = conservar
  const newRow = ws.addRow([]);                                      // perfume nuevo
  const vals = { sku: 'AJ-9001', name: 'Perfume de prueba Excel', brand: 'Lattafa', gender: 'unisex',
    perfume_type: 'arabe', price_bottle: 'L. 1,250.00', stock_bottles: 5, price_5ml: 150, decant_ml: 40,
    status: 'activo', featured: 'Sí', image: 'prueba.jpg' };
  Object.entries(vals).forEach(([k, v]) => { newRow.getCell(col(k)).value = v; });
  const bad = ws.addRow([]);                                         // fila con errores
  bad.getCell(col('sku')).value = 'AJ-0001';                         // duplicado en el archivo
  bad.getCell(col('stock_bottles')).value = -2;

  const parsed = await parseWorkbook(ExcelJS, await toBuffer(wb));
  assert.ok(parsed.exportedAt instanceof Date, 'conserva la fecha de exportación');
  const plan = buildImportPlan(parsed, current);
  assert.equal(plan.added.length, 1);
  assert.equal(plan.added[0].data.gender, 'Unisex', 'acepta minúsculas y sin acentos');
  assert.equal(plan.added[0].data.perfume_type, 'Árabe');
  assert.equal(plan.added[0].data.price_bottle, 1250);
  assert.equal(plan.modified.length, 1);
  assert.deepEqual(plan.modified[0].changes.map((c) => c.key).sort(), ['decant_ml', 'price_bottle', 'stock_bottles']);
  assert.ok(plan.modified[0].stockChanged);
  assert.ok(plan.errors.some((e) => /repetido/.test(e.message)), 'detecta SKU repetido');
  assert.ok(plan.errors.some((e) => /mayor o igual a 0/.test(e.message)), 'detecta existencias negativas');
  assert.equal(plan.unchanged.length, 92);

  const payload = [...plan.added, ...plan.modified].map((x) => toImportPayload(x.data));
  const res = await admin((tx) => tx.query('select import_products($1::jsonb) as r', [JSON.stringify(payload)]));
  assert.deepEqual(res.rows[0].r, { inserted: 1, updated: 1, unchanged: 0 });

  const after = await listProducts();
  assert.equal(after.length, 94, 'no se duplicó nada');
  const p1 = after.find((p) => p.sku === 'AJ-0001');
  assert.equal(p1.price_bottle, 4100);
  assert.equal(p1.stock_bottles, 3);
  assert.equal(availableUnits(p1, '10ml'), 10);
  const p2 = after.find((p) => p.sku === 'AJ-0002');
  assert.equal(p2.name, 'VALENTINO UOMO INTENSE', 'la celda vacía no borró el nombre');
  const pNew = after.find((p) => p.sku === 'AJ-9001');
  assert.equal(pNew.featured, true);
  assert.deepEqual(presentationsOf(pNew).map((x) => [x.key, x.price, x.available]), [['botella', 1250, 5], ['5ml', 150, 8]]);
});

test('archivo sin columna SKU se rechaza con un mensaje claro', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Inventario');
  ws.addRow(['Nombre', 'Marca']);
  ws.addRow(['X', 'Y']);
  const parsed = await parseWorkbook(ExcelJS, await toBuffer(wb));
  assert.match(parsed.errors[0].message, /No se encontró la columna "SKU"/);
});
