/* =========================================================================
   Informe Diario de Ventas - PWA
   Lee el CSV de turnos y arma el informe por fecha + turno, con la sección
   de NOVEDADES (RESTAR / SUMAR) y el TOTAL VENTA.
   Sin dependencias externas: funciona 100% sin conexión.
   ========================================================================= */
'use strict';

/* ------------------------------ constantes ------------------------------ */

const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio',
               'agosto','septiembre','octubre','noviembre','diciembre'];

const MES_CORTO = {
  ene:0, enero:0, feb:1, febrero:1, mar:2, marzo:2, abr:3, abril:3,
  may:4, mayo:4, jun:5, junio:5, jul:6, julio:6, ago:7, agosto:7,
  sep:8, sept:8, septiembre:8, oct:9, octubre:9, nov:10, noviembre:10,
  dic:11, diciembre:11
};

const TURNOS_DEFECTO = [
  { id: 'noche', name: 'TURNO NOCHE', from: '00:00', to: '11:59' },
  { id: 'tarde', name: 'TURNO TARDE', from: '12:00', to: '23:59' }
];

/* Rango horario escrito a mano; no altera los turnos guardados. */
const TURNO_LIBRE = { id: '__libre', name: 'PERSONALIZADO', from: '06:00', to: '14:00' };

const CRITERIOS = [
  { id: 'inicio', label: 'Hora de inicio',
    nota: 'Se incluyen los turnos que <strong>inician</strong> dentro del rango, en la fecha elegida.' },
  { id: 'fin', label: 'Hora de finalización',
    nota: 'Se incluyen los turnos que <strong>terminan</strong> dentro del rango, en la fecha elegida.' },
  { id: 'activo', label: 'Activos en el rango',
    nota: 'Se incluye todo turno que estuvo <strong>abierto en algún momento</strong> del rango, aunque haya empezado antes o terminado después.' }
];

const LS = {
  csv:    'idv.csv',
  nov:    'idv.novedades',
  turnos: 'idv.turnos',
  titles: 'idv.titulos',
  sel:    'idv.seleccion',
  pend:   'idv.pendientes',
  libre:  'idv.rangolibre'
};

/* --------------------------------- estado -------------------------------- */

const state = {
  fileName: '',
  rows: [],          // todos los registros del CSV
  turnos: [],
  novedades: {},     // { "YYYY-MM-DD|turnoId": [novedad] }
  titulos: {},       // { "YYYY-MM-DD|turnoId": "titulo personalizado" }
  date: '',
  turnoId: '',
  criterio: 'inicio',              // inicio | fin | activo
  origen: '',                      // archivo | nube | mixto
  fechasNube: {},                  // { "YYYY-MM-DD": cantidad de turnos }
  perfil: null,                    // ficha en informe_usuarios (null = no habilitado)
  libre: Object.assign({}, TURNO_LIBRE),
  sort: { key: null, dir: 1 }
};

/* --------------------------------- utils --------------------------------- */

const $ = (sel) => document.querySelector(sel);

const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (_) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  },
  del(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
};

function toast(msg, isError) {
  let el = $('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle('err', !!isError);
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 3200);
}

/** "$1,234,567.00" / "-$20,000.00" (mismo formato de la hoja de cálculo). */
function fmtMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
  return (v < 0 ? '-$' : '$') + abs;
}

const fmtInt = (n) => (Number(n) || 0).toLocaleString('en-US');

/** Convierte texto escrito por el usuario ("20.000", "$20,000", "20000") a número. */
function parseNum(input) {
  if (typeof input === 'number') return input;
  let s = String(input == null ? '' : input).trim();
  if (!s) return 0;
  const negative = /-/.test(s);
  s = s.replace(/[^\d.,]/g, '');
  if (!s) return 0;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');

  if (lastDot >= 0 && lastComma >= 0) {
    // el separador que aparece de último es el decimal
    const decSep = lastDot > lastComma ? '.' : ',';
    const thouSep = decSep === '.' ? ',' : '.';
    s = s.split(thouSep).join('').replace(decSep, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = s.split(sep);
    const decimals = parts[parts.length - 1].length;
    // varios separadores, o grupos de 3 dígitos => separador de miles
    if (parts.length > 2 || decimals === 3) s = parts.join('');
    else s = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
  }

  const n = parseFloat(s);
  if (!isFinite(n)) return 0;
  return negative ? -n : n;
}

/* -------------------------------- CSV parse ------------------------------- */

/** Parser CSV con soporte de comillas dobles, saltos de línea y BOM. */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let row = [], field = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
      continue;
    }
    if (c === '"') { inQuotes = true; continue; }
    if (c === ',' || c === ';') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((cell) => String(cell).trim() !== ''));
}

const normalize = (s) => String(s || '')
  .toLowerCase()
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9]/g, '');

/** Localiza las columnas del CSV aunque cambien de nombre u orden. */
function mapColumns(header) {
  const norm = header.map(normalize);
  const find = (...keys) => {
    for (const k of keys) {
      const i = norm.findIndex((h) => h.includes(k));
      if (i !== -1) return i;
    }
    return -1;
  };
  return {
    shift:  find('shiftid', 'idturno', 'turnoid', 'id'),
    agente: find('agente', 'usuario', 'vendedor'),
    ventas: find('ndeventas', 'numeroventas', 'ventas', 'nventas'),
    pax:    find('pasajeros', 'pax'),
    inicio: find('inicoturno', 'inicioturno', 'inico', 'inicio', 'apertura'),
    final:  find('finalturno', 'final', 'cierre', 'fin'),
    efec:   find('efectivo'),
    trans:  find('transferencia', 'transfer'),
    tarj:   find('tarjeta', 'datafono')
  };
}

/** "8 sept 2026, 14:19:26" -> Date  (también acepta ISO y dd/mm/yyyy). */
function parseFecha(str) {
  const s = String(str || '').trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})\s+([a-zA-ZáéíóúÁÉÍÓÚ.]+)\.?\s+(\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    const mes = MES_CORTO[normalize(m[2])];
    if (mes !== undefined) {
      return new Date(+m[3], mes, +m[1], +m[4], +m[5], +(m[6] || 0));
    }
  }
  m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +m[4], +m[5], +(m[6] || 0));

  const d = new Date(s);
  return isNaN(d) ? null : d;
}

const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();

function hhmmToMinutes(hhmm) {
  const m = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  return m ? +m[1] * 60 + +m[2] : 0;
}

/* ------------------------------ carga de datos ---------------------------- */

