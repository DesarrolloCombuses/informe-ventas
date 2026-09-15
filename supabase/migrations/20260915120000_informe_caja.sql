-- =====================================================================
-- Cierre de caja: consignaciones y deducciones
-- Van junto a las novedades, en la misma fila de (fecha, turno), para que
-- el informe de un turno viaje completo en una sola lectura.
-- Además: borrar un día queda reservado al administrador.
-- =====================================================================

alter table public.informe_novedades
  add column if not exists consignaciones jsonb not null default '[]'::jsonb,
  add column if not exists deducciones    jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'informe_novedades_consignaciones_es_arreglo') then
    alter table public.informe_novedades
      add constraint informe_novedades_consignaciones_es_arreglo
      check (jsonb_typeof(consignaciones) = 'array');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'informe_novedades_deducciones_es_arreglo') then
    alter table public.informe_novedades
      add constraint informe_novedades_deducciones_es_arreglo
      check (jsonb_typeof(deducciones) = 'array');
  end if;
end $$;

comment on column public.informe_novedades.consignaciones is
  'Arreglo JSON: [{banco, comprobante, texto, valor}] consignado del efectivo del turno.';
comment on column public.informe_novedades.deducciones is
  'Arreglo JSON: [{texto, valor}] descuentos al efectivo del turno.';

-- ---------------------------------------------------------------------
-- Borrar un día: solo el administrador
-- Cualquier autorizado sigue pudiendo cargar y editar; borrar no.
-- ---------------------------------------------------------------------
drop policy if exists "novedades: borrar autorizados" on public.informe_novedades;
drop policy if exists "novedades: admin borra"        on public.informe_novedades;
drop policy if exists "cierres: borrar autorizados"   on public.informe_cierres;
drop policy if exists "cierres: admin borra"          on public.informe_cierres;

create policy "novedades: admin borra"
  on public.informe_novedades for delete to authenticated
  using (public.informe_es_admin());

create policy "cierres: admin borra"
  on public.informe_cierres for delete to authenticated
  using (public.informe_es_admin());
