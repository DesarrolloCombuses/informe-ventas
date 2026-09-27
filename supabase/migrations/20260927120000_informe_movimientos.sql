-- =====================================================================
-- Bitácora del informe: quién cambió qué, cuándo y desde dónde.
-- Es un registro de solo agregar: nadie lo edita ni lo borra, ni el
-- administrador, para que sirva de respaldo cuando haya que explicar un
-- descuadre. Se lee entre usuarios autorizados.
-- =====================================================================

create table if not exists public.informe_movimientos (
  id          bigint generated always as identity primary key,
  fecha       date not null,                    -- fecha del informe donde ocurrió
  turno_id    text not null default '',         -- turno del informe
  tipo        text not null,                    -- csv | novedad | consignacion | deduccion | agente | titulo | dia | turno
  accion      text not null,                    -- cargar | agregar | editar | borrar
  descripcion text not null,                    -- ya redactado en español, se muestra tal cual
  detalle     jsonb not null default '{}'::jsonb,
  autor_id    uuid references auth.users (id) on delete set null,
  autor       text not null default '',         -- nombre visible cuando hizo el cambio
  sede        text not null default '',         -- desde dónde se hizo
  creado_at   timestamptz not null default now()
);

comment on table public.informe_movimientos is
  'Bitácora de cambios del informe: solo se agrega, nunca se edita ni se borra.';
comment on column public.informe_movimientos.descripcion is
  'Frase en español lista para mostrar, por ejemplo: Agregó una novedad de RESTAR $100.000 a Ana Uno.';

create index if not exists informe_movimientos_por_informe
  on public.informe_movimientos (fecha desc, turno_id, creado_at desc);

-- ---------------------------------------------------------------------
-- RLS: se lee entre autorizados y cada uno solo firma lo suyo
-- ---------------------------------------------------------------------
alter table public.informe_movimientos enable row level security;

drop policy if exists "movimientos: leer autorizados"     on public.informe_movimientos;
drop policy if exists "movimientos: insertar autorizados" on public.informe_movimientos;

create policy "movimientos: leer autorizados"
  on public.informe_movimientos for select to authenticated
  using (public.informe_autorizado());

create policy "movimientos: insertar autorizados"
  on public.informe_movimientos for insert to authenticated
  with check (public.informe_autorizado() and autor_id = (select auth.uid()));

-- A propósito no hay políticas de update ni de delete: la bitácora no se toca.