function loadCSVText(text, fileName) {
  const grid = parseCSV(text);
  if (grid.length < 2) throw new Error('El archivo no contiene datos.');

  const col = mapColumns(grid[0]);
  if (col.inicio === -1) throw new Error('No se encontró la columna de inicio de turno.');

  const rows = [];
  for (let i = 1; i < grid.length; i++) {
    const r = grid[i];
    const get = (idx) => (idx === -1 ? '' : (r[idx] == null ? '' : String(r[idx]).trim()));
    const inicioTxt = get(col.inicio);
    const inicio = parseFecha(inicioTxt);
    if (!inicio) continue;

    rows.push({
      shift:     get(col.shift),
      agente:    get(col.agente),
      ventas:    parseNum(get(col.ventas)),
      pax:       parseNum(get(col.pax)),
      inicioTxt,
      finalTxt:  get(col.final),
      inicio,
      final:     parseFecha(get(col.final)),
      efectivo:  parseNum(get(col.efec)),
      transfer:  parseNum(get(col.trans)),
      tarjeta:   parseNum(get(col.tarj))
    });
  }
  if (!rows.length) throw new Error('No se pudo interpretar ninguna fila con fecha válida.');

  state.rows = rows;
  state.fileName = fileName || 'datos.csv';
  store.set(LS.csv, { name: state.fileName, text });

  const prev = store.get(LS.sel, {});
  if (CRITERIOS.some((c) => c.id === prev.criterio)) state.criterio = prev.criterio;
  const fechas = availableDates();
  state.date = fechas.includes(prev.date) ? prev.date : fechas[0];
  state.turnoId = (prev.turnoId === TURNO_LIBRE.id || state.turnos.some((t) => t.id === prev.turnoId))
    ? prev.turnoId : state.turnos[0].id;

  state.origen = 'archivo';
  mostrarInforme();
  bajarInforme(currentKey());
  subirCierres(rows);
}

function readFile(file) {
  if (!file) return;
  if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
    toast('Selecciona un archivo .csv', true);
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    try {
      loadCSVText(String(reader.result), file.name);
      toast('Archivo cargado correctamente');
    } catch (err) {
      toast(err.message || 'No se pudo leer el archivo', true);
    }
  };
  reader.onerror = () => toast('Error al leer el archivo', true);
  reader.readAsText(file, 'UTF-8');
}

/* ------------------------------- selección -------------------------------- */

/** Fechas presentes en el CSV según el campo con el que se está filtrando. */
function availableDates() {
  const set = new Set();
  state.rows.forEach((r) => {
    if (state.criterio !== 'fin') set.add(dateKey(r.inicio));
    if (state.criterio !== 'inicio' && r.final) set.add(dateKey(r.final));
  });
  return [...set].sort().reverse();
}

/** Fechas del archivo local más las que ya están guardadas en el servidor. */
function todasLasFechas() {
  const set = new Set(availableDates());
  Object.keys(state.fechasNube).forEach((f) => set.add(f));
  return [...set].sort().reverse();
}

const currentTurno = () =>
  (state.turnoId === TURNO_LIBRE.id
    ? state.libre
    : state.turnos.find((t) => t.id === state.turnoId) || state.turnos[0]);

const currentKey = () => `${state.date}|${state.turnoId}`;

/** Ventana real del rango horario sobre la fecha elegida (soporta cruce de medianoche). */
function ventanaDelRango() {
  const t = currentTurno();
  const [y, m, d] = String(state.date || '').split('-').map(Number);
  const from = hhmmToMinutes(t.from);
  const to = hhmmToMinutes(t.to);
  const desde = new Date(y, m - 1, d, 0, 0, 0);
  desde.setMinutes(from);
  const hasta = new Date(y, m - 1, d, 0, 0, 0);
  hasta.setMinutes(to + (to < from ? 1440 : 0));
  hasta.setSeconds(59);
  return { desde, hasta, from, to, cruza: to < from };
}

/** ¿La hora (en minutos) cae dentro del rango, incluso si cruza la medianoche? */
function enRangoHorario(minutos, from, to) {
  return to < from ? (minutos >= from || minutos <= to) : (minutos >= from && minutos <= to);
}

/** Filas del CSV que cumplen la fecha + rango horario, según el criterio elegido. */
function filteredRows() {
  const { desde, hasta, from, to } = ventanaDelRango();

  let rows = state.rows.filter((r) => {
    if (state.criterio === 'fin') {
      if (!r.final) return false;
      return dateKey(r.final) === state.date && enRangoHorario(minutesOf(r.final), from, to);
    }
    if (state.criterio === 'activo') {
      // el turno estuvo abierto en algún momento de la ventana
      const fin = r.final || r.inicio;
      return r.inicio <= hasta && fin >= desde;
    }
    return dateKey(r.inicio) === state.date && enRangoHorario(minutesOf(r.inicio), from, to);
  });

  const { key, dir } = state.sort;
  if (key) {
    rows = rows.slice().sort((a, b) => {
      const va = a[key], vb = b[key];
      if (va instanceof Date && vb instanceof Date) return (va - vb) * dir;
      if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
      return String(va).localeCompare(String(vb), 'es') * dir;
    });
  }
  return rows;
}

/** "6:00 a. m." -> texto corto para el título del informe. */
function horaTexto(hhmm) {
  const min = hhmmToMinutes(hhmm);
  const h = Math.floor(min / 60), m = min % 60;
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function tituloAuto() {
  const t = currentTurno();
  const [y, m, d] = String(state.date || '').split('-').map(Number);
  const nombre = t.id === TURNO_LIBRE.id
    ? `DE ${horaTexto(t.from)} A ${horaTexto(t.to)}`
    : t.name;
  if (!y) return `INFORME DIARIO DE VENTAS ${nombre}`;
  return `INFORME DIARIO DE VENTAS ${d} DE ${MESES[m - 1].toUpperCase()} ${nombre}`;
}

const tituloActual = () => state.titulos[currentKey()] || tituloAuto();

/* -------------------------------- novedades ------------------------------- */

const novedadesActuales = () => state.novedades[currentKey()] || [];

function saveNovedades(list) {
  const key = currentKey();
  if (list.length) state.novedades[key] = list;
  else delete state.novedades[key];
  store.set(LS.nov, state.novedades);
  marcarPendiente(key);
}

function addNovedad() {
  const list = novedadesActuales().slice();
  list.push({
    id: 'n' + Date.now() + Math.random().toString(36).slice(2, 6),
    shift: '', accion: 'RESTAR', texto: '',
    efectivo: 0, transfer: 0, tarjeta: 0
  });
  saveNovedades(list);
  render();
  // enfoca la descripción de la fila recién creada
  const inputs = document.querySelectorAll('.r-nov .nov-texto');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

function updateNovedad(id, field, value) {
  const list = novedadesActuales().map((n) =>
    n.id === id ? Object.assign({}, n, { [field]: value }) : n);
  saveNovedades(list);
}

function deleteNovedad(id) {
  saveNovedades(novedadesActuales().filter((n) => n.id !== id));
  render();
}

/** Signo aplicado según la acción: RESTAR resta, SUMAR suma. */
const signo = (nov) => (nov.accion === 'SUMAR' ? 1 : -1);

/* --------------------------------- totales -------------------------------- */

function calcular() {
  const rows = filteredRows();
  const novs = novedadesActuales();

  const sub = rows.reduce((a, r) => ({
    ventas: a.ventas + r.ventas,
    pax: a.pax + r.pax,
    efectivo: a.efectivo + r.efectivo,
    transfer: a.transfer + r.transfer,
    tarjeta: a.tarjeta + r.tarjeta
  }), { ventas: 0, pax: 0, efectivo: 0, transfer: 0, tarjeta: 0 });

  const ajuste = novs.reduce((a, n) => {
    const s = signo(n);
    return {
      efectivo: a.efectivo + s * Math.abs(parseNum(n.efectivo)),
      transfer: a.transfer + s * Math.abs(parseNum(n.transfer)),
      tarjeta: a.tarjeta + s * Math.abs(parseNum(n.tarjeta))
    };
  }, { efectivo: 0, transfer: 0, tarjeta: 0 });

  const total = {
    efectivo: sub.efectivo + ajuste.efectivo,
    transfer: sub.transfer + ajuste.transfer,
    tarjeta: sub.tarjeta + ajuste.tarjeta
  };
  total.general = total.efectivo + total.transfer + total.tarjeta;

  return { rows, novs, sub, ajuste, total };
}

/* --------------------------------- render --------------------------------- */

const COLS = [
  { key: 'shift',  label: 'shift_id' },
  { key: 'agente', label: 'Agente' },
  { key: 'ventas', label: 'N.', num: true },
  { key: 'pax',    label: 'Pasajeros', num: true },
  { key: 'inicio', label: 'Inicio' },
  { key: 'final',  label: 'Final' },
  { key: 'efectivo', label: 'Efectivo', num: true },
  { key: 'transfer', label: 'Transferencia', num: true },
  { key: 'tarjeta',  label: 'Tarjeta', num: true }
];

function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') node.className = attrs[k];
    else if (k === 'text') node.textContent = attrs[k];
    else if (k in node && k !== 'list') node[k] = attrs[k];
    else node.setAttribute(k, attrs[k]);
  }
  (children || []).forEach((c) => node.appendChild(c));
  return node;
}

