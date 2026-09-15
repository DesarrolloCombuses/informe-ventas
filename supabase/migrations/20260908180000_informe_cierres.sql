-- =====================================================================
-- Cierres de turno en línea
-- Cada fila del CSV queda guardada una sola vez (clave: shift_id), para
-- que el informe se pueda consultar desde cualquier equipo sin el archivo.
-- =====================================================================

create table if not exists public.informe_cierres (
  shift_id      text primary key,
  agente        text,
  ventas        integer not null default 0,
  pasajeros     integer not null default 0,
  inicio        timestamp not null,          -- hora local, tal como viene del CSV
  final         timestamp,
  efectivo      numeric(14,2) not null default 0,
  transferencia numeric(14,2) not null default 0,
  tarjeta       numeric(14,2) not null default 0,
  archivo       text,                        -- nombre del CSV de origen
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid references auth.users (id) on delete set null
);

comment on table  public.informe_cierres is 'Cierres de turno cargados desde el CSV; una fila por shift_id.';
comment on column public.informe_cierres.inicio is 'Hora local del inicio del turno (sin zona horaria, igual que el CSV).';

create index if not exists informe_cierres_inicio_idx on public.informe_cierres (inicio desc);
create index if not exists informe_cierres_final_idx  on public.informe_cierres (final desc);
create index if not exists informe_cierres_agente_idx on public.informe_cierres (agente);

drop trigger if exists informe_cierres_sellar on public.informe_cierres;
create trigger informe_cierres_sellar
  before insert or update on public.informe_cierres
  for each row execute function public.informe_sellar();

alter table public.informe_cierres enable row level security;

drop policy if exists "cierres: leer autenticados"       on public.informe_cierres;
drop policy if exists "cierres: insertar autenticados"   on public.informe_cierres;
drop policy if exists "cierres: actualizar autenticados" on public.informe_cierres;

create policy "cierres: leer autenticados"
  on public.informe_cierres for select to authenticated using (true);
create policy "cierres: insertar autenticados"
  on public.informe_cierres for insert to authenticated with check (true);
create policy "cierres: actualizar autenticados"
  on public.informe_cierres for update to authenticated using (true) with check (true);

-- Fechas con cierres registrados, para llenar el selector sin traer todo
create or replace view public.informe_cierres_fechas as
  select inicio::date as fecha, count(*) as turnos
  from public.informe_cierres
  group by 1
  order by 1 desc;

-- La vista debe respetar RLS del usuario que consulta, no del creador
alter view public.informe_cierres_fechas set (security_invoker = on);
revoke all on public.informe_cierres_fechas from anon;
grant select on public.informe_cierres_fechas to authenticated;
