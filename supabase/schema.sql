-- =====================================================================
-- AJRO HOUSE · Esquema de base de datos (Supabase / PostgreSQL)
-- ---------------------------------------------------------------------
-- Cómo usarlo: Supabase > SQL Editor > New query > pega TODO este
-- archivo > Run. Se puede ejecutar más de una vez sin perder datos
-- (usa "if not exists" / "create or replace").
--
-- Reglas de inventario:
--   * Botellas selladas (stock_bottles) y líquido para decants
--     (decant_ml) son existencias SEPARADAS.
--   * stock_5ml / stock_10ml = decants YA PREPARADOS (frascos llenos).
--   * Disponibles 5 ml  = stock_5ml  + floor(decant_ml / 5)
--     Disponibles 10 ml = stock_10ml + floor(decant_ml / 10)
--     (5 ml y 10 ml comparten el mismo líquido; al confirmar un pedido
--      se valida el total de mililitros).
--   * Un pedido de WhatsApp queda "pendiente" y NO descuenta nada.
--     Solo al CONFIRMARLO el administrador se descuentan existencias.
--   * Todo cambio de existencias queda en inventory_movements.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Administradores
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 2. Productos
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id                  uuid primary key default gen_random_uuid(),
  sku                 text not null unique
                      check (sku ~ '^[A-Z0-9][A-Z0-9_-]{1,39}$'),
  name                text not null check (char_length(btrim(name)) between 2 and 120),
  brand               text not null check (char_length(btrim(brand)) between 1 and 80),
  gender              text not null check (gender in ('Masculino','Femenino','Unisex')),
  perfume_type        text not null check (perfume_type in ('Diseñador','Árabe','Nicho')),
  description         text not null default '' check (char_length(description) <= 1000),
  bottle_ml           integer check (bottle_ml is null or bottle_ml between 1 and 1000),
  price_bottle        numeric(10,2) not null default 0 check (price_bottle >= 0),
  price_5ml           numeric(10,2) not null default 0 check (price_5ml >= 0),
  price_10ml          numeric(10,2) not null default 0 check (price_10ml >= 0),
  discount_pct        integer not null default 0 check (discount_pct between 0 and 90),
  stock_bottles       integer not null default 0 check (stock_bottles >= 0),
  stock_5ml           integer not null default 0 check (stock_5ml >= 0),
  stock_10ml          integer not null default 0 check (stock_10ml >= 0),
  decant_ml           numeric(8,1) not null default 0 check (decant_ml >= 0),
  low_stock_threshold integer not null default 1 check (low_stock_threshold >= 0),
  image               text not null default '' check (char_length(image) <= 500),
  featured            boolean not null default false,
  is_new              boolean not null default false,
  status              text not null default 'Activo'
                      check (status in ('Activo','Inactivo','Próximamente')),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists products_status_idx on public.products (status);
create index if not exists products_brand_idx  on public.products (brand);

-- ---------------------------------------------------------------------
-- 3. Historial de movimientos de inventario
-- ---------------------------------------------------------------------
create table if not exists public.inventory_movements (
  id               bigint generated always as identity primary key,
  product_id       uuid references public.products(id) on delete set null,
  sku              text not null,
  product_name     text not null,
  kind             text not null check (kind in
                   ('entrada','salida','ajuste','apertura','preparacion',
                    'venta','anulacion','importacion')),
  bottles_delta    integer not null default 0,
  stock_5ml_delta  integer not null default 0,
  stock_10ml_delta integer not null default 0,
  decant_ml_delta  numeric(8,1) not null default 0,
  bottles_after    integer not null,
  stock_5ml_after  integer not null,
  stock_10ml_after integer not null,
  decant_ml_after  numeric(8,1) not null,
  note             text,
  order_id         uuid,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now()
);

create index if not exists movements_created_idx on public.inventory_movements (created_at desc);
create index if not exists movements_product_idx on public.inventory_movements (product_id);