function td(content, cls, colSpan) {
  const cell = el('td', { class: cls || '' });
  if (colSpan) cell.colSpan = colSpan;
  if (content instanceof Node) cell.appendChild(content);
  else cell.textContent = content == null ? '' : String(content);
  return cell;
}

function render() {
  if (!state.rows.length) return;
  const { rows, novs, sub, total } = calcular();

  $('#reportWrap').hidden = false;
  $('#empty').hidden = rows.length > 0;
  $('#summary').hidden = false;
  $('#reportTitle').value = tituloActual();
  if ($('#selDate').value !== state.date) $('#selDate').value = state.date;
  if ($('#selShift').value !== state.turnoId) $('#selShift').value = state.turnoId;
  if ($('#selCriterio').value !== state.criterio) $('#selCriterio').value = state.criterio;
  pintarNotaCriterio();

  renderKpis(sub, total, rows.length, novs.length);

  const table = $('#report');
  table.textContent = '';
  const tb = el('tbody');

  /* --- barra de título (rosa) --- */
  tb.appendChild(el('tr', { class: 'r-title' }, [td(tituloActual(), '', COLS.length)]));

  /* --- encabezados (azul), ordenables --- */
  const head = el('tr', { class: 'r-head' });
  COLS.forEach((c) => {
    const arrow = state.sort.key === c.key ? (state.sort.dir === 1 ? ' ▲' : ' ▼') : '';
    const cell = td(c.label + arrow, c.num ? 'num' : '');
    cell.style.cursor = 'pointer';
    cell.title = 'Ordenar por ' + c.label;
    cell.addEventListener('click', () => {
      state.sort = (state.sort.key === c.key)
        ? { key: c.key, dir: -state.sort.dir }
        : { key: c.key, dir: 1 };
      render();
    });
    head.appendChild(cell);
  });
  tb.appendChild(head);

  /* --- filas de turnos --- */
  rows.forEach((r) => {
    tb.appendChild(el('tr', { class: 'r-data' }, [
      td(r.shift), td(r.agente),
      td(fmtInt(r.ventas), 'num'), td(fmtInt(r.pax), 'num'),
      td(r.inicioTxt, 'date'), td(r.finalTxt, 'date'),
      td(fmtMoney(r.efectivo), 'num'),
      td(fmtMoney(r.transfer), 'num'),
      td(fmtMoney(r.tarjeta), 'num')
    ]));
  });

  /* --- fila de subtotales = encabezado de NOVEDADES --- */
  tb.appendChild(el('tr', { class: 'r-total' }, [
    td('shift_id', 'c-label'),
    td('ACCION', 'c-label center'),
    td('NOVEDADES', 'center', 4),
    td(fmtMoney(sub.efectivo), 'num'),
    td(fmtMoney(sub.transfer), 'num'),
    td(fmtMoney(sub.tarjeta), 'num')
  ]));

  /* --- filas de novedades (editables) --- */
  novs.forEach((n) => tb.appendChild(renderNovedad(n, rows)));

  tb.appendChild(el('tr', { class: 'r-spacer' }, [td('', '', COLS.length)]));

  /* --- total venta --- */
  tb.appendChild(el('tr', { class: 'r-grand' }, [
    td('TOTAL VENTA', 'c-label', 6),
    td(fmtMoney(total.efectivo), 'num'),
    td(fmtMoney(total.transfer), 'num'),
    td(fmtMoney(total.tarjeta), 'num')
  ]));

  table.appendChild(tb);

  // lista de shift_id disponibles para el datalist de novedades
  const dl = document.getElementById('shiftList') || el('datalist', { id: 'shiftList' });
  dl.textContent = '';
  rows.forEach((r) => dl.appendChild(el('option', { value: r.shift })));
  if (!dl.parentNode) document.body.appendChild(dl);
}

function renderNovedad(n, rows) {
  const tr = el('tr', { class: 'r-nov' });

  /* shift_id + botón eliminar */
  const wrap = el('div', { class: 'cell-with-btn' });
  const del = el('button', { class: 'del-nov no-print', type: 'button', title: 'Eliminar novedad', text: '×' });
  del.addEventListener('click', () => deleteNovedad(n.id));
  const inShift = el('input', {
    class: 'cell-input', type: 'text', value: n.shift, placeholder: 'shift_id', list: 'shiftList'
  });
  inShift.setAttribute('list', 'shiftList');
  inShift.addEventListener('change', () => updateNovedad(n.id, 'shift', inShift.value.trim()));
  wrap.appendChild(del);
  wrap.appendChild(inShift);
  tr.appendChild(td(wrap));

  /* acción */
  const sel = el('select', { class: 'cell-input c-nov' });
  ['RESTAR', 'SUMAR'].forEach((op) =>
    sel.appendChild(el('option', { value: op, text: op, selected: n.accion === op })));
  sel.value = n.accion;
  sel.addEventListener('change', () => { updateNovedad(n.id, 'accion', sel.value); render(); });
  tr.appendChild(td(sel, 'center'));

  /* descripción */
  const inTexto = el('input', {
    class: 'cell-input c-nov nov-texto', type: 'text', value: n.texto,
    placeholder: 'Describe la novedad...'
  });
  inTexto.addEventListener('change', () => updateNovedad(n.id, 'texto', inTexto.value));
  tr.appendChild(td(inTexto, 'c-nov', 4));

  /* montos */
  ['efectivo', 'transfer', 'tarjeta'].forEach((field) => {
    const raw = Math.abs(parseNum(n[field]));
    const input = el('input', {
      class: 'cell-input num', type: 'text', inputmode: 'decimal',
      value: raw ? fmtMoney(signo(n) * raw) : ''
    });
    input.addEventListener('focus', () => { input.value = raw ? String(raw) : ''; input.select(); });
    input.addEventListener('blur', () => {
      const v = Math.abs(parseNum(input.value));
      updateNovedad(n.id, field, v);
      render();
    });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') input.blur(); });
    const cell = td(input, 'num');
    if (raw) cell.classList.add(signo(n) < 0 ? 'neg' : 'pos');
    tr.appendChild(cell);
  });

  return tr;
}

