<#
  Publica la aplicación en GitHub Pages.

  Hace, en orden:
    1. sube el número de versión (sw.js y js/version.js),
    2. revisa que no se escape nada que no deba subirse (CSV, contraseñas,
       archivos de prueba),
    3. hace el commit y lo sube,
    4. espera a que GitHub Pages publique y lo verifica.

  Uso desde PowerShell, en esta carpeta:

      .\publicar.ps1 "Lo que cambió"
#>
param(
  [Parameter(Mandatory = $true, Position = 0)]
  [string]$Mensaje
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSCommandPath)

$SITIO = 'https://desarrollocombuses.github.io/informe-ventas'
$MESES = @('enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
           'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre')

function Leer($ruta) {
  return [System.IO.File]::ReadAllText($ruta, [System.Text.Encoding]::UTF8)
}

function Escribir($ruta, $texto) {
  [System.IO.File]::WriteAllText($ruta, $texto, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------- 1. versión
$sw = Leer (Join-Path $PWD 'sw.js')
$m = [regex]::Match($sw, "const VERSION = 'v(\d+)'")
if (-not $m.Success) { throw 'No se encontró el número de versión en sw.js' }

$anterior = 'v' + $m.Groups[1].Value
$nueva = 'v' + ([int]$m.Groups[1].Value + 1)
$hoy = Get-Date
$fecha = '{0} de {1} de {2}' -f $hoy.Day, $MESES[$hoy.Month - 1], $hoy.Year

Escribir (Join-Path $PWD 'sw.js') ($sw -replace "const VERSION = 'v\d+'", "const VERSION = '$nueva'")
Escribir (Join-Path $PWD 'js\version.js') @"
/* Versión publicada de la aplicación.
   Lo escribe ``publicar.ps1`` en cada publicación: no se edita a mano. */
self.IDV_VERSION = { numero: '$nueva', fecha: '$fecha' };
"@

Write-Host "Versión $anterior -> $nueva ($fecha)"

# ------------------------------------------------------- 2. revisión previa
git add -A
if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los cambios (git add)' }

$archivos = @(git diff --cached --name-only)
if (-not $archivos) { throw 'No hay cambios para publicar' }

$prohibidos = $archivos | Where-Object { $_ -match '\.csv$|_selftest|_prueba|\.env$|claves' }
if ($prohibidos) {
  throw "No se publica: estos archivos no deben subirse: $($prohibidos -join ', ')"
}

# este mismo archivo no se revisa: contiene los patrones que busca y se
# señalaría a sí mismo
$revisables = @($archivos | Where-Object { $_ -ne 'publicar.ps1' })
$diff = if ($revisables) { @(git diff --cached -- $revisables) } else { @() }
$sospechas = $diff | Select-String -Pattern '[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}|encrypted_password|service_role|gen_salt'
if ($sospechas) {
  Write-Host ($sospechas | Select-Object -First 5)
  throw 'No se publica: el cambio parece traer contraseñas o datos sensibles'
}

Write-Host "Revisado: $($archivos.Count) archivo(s), sin datos sensibles"

# ------------------------------------------------------------ 3. commit y push
$texto = @"
$Mensaje

Versión $nueva
"@
git commit -m $texto
if ($LASTEXITCODE -ne 0) { throw 'No se pudo hacer el commit' }

git push origin main
if ($LASTEXITCODE -ne 0) { throw 'No se pudo subir a GitHub' }

# -------------------------------------------------------- 4. verificar en línea
Write-Host 'Esperando a que GitHub publique...'
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep -Seconds 15
  try {
    $t = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    $publicado = (Invoke-WebRequest -UseBasicParsing "$SITIO/sw.js?v=$t" -TimeoutSec 20).Content
    if ($publicado -match "const VERSION = '$nueva'") {
      Write-Host ''
      Write-Host "LISTO: la versión $nueva ya está publicada en $SITIO"
      Write-Host 'Quien tenga la aplicación abierta verá el aviso para actualizar.'
      exit 0
    }
  } catch { }
}

Write-Host ''
Write-Host "El commit se subió, pero la versión $nueva todavía no aparece en línea."
Write-Host 'GitHub Pages suele tardar un par de minutos: vuelve a revisar el sitio en un rato.'
exit 1
