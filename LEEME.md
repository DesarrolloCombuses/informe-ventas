# Informe Diario de Ventas (PWA)

Aplicación web instalable que convierte el CSV de turnos en el informe diario de ventas
por turno, con la sección de **NOVEDADES** y el **TOTAL VENTA**, igual al formato de la
hoja de cálculo.

## Probar en línea

**https://desarrollocombuses.github.io/informe-ventas/**

Abre en cualquier equipo o celular, sin instalar nada. Desde ahí también se puede instalar
como aplicación (botón **Instalar app** o el ícono en la barra de direcciones).

El repositorio es público, pero los datos no: sin una cuenta habilitada en `informe_usuarios`
no se ve ningún cierre ni novedad. Los CSV nunca se suben al repositorio (`.gitignore`).

## Cómo usarla

1. Doble clic en **`Iniciar informe.bat`** (levanta un servidor local y abre el navegador),
   o usa el enlace de arriba.
2. Arrastra el CSV de turnos sobre la ventana, o pulsa **Cargar CSV**.
3. Elige la **fecha** y el **turno**. La tabla se arma sola.
4. Agrega las novedades con **+ Agregar novedad** (shift_id, RESTAR/SUMAR, descripción y el monto
   en la columna que corresponda).
5. **Imprimir / PDF**, **Exportar Excel** o **Exportar CSV**.

Para instalarla como aplicación de escritorio: botón **Instalar app** de la barra superior
(o el icono de instalación en la barra de direcciones del navegador).

## Filtro por horas

El panel tiene cuatro controles: **fecha**, **turno**, **filtrar por** y el rango **desde / hasta**.

### Criterio (Filtrar por)

| Criterio | Incluye |
|---|---|
| **Hora de inicio** | Turnos que *inician* dentro del rango, en la fecha elegida (comportamiento por defecto) |
| **Hora de finalización** | Turnos que *terminan* dentro del rango, en la fecha elegida |
| **Activos en el rango** | Todo turno que estuvo *abierto* en algún momento del rango, aunque haya empezado antes o terminado después |

### Turnos y rango libre

| Turno | Rango por defecto |
|---|---|
| TURNO NOCHE | 00:00 – 11:59 |
| TURNO TARDE | 12:00 – 23:59 |
| PERSONALIZADO | Rango libre (por ejemplo 06:00 – 14:00) |

Al editar las horas de un turno con nombre, el cambio queda guardado y se comparte por Supabase.
Con **PERSONALIZADO** el rango es libre y solo afecta a ese equipo: sirve para consultas puntuales
sin alterar los turnos de todos. El título del informe refleja el rango (*... DE 6:00 AM A 2:00 PM*).

Si la hora final es menor que la inicial (por ejemplo 22:00 – 06:00), el rango cruza la medianoche
y, con el criterio *Activos en el rango*, toma turnos de la noche que cierran al día siguiente.

## Estructura esperada del CSV

```
shift_id,Agente,N. de Ventas,Pasajeros,Inico Turno,Final Turno,Efectivo,Transferencia,Tarjeta
e.mazo__69,e.mazo,22,37,"8 sept 2026, 14:19:26","8 sept 2026, 16:25:17",620000,0,120000
```

Las columnas se detectan por nombre, así que toleran cambios de orden, mayúsculas o acentos.
Las fechas se leen en el formato en español del sistema (`8 sept 2026, 14:19:26`) y también
en `dd/mm/aaaa` o ISO.

## Novedades

- **RESTAR** descuenta el monto del subtotal; **SUMAR** lo agrega.
- El monto se escribe en positivo; el signo lo pone la acción (se muestra en rojo si resta).
- Se guardan automáticamente en el equipo, separadas por fecha y turno, y siguen ahí al reabrir la app.

## Archivos

```
index.html              interfaz
css/styles.css          estilos (incluye el formato de impresión)
js/app.js               lectura del CSV, filtros, totales y exportaciones
manifest.webmanifest    metadatos de la PWA
sw.js                   service worker (modo sin conexión)
icons/                  iconos de la aplicación
data/                   CSV de ejemplo
```

Todo el procesamiento ocurre en el navegador: ningún dato sale del equipo.

---

## Trabajo en línea (Supabase)

Con la sesión iniciada, **todo queda guardado en el servidor**: los cierres de turno,
las novedades, los títulos y los rangos horarios. El CSV solo se usa para cargar los
cierres la primera vez; después el informe se puede abrir desde cualquier equipo sin
el archivo.