function renderKpis(sub, total, nRows, nNovs) {
  const box = $('#summary');
  box.textContent = '';
  const items = [
    ['Turnos', fmtInt(nRows)],
    ['Ventas', fmtInt(sub.ventas)],
    ['Pasajeros', fmtInt(sub.pax)],
    ['Novedades', fmtInt(nNovs)],
    ['Total venta', fmtMoney(total.general)]
  ];
  items.forEach(([label, value]) => {
    box.appendChild(el('div', { class: 'kpi' }, [
      el('span', { text: label }), el('b', { text: value })
    ]));
  });
}

/* ------------------------------- controles -------------------------------- */

function buildControls() {
  const selDate = $('#selDate');
  selDate.textContent = '';
  todasLasFechas().forEach((d) => {
    const [y, m, day] = d.split('-').map(Number);
    const n = state.fechasNube[d];
    const etiqueta = `${day} de ${MESES[m - 1]} de ${y}` + (n ? `  ·  ${n} turnos` : '');
    selDate.appendChild(el('option', { value: d, text: etiqueta }));
  });
  selDate.value = state.date;

  const selShift = $('#selShift');
  selShift.textContent = '';
  state.turnos.forEach((t) =>
    selShift.appendChild(el('option', { value: t.id, text: t.name })));
  selShift.appendChild(el('option', { value: TURNO_LIBRE.id, text: 'PERSONALIZADO (rango libre)' }));
  selShift.value = state.turnoId;

  const selCrit = $('#selCriterio');
  if (!selCrit.options.length) {
    CRITERIOS.forEach((c) => selCrit.appendChild(el('option', { value: c.id, text: c.label })));
  }
  selCrit.value = state.criterio;

  syncShiftInputs();
  pintarNotaCriterio();
}

function pintarNotaCriterio() {
  const c = CRITERIOS.find((x) => x.id === state.criterio) || CRITERIOS[0];
  const t = currentTurno();
  const libre = state.turnoId === TURNO_LIBRE.id;
  $('#ctrlNote').innerHTML = c.nota
    + ` Rango actual: <strong>${horaTexto(t.from)} – ${horaTexto(t.to)}</strong>`
    + (hhmmToMinutes(t.to) < hhmmToMinutes(t.from) ? ' (cruza la medianoche).' : '.')
    + (libre ? ' Este rango no modifica los turnos guardados.' : '');
}

function syncShiftInputs() {
  const t = currentTurno();
  $('#shiftFrom').value = t.from;
  $('#shiftTo').value = t.to;
}

function persistSeleccion() {
  store.set(LS.sel, { date: state.date, turnoId: state.turnoId, criterio: state.criterio });
}

/* ------------------------------ exportaciones ----------------------------- */

function reportMatrix() {
  const { rows, novs, sub, total } = calcular();
  const out = [];
  out.push([tituloActual()]);
  out.push(COLS.map((c) => c.label));
  rows.forEach((r) => out.push([
    r.shift, r.agente, r.ventas, r.pax, r.inicioTxt, r.finalTxt,
    r.efectivo, r.transfer, r.tarjeta
  ]));
  out.push(['shift_id', 'ACCION', 'NOVEDADES', '', '', '', sub.efectivo, sub.transfer, sub.tarjeta]);
  novs.forEach((n) => {
    const s = signo(n);
    out.push([
      n.shift, n.accion, n.texto, '', '', '',
      s * Math.abs(parseNum(n.efectivo)),
      s * Math.abs(parseNum(n.transfer)),
      s * Math.abs(parseNum(n.tarjeta))
    ]);
  });
  out.push([]);
  out.push(['TOTAL VENTA', '', '', '', '', '', total.efectivo, total.transfer, total.tarjeta]);
  return out;
}

function baseFileName() {
  const t = currentTurno();
  return `Informe_${state.date}_${t.name.replace(/\s+/g, '_')}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function exportCSV() {
  const esc = (v) => {
    const s = String(v == null ? '' : v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const text = reportMatrix().map((r) => r.map(esc).join(',')).join('\r\n');
  download(new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' }), baseFileName() + '.csv');
  toast('CSV exportado');
}

function exportExcel() {
  const { rows, novs, sub, total } = calcular();
  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const money = 'mso-number-format:"\\#\\,\\#\\#0\\.00";';
  const border = 'border:1px solid #b9a3c9;';
  const cellNum = (v) => `<td style="${border}${money}text-align:right">${v}</td>`;

  let html = '<table style="border-collapse:collapse;font-family:Calibri,sans-serif;font-size:11pt">';
  html += `<tr><td colspan="9" style="${border}background:#f2b6d8;font-weight:bold;text-align:center">${esc(tituloActual())}</td></tr>`;
  html += '<tr>' + COLS.map((c) =>
    `<td style="${border}background:#9dc3e6;font-weight:bold">${esc(c.label)}</td>`).join('') + '</tr>';

  rows.forEach((r) => {
    html += '<tr>'
      + `<td style="${border}">${esc(r.shift)}</td>`
      + `<td style="${border}">${esc(r.agente)}</td>`
      + `<td style="${border}text-align:right">${r.ventas}</td>`
      + `<td style="${border}text-align:right">${r.pax}</td>`
      + `<td style="${border}">${esc(r.inicioTxt)}</td>`
      + `<td style="${border}">${esc(r.finalTxt)}</td>`
      + cellNum(r.efectivo) + cellNum(r.transfer) + cellNum(r.tarjeta)
      + '</tr>';
  });

  const th = `${border}background:#9dc3e6;font-weight:bold;`;
  html += '<tr>'
    + `<td style="${th}">shift_id</td>`
    + `<td style="${th}text-align:center">ACCION</td>`
    + `<td colspan="4" style="${th}text-align:center">NOVEDADES</td>`
    + `<td style="${th}${money}text-align:right">${sub.efectivo}</td>`
    + `<td style="${th}${money}text-align:right">${sub.transfer}</td>`
    + `<td style="${th}${money}text-align:right">${sub.tarjeta}</td>`
    + '</tr>';

  novs.forEach((n) => {
    const s = signo(n);
    const val = (f) => {
      const v = Math.abs(parseNum(n[f]));
      return v ? s * v : '';
    };
    html += '<tr>'
      + `<td style="${border}">${esc(n.shift)}</td>`
      + `<td style="${border}text-align:center">${esc(n.accion)}</td>`
      + `<td colspan="4" style="${border}text-align:center">${esc(n.texto)}</td>`
      + cellNum(val('efectivo')) + cellNum(val('transfer')) + cellNum(val('tarjeta'))
      + '</tr>';
  });

  html += '<tr><td colspan="9"></td></tr>';
  html += '<tr>'
    + `<td colspan="6" style="${th}text-align:center">TOTAL VENTA</td>`
    + `<td style="${th}${money}text-align:right">${total.efectivo}</td>`
    + `<td style="${th}${money}text-align:right">${total.transfer}</td>`
    + `<td style="${th}${money}text-align:right">${total.tarjeta}</td>`
    + '</tr></table>';

  const doc = '<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><meta charset="utf-8">'
    + '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>'
    + '<x:Name>Informe</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>'
    + '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->'
    + '</head><body>' + html + '</body></html>';

  download(new Blob(['﻿' + doc], { type: 'application/vnd.ms-excel;charset=utf-8' }),
           baseFileName() + '.xls');
  toast('Excel exportado');
}