-- ---------------------------------------------------------------------
-- 4. Pedidos (generados desde el carrito de WhatsApp)
-- ---------------------------------------------------------------------
create table if not exists public.orders (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  status        text not null default 'pendiente'
                check (status in ('pendiente','confirmado','cancelado')),
  items         jsonb not null,
  total         numeric(12,2) not null check (total >= 0),
  customer_name text check (customer_name is null or char_length(customer_name) <= 80),
  note          text check (note is null or char_length(note) <= 500),
  consumption   jsonb,
  created_at    timestamptz not null default now(),
  confirmed_at  timestamptz,
  confirmed_by  uuid,
  cancelled_at  timestamptz
);

create index if not exists orders_created_idx on public.orders (created_at desc);

-- ---------------------------------------------------------------------
-- 5. Triggers: updated_at y registro automático de movimientos
-- ---------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists products_touch on public.products;
create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();

-- Cualquier cambio en existencias (formulario, importación, pedido...)
-- se registra aquí. Las funciones RPC indican el tipo de movimiento con
-- set_config('ajro.kind', ...), y una nota con 'ajro.note'.
create or replace function public.log_stock_change()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_kind  text := nullif(current_setting('ajro.kind',  true), '');
  v_note  text := nullif(current_setting('ajro.note',  true), '');
  v_order uuid := nullif(current_setting('ajro.order', true), '')::uuid;
  d_b int := 0; d_5 int := 0; d_10 int := 0; d_ml numeric := 0;
begin
  if tg_op = 'INSERT' then
    d_b := new.stock_bottles; d_5 := new.stock_5ml; d_10 := new.stock_10ml; d_ml := new.decant_ml;
    v_kind := coalesce(v_kind, 'entrada');
    v_note := coalesce(v_note, 'Existencias iniciales');
  else
    d_b  := new.stock_bottles - old.stock_bottles;
    d_5  := new.stock_5ml     - old.stock_5ml;
    d_10 := new.stock_10ml    - old.stock_10ml;
    d_ml := new.decant_ml     - old.decant_ml;
    v_kind := coalesce(v_kind, 'ajuste');
  end if;

  if d_b = 0 and d_5 = 0 and d_10 = 0 and d_ml = 0 then
    return new;
  end if;

  insert into public.inventory_movements
    (product_id, sku, product_name, kind,
     bottles_delta, stock_5ml_delta, stock_10ml_delta, decant_ml_delta,
     bottles_after, stock_5ml_after, stock_10ml_after, decant_ml_after,
     note, order_id)
  values
    (new.id, new.sku, new.name, v_kind,
     d_b, d_5, d_10, d_ml,
     new.stock_bottles, new.stock_5ml, new.stock_10ml, new.decant_ml,
     v_note, v_order);
  return new;
end $$;

drop trigger if exists products_log_stock on public.products;
create trigger products_log_stock
  after insert or update of stock_bottles, stock_5ml, stock_10ml, decant_ml
  on public.products
  for each row execute function public.log_stock_change();

-- ---------------------------------------------------------------------
-- 6. Funciones auxiliares
-- ---------------------------------------------------------------------
create or replace function public._require_admin()
returns void language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'No autorizado: se requiere una cuenta de administrador.'
      using errcode = '42501';
  end if;
end $$;

create or replace function public._effective_price(p_price numeric, p_discount int)
returns numeric language sql immutable as $$
  select round(p_price * (100 - coalesce(p_discount, 0)) / 100.0);
$$;

-- ---------------------------------------------------------------------
-- 7. Movimientos manuales de inventario (solo administradores)
-- ---------------------------------------------------------------------
-- p_kind: 'entrada' | 'salida' | 'ajuste'
-- Los valores son VARIACIONES (positivas o negativas).
create or replace function public.adjust_stock(
  p_product uuid, p_kind text,
  p_bottles int default 0, p_5ml int default 0, p_10ml int default 0,
  p_ml numeric default 0, p_note text default null)
