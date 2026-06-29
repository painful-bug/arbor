@echo off
REM Wrapper to run build-windows.ps1 from cmd
powershell -ExecutionPolicy Bypass -File "%~dp0build-windows.ps1" %*
