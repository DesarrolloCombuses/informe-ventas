-- =====================================================================
-- Control de acceso del informe
-- Tener cuenta en el proyecto no basta: solo quien esté en esta lista
-- (y activo) puede ver o modificar los cierres y las novedades.
-- =====================================================================

create table if not exists public.informe_usuarios (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  correo     text not null unique,
  nombre     text,                       -- nombre visible, lo asigna el administrador
  rol        text not null default 'lider' check (rol in ('admin', 'lider')),
  activo     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null   -- lo exige el trigger de auditoría
);

comment on table  public.informe_usuarios is 'Usuarios habilitados para el informe diario de ventas.';
comment on column public.informe_usuarios.nombre is 'Nombre con el que se identifica al líder; lo edita el administrador.';

-- ---------------------------------------------------------------------
-- Funciones de autorización (security definer para no chocar con RLS)
-- ---------------------------------------------------------------------
create or replace function public.informe_autorizado()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.informe_usuarios u
    where u.user_id = (select auth.uid()) and u.activo
  );
$$;

create or replace function public.informe_es_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.informe_usuarios u
    where u.user_id = (select auth.uid()) and u.activo and u.rol = 'admin'
  );
$$;

revoke all on function public.informe_autorizado() from public, anon;
revoke all on function public.informe_es_admin()  from public, anon;
grant execute on function public.informe_autorizado() to authenticated;
grant execute on function public.informe_es_admin()  to authenticated;

-- ---------------------------------------------------------------------
-- La lista se ve entre autorizados; solo el administrador la modifica
-- ---------------------------------------------------------------------
alter table public.informe_usuarios enable row level security;

drop policy if exists "usuarios: leer autorizados"      on public.informe_usuarios;
drop policy if exists "usuarios: admin actualiza"       on public.informe_usuarios;
drop policy if exists "usuarios: admin inserta"         on public.informe_usuarios;
drop policy if exists "usuarios: admin elimina"         on public.informe_usuarios;

create policy "usuarios: leer autorizados"
  on public.informe_usuarios for select to authenticated
  using (public.informe_autorizado());
create policy "usuarios: admin actualiza"
  on public.informe_usuarios for update to authenticated
  using (public.informe_es_admin()) with check (public.informe_es_admin());
create policy "usuarios: admin inserta"
  on public.informe_usuarios for insert to authenticated
  with check (public.informe_es_admin());
create policy "usuarios: admin elimina"
  on public.informe_usuarios for delete to authenticated
  using (public.informe_es_admin());

drop trigger if exists informe_usuarios_sellar on public.informe_usuarios;
create trigger informe_usuarios_sellar
  before update on public.informe_usuarios
  for each row execute function public.informe_sellar();

-- ---------------------------------------------------------------------
-- Las tablas del informe pasan a exigir estar autorizado
-- ---------------------------------------------------------------------
drop policy if exists "cierres: leer autenticados"       on public.informe_cierres;
drop policy if exists "cierres: insertar autenticados"   on public.informe_cierres;
drop policy if exists "cierres: actualizar autenticados" on public.informe_cierres;

create policy "cierres: leer autorizados"
  on public.informe_cierres for select to authenticated using (public.informe_autorizado());
create policy "cierres: insertar autorizados"
  on public.informe_cierres for insert to authenticated with check (public.informe_autorizado());
create policy "cierres: actualizar autorizados"
  on public.informe_cierres for update to authenticated
  using (public.informe_autorizado()) with check (public.informe_autorizado());

drop policy if exists "novedades: leer autenticados"       on public.informe_novedades;
drop policy if exists "novedades: insertar autenticados"   on public.informe_novedades;
drop policy if exists "novedades: actualizar autenticados" on public.informe_novedades;
drop policy if exists "novedades: borrar autenticados"     on public.informe_novedades;

create policy "novedades: leer autorizados"
  on public.informe_novedades for select to authenticated using (public.informe_autorizado());
create policy "novedades: insertar autorizados"
  on public.informe_novedades for insert to authenticated with check (public.informe_autorizado());
create policy "novedades: actualizar autorizados"
  on public.informe_novedades for update to authenticated
  using (public.informe_autorizado()) with check (public.informe_autorizado());
create policy "novedades: borrar autorizados"
  on public.informe_novedades for delete to authenticated using (public.informe_autorizado());

drop policy if exists "config: leer autenticados"       on public.informe_config;
drop policy if exists "config: insertar autenticados"   on public.informe_config;
drop policy if exists "config: actualizar autenticados" on public.informe_config;

create policy "config: leer autorizados"
  on public.informe_config for select to authenticated using (public.informe_autorizado());
create policy "config: insertar autorizados"
  on public.informe_config for insert to authenticated with check (public.informe_autorizado());
create policy "config: actualizar autorizados"
  on public.informe_config for update to authenticated
  using (public.informe_autorizado()) with check (public.informe_autorizado());