returns public.products
language plpgsql security definer
set search_path = public
as $$
declare p public.products;
begin
  perform public._require_admin();
  if p_kind not in ('entrada','salida','ajuste') then
    raise exception 'Tipo de movimiento no válido: %', p_kind;
  end if;
  if coalesce(p_bottles,0) = 0 and coalesce(p_5ml,0) = 0
     and coalesce(p_10ml,0) = 0 and coalesce(p_ml,0) = 0 then
    raise exception 'Indica al menos una cantidad distinta de cero.';
  end if;
  if p_kind = 'entrada' and (p_bottles < 0 or p_5ml < 0 or p_10ml < 0 or p_ml < 0) then
    raise exception 'Una entrada solo puede sumar existencias.';
  end if;
  if p_kind = 'salida' and (p_bottles > 0 or p_5ml > 0 or p_10ml > 0 or p_ml > 0) then
    raise exception 'Una salida solo puede restar existencias.';
  end if;

  select * into p from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  if p.stock_bottles + coalesce(p_bottles,0) < 0 then
    raise exception 'Solo hay % botella(s) sellada(s) de %.', p.stock_bottles, p.name;
  end if;
  if p.stock_5ml + coalesce(p_5ml,0) < 0 then
    raise exception 'Solo hay % decant(s) de 5 ml preparados de %.', p.stock_5ml, p.name;
  end if;
  if p.stock_10ml + coalesce(p_10ml,0) < 0 then
    raise exception 'Solo hay % decant(s) de 10 ml preparados de %.', p.stock_10ml, p.name;
  end if;
  if p.decant_ml + coalesce(p_ml,0) < 0 then
    raise exception 'Solo hay % ml disponibles para decants de %.', p.decant_ml, p.name;
  end if;

  perform set_config('ajro.kind', p_kind, true);
  perform set_config('ajro.note', coalesce(p_note, ''), true);

  update public.products set
    stock_bottles = stock_bottles + coalesce(p_bottles,0),
    stock_5ml     = stock_5ml     + coalesce(p_5ml,0),
    stock_10ml    = stock_10ml    + coalesce(p_10ml,0),
    decant_ml     = decant_ml     + coalesce(p_ml,0)
  where id = p_product
  returning * into p;
  return p;
end $$;

-- Abrir botellas selladas para decants: resta botellas y suma su
-- contenido (bottle_ml) al líquido disponible para decants.
create or replace function public.open_bottle(
  p_product uuid, p_count int default 1, p_note text default null)
returns public.products
language plpgsql security definer
set search_path = public
as $$
declare p public.products;
begin
  perform public._require_admin();
  if p_count is null or p_count < 1 then
    raise exception 'La cantidad de botellas debe ser 1 o más.';
  end if;
  select * into p from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if p.bottle_ml is null then
    raise exception 'Registra primero el tamaño de la botella (ml) de %.', p.name;
  end if;
  if p.stock_bottles < p_count then
    raise exception 'Solo hay % botella(s) sellada(s) de %.', p.stock_bottles, p.name;
  end if;

  perform set_config('ajro.kind', 'apertura', true);
  perform set_config('ajro.note',
    coalesce(p_note, format('Apertura de %s botella(s) de %s ml para decants', p_count, p.bottle_ml)), true);

  update public.products set
    stock_bottles = stock_bottles - p_count,
    decant_ml     = decant_ml + (p_count * p.bottle_ml)
  where id = p_product
  returning * into p;
  return p;
end $$;

-- Preparar decants: pasa líquido a frascos de 5 ml o 10 ml ya llenos.
create or replace function public.prepare_decants(
  p_product uuid, p_size int, p_count int, p_note text default null)