/* --------------------------------- eventos -------------------------------- */

function bindEvents() {
  const fileInput = $('#fileInput');
  $('#btnLoad').addEventListener('click', () => fileInput.click());
  $('#btnPick').addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    readFile(fileInput.files[0]);
    fileInput.value = '';
  });

  const dz = $('#dropzone');
  ['dragenter', 'dragover'].forEach((ev) =>
    document.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    document.addEventListener(ev, (e) => {
      e.preventDefault();
      if (ev === 'dragleave' && e.relatedTarget) return;
      dz.classList.remove('over');
    }));
  document.addEventListener('drop', (e) => {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) readFile(file);
  });

  $('#selDate').addEventListener('change', (e) => {
    state.date = e.target.value;
    persistSeleccion();
    render();
    bajarCierres(state.date);
    bajarInforme(currentKey());
  });

  $('#selShift').addEventListener('change', (e) => {
    state.turnoId = e.target.value;
    persistSeleccion();
    syncShiftInputs();
    render();
    bajarInforme(currentKey());
  });

  ['#shiftFrom', '#shiftTo'].forEach((sel) => {
    $(sel).addEventListener('change', () => {
      const t = currentTurno();
      t.from = $('#shiftFrom').value || '00:00';
      t.to = $('#shiftTo').value || '23:59';
      if (state.turnoId === TURNO_LIBRE.id) {
        store.set(LS.libre, state.libre);   // rango propio de este equipo
        render();
      } else {
        store.set(LS.turnos, state.turnos);
        render();
        subirTurnos();
      }
    });
  });

  $('#selCriterio').addEventListener('change', (e) => {
    state.criterio = e.target.value;
    persistSeleccion();
    const fechas = availableDates();
    if (!fechas.includes(state.date)) state.date = fechas[0] || state.date;
    buildControls();
    render();
    bajarInforme(currentKey());
  });

  const title = $('#reportTitle');
  title.addEventListener('input', () => {
    state.titulos[currentKey()] = title.value;
    store.set(LS.titles, state.titulos);
    marcarPendiente(currentKey());
    const cell = document.querySelector('.r-title td');
    if (cell) cell.textContent = title.value;
  });

  $('#btnResetTitle').addEventListener('click', () => {
    delete state.titulos[currentKey()];
    store.set(LS.titles, state.titulos);
    marcarPendiente(currentKey());
    render();
  });

  $('#btnAddNov').addEventListener('click', addNovedad);
  $('#btnPrint').addEventListener('click', () => window.print());
  $('#btnExcel').addEventListener('click', exportExcel);
  $('#btnCsv').addEventListener('click', exportCSV);

  $('#btnClear').addEventListener('click', () => {
    if (!confirm('¿Quitar el archivo cargado? Las novedades guardadas se conservan.')) return;
    store.del(LS.csv);
    state.rows = [];
    state.fileName = '';
    state.origen = '';
    $('#dzNube').hidden = !Object.keys(state.fechasNube).length;
    $('#fileInfo').textContent = 'Ningún archivo cargado';
    $('#dropzone').hidden = false;
    ['#controls', '#reportWrap', '#summary', '#empty'].forEach((s) => ($(s).hidden = true));
    ['#btnPrint', '#btnExcel', '#btnCsv', '#btnClear'].forEach((s) => ($(s).disabled = true));
  });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') return; // imprimir nativo
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      fileInput.click();
    }
  });
}

/* ------------------------------ PWA / arranque ---------------------------- */

function setupPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () =>
      navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
  let deferred = null;
  const btn = $('#btnInstall');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    btn.hidden = false;
  });
  btn.addEventListener('click', async () => {
    if (!deferred) return;
    deferred.prompt();
    await deferred.userChoice;
    deferred = null;
    btn.hidden = true;
  });
  window.addEventListener('appinstalled', () => { btn.hidden = true; });
}

function init() {
  state.turnos = store.get(LS.turnos, null) || TURNOS_DEFECTO.map((t) => Object.assign({}, t));
  state.libre = Object.assign({}, TURNO_LIBRE, store.get(LS.libre, {}));
  state.novedades = store.get(LS.nov, {});
  state.titulos = store.get(LS.titles, {});

  bindEvents();
  setupPWA();
  initNube();

  const saved = store.get(LS.csv, null);
  if (saved && saved.text) {
    try {
      loadCSVText(saved.text, saved.name);
    } catch (_) {
      store.del(LS.csv);
    }
  }
}

/* --------------------------- sincronización nube --------------------------
   Sube y baja únicamente novedades, títulos y rangos de turno.
   Regla de conflicto: lo que el usuario acaba de escribir manda; si no hay
   cambios locales pendientes, se adopta lo que esté en la nube.
   ------------------------------------------------------------------------- */

const sync = { pendientes: {}, remoto: {}, timer: null };

const horaCorta = () =>
  new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: false });

function setSyncEstado(clase, mensaje) {
  const info = $('#syncInfo');
  if (info) {
    info.textContent = mensaje;
    info.className = 'sync-info' + (clase ? ' ' + clase : '');
  }
  const btn = $('#btnNube');
  if (btn) {
    const on = Nube.conectado();
    btn.classList.toggle('btn-nube-on', on);
    btn.textContent = on ? nombreUsuario() : 'Nube';
  }
}

function refrescarEstadoNube() {
  pintarVisorRed();
  if (!Nube.conectado()) {
    setSyncEstado('', 'Sin sesión · los datos quedan solo en este equipo');
    return;
  }
  const pend = Object.keys(sync.pendientes).length;
  if (pend) setSyncEstado('pend', `${pend} cambio(s) sin subir`);
  else if (!red.servidor) setSyncEstado('pend', 'Sin conexión · se sincroniza al volver');
  else setSyncEstado('ok', 'Sincronizado ' + horaCorta());
}

/* ---------------------------- visor de conexión ---------------------------
   navigator.onLine solo indica si hay red; además se comprueba que el
   servidor responda, porque puede haber wifi sin salida a internet.
   ------------------------------------------------------------------------- */

const red = { servidor: null, revisando: false, timer: null, desde: null, avisoTimer: null };

