-- Estándar Stock Karam: tablas, seguridad y almacenamiento
-- Pegar todo en Supabase > SQL Editor > New query y tocar RUN.

-- 1) Tabla donde la app guarda sus datos (ventas, stock, Wings, estándar, parámetros, pedidos)
create table if not exists public.docs (
  path       text primary key,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.docs enable row level security;

drop policy if exists "Usuarios ingresados leen y escriben" on public.docs;
create policy "Usuarios ingresados leen y escriben" on public.docs
  for all to authenticated using (true) with check (true);

-- 2) Vistas para consultar los datos como tablas comunes (Table Editor o SQL)
create or replace view public.v_pedidos with (security_invoker = true) as
select d.path                         as pedido_id,
       d.data->>'nombre'              as nombre,
       d.data->>'sucursal'            as sucursal,
       (d.data->>'fecha')::timestamptz as fecha,
       d.data->>'estado'              as estado,
       l->>0                          as codigo,
       l->>1                          as descripcion,
       (l->>2)::numeric               as stock,
       (l->>3)::numeric               as std_stock,
       (l->>4)::numeric               as sugerido,
       (l->>5)::numeric               as cantidad_pedida,
       (l->>6)::numeric               as costo_rep
from public.docs d
cross join lateral jsonb_array_elements((d.data->>'lines')::jsonb) l
where d.path like 'sugeridos/%';

create or replace view public.v_stock with (security_invoker = true) as
select split_part(split_part(d.path, '/', 2), '--', 2) as sucursal,
       r->>0            as codigo,
       r->>1            as descripcion,
       (r->>2)::numeric as stock,
       (r->>3)::numeric as costo_rep,
       r->>4            as actividad,
       r->>5            as origen
from public.docs d
cross join lateral jsonb_array_elements((d.data->>'data')::jsonb) r
where d.path like 'ds/stock--%/chunks/%';

create or replace view public.v_ventas with (security_invoker = true) as
select split_part(split_part(d.path, '/', 2), '--', 2) as sucursal,
       r->>0            as codigo,
       r->>1            as descripcion,
       (r->>5)::numeric as cantidad_6m,
       r->>6            as proveedor,
       r->>7            as origen
from public.docs d
cross join lateral jsonb_array_elements((d.data->>'data')::jsonb) r
where d.path like 'ds/ventas--%/chunks/%';

-- 3) Bucket privado para los archivos que genera la app (CSV, Excel, respaldos)
insert into storage.buckets (id, name, public)
values ('archivos', 'archivos', false)
on conflict (id) do nothing;

drop policy if exists "Usuarios ingresados manejan archivos" on storage.objects;
create policy "Usuarios ingresados manejan archivos" on storage.objects
  for all to authenticated
  using (bucket_id = 'archivos') with check (bucket_id = 'archivos');