returns public.products
language plpgsql security definer
set search_path = public
as $$
declare p public.products;
begin
  perform public._require_admin();
  if p_size not in (5, 10) then raise exception 'El tamaño debe ser 5 o 10 ml.'; end if;
  if p_count is null or p_count < 1 then raise exception 'La cantidad debe ser 1 o más.'; end if;
  select * into p from public.products where id = p_product for update;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if p.decant_ml < p_size * p_count then
    raise exception 'Se necesitan % ml y solo hay % ml de %.', p_size * p_count, p.decant_ml, p.name;
  end if;

  perform set_config('ajro.kind', 'preparacion', true);
  perform set_config('ajro.note',
    coalesce(p_note, format('Preparación de %s decant(s) de %s ml', p_count, p_size)), true);

  update public.products set
    decant_ml  = decant_ml - (p_size * p_count),
    stock_5ml  = stock_5ml  + case when p_size = 5  then p_count else 0 end,
    stock_10ml = stock_10ml + case when p_size = 10 then p_count else 0 end
  where id = p_product
  returning * into p;
  return p;
end $$;

-- ---------------------------------------------------------------------
-- 8. Pedidos
-- ---------------------------------------------------------------------
-- Cálculo de consumo: primero se usan los decants ya preparados y luego
-- el líquido. Devuelve null si alcanza o un mensaje de error si no.
create or replace function public._check_capacity(
  p public.products, q_b int, q_5 int, q_10 int)
returns text language plpgsql immutable as $$
declare
  ml_needed numeric;
begin
  if q_b > p.stock_bottles then
    return format('%s: solo hay %s botella(s) sellada(s).', p.name, p.stock_bottles);
  end if;
  ml_needed := greatest(q_5 - p.stock_5ml, 0) * 5 + greatest(q_10 - p.stock_10ml, 0) * 10;
  if ml_needed > p.decant_ml then
    return format('%s: no hay suficiente perfume para los decants solicitados (disponible: %s ml).',
                  p.name, p.decant_ml);
  end if;
  return null;
end $$;