### Cómo se usa

1. Al abrir la aplicación aparece la pantalla de ingreso: correo y contraseña.
2. Al cargar un CSV, sus cierres se suben automáticamente al servidor.
3. Al abrir la aplicación en otro equipo e iniciar sesión, se abre sola la última fecha
   con cierres guardados, sin necesidad del archivo.
4. Las novedades se suben un segundo después de escribirlas; al cambiar de fecha o
   turno se baja lo que haya en el servidor.
5. El texto bajo el nombre del archivo indica el estado y el origen de los datos:
   *desde la nube*, *archivo + nube*, *Sincronizado HH:MM* o *N cambio(s) sin subir*.

### Visor de conexión

En la barra superior hay un indicador con cuatro estados. No se limita a mirar si el equipo
tiene red: cada 45 segundos (y al volver a la pestaña) comprueba que el **servidor responda**,
porque puede haber wifi sin salida a internet.

| Indicador | Significa |
|---|---|
| 🟢 **En línea** | Hay conexión y sesión iniciada: todo se está guardando en el servidor |
| 🟠 **Sin sesión** | Hay internet, pero no has entrado: nada se guarda en línea |
| 🟠 **Subiendo cambios** | Quedan cambios por subir |
| 🔴 **Sin internet** / **Servidor no disponible** | Se sigue trabajando local y se sube todo al reconectar |

Al pasar el mouse sobre el indicador aparece el detalle.

### Trabajo sin internet

Cuando se pierde la conexión aparece una **banda naranja** bajo la barra superior:

> **Trabajando sin internet** — El equipo no tiene red desde las 08:50. Lo que registres se guarda
> en este equipo y se sube solo al reconectar. 2 cambio(s) esperando. Los 19 turnos cargados
> siguen disponibles aquí.

La banda dice desde qué hora está caída, cuántos cambios esperan y que los turnos ya cargados
siguen a la mano. Trae un botón **Reintentar** para forzar la comprobación sin esperar los 45
segundos del chequeo automático.

Mientras tanto se puede seguir trabajando con normalidad: cargar el CSV, cambiar de turno,
escribir novedades, imprimir y exportar. Al volver la conexión, la banda se pone verde
(*Conexión restablecida*), se suben los cambios pendientes y desaparece sola.

La banda distingue dos situaciones: que el equipo no tenga red, o que haya red pero el servidor
no responda. Nunca aparece al abrir la aplicación mientras se hace la primera comprobación.
Tampoco sale en las impresiones ni en el PDF.

### Histórico

El selector de fecha muestra todas las fechas con cierres guardados en el servidor, con el
número de turnos de cada una (*8 de septiembre de 2026 · 19 turnos*). Al elegir una, se traen
sus cierres aunque el CSV no esté cargado en ese equipo.

Si se pierde la conexión, los cambios quedan pendientes y se suben al reconectar.

### Regla ante cambios simultáneos

Si dos personas editan el mismo turno, gana lo último que se escribió: al abrir una
fecha/turno se baja la versión de la nube, salvo que en ese equipo haya cambios sin
subir, en cuyo caso esos cambios se suben primero.

### Base de datos

Proyecto `cbplebkmxrkaafqdhiyi`. El DDL está en
[`supabase/migrations/20260908170000_informe_ventas.sql`](supabase/migrations/20260908170000_informe_ventas.sql)
y ya fue aplicado.

| Tabla | Contenido |
|---|---|
| `informe_cierres` | Un cierre de turno por `shift_id`: agente, ventas, pasajeros, inicio, final y recaudos |
| `informe_novedades` | Una fila por (fecha, turno): título y arreglo JSON de novedades |
| `informe_config` | Configuración compartida; la clave `turnos` guarda los rangos horarios |
| `informe_sedes` | Sedes registradas por el administrador: nombre, coordenadas y radio |

La vista `informe_cierres_fechas` lista las fechas que ya tienen cierres cargados
(con `security_invoker`, así que también respeta RLS).

### Cómo se evitan los duplicados

La clave de `informe_cierres` es el `shift_id`. Si se vuelve a cargar el mismo CSV, o uno
que se solapa con otro anterior, los turnos ya guardados se actualizan en lugar de duplicarse.

Ambas tienen **RLS activo**: sin sesión iniciada no se puede leer ni escribir
(verificado: la escritura anónima devuelve `42501` y la lectura devuelve vacío).
Cada escritura registra `updated_at` y `updated_by` mediante un trigger.

