// Pruebas reales del esquema SQL (supabase/schema.sql) sobre PostgreSQL
// embebido (PGlite). Ejecutar con:  npm test
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const ADMIN = '11111111-1111-1111-1111-111111111111';
const USER  = '22222222-2222-2222-2222-222222222222';
let db;

// Ejecuta fn como un rol de Supabase ('anon' o 'authenticated' con uid)
async function as(role, uid, fn) {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid || '']);
    await tx.exec(`set local role ${role}`);
    return fn(tx);
  });
}
const admin = (fn) => as('authenticated', ADMIN, fn);
const anon  = (fn) => as('anon', null, fn);
const one = async (tx, sql, params) => (await tx.query(sql, params)).rows[0];

before(async () => {
  db = new PGlite();
  await db.exec(readFileSync(new URL('./supabase-stub.sql', import.meta.url), 'utf8'));
  const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  await db.exec(schema);
  await db.exec(schema); // debe poder ejecutarse dos veces sin errores
  await db.query(`insert into auth.users values ($1,'admin@test'),($2,'cliente@test')`, [ADMIN, USER]);
  await db.query(`insert into public.admins (user_id, email) values ($1, 'admin@test')`, [ADMIN]);
});

const newProduct = (sku, extra = {}) => ({
  sku, name: 'Perfume ' + sku, brand: 'Marca', gender: 'Masculino', perfume_type: 'Diseñador',
  bottle_ml: 100, price_bottle: 3000, price_5ml: 250, price_10ml: 450, ...extra,
});

async function insertProduct(p) {
  return admin((tx) => one(tx,
    `insert into products (sku,name,brand,gender,perfume_type,bottle_ml,price_bottle,price_5ml,price_10ml,stock_bottles,status,discount_pct)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,coalesce($11,'Activo'),coalesce($12,0)) returning *`,
    [p.sku, p.name, p.brand, p.gender, p.perfume_type, p.bottle_ml, p.price_bottle, p.price_5ml,
     p.price_10ml, p.stock_bottles ?? 0, p.status ?? null, p.discount_pct ?? null]));
}

test('anónimo no puede crear productos ni ver pedidos o movimientos', async () => {
  await assert.rejects(anon((tx) => tx.query(
    `insert into products (sku,name,brand,gender,perfume_type) values ('X1','Nombre','M','Masculino','Diseñador')`)));
  await assert.rejects(anon((tx) => tx.query('select * from orders')), /permission denied/);
  await assert.rejects(anon((tx) => tx.query('select * from inventory_movements')));
});

test('usuario autenticado sin permiso de admin no puede modificar inventario', async () => {
  const p = await insertProduct(newProduct('NOADM-1', { stock_bottles: 1 }));
  await assert.rejects(
    as('authenticated', USER, (tx) => tx.query(`select adjust_stock($1,'entrada',1,0,0,0,null)`, [p.id])),
    /No autorizado/);
  const r = await as('authenticated', USER, (tx) => tx.query(`update products set price_bottle = 1 where id = $1`, [p.id]));
  assert.equal(r.affectedRows ?? 0, 0);
});

test('existencias iniciales se registran como entrada', async () => {
  const p = await insertProduct(newProduct('ENT-1', { stock_bottles: 3 }));
  const m = await admin((tx) => one(tx, `select * from inventory_movements where product_id = $1`, [p.id]));
  assert.equal(m.kind, 'entrada');
  assert.equal(m.bottles_delta, 3);
});

test('control de mililitros: 100 ml -> vender 5 -> 95 -> vender 10 -> 85', async () => {
  const p = await insertProduct(newProduct('ML-1', { stock_bottles: 2 }));
  const opened = await admin((tx) => one(tx, `select * from open_bottle($1, 1, null)`, [p.id]));
  assert.equal(opened.stock_bottles, 1, 'queda 1 botella sellada');
  assert.equal(Number(opened.decant_ml), 100, '100 ml para decants');

  // Pedido de 5 ml: queda pendiente y NO descuenta
  const o1 = await anon((tx) => one(tx, `select create_order($1::jsonb) as r`,
    [JSON.stringify([{ sku: 'ML-1', presentation: '5ml', qty: 1 }])]));
  let cur = await admin((tx) => one(tx, `select decant_ml from products where id = $1`, [p.id]));
  assert.equal(Number(cur.decant_ml), 100, 'un pedido pendiente no descuenta');

  const ord1 = await admin((tx) => one(tx, `select id from orders where code = $1`, [o1.r.code]));
  await admin((tx) => tx.query(`select confirm_order($1)`, [ord1.id]));
  cur = await admin((tx) => one(tx, `select * from products where id = $1`, [p.id]));
  assert.equal(Number(cur.decant_ml), 95);
  assert.equal(cur.stock_bottles, 1, 'las botellas selladas no se tocan');

  const o2 = await anon((tx) => one(tx, `select create_order($1::jsonb) as r`,
    [JSON.stringify([{ sku: 'ML-1', presentation: '10ml', qty: 1 }])]));
  const ord2 = await admin((tx) => one(tx, `select id from orders where code = $1`, [o2.r.code]));
  await admin((tx) => tx.query(`select confirm_order($1)`, [ord2.id]));
  cur = await admin((tx) => one(tx, `select * from products where id = $1`, [p.id]));
  assert.equal(Number(cur.decant_ml), 85);

  const moves = await admin((tx) => tx.query(
    `select kind, decant_ml_delta, decant_ml_after from inventory_movements where product_id = $1 order by id`, [p.id]));
  assert.deepEqual(moves.rows.map((m) => [m.kind, Number(m.decant_ml_delta), Number(m.decant_ml_after)]),
    [['entrada', 0, 0], ['apertura', 100, 100], ['venta', -5, 95], ['venta', -10, 85]]);
});

