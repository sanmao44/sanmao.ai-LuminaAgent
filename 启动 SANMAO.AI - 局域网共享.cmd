@echo off
cd /d %~dp0
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -WindowStyle Hidden -File "%~dp0scripts\lan-launcher.ps1"
