@echo off
title QbD Experimental Design App
chcp 65001 >nul

:: Dat duong dan tuyet doi cua du an
set "APP_DIR=d:\Sync\GDrive\AG\Experimental Design"

:: Kiem tra thu muc du an
if exist "%APP_DIR%\package.json" (
    cd /d "%APP_DIR%"
) else if exist "%~dp0package.json" (
    cd /d "%~dp0"
) else (
    echo [ERROR] Khong tim thay thu muc ung dung tai: %APP_DIR%
    echo Vui long kiem tra lai duong dan!
    pause
    exit /b 1
)

echo ========================================================
echo   DANG KHOI CHAY UNG DUNG QbD - EXPERIMENTAL DESIGN
echo ========================================================
echo Thu muc lam viec: %CD%
echo.

:: Tu dong mo trinh duyet sau 2 giay
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:5173"

:: Chay Vite dev server
echo Dang khoi dong may chu Vite...
call npm.cmd run dev

pause