test('no permite vender más líquido del disponible', async () => {
  const p = await insertProduct(newProduct('ML-2', { stock_bottles: 1 }));
  await admin((tx) => tx.query(`select open_bottle($1, 1, null)`, [p.id])); // 100 ml
  await assert.rejects(anon((tx) => tx.query(`select create_order($1::jsonb)`,
    [JSON.stringify([{ sku: 'ML-2', presentation: '10ml', qty: 8 }, { sku: 'ML-2', presentation: '5ml', qty: 5 }])])),
    /no hay suficiente perfume/);
  // 10 x 10 ml = 100 ml exactos sí se permite
  const ok = await anon((tx) => one(tx, `select create_order($1::jsonb) as r`,
    [JSON.stringify([{ sku: 'ML-2', presentation: '10ml', qty: 10 }])]));
  assert.ok(ok.r.code.startsWith('AJ-'));
  // Dos pedidos pendientes que juntos superan el stock: el segundo no se puede confirmar
  const ok2 = await anon((tx) => one(tx, `select create_order($1::jsonb) as r`,
    [JSON.stringify([{ sku: 'ML-2', presentation: '5ml', qty: 1 }])]));
  const id1 = (await admin((tx) => one(tx, `select id from orders where code=$1`, [ok.r.code]))).id;
  const id2 = (await admin((tx) => one(tx, `select id from orders where code=$1`, [ok2.r.code]))).id;
  await admin((tx) => tx.query(`select confirm_order($1)`, [id1]));
  await assert.rejects(admin((tx) => tx.query(`select confirm_order($1)`, [id2])), /No se puede confirmar/);
  const st = await admin((tx) => one(tx, `select status from orders where id=$1`, [id2]));
  assert.equal(st.status, 'pendiente');
});

test('decants preparados se usan antes que el líquido; varias botellas suman líquido', async () => {
  const p = await insertProduct(newProduct('PREP-1', { stock_bottles: 3 }));
  await admin((tx) => tx.query(`select open_bottle($1, 2, null)`, [p.id]));
  let cur = await admin((tx) => one(tx, `select * from products where id=$1`, [p.id]));
  assert.equal(Number(cur.decant_ml), 200);
  assert.equal(cur.stock_bottles, 1);
  await admin((tx) => tx.query(`select prepare_decants($1, 5, 2, null)`, [p.id]));
  cur = await admin((tx) => one(tx, `select * from products where id=$1`, [p.id]));
  assert.equal(Number(cur.decant_ml), 190);
  assert.equal(cur.stock_5ml, 2);
  const o = await anon((tx) => one(tx, `select create_order($1::jsonb) as r`,
    [JSON.stringify([{ sku: 'PREP-1', presentation: '5ml', qty: 3 }, { sku: 'PREP-1', presentation: 'botella', qty: 1 }])]));
  const id = (await admin((tx) => one(tx, `select id from orders where code=$1`, [o.r.code]))).id;
  await admin((tx) => tx.query(`select confirm_order($1)`, [id]));
  cur = await admin((tx) => one(tx, `select * from products where id=$1`, [p.id]));
  assert.equal(cur.stock_5ml, 0, 'usa los 2 preparados');
  assert.equal(Number(cur.decant_ml), 185, 'y 5 ml de líquido');
  assert.equal(cur.stock_bottles, 0);

  // Cancelar el pedido confirmado devuelve exactamente lo descontado
  await admin((tx) => tx.query(`select cancel_order($1)`, [id]));
  cur = await admin((tx) => one(tx, `select * from products where id=$1`, [p.id]));
  assert.equal(cur.stock_5ml, 2);
  assert.equal(Number(cur.decant_ml), 190);
  assert.equal(cur.stock_bottles, 1);
});

test('salida no puede dejar existencias negativas', async () => {
  const p = await insertProduct(newProduct('NEG-1', { stock_bottles: 1 }));
  await assert.rejects(admin((tx) => tx.query(`select adjust_stock($1,'salida',-2,0,0,0,'rotura')`, [p.id])),
    /Solo hay 1 botella/);
  await assert.rejects(admin((tx) => tx.query(`select adjust_stock($1,'entrada',-1,0,0,0,null)`, [p.id])),
    /solo puede sumar/);
  const r = await admin((tx) => one(tx, `select * from adjust_stock($1,'salida',-1,0,0,0,'Regalo')`, [p.id]));
  assert.equal(r.stock_bottles, 0);
});

