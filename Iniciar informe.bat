@echo off
title Informe Diario de Ventas
cd /d "%~dp0"

rem --- Busca un servidor local: Python o Node ---
set "PORT=8123"
set "CMD="

where py >nul 2>&1 && set "CMD=py -3 -m http.server %PORT%"
if not defined CMD ( where python >nul 2>&1 && set "CMD=python -m http.server %PORT%" )
if not defined CMD ( where npx >nul 2>&1 && set "CMD=npx --yes http-server -p %PORT% -c-1" )

if not defined CMD (
  echo No se encontro Python ni Node para levantar el servidor local.
  echo.
  echo Puedes abrir index.html directamente en el navegador, pero la instalacion
  echo como aplicacion ^(PWA^) y el modo sin conexion requieren un servidor.
  echo.
  start "" "index.html"
  pause
  exit /b
)

echo Servidor local en http://localhost:%PORT%
echo Cierra esta ventana para detenerlo.
echo.
start "" "http://localhost:%PORT%/index.html"
%CMD%
