@echo off
cd /d "%~dp0"

echo ============================================
echo   Building Riftgate installer
echo ============================================
echo.
echo Step 1/2: Installing dependencies (only needed the first time)...
echo.

call npm install
if errorlevel 1 (
    echo.
    echo Something went wrong during npm install. Scroll up to see the error.
    echo Make sure Node.js is installed and you're running this from inside the Riftgate folder.
    pause
    exit /b 1
)

echo.
echo Step 2/2: Building the installer... this can take a few minutes the first time.
echo.

call npm run dist
if errorlevel 1 (
    echo.
    echo Something went wrong during the build. Scroll up to see the error.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Done! Look inside the "dist" folder for:
echo   Riftgate Setup 1.0.0.exe
echo   That is the file you send to your friend.
echo ============================================
pause