test('pedidos: precios calculados en el servidor, inactivos y próximamente rechazados', async () => {
  await insertProduct(newProduct('DESC-1', { stock_bottles: 5, discount_pct: 10 }));
  await insertProduct(newProduct('INAC-1', { stock_bottles: 5, status: 'Inactivo' }));
  await insertProduct(newProduct('PROX-1', { stock_bottles: 5, status: 'Próximamente' }));
  const o = await anon((tx) => one(tx, `select create_order($1::jsonb,'Ana','') as r`,
    [JSON.stringify([{ sku: 'desc-1', presentation: 'botella', qty: 2 }])]));
  assert.equal(Number(o.r.items[0].unit_price), 2700);
  assert.equal(Number(o.r.total), 5400);
  await assert.rejects(anon((tx) => tx.query(`select create_order($1::jsonb)`,
    [JSON.stringify([{ sku: 'INAC-1', presentation: 'botella', qty: 1 }])])), /ya no está disponible/);
  await assert.rejects(anon((tx) => tx.query(`select create_order($1::jsonb)`,
    [JSON.stringify([{ sku: 'PROX-1', presentation: 'botella', qty: 1 }])])), /ya no está disponible/);
  await assert.rejects(anon((tx) => tx.query(`select create_order($1::jsonb)`,
    [JSON.stringify([{ sku: 'DESC-1', presentation: 'botella', qty: 0 }])])), /Cantidad no válida/);
  const vis = await anon((tx) => tx.query(`select sku from products where sku in ('INAC-1','PROX-1')`));
  assert.deepEqual(vis.rows.map((r) => r.sku), ['PROX-1'], 'el público no ve inactivos');
});

test('importación por SKU: crea, actualiza sin duplicar, conserva vacíos y es todo-o-nada', async () => {
  const rows = [
    { sku: 'IMP-1', name: 'Importado Uno', brand: 'Armaf', gender: 'Unisex', perfume_type: 'Árabe',
      price_bottle: 1800, stock_bottles: 4, decant_ml: 50, status: 'Activo' },
    { sku: 'IMP-2', name: 'Importado Dos', brand: 'Lattafa', gender: 'Femenino', perfume_type: 'Árabe',
      price_bottle: 1500, status: 'Activo' },
  ];
  let r = await admin((tx) => one(tx, `select import_products($1::jsonb) as r`, [JSON.stringify(rows)]));
  assert.deepEqual(r.r, { inserted: 2, updated: 0, unchanged: 0 });

  r = await admin((tx) => one(tx, `select import_products($1::jsonb) as r`, [JSON.stringify([
    { sku: 'imp-1', name: null, brand: null, gender: null, perfume_type: null, price_bottle: 1900, stock_bottles: 6 },
    { sku: 'IMP-2', name: 'Importado Dos' },
  ])]));
  assert.deepEqual(r.r, { inserted: 0, updated: 1, unchanged: 1 });
  const p = await admin((tx) => one(tx, `select * from products where sku='IMP-1'`));
  assert.equal(p.name, 'Importado Uno', 'un campo vacío no borra el valor');
  assert.equal(Number(p.price_bottle), 1900);
  assert.equal(p.stock_bottles, 6);
  assert.equal(Number(p.decant_ml), 50);
  const count = await admin((tx) => one(tx, `select count(*)::int c from products where sku like 'IMP-%'`));
  assert.equal(count.c, 2, 'no se duplica');
  const mv = await admin((tx) => one(tx,
    `select kind, bottles_delta from inventory_movements where sku='IMP-1' order by id desc limit 1`));
  assert.deepEqual([mv.kind, mv.bottles_delta], ['importacion', 2]);

  // Una fila inválida cancela toda la importación
  await assert.rejects(admin((tx) => tx.query(`select import_products($1::jsonb)`, [JSON.stringify([
    { sku: 'IMP-3', name: 'Válido', brand: 'X', gender: 'Masculino', perfume_type: 'Nicho' },
    { sku: 'IMP-4', name: 'Inválido', brand: 'X', gender: 'Niño', perfume_type: 'Nicho' },
  ])])), /SKU IMP-4/);
  const c3 = await admin((tx) => one(tx, `select count(*)::int c from products where sku='IMP-3'`));
  assert.equal(c3.c, 0);
  await assert.rejects(as('authenticated', USER, (tx) => tx.query(`select import_products('[]'::jsonb)`)), /No autorizado/);
});

test('más vendidos solo cuenta pedidos confirmados', async () => {
  const rows = await anon((tx) => tx.query(`select * from best_sellers(8)`));
  const skus = rows.rows.map((r) => r.sku);
  assert.ok(skus.includes('ML-1'));
  assert.ok(!skus.includes('DESC-1'), 'DESC-1 solo tiene un pedido pendiente');
  assert.ok(!skus.includes('PREP-1'), 'PREP-1 fue cancelado');
});