/** Banda de aviso mientras se trabaja sin conexión. */
function pintarBannerOffline() {
  const bar = $('#offlineBar');
  if (!bar) return;

  const sinRed = !navigator.onLine;
  const sinServidor = navigator.onLine && red.servidor === false;

  if (!sinRed && !sinServidor) return;   // el estado "reconectado" lo pinta avisarReconexion

  const pend = Object.keys(sync.pendientes).length;
  const desde = red.desde ? ` desde las ${red.desde}` : '';
  const guardados = state.rows.length
    ? ` Los ${fmtInt(state.rows.length)} turnos cargados siguen disponibles aquí.`
    : '';

  bar.classList.remove('ok');
  $('#offbarTitulo').textContent = sinRed
    ? 'Trabajando sin internet'
    : 'Trabajando sin conexión al servidor';
  $('#offbarDetalle').textContent =
    (sinRed ? `El equipo no tiene red${desde}.` : `Hay red, pero el servidor no responde${desde}.`)
    + ' Lo que registres se guarda en este equipo y se sube solo al reconectar.'
    + (pend ? ` ${pend} cambio(s) esperando.` : '')
    + guardados;
  bar.hidden = false;
}

/** Aviso verde momentáneo cuando vuelve la conexión. */
function avisarReconexion() {
  const bar = $('#offlineBar');
  if (!bar || bar.hidden) return;        // no estaba avisando: no hay nada que anunciar
  bar.classList.add('ok');
  $('#offbarTitulo').textContent = 'Conexión restablecida';
  $('#offbarDetalle').textContent = Nube.conectado()
    ? 'Se están subiendo los cambios que quedaron pendientes.'
    : 'Inicia sesión para que lo registrado quede guardado en línea.';
  clearTimeout(red.avisoTimer);
  red.avisoTimer = setTimeout(() => {
    bar.hidden = true;
    bar.classList.remove('ok');
  }, 5000);
}

function pintarVisorRed() {
  const chip = $('#netStatus');
  const txt = $('#netText');
  if (!chip || !txt) return;

  let clase, texto, detalle;
  if (!navigator.onLine) {
    clase = 'net-off'; texto = 'Sin internet';
    detalle = 'El equipo no tiene red. Los cambios se guardan aquí y se suben al reconectar.';
  } else if (red.servidor === null) {
    clase = ''; texto = 'Comprobando...';
    detalle = 'Verificando la conexión con el servidor.';
  } else if (!red.servidor) {
    clase = 'net-off'; texto = 'Servidor no disponible';
    detalle = 'Hay red, pero no se alcanza el servidor. Los cambios se suben cuando vuelva.';
  } else if (!Nube.conectado()) {
    clase = 'net-warn'; texto = 'Sin sesión';
    detalle = 'Hay conexión, pero no has iniciado sesión: nada se está guardando en línea.';
  } else if (Object.keys(sync.pendientes).length) {
    clase = 'net-warn'; texto = 'Subiendo cambios';
    detalle = 'Hay cambios pendientes por subir al servidor.';
  } else {
    clase = 'net-on'; texto = 'En línea';
    detalle = `Conectado como ${nombreUsuario()} · todo se está guardando en línea.`;
  }

  chip.className = 'net ' + clase;
  txt.textContent = texto;
  chip.title = detalle;
  pintarBannerOffline();
}

async function revisarRed() {
  if (red.revisando) return red.servidor;
  red.revisando = true;
  try {
    const antes = red.servidor;
    red.servidor = await Nube.hayServidor();

    if (antes === true && !red.servidor) red.desde = horaCorta();   // acaba de caerse
    pintarVisorRed();

    if (antes === false && red.servidor) {          // volvió la conexión
      red.desde = null;
      avisarReconexion();
    }
    if (red.servidor && antes !== true) {   // primera confirmación o regreso
      await sincronizarTodo();
      refrescarEstadoNube();
    }
    return red.servidor;
  } finally {
    red.revisando = false;
  }
}

function vigilarRed() {
  if (!navigator.onLine) { red.servidor = false; red.desde = horaCorta(); }
  revisarRed();
  clearInterval(red.timer);
  red.timer = setInterval(revisarRed, 45000);
  window.addEventListener('online', revisarRed);
  window.addEventListener('offline', () => {
    red.servidor = false;
    red.desde = horaCorta();
    pintarVisorRed();
  });
  $('#btnReintentar').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    btn.textContent = 'Comprobando...';
    const ok = await revisarRed();
    btn.disabled = false;
    btn.textContent = 'Reintentar';
    if (!ok) toast('Sigue sin haber conexión', true);
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarRed();
  });
}

function partesKey(key) {
  const [fecha, turnoId] = String(key).split('|');
  return { fecha, turnoId };
}

/** Deja la novedad en un formato estable y con montos numéricos. */
function limpiarNovedad(n) {
  return {
    id: n.id || ('n' + Math.random().toString(36).slice(2, 10)),
    shift: String(n.shift || ''),
    accion: n.accion === 'SUMAR' ? 'SUMAR' : 'RESTAR',
    texto: String(n.texto || ''),
    efectivo: Math.abs(parseNum(n.efectivo)),
    transfer: Math.abs(parseNum(n.transfer)),
    tarjeta: Math.abs(parseNum(n.tarjeta))
  };
}

function marcarPendiente(key) {
  if (!key || !Nube.conectado()) return;
  sync.pendientes[key] = true;
  store.set(LS.pend, sync.pendientes);
  refrescarEstadoNube();
  pintarBannerOffline();
  clearTimeout(sync.timer);
  sync.timer = setTimeout(subirPendientes, 1200);
}

async function subirInforme(key) {
  const { fecha, turnoId } = partesKey(key);
  if (!fecha || !turnoId) return;
  const turno = state.turnos.find((t) => t.id === turnoId);
  const fila = await Nube.guardarInforme({
    fecha,
    turno_id: turnoId,
    turno_nombre: turno ? turno.name : null,
    titulo: state.titulos[key] || null,
    novedades: (state.novedades[key] || []).map(limpiarNovedad)
  });
  if (fila) sync.remoto[key] = fila.updated_at;
  delete sync.pendientes[key];
  store.set(LS.pend, sync.pendientes);
}

async function subirPendientes() {
  if (!Nube.conectado() || !navigator.onLine) return;
  const keys = Object.keys(sync.pendientes);
  if (!keys.length) return;
  setSyncEstado('', 'Guardando en la nube...');
  try {
    for (const k of keys) await subirInforme(k);
    refrescarEstadoNube();
  } catch (err) {
    setSyncEstado('err', err.message || 'No se pudo guardar en la nube');
  }
}

