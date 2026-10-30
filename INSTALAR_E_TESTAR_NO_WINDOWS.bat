@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Instalando dependencias do ConecTorno...
py -m pip install --upgrade pip
py -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo ERRO ao instalar. Verifique se o Python esta instalado e marcado no PATH.
  pause
  exit /b 1
)
echo.
echo Dependencias instaladas com sucesso!
pause