### Cuentas de usuario

Las cuentas solo las crea el administrador (la aplicación no tiene registro abierto).
Ver *Agregar un usuario nuevo* más abajo.

La URL y la clave publicable están en [`js/supabase-config.js`](js/supabase-config.js).
Esa clave es pública por diseño; quien controla el acceso es RLS.

---

## Ubicación de cada cambio

Al iniciar sesión el navegador pide permiso para usar la ubicación. **No bloquea**: sirve para
saber desde dónde se hizo cada cambio.

- Se registra en cada carga de cierres, en cada novedad (al crearla y al editarla) y en cada
  cambio de rangos de turno: coordenadas, precisión y si fue dentro de una sede.
- En la barra superior se ve el estado del equipo: *En sede: nombre*, *Fuera de sede*,
  *Ubicación imprecisa*, *Sin permiso de ubicación* o *Ubicación registrada* (si aún no hay sedes).
- Bajo cada novedad y en *Última modificación en línea* aparece desde dónde se hizo.
- Sin permiso, o con una precisión peor que el radio de la sede, se puede trabajar igual y el
  cambio queda marcado (*sin permiso de ubicación* o *ubicación no confirmada*).

### Sedes

El administrador registra las sedes estando en ellas: botón con su nombre, sección **Sedes**,
escribir el nombre y pulsar **Registrar esta sede**. Se puede ajustar el radio (200 m por
defecto) y quitar sedes; al quitarlas se desactivan, así los registros anteriores conservan
el nombre.

Un celular ubica con GPS y es preciso; un computador se ubica por WiFi o por la conexión y puede
errar por cientos de metros. Por eso conviene registrar las sedes desde un celular.

La ubicación la reporta el navegador: sirve como registro y control, pero alguien con
conocimientos técnicos podría falsearla.

### Cargas de cierres

Los cierres se suben solo cuando alguien carga un archivo nuevo. Reabrir la aplicación no vuelve
a subir el último CSV guardado en el equipo, así no se sobrescribe quién ni desde dónde lo cargó.

## Usuarios y permisos

### Acceso obligatorio

La aplicación **no se puede usar sin iniciar sesión**. Al abrirla solo aparece la pantalla
de ingreso; la barra, el informe, la carga de CSV y las novedades quedan ocultos y
bloqueados hasta verificar que la cuenta esté habilitada. Así cada cambio tiene responsable:

- Cada novedad guarda quién la registró y quién la editó por última vez, con fecha y hora
  (se ve bajo la descripción, y no sale en la impresión).
- Bajo el informe aparece *Última modificación en línea: nombre · fecha*.
- En el servidor, cada fila de cierres, novedades y configuración registra `updated_by`.

Si la sesión se vence mientras se trabaja, la aplicación se bloquea y pide ingresar de nuevo.
Sin internet puede seguir trabajando quien ya había iniciado sesión en ese equipo, pero para
entrar por primera vez hace falta conexión. Al cerrar sesión con cambios sin subir, la
aplicación avisa antes de salir.

Tener cuenta en el proyecto Supabase **no basta**: la cuenta debe estar en la tabla
`informe_usuarios` y activa. Los usuarios de otras aplicaciones del mismo proyecto no ven
nada del informe (todas las políticas exigen `informe_autorizado()`).

| Rol | Puede |
|---|---|
| `admin` | Todo lo del líder, y además poner nombre a los usuarios y activarlos o desactivarlos |
| `lider` | Cargar cierres, editar novedades, imprimir y exportar |

El administrador ve el panel **Usuarios del informe** dentro del botón *Nube*: escribe el
nombre de cada persona y se guarda al salir del campo. Ese nombre es el que aparece luego
en la barra superior y en el detalle del indicador de conexión.

Si alguien con cuenta pero sin autorización intenta entrar, la aplicación se lo dice
explícitamente en vez de fallar: *"Tu cuenta existe, pero no está habilitada para el informe"*.

### Agregar un usuario nuevo

1. Crear la cuenta (panel de Supabase → *Authentication → Users → Add user*, marcando
   **Auto Confirm User**).
2. Habilitarla en el informe:

```sql
insert into public.informe_usuarios (user_id, correo, nombre, rol)
select id, email, 'Nombre visible', 'lider' from auth.users where email = 'correo@combuses.com.co';
```

Para quitarle el acceso a alguien sin borrar su cuenta:

```sql
update public.informe_usuarios set activo = false where correo = 'correo@combuses.com.co';
```