-- Crea un pedido PENDIENTE a partir del carrito. Lo puede llamar cualquier
-- visitante. Los precios se calculan aquí (no se confía en el navegador).
-- p_items: [{"sku":"AJ-0001","presentation":"botella|5ml|10ml","qty":1}, ...]
create or replace function public.create_order(
  p_items jsonb, p_customer text default null, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  it        record;
  agg       record;
  p         public.products;
  v_items   jsonb := '[]'::jsonb;
  v_total   numeric := 0;
  v_price   numeric;
  v_code    text;
  v_err     text;
  v_label   text;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito está vacío.';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'El pedido supera el máximo de 30 líneas.';
  end if;
  if (select count(*) from public.orders
       where status = 'pendiente' and created_at > now() - interval '1 hour') > 300 then
    raise exception 'Hay demasiados pedidos pendientes. Intenta de nuevo más tarde.';
  end if;

  for it in
    select upper(btrim(x.sku)) as sku, x.presentation, x.qty
    from jsonb_to_recordset(p_items) as x(sku text, presentation text, qty int)
  loop
    if it.presentation not in ('botella','5ml','10ml') then
      raise exception 'Presentación no válida.';
    end if;
    if it.qty is null or it.qty < 1 or it.qty > 20 then
      raise exception 'Cantidad no válida (1 a 20 por línea).';
    end if;
    select * into p from public.products where sku = it.sku;
    if not found or p.status <> 'Activo' then
      raise exception 'El producto % ya no está disponible.', it.sku;
    end if;
    v_price := case it.presentation
                 when 'botella' then p.price_bottle
                 when '5ml'     then p.price_5ml
                 else                p.price_10ml end;
    if v_price <= 0 then
      raise exception '% no se vende en la presentación seleccionada.', p.name;
    end if;
    v_price := public._effective_price(v_price, p.discount_pct);
    v_label := case it.presentation when 'botella' then 'Botella sellada'
                 when '5ml' then 'Decant 5 ml' else 'Decant 10 ml' end;
    v_items := v_items || jsonb_build_object(
      'sku', p.sku, 'name', p.name, 'brand', p.brand,
      'presentation', it.presentation, 'label', v_label,
      'qty', it.qty, 'unit_price', v_price, 'subtotal', v_price * it.qty);
    v_total := v_total + v_price * it.qty;
  end loop;

  -- Validar disponibilidad total por producto (5 ml y 10 ml comparten líquido)
  for agg in
    select x->>'sku' as sku,
           sum(case when x->>'presentation' = 'botella' then (x->>'qty')::int else 0 end)::int as qb,
           sum(case when x->>'presentation' = '5ml'     then (x->>'qty')::int else 0 end)::int as q5,
           sum(case when x->>'presentation' = '10ml'    then (x->>'qty')::int else 0 end)::int as q10
    from jsonb_array_elements(v_items) x group by 1
  loop
    select * into p from public.products where sku = agg.sku;
    v_err := public._check_capacity(p, agg.qb, agg.q5, agg.q10);
    if v_err is not null then raise exception '%', v_err; end if;
  end loop;

  loop
    v_code := 'AJ-' || to_char(now(), 'YYMMDD') || '-' ||
              upper(substr(md5(random()::text || clock_timestamp()::text), 1, 4));
    exit when not exists (select 1 from public.orders where code = v_code);
  end loop;

  insert into public.orders (code, items, total, customer_name, note)
  values (v_code, v_items, v_total,
          nullif(left(btrim(coalesce(p_customer, '')), 80), ''),
          nullif(left(btrim(coalesce(p_note, '')), 500), ''));

  return jsonb_build_object('code', v_code, 'total', v_total, 'items', v_items);
end $$;

-- Confirma un pedido pendiente y DESCUENTA existencias (solo admin).
create or replace function public.confirm_order(p_order uuid)
returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  o      public.orders;
  agg    record;
  p      public.products;
  v_err  text;
  u5 int; u10 int; ml numeric;
  v_cons jsonb := '[]'::jsonb;
begin
  perform public._require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if o.status <> 'pendiente' then
    raise exception 'El pedido % ya está %.', o.code, o.status;
  end if;

  perform set_config('ajro.kind',  'venta', true);
  perform set_config('ajro.order', o.id::text, true);
  perform set_config('ajro.note',  'Pedido ' || o.code, true);

  for agg in
    select x->>'sku' as sku,
           sum(case when x->>'presentation' = 'botella' then (x->>'qty')::int else 0 end)::int as qb,
           sum(case when x->>'presentation' = '5ml'     then (x->>'qty')::int else 0 end)::int as q5,
           sum(case when x->>'presentation' = '10ml'    then (x->>'qty')::int else 0 end)::int as q10
    from jsonb_array_elements(o.items) x group by 1 order by 1
  loop
    select * into p from public.products where sku = agg.sku for update;
    if not found then
      raise exception 'El producto % del pedido ya no existe.', agg.sku;
    end if;
    v_err := public._check_capacity(p, agg.qb, agg.q5, agg.q10);
    if v_err is not null then raise exception 'No se puede confirmar. %', v_err; end if;

    u5  := least(agg.q5,  p.stock_5ml);
    u10 := least(agg.q10, p.stock_10ml);
    ml  := (agg.q5 - u5) * 5 + (agg.q10 - u10) * 10;

    update public.products set
      stock_bottles = stock_bottles - agg.qb,
      stock_5ml     = stock_5ml - u5,
      stock_10ml    = stock_10ml - u10,
      decant_ml     = decant_ml - ml
    where id = p.id;

    v_cons := v_cons || jsonb_build_object('product_id', p.id, 'sku', p.sku,
      'bottles', agg.qb, 'stock_5ml', u5, 'stock_10ml', u10, 'ml', ml);
  end loop;

  update public.orders set status = 'confirmado', consumption = v_cons,
    confirmed_at = now(), confirmed_by = auth.uid()
  where id = o.id returning * into o;
  return o;
end $$;

-- Cancela un pedido. Si ya estaba confirmado, DEVUELVE las existencias
-- exactamente como se descontaron.
create or replace function public.cancel_order(p_order uuid)
returns public.orders
language plpgsql security definer
set search_path = public
as $$
declare
  o public.orders;
  c record;
begin
  perform public._require_admin();
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'Pedido no encontrado.'; end if;
  if o.status = 'cancelado' then raise exception 'El pedido ya está cancelado.'; end if;

  if o.status = 'confirmado' and o.consumption is not null then
    perform set_config('ajro.kind',  'anulacion', true);
    perform set_config('ajro.order', o.id::text, true);
    perform set_config('ajro.note',  'Cancelación del pedido ' || o.code, true);
    for c in
      select (x->>'product_id')::uuid as pid, (x->>'bottles')::int as b,
             (x->>'stock_5ml')::int as s5, (x->>'stock_10ml')::int as s10,
             (x->>'ml')::numeric as ml
      from jsonb_array_elements(o.consumption) x
    loop
      update public.products set
        stock_bottles = stock_bottles + c.b,
        stock_5ml     = stock_5ml + c.s5,
        stock_10ml    = stock_10ml + c.s10,
        decant_ml     = decant_ml + c.ml
      where id = c.pid;
    end loop;
  end if;

  update public.orders set status = 'cancelado', cancelled_at = now()
  where id = o.id returning * into o;
  return o;
end $$;

-- Productos más vendidos (solo pedidos confirmados = ventas reales).
create or replace function public.best_sellers(p_limit int default 8)
returns table (sku text, units bigint)
language sql stable security definer
set search_path = public
as $$
  select x->>'sku' as sku, sum((x->>'qty')::int)::bigint as units
  from public.orders o, jsonb_array_elements(o.items) x
  where o.status = 'confirmado'
  group by 1
  order by 2 desc, 1
  limit least(greatest(coalesce(p_limit, 8), 1), 24);
$$;

-- ---------------------------------------------------------------------
-- 9. Importación masiva desde Excel (solo admin, todo o nada)
-- ---------------------------------------------------------------------
-- p_rows: arreglo de objetos con las claves de la tabla products.
-- Si una clave viene null en un producto EXISTENTE, se conserva el
-- valor actual (no se borra información accidentalmente).
create or replace function public.import_products(p_rows jsonb)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare
  r jsonb;
  v_sku text;
  v_inserted int := 0; v_updated int := 0; v_unchanged int := 0;
  n int;
begin
  perform public._require_admin();
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then
    raise exception 'Formato de importación no válido.';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Máximo 2000 productos por importación.';
  end if;

  perform set_config('ajro.kind', 'importacion', true);
  perform set_config('ajro.note', 'Importación desde Excel', true);

  for r in select * from jsonb_array_elements(p_rows) loop
    v_sku := upper(btrim(r->>'sku'));
    begin
      if v_sku is null or v_sku = '' then
        raise exception 'falta el SKU';
      end if;

      if not exists (select 1 from public.products where sku = v_sku) then
        insert into public.products (sku, name, brand, gender, perfume_type, description,
          bottle_ml, price_bottle, price_5ml, price_10ml, discount_pct,
          stock_bottles, stock_5ml, stock_10ml, decant_ml, low_stock_threshold,
          image, featured, is_new, status)
        values (v_sku, btrim(r->>'name'), btrim(r->>'brand'), r->>'gender', r->>'perfume_type',
          coalesce(r->>'description', ''),
          (r->>'bottle_ml')::int,
          coalesce((r->>'price_bottle')::numeric, 0),
          coalesce((r->>'price_5ml')::numeric, 0),
          coalesce((r->>'price_10ml')::numeric, 0),
          coalesce((r->>'discount_pct')::int, 0),
          coalesce((r->>'stock_bottles')::int, 0),
          coalesce((r->>'stock_5ml')::int, 0),
          coalesce((r->>'stock_10ml')::int, 0),
          coalesce((r->>'decant_ml')::numeric, 0),
          coalesce((r->>'low_stock_threshold')::int, 1),
          coalesce(r->>'image', ''),
          coalesce((r->>'featured')::boolean, false),
          coalesce((r->>'is_new')::boolean, false),
          coalesce(r->>'status', 'Activo'));
        v_inserted := v_inserted + 1;
      else
        update public.products t set
          name                = coalesce(btrim(r->>'name'), t.name),
          brand               = coalesce(btrim(r->>'brand'), t.brand),
          gender              = coalesce(r->>'gender', t.gender),
          perfume_type        = coalesce(r->>'perfume_type', t.perfume_type),
          description         = coalesce(r->>'description', t.description),
          bottle_ml           = coalesce((r->>'bottle_ml')::int, t.bottle_ml),
          price_bottle        = coalesce((r->>'price_bottle')::numeric, t.price_bottle),
          price_5ml           = coalesce((r->>'price_5ml')::numeric, t.price_5ml),
          price_10ml          = coalesce((r->>'price_10ml')::numeric, t.price_10ml),
          discount_pct        = coalesce((r->>'discount_pct')::int, t.discount_pct),
          stock_bottles       = coalesce((r->>'stock_bottles')::int, t.stock_bottles),
          stock_5ml           = coalesce((r->>'stock_5ml')::int, t.stock_5ml),
          stock_10ml          = coalesce((r->>'stock_10ml')::int, t.stock_10ml),
          decant_ml           = coalesce((r->>'decant_ml')::numeric, t.decant_ml),
          low_stock_threshold = coalesce((r->>'low_stock_threshold')::int, t.low_stock_threshold),
          image               = coalesce(r->>'image', t.image),
          featured            = coalesce((r->>'featured')::boolean, t.featured),
          is_new              = coalesce((r->>'is_new')::boolean, t.is_new),
          status              = coalesce(r->>'status', t.status)
        where t.sku = v_sku
          and (t.name, t.brand, t.gender, t.perfume_type, t.description, t.bottle_ml,
               t.price_bottle, t.price_5ml, t.price_10ml, t.discount_pct,
               t.stock_bottles, t.stock_5ml, t.stock_10ml, t.decant_ml,
               t.low_stock_threshold, t.image, t.featured, t.is_new, t.status)
          is distinct from
              (coalesce(btrim(r->>'name'), t.name), coalesce(btrim(r->>'brand'), t.brand),
               coalesce(r->>'gender', t.gender), coalesce(r->>'perfume_type', t.perfume_type),
               coalesce(r->>'description', t.description),
               coalesce((r->>'bottle_ml')::int, t.bottle_ml),
               coalesce((r->>'price_bottle')::numeric, t.price_bottle),
               coalesce((r->>'price_5ml')::numeric, t.price_5ml),
               coalesce((r->>'price_10ml')::numeric, t.price_10ml),
               coalesce((r->>'discount_pct')::int, t.discount_pct),
               coalesce((r->>'stock_bottles')::int, t.stock_bottles),
               coalesce((r->>'stock_5ml')::int, t.stock_5ml),
               coalesce((r->>'stock_10ml')::int, t.stock_10ml),
               coalesce((r->>'decant_ml')::numeric, t.decant_ml),
               coalesce((r->>'low_stock_threshold')::int, t.low_stock_threshold),
               coalesce(r->>'image', t.image),
               coalesce((r->>'featured')::boolean, t.featured),
               coalesce((r->>'is_new')::boolean, t.is_new),
               coalesce(r->>'status', t.status));
        get diagnostics n = row_count;
        if n > 0 then v_updated := v_updated + 1; else v_unchanged := v_unchanged + 1; end if;
      end if;
    exception when others then
      raise exception 'SKU %: %', coalesce(v_sku, '(vacío)'), sqlerrm;
    end;
  end loop;

  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'unchanged', v_unchanged);
