-- Estándar Stock Karam: usuarios y permisos
-- Pegar todo en Supabase > SQL Editor > New query y tocar RUN. Se puede volver a correr sin problema.
--
-- Qué hace:
--  * Agrega a la tabla usuarios: nombre, varias sucursales, secciones permitidas y activo.
--  * Solo los usuarios cargados y activos pueden leer o escribir los datos de la app.
--  * Solo el administrador (admin = true) puede ver la lista de usuarios, crearlos, cambiarles
--    la contraseña, los permisos o eliminarlos. Nadie puede darse permisos a sí mismo.

create extension if not exists pgcrypto with schema extensions;

-- 1) Tabla de usuarios (ya existe: solo se agregan columnas)
create table if not exists public.usuarios (
  email    text primary key,
  sucursal text,
  admin    boolean not null default false
);
alter table public.usuarios add column if not exists nombre      text;
alter table public.usuarios add column if not exists sucursales  text[];
alter table public.usuarios add column if not exists permisos    text[];   -- null = todas las secciones
alter table public.usuarios add column if not exists activo      boolean not null default true;
alter table public.usuarios add column if not exists creado_at   timestamptz default now();
update public.usuarios set sucursales = array[sucursal] where sucursales is null and sucursal is not null;

-- 2) Quién es quién (se evalúan con el usuario que ingresó)
create or replace function public.es_usuario() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios
                 where lower(email) = lower(auth.jwt() ->> 'email') and coalesce(activo, true));
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios
                 where lower(email) = lower(auth.jwt() ->> 'email') and admin and coalesce(activo, true));
$$;

-- 3) Seguridad de la tabla usuarios: cada uno lee su propia fila, el admin lee todas.
--    Nadie escribe directo: los cambios pasan por las funciones de abajo, que controlan que sea el admin.
alter table public.usuarios enable row level security;
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'usuarios' loop
    execute format('drop policy %I on public.usuarios', p.policyname);
  end loop;
end $$;
create policy "Cada uno lee su fila, el admin todas" on public.usuarios
  for select to authenticated
  using (lower(email) = lower(auth.jwt() ->> 'email') or (select public.es_admin()));

-- 4) Datos de la app: solo usuarios cargados y activos
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'docs' loop
    execute format('drop policy %I on public.docs', p.policyname);
  end loop;
end $$;
create policy "Usuarios activos leen y escriben" on public.docs
  for all to authenticated
  using ((select public.es_usuario())) with check ((select public.es_usuario()));

drop policy if exists "Usuarios ingresados manejan archivos" on storage.objects;
drop policy if exists "Usuarios activos manejan archivos" on storage.objects;
create policy "Usuarios activos manejan archivos" on storage.objects
  for all to authenticated
  using (bucket_id = 'archivos' and (select public.es_usuario()))
  with check (bucket_id = 'archivos' and (select public.es_usuario()));

-- 5) Crear o modificar un usuario (solo admin)
create or replace function public.admin_guardar_usuario(
  p_email text, p_nombre text, p_sucursales text[], p_permisos text[], p_activo boolean, p_clave text default null)
returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_email text := lower(trim(p_email));
  v_yo    text := lower(auth.jwt() ->> 'email');
  v_uid   uuid;
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede modificar usuarios'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Email inválido'; end if;
  if p_clave is not null and length(p_clave) < 6 then raise exception 'La contraseña debe tener al menos 6 caracteres'; end if;
  if v_email = v_yo and not coalesce(p_activo, true) then raise exception 'No podés desactivar tu propio usuario'; end if;

  select id into v_uid from auth.users where lower(email) = v_email limit 1;
  if v_uid is null and p_clave is null then
    if not exists (select 1 from public.usuarios where lower(email) = v_email) then
      raise exception 'Para un usuario nuevo hay que poner una contraseña';
    end if;
  elsif v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                            confirmation_token, recovery_token, email_change, email_change_token_new,
                            email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
            crypt(p_clave, gen_salt('bf')), now(),
            '{"provider":"email","providers":["email"]}', '{}', now(), now(),
            '', '', '', '', '', '', '', '');
    insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (gen_random_uuid(), v_uid, v_uid::text,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  elsif p_clave is not null then
    update auth.users set encrypted_password = crypt(p_clave, gen_salt('bf')),
                          email_confirmed_at = coalesce(email_confirmed_at, now()), updated_at = now()
     where id = v_uid;
  end if;

  update public.usuarios
     set nombre = nullif(trim(p_nombre), ''), sucursales = p_sucursales, sucursal = p_sucursales[1],
         permisos = p_permisos, activo = coalesce(p_activo, true)
   where lower(email) = v_email;
  if not found then
    insert into public.usuarios (email, nombre, sucursal, sucursales, permisos, activo, admin)
    values (v_email, nullif(trim(p_nombre), ''), p_sucursales[1], p_sucursales, p_permisos, coalesce(p_activo, true), false);
  end if;
  return v_email;
end $$;

-- 6) Eliminar un usuario (solo admin; no se puede eliminar a sí mismo ni a otro admin)
create or replace function public.admin_borrar_usuario(p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(trim(p_email));
begin
  if not public.es_admin() then raise exception 'Solo el administrador puede eliminar usuarios'; end if;
  if v_email = lower(auth.jwt() ->> 'email') then raise exception 'No podés eliminar tu propio usuario'; end if;
  if exists (select 1 from public.usuarios where lower(email) = v_email and admin) then
    raise exception 'No se puede eliminar a un administrador desde la app';
  end if;
  delete from public.usuarios where lower(email) = v_email;
  delete from auth.users where lower(email) = v_email;
end $$;

revoke all on function public.admin_guardar_usuario(text, text, text[], text[], boolean, text) from public, anon;
revoke all on function public.admin_borrar_usuario(text) from public, anon;
grant execute on function public.admin_guardar_usuario(text, text, text[], text[], boolean, text) to authenticated;
grant execute on function public.admin_borrar_usuario(text) to authenticated;
grant execute on function public.es_usuario() to authenticated;
grant execute on function public.es_admin() to authenticated;

-- 7) Control: quiénes son administradores hoy (tiene que aparecer solo tu email)
select email, nombre, admin, activo, sucursales from public.usuarios order by admin desc, email;
