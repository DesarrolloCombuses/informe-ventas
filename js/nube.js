/* =========================================================================
   Nube: sesión y sincronización con Supabase (REST directo, sin librerías).
   Viajan cierres, novedades, configuración y usuarios; siempre con sesión.
   ========================================================================= */
'use strict';

const Nube = (function () {

  const CFG_KEY = 'idv.supabase';
  const SES_KEY = 'idv.sesion';

  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
    del(k) { try { localStorage.removeItem(k); } catch (_) {} }
  };

  let config = Object.assign({ url: '', key: '' }, window.IDV_SUPABASE || {}, ls.get(CFG_KEY, {}));
  let session = ls.get(SES_KEY, null);
  let refreshing = null;

  const configurada = () => !!(config.url && config.key);
  const conectado = () => configurada() && !!(session && session.access_token);
  const usuario = () => (session && session.user) || null;

  function guardarSesion(data) {
    if (!data || !data.access_token) return null;
    session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: Date.now() + (Number(data.expires_in || 3600) * 1000),
      user: data.user ? { id: data.user.id, email: data.user.email } : (session && session.user) || null
    };
    ls.set(SES_KEY, session);
    return session;
  }

  function limpiarSesion() {
    session = null;
    ls.del(SES_KEY);
  }

  /** Mensaje de error legible a partir de una respuesta de Supabase. */
  async function errorDe(res) {
    let detalle = '';
    try {
      const j = await res.json();
      detalle = j.error_description || j.msg || j.message || j.error || j.hint || '';
    } catch (_) {}
    if (res.status === 400 && /invalid.*credentials|grant/i.test(detalle)) return 'Correo o contraseña incorrectos.';
    if (res.status === 401) return 'La sesión expiró. Inicia sesión de nuevo.';
    if (res.status === 403) return 'La cuenta no tiene permiso sobre estos datos.';
    if (res.status === 422 && /already registered/i.test(detalle)) return 'Ese correo ya tiene cuenta.';
    return detalle || `Error ${res.status} al conectar con la nube.`;
  }

  function authHeaders(conToken) {
    const h = { apikey: config.key, 'Content-Type': 'application/json' };
    if (conToken && session) h.Authorization = 'Bearer ' + session.access_token;
    return h;
  }

  /* ------------------------------- sesión -------------------------------- */

  async function iniciarSesion(email, password) {
    if (!configurada()) throw new Error('Falta configurar la conexión con Supabase.');
    const res = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: authHeaders(false),
      body: JSON.stringify({ email: String(email).trim(), password })
    });
    if (!res.ok) throw new Error(await errorDe(res));
    return guardarSesion(await res.json());
  }

  async function recuperarClave(email) {
    if (!configurada()) throw new Error('Falta configurar la conexión con Supabase.');
    const res = await fetch(`${config.url}/auth/v1/recover`, {
      method: 'POST',
      headers: authHeaders(false),
      body: JSON.stringify({ email: String(email).trim() })
    });
    if (!res.ok) throw new Error(await errorDe(res));
  }

  async function refrescar() {
    if (!session || !session.refresh_token) throw new Error('Sin sesión.');
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const res = await fetch(`${config.url}/auth/v1/token?grant_type=refresh_token`, {
        method: 'POST',
        headers: authHeaders(false),
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
      if (!res.ok) { limpiarSesion(); throw new Error('La sesión expiró. Inicia sesión de nuevo.'); }
      return guardarSesion(await res.json());
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }

  async function cerrarSesion() {
    if (session) {
      try {
        await fetch(`${config.url}/auth/v1/logout`, { method: 'POST', headers: authHeaders(true) });
      } catch (_) {}
    }
    limpiarSesion();
  }

  /* ------------------------------- datos --------------------------------- */

  async function api(path, opts) {
    if (!conectado()) throw new Error('Sin sesión iniciada.');
    if (session.expires_at && Date.now() > session.expires_at - 60000) {
      await refrescar();
    }
    const hacer = () => fetch(config.url + path, Object.assign({}, opts, {
      headers: Object.assign(authHeaders(true), (opts && opts.headers) || {})
    }));

    let res = await hacer();
    if (res.status === 401) {
      await refrescar();
      res = await hacer();
    }
    if (!res.ok) throw new Error(await errorDe(res));
    if (res.status === 204) return null;
    const texto = await res.text();
    return texto ? JSON.parse(texto) : null;
  }

  /** Novedades y título de un (fecha, turno). Devuelve null si no existe. */
  async function leerInforme(fecha, turnoId) {
    const q = `/rest/v1/informe_novedades?fecha=eq.${encodeURIComponent(fecha)}`
            + `&turno_id=eq.${encodeURIComponent(turnoId)}`
            + `&select=fecha,turno_id,turno_nombre,titulo,novedades,updated_at,updated_by`;
    const filas = await api(q, { method: 'GET' });
    return (filas && filas[0]) || null;
  }

  async function guardarInforme(payload) {
    const filas = await api('/rest/v1/informe_novedades?on_conflict=fecha,turno_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([payload])
    });
    return (filas && filas[0]) || null;
  }

  async function leerConfig(clave) {
    const filas = await api(
      `/rest/v1/informe_config?clave=eq.${encodeURIComponent(clave)}&select=clave,valor,updated_at`,
      { method: 'GET' });
    return (filas && filas[0]) || null;
  }

  async function guardarConfig(clave, valor) {
    const filas = await api('/rest/v1/informe_config?on_conflict=clave', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{ clave, valor }])
    });
    return (filas && filas[0]) || null;
  }

  /* ----------------------------- cierres --------------------------------- */

  /** Sube (o actualiza) los cierres de turno. Se envían por lotes. */
  async function guardarCierres(filas) {
    const LOTE = 400;
    let guardados = 0;
    for (let i = 0; i < filas.length; i += LOTE) {
      await api('/rest/v1/informe_cierres?on_conflict=shift_id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(filas.slice(i, i + LOTE))
      });
      guardados += Math.min(LOTE, filas.length - i);
    }
    return guardados;
  }

  /** Cierres cuyo inicio o final cae dentro del día indicado (YYYY-MM-DD). */
  async function leerCierresDelDia(fecha) {
    const desde = `${fecha}T00:00:00`;
    const hasta = `${fecha}T23:59:59`;
    const q = '/rest/v1/informe_cierres'
      + '?select=shift_id,agente,ventas,pasajeros,inicio,final,efectivo,transferencia,tarjeta'
      + `&or=(and(inicio.gte.${desde},inicio.lte.${hasta}),and(final.gte.${desde},final.lte.${hasta}))`
      + '&order=final.desc';
    return (await api(q, { method: 'GET' })) || [];
  }

  /** Fechas que ya tienen cierres guardados, con su conteo. */
  async function leerFechasConCierres() {
    return (await api('/rest/v1/informe_cierres_fechas?select=fecha,turnos', { method: 'GET' })) || [];
  }

  /* ----------------------------- usuarios -------------------------------- */

  /** Ficha del usuario actual: null si su cuenta no está habilitada. */
  async function miPerfil() {
    const u = usuario();
    if (!u) return null;
    const filas = await api(
      `/rest/v1/informe_usuarios?user_id=eq.${encodeURIComponent(u.id)}&select=user_id,correo,nombre,rol,activo`,
      { method: 'GET' });
    return (filas && filas[0]) || null;
  }

  async function leerUsuarios() {
    return (await api(
      '/rest/v1/informe_usuarios?select=user_id,correo,nombre,rol,activo&order=rol.asc,correo.asc',
      { method: 'GET' })) || [];
  }

  /** Solo el administrador puede cambiar nombre o estado (lo impone RLS). */
  async function guardarUsuario(userId, cambios) {
    const filas = await api(`/rest/v1/informe_usuarios?user_id=eq.${encodeURIComponent(userId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(cambios)
    });
    return (filas && filas[0]) || null;
  }

  /* --------------------------- estado de la red -------------------------- */

  /** ¿Se alcanza el servidor? navigator.onLine solo confirma la red local. */
  async function hayServidor(timeoutMs) {
    if (!configurada() || !navigator.onLine) return false;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs || 6000);
    try {
      const res = await fetch(`${config.url}/rest/v1/`, {
        method: 'HEAD',
        headers: { apikey: config.key },
        cache: 'no-store',
        signal: ctrl.signal
      });
      return res.status < 500;
    } catch (_) {
      return false;
    } finally {
      clearTimeout(t);
    }
  }

  /* ---------------------------- configuración ---------------------------- */

  function setConfig(url, key) {
    config = { url: String(url || '').replace(/\/+$/, ''), key: String(key || '').trim() };
    ls.set(CFG_KEY, config);
  }

  return {
    configurada, conectado, usuario,
    getConfig: () => Object.assign({}, config),
    setConfig,
    iniciarSesion, recuperarClave, cerrarSesion,
    leerInforme, guardarInforme, leerConfig, guardarConfig,
    guardarCierres, leerCierresDelDia, leerFechasConCierres,
    miPerfil, leerUsuarios, guardarUsuario,
    hayServidor
  };
})();