end $$;

-- ---------------------------------------------------------------------
-- 10. Seguridad: Row Level Security y permisos
-- ---------------------------------------------------------------------
alter table public.admins              enable row level security;
alter table public.products            enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.orders              enable row level security;

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins
  for select using (user_id = auth.uid());

-- Catálogo público: cualquiera ve productos no inactivos; admin ve todo.
drop policy if exists products_public_read on public.products;
create policy products_public_read on public.products
  for select using (status <> 'Inactivo' or public.is_admin());

drop policy if exists products_admin_insert on public.products;
create policy products_admin_insert on public.products
  for insert with check (public.is_admin());

drop policy if exists products_admin_update on public.products;
create policy products_admin_update on public.products
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists products_admin_delete on public.products;
create policy products_admin_delete on public.products
  for delete using (public.is_admin());

drop policy if exists movements_admin_read on public.inventory_movements;
create policy movements_admin_read on public.inventory_movements
  for select using (public.is_admin());

drop policy if exists orders_admin_read on public.orders;
create policy orders_admin_read on public.orders
  for select using (public.is_admin());
-- Los pedidos solo se crean/modifican mediante las funciones de arriba.

-- Las funciones no deben ser ejecutables por cualquiera por defecto.
revoke execute on function public.adjust_stock(uuid,text,int,int,int,numeric,text) from public;
revoke execute on function public.open_bottle(uuid,int,text)        from public;
revoke execute on function public.prepare_decants(uuid,int,int,text) from public;
revoke execute on function public.confirm_order(uuid)               from public;
revoke execute on function public.cancel_order(uuid)                from public;
revoke execute on function public.import_products(jsonb)            from public;
revoke execute on function public.create_order(jsonb,text,text)     from public;
revoke execute on function public.best_sellers(int)                 from public;
revoke execute on function public._require_admin()                  from public;
revoke execute on function public._check_capacity(public.products,int,int,int) from public;

