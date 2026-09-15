-- =====================================================================
-- Ubicación de cada cambio
-- No bloquea: registra desde dónde se hizo cada cambio y si fue dentro
-- de una sede. Las sedes las registra el administrador estando en ellas.
-- =====================================================================

create table if not exists public.informe_sedes (
  id         bigint generated always as identity primary key,
  nombre     text not null,
  lat        double precision not null check (lat between -90 and 90),
  lon        double precision not null check (lon between -180 and 180),
  radio_m    integer not null default 200 check (radio_m between 20 and 5000),
  activa     boolean not null default true,   -- se desactiva en vez de borrar: el historial conserva el nombre
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null   -- lo exige el trigger de auditoría
);

comment on table public.informe_sedes is 'Sedes desde las que se espera trabajar; se usan para clasificar la ubicación de cada cambio.';

alter table public.informe_sedes enable row level security;

drop policy if exists "sedes: leer autorizados" on public.informe_sedes;
drop policy if exists "sedes: admin inserta"    on public.informe_sedes;
drop policy if exists "sedes: admin actualiza"  on public.informe_sedes;

create policy "sedes: leer autorizados"
  on public.informe_sedes for select to authenticated using (public.informe_autorizado());
create policy "sedes: admin inserta"
  on public.informe_sedes for insert to authenticated with check (public.informe_es_admin());
create policy "sedes: admin actualiza"
  on public.informe_sedes for update to authenticated
  using (public.informe_es_admin()) with check (public.informe_es_admin());

drop trigger if exists informe_sedes_sellar on public.informe_sedes;
create trigger informe_sedes_sellar
  before insert or update on public.informe_sedes
  for each row execute function public.informe_sellar();

-- ---------------------------------------------------------------------
-- Ubicación reportada por el equipo en cada escritura:
-- { lat, lon, precision_m, capturada, estado, sede, sede_id, distancia_m }
-- estado: en-sede | fuera-de-sede | no-confirmada | sin-permiso | no-disponible | sin-sedes
-- ---------------------------------------------------------------------
alter table public.informe_cierres   add column if not exists ubicacion jsonb;
alter table public.informe_novedades add column if not exists ubicacion jsonb;
alter table public.informe_config    add column if not exists ubicacion jsonb;

comment on column public.informe_cierres.ubicacion   is 'Desde dónde se cargó el cierre (la reporta el navegador).';
comment on column public.informe_novedades.ubicacion is 'Desde dónde se hizo la última modificación del turno.';
comment on column public.informe_config.ubicacion    is 'Desde dónde se cambió la configuración.';
