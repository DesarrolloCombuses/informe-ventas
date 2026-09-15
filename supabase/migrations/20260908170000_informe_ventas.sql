-- =====================================================================
-- Informe Diario de Ventas
-- Guarda únicamente las NOVEDADES y la configuración del informe.
-- Los turnos siguen leyéndose del CSV en el equipo de cada usuario.
-- Acceso: solo usuarios autenticados (Supabase Auth con correo).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Novedades y título, una fila por (fecha, turno)
-- ---------------------------------------------------------------------
create table if not exists public.informe_novedades (
  id            uuid primary key default gen_random_uuid(),
  fecha         date not null,
  turno_id      text not null,
  turno_nombre  text,
  titulo        text,
  novedades     jsonb not null default '[]'::jsonb,
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null,
  constraint informe_novedades_fecha_turno_key unique (fecha, turno_id),
  constraint informe_novedades_es_arreglo check (jsonb_typeof(novedades) = 'array')
);

comment on table  public.informe_novedades is 'Novedades (RESTAR/SUMAR) y título del informe diario, por fecha y turno.';
comment on column public.informe_novedades.novedades is 'Arreglo JSON: [{shift, accion, texto, efectivo, transfer, tarjeta}]';

create index if not exists informe_novedades_fecha_idx
  on public.informe_novedades (fecha desc);

-- ---------------------------------------------------------------------
-- Configuración compartida (rangos horarios de los turnos, etc.)
-- ---------------------------------------------------------------------
create table if not exists public.informe_config (
  clave       text primary key,
  valor       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null
);

comment on table public.informe_config is 'Configuración compartida del informe; la clave "turnos" guarda los rangos horarios.';

-- ---------------------------------------------------------------------
-- Sello de auditoría en cada escritura
-- ---------------------------------------------------------------------
create or replace function public.informe_sellar()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists informe_novedades_sellar on public.informe_novedades;
create trigger informe_novedades_sellar
  before insert or update on public.informe_novedades
  for each row execute function public.informe_sellar();

drop trigger if exists informe_config_sellar on public.informe_config;
create trigger informe_config_sellar
  before insert or update on public.informe_config
  for each row execute function public.informe_sellar();

-- ---------------------------------------------------------------------
-- RLS: nada es accesible sin sesión iniciada
-- ---------------------------------------------------------------------
alter table public.informe_novedades enable row level security;
alter table public.informe_config    enable row level security;

drop policy if exists "novedades: leer autenticados"       on public.informe_novedades;
drop policy if exists "novedades: insertar autenticados"   on public.informe_novedades;
drop policy if exists "novedades: actualizar autenticados" on public.informe_novedades;
drop policy if exists "novedades: borrar autenticados"     on public.informe_novedades;

create policy "novedades: leer autenticados"
  on public.informe_novedades for select to authenticated using (true);
create policy "novedades: insertar autenticados"
  on public.informe_novedades for insert to authenticated with check (true);
create policy "novedades: actualizar autenticados"
  on public.informe_novedades for update to authenticated using (true) with check (true);
create policy "novedades: borrar autenticados"
  on public.informe_novedades for delete to authenticated using (true);

drop policy if exists "config: leer autenticados"       on public.informe_config;
drop policy if exists "config: insertar autenticados"   on public.informe_config;
drop policy if exists "config: actualizar autenticados" on public.informe_config;

create policy "config: leer autenticados"
  on public.informe_config for select to authenticated using (true);
create policy "config: insertar autenticados"
  on public.informe_config for insert to authenticated with check (true);
create policy "config: actualizar autenticados"
  on public.informe_config for update to authenticated using (true) with check (true);