-- Supabase concede EXECUTE a "anon" por defecto: se retira en las funciones
-- de administración (además, todas verifican is_admin() internamente).
revoke execute on function public.adjust_stock(uuid,text,int,int,int,numeric,text) from anon;
revoke execute on function public.open_bottle(uuid,int,text)          from anon;
revoke execute on function public.prepare_decants(uuid,int,int,text)  from anon;
revoke execute on function public.confirm_order(uuid)                 from anon;
revoke execute on function public.cancel_order(uuid)                  from anon;
revoke execute on function public.import_products(jsonb)              from anon;
revoke execute on function public._require_admin()                    from anon;
revoke execute on function public.log_stock_change()                  from anon, authenticated;

grant execute on function public.adjust_stock(uuid,text,int,int,int,numeric,text) to authenticated;
grant execute on function public.open_bottle(uuid,int,text)          to authenticated;
grant execute on function public.prepare_decants(uuid,int,int,text)  to authenticated;
grant execute on function public.confirm_order(uuid)                 to authenticated;
grant execute on function public.cancel_order(uuid)                  to authenticated;
grant execute on function public.import_products(jsonb)              to authenticated;
grant execute on function public.create_order(jsonb,text,text)       to anon, authenticated;
grant execute on function public.best_sellers(int)                   to anon, authenticated;
grant execute on function public.is_admin()                          to anon, authenticated;