async function bajarInforme(key) {
  if (!Nube.conectado() || !key) return;
  if (sync.pendientes[key]) { await subirPendientes(); return; }
  const { fecha, turnoId } = partesKey(key);
  if (!fecha || !turnoId) return;
  try {
    const fila = await Nube.leerInforme(fecha, turnoId);
    if (fila) {
      const lista = Array.isArray(fila.novedades) ? fila.novedades.map(limpiarNovedad) : [];
      if (lista.length) state.novedades[key] = lista;
      else delete state.novedades[key];
      if (fila.titulo) state.titulos[key] = fila.titulo;
      else delete state.titulos[key];
      store.set(LS.nov, state.novedades);
      store.set(LS.titles, state.titulos);
      sync.remoto[key] = fila.updated_at;
      if (state.rows.length) render();
    }
    refrescarEstadoNube();
  } catch (err) {
    setSyncEstado('err', err.message || 'No se pudo leer de la nube');
  }
}

async function bajarTurnos() {
  if (!Nube.conectado()) return;
  try {
    const fila = await Nube.leerConfig('turnos');
    if (fila && Array.isArray(fila.valor) && fila.valor.length) {
      state.turnos = fila.valor;
      store.set(LS.turnos, state.turnos);
      if (!state.turnos.some((t) => t.id === state.turnoId)) state.turnoId = state.turnos[0].id;
      if (state.rows.length) { buildControls(); render(); }
    }
  } catch (_) { /* la configuración local sigue sirviendo */ }
}

async function subirTurnos() {
  if (!Nube.conectado()) return;
  try { await Nube.guardarConfig('turnos', state.turnos); }
  catch (err) { setSyncEstado('err', err.message || 'No se pudo guardar la configuración'); }
}

async function sincronizarTodo() {
  if (!Nube.conectado()) return;
  if (!state.perfil) await cargarPerfil();
  if (!estaAutorizado()) {
    setSyncEstado('err', 'Tu cuenta no está habilitada para el informe');
    return;
  }
  await subirPendientes();
  if (state.origen === 'archivo' && state.rows.length) await subirCierres(state.rows);
  await cargarFechasNube();
  await bajarTurnos();
  if (state.date) await bajarCierres(state.date);
  else await abrirUltimaFecha();
  if (state.date && state.turnoId) await bajarInforme(currentKey());
}

/** Índice de fechas con cierres guardados, para poder navegar el histórico. */
async function cargarFechasNube() {
  if (!Nube.conectado()) return;
  try {
    const filas = await Nube.leerFechasConCierres();
    const mapa = {};
    filas.forEach((f) => { mapa[String(f.fecha).slice(0, 10)] = Number(f.turnos) || 0; });
    state.fechasNube = mapa;
    $('#dzNube').hidden = !Object.keys(mapa).length || state.rows.length > 0;
    if (state.rows.length) buildControls();
  } catch (_) { /* se sigue con las fechas del archivo */ }
}

/** Sin CSV cargado: abre la última fecha que tenga cierres en línea. */
async function abrirUltimaFecha() {
  if (!Nube.conectado()) return;
  try {
    const fechas = await Nube.leerFechasConCierres();
    if (!fechas.length) return;
    state.date = String(fechas[0].fecha).slice(0, 10);
    if (!state.turnoId) state.turnoId = state.turnos[0].id;
    persistSeleccion();
    await bajarCierres(state.date);
  } catch (_) { /* se sigue trabajando solo con el archivo local */ }
}

/* ------------------------------- cierres ---------------------------------- */

const MES_TXT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** Fecha -> "8 sept 2026, 14:19:26" (el mismo formato que trae el CSV). */
function fechaTexto(d) {
  if (!d) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getDate()} ${MES_TXT[d.getMonth()]} ${d.getFullYear()}, `
       + `${d.getHours()}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** Fecha -> "2026-09-08T14:19:26" (hora local, sin zona horaria). */