grant select on public.products to anon, authenticated;
grant insert, update, delete on public.products to authenticated;
grant select on public.inventory_movements, public.orders, public.admins to authenticated;
revoke insert, update, delete on public.inventory_movements, public.orders, public.admins from anon, authenticated;

-- ---------------------------------------------------------------------
-- 11. Almacenamiento de fotografías (Supabase Storage)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public)
    values ('product-images', 'product-images', true)
    on conflict (id) do update set public = true;

    execute 'drop policy if exists "ajro images admin insert" on storage.objects';
    execute 'drop policy if exists "ajro images admin update" on storage.objects';
    execute 'drop policy if exists "ajro images admin delete" on storage.objects';
    execute 'drop policy if exists "ajro images admin read" on storage.objects';
    execute $p$create policy "ajro images admin read" on storage.objects
      for select to authenticated
      using (bucket_id = 'product-images' and public.is_admin())$p$;
    execute $p$create policy "ajro images admin insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'product-images' and public.is_admin())$p$;
    execute $p$create policy "ajro images admin update" on storage.objects
      for update to authenticated
      using (bucket_id = 'product-images' and public.is_admin())$p$;
    execute $p$create policy "ajro images admin delete" on storage.objects
      for delete to authenticated
      using (bucket_id = 'product-images' and public.is_admin())$p$;
  end if;
end $$;