function fechaISOLocal(d) {
  if (!d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
       + `T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** "2026-09-08T14:19:26" -> Date local (ignora cualquier zona horaria). */
function fechaDesdeISO(txt) {
  const m = String(txt || '').match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Sube al servidor los cierres que se acaban de leer del CSV. */
async function subirCierres(filas) {
  if (!Nube.conectado() || !filas.length) return;
  setSyncEstado('', `Subiendo ${filas.length} cierres...`);
  try {
    const payload = filas.map((r) => ({
      shift_id: r.shift || `${r.agente}_${fechaISOLocal(r.inicio)}`,
      agente: r.agente || null,
      ventas: Math.round(r.ventas) || 0,
      pasajeros: Math.round(r.pax) || 0,
      inicio: fechaISOLocal(r.inicio),
      final: fechaISOLocal(r.final),
      efectivo: r.efectivo || 0,
      transferencia: r.transfer || 0,
      tarjeta: r.tarjeta || 0,
      archivo: state.fileName || null
    }));
    const n = await Nube.guardarCierres(payload);
    toast(`${n} cierres guardados en línea`);
    refrescarEstadoNube();
  } catch (err) {
    setSyncEstado('err', err.message || 'No se pudieron subir los cierres');
  }
}

/** Convierte una fila del servidor al formato que usa la tabla. */
function cierreDesdeNube(f) {
  const inicio = fechaDesdeISO(f.inicio);
  const final = fechaDesdeISO(f.final);
  return {
    shift: f.shift_id,
    agente: f.agente || '',
    ventas: Number(f.ventas) || 0,
    pax: Number(f.pasajeros) || 0,
    inicio, final,
    inicioTxt: fechaTexto(inicio),
    finalTxt: fechaTexto(final),
    efectivo: Number(f.efectivo) || 0,
    transfer: Number(f.transferencia) || 0,
    tarjeta: Number(f.tarjeta) || 0
  };
}

/** Trae de la nube los cierres de un día y los deja listos para el informe. */
async function bajarCierres(fecha) {
  if (!Nube.conectado() || !fecha) return 0;
  setSyncEstado('', 'Consultando cierres en línea...');
  try {
    const filas = await Nube.leerCierresDelDia(fecha);
    const nuevos = filas.map(cierreDesdeNube).filter((r) => r.inicio);

    // se combinan con lo que ya haya cargado, sin duplicar shift_id
    const porId = new Map(state.rows.map((r) => [r.shift, r]));
    nuevos.forEach((r) => porId.set(r.shift, r));
    state.rows = [...porId.values()].sort((a, b) => (b.final || b.inicio) - (a.final || a.inicio));

    if (state.rows.length) {
      state.origen = state.fileName ? 'mixto' : 'nube';
      mostrarInforme();
    }
    refrescarEstadoNube();
    return nuevos.length;
  } catch (err) {
    setSyncEstado('err', err.message || 'No se pudieron leer los cierres');
    return 0;
  }
}

/** Deja la interfaz lista cuando ya hay filas cargadas (de CSV o de la nube). */
function mostrarInforme() {
  const fechas = todasLasFechas();
  if (!fechas.includes(state.date)) state.date = fechas[0] || state.date;
  if (!state.turnoId) state.turnoId = state.turnos[0].id;

  buildControls();
  render();

  const origen = state.origen === 'nube' ? 'desde la nube'
               : state.origen === 'mixto' ? 'archivo + nube'
               : state.fileName;
  $('#fileInfo').textContent = `${origen} · ${state.rows.length} turnos · ${fechas.length} fecha(s)`;
  ['#btnPrint', '#btnExcel', '#btnCsv', '#btnClear'].forEach((s) => ($(s).disabled = false));
  $('#dropzone').hidden = true;
  $('#controls').hidden = false;
}

/* ----------------------------- perfil y usuarios --------------------------
   Tener cuenta no basta: la cuenta debe estar en la lista de habilitados.
   El administrador es quien pone los nombres para identificar a cada líder.
   ------------------------------------------------------------------------- */

/** Nombre visible del usuario actual (o la parte antes de la arroba). */
function nombreUsuario() {
  const u = Nube.usuario();
  if (!u) return '';
  if (state.perfil && state.perfil.nombre) return state.perfil.nombre;
  return u.email.split('@')[0];
}

const esAdmin = () => !!(state.perfil && state.perfil.rol === 'admin');
const estaAutorizado = () => !!state.perfil;

async function cargarPerfil() {
  if (!Nube.conectado()) { state.perfil = null; return null; }
  try {
    state.perfil = await Nube.miPerfil();
  } catch (_) {
    state.perfil = null;
  }
  refrescarEstadoNube();
  return state.perfil;
}

async function renderUsuarios() {
  const caja = $('#listaUsuarios');
  const panel = $('#nubeAdmin');
  if (!esAdmin()) { panel.hidden = true; return; }
  panel.hidden = false;
  caja.textContent = 'Cargando...';

  let usuarios;
  try {
    usuarios = await Nube.leerUsuarios();
  } catch (err) {
    caja.textContent = err.message || 'No se pudo leer la lista.';
    return;
  }

  const yo = Nube.usuario();
  caja.textContent = '';
  usuarios.forEach((u) => {
    const fila = el('div', { class: 'user-row' + (yo && u.user_id === yo.id ? ' yo' : '') });
    fila.appendChild(el('span', { class: 'correo', text: u.correo, title: u.correo }));

    const nombre = el('input', {
      type: 'text', value: u.nombre || '',
      placeholder: u.rol === 'admin' ? 'Administrador' : 'Nombre del líder'
    });
    nombre.addEventListener('change', async () => {
      const valor = nombre.value.trim();
      try {
        await Nube.guardarUsuario(u.user_id, { nombre: valor || null });
        if (yo && u.user_id === yo.id) { state.perfil.nombre = valor; refrescarEstadoNube(); }
        toast('Nombre guardado');
      } catch (err) {
        toast(err.message || 'No se pudo guardar', true);
        nombre.value = u.nombre || '';
      }
    });
    fila.appendChild(nombre);

    fila.appendChild(el('span', {
      class: 'user-rol' + (u.rol === 'admin' ? '' : ' lider'),
      text: u.rol === 'admin' ? 'Admin' : 'Líder'
    }));
    caja.appendChild(fila);
  });
}

/* ------------------------------ modal de nube ----------------------------- */

function mostrarErrorNube(msg, ok) {
  const p = $('#nubeError');
  p.textContent = msg;
  p.classList.toggle('ok', !!ok);
  p.hidden = !msg;
}

function abrirModalNube() {
  const conectado = Nube.conectado();
  $('#nubeSesion').hidden = !conectado;
  $('#nubeLogin').hidden = conectado;
  if (conectado) {
    const u = Nube.usuario();
    $('#nubeEmail').textContent = (state.perfil && state.perfil.nombre)
      ? `${state.perfil.nombre} (${u ? u.email : ''})`
      : (u ? u.email : '');
    $('#nubeNoAutorizado').hidden = estaAutorizado();
    renderUsuarios();
  } else {
    mostrarErrorNube('');
    setTimeout(() => $('#nubeCorreo').focus(), 50);
  }
  $('#modalNube').hidden = false;
}

const cerrarModalNube = () => { $('#modalNube').hidden = true; };

function bindNube() {
  $('#btnNube').addEventListener('click', abrirModalNube);
  $('#btnAbrirNube').addEventListener('click', async () => {
    if (!Nube.conectado()) { abrirModalNube(); return; }
    await abrirUltimaFecha();
    if (!state.rows.length) toast('No hay cierres guardados todavía', true);
  });
  $('#btnCerrarModal').addEventListener('click', cerrarModalNube);
  $('#modalNube').addEventListener('click', (e) => {
    if (e.target.id === 'modalNube') cerrarModalNube();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#modalNube').hidden) cerrarModalNube();
  });

  $('#nubeLogin').addEventListener('submit', async (e) => {
    e.preventDefault();
    mostrarErrorNube('');
    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    try {
      await Nube.iniciarSesion($('#nubeCorreo').value, $('#nubeClave').value);
      $('#nubeClave').value = '';
      await cargarPerfil();
      if (!estaAutorizado()) {
        mostrarErrorNube('Tu cuenta existe, pero no está habilitada para el informe. '
                       + 'Pídele al administrador que te agregue.');
        return;
      }
      cerrarModalNube();
      toast(`Bienvenido, ${nombreUsuario()}`);
      refrescarEstadoNube();
      await sincronizarTodo();
    } catch (err) {
      mostrarErrorNube(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  $('#btnCrearCuenta').addEventListener('click', async () => {
    mostrarErrorNube('');
    const correo = $('#nubeCorreo').value.trim();
    const clave = $('#nubeClave').value;
    if (!correo || clave.length < 6) {
      mostrarErrorNube('Escribe el correo y una contraseña de al menos 6 caracteres.');
      return;
    }
    try {
      const r = await Nube.crearCuenta(correo, clave);
      if (r.sesion) {
        cerrarModalNube();
        toast('Cuenta creada y sesión iniciada');
        refrescarEstadoNube();
        await sincronizarTodo();
      } else {
        mostrarErrorNube('Cuenta creada. Revisa tu correo para confirmarla y luego inicia sesión.', true);
      }
    } catch (err) {
      mostrarErrorNube(err.message);
    }
  });

  $('#btnOlvide').addEventListener('click', async () => {
    const correo = $('#nubeCorreo').value.trim();
    if (!correo) { mostrarErrorNube('Escribe tu correo primero.'); return; }
    try {
      await Nube.recuperarClave(correo);
      mostrarErrorNube('Te enviamos un enlace para restablecer la contraseña.', true);
    } catch (err) {
      mostrarErrorNube(err.message);
    }
  });

  $('#btnSalir').addEventListener('click', async () => {
    await Nube.cerrarSesion();
    cerrarModalNube();
    state.fechasNube = {};
    state.perfil = null;
    $('#nubeAdmin').hidden = true;
    $('#dzNube').hidden = true;
    if (state.rows.length) buildControls();
    toast('Sesión cerrada · los datos siguen guardados en este equipo');
    refrescarEstadoNube();
  });

  window.addEventListener('online', () => { subirPendientes(); });
  window.addEventListener('offline', () => {
    if (Nube.conectado()) setSyncEstado('pend', 'Sin conexión · se subirá al reconectar');
  });
}

function initNube() {
  sync.pendientes = store.get(LS.pend, {});
  bindNube();
  vigilarRed();          // al confirmar el servidor, sincroniza por su cuenta
  refrescarEstadoNube();
}

document.addEventListener('DOMContentLoaded', init);
