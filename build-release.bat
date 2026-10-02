@echo off
cd /d C:\Riftgate
echo Building Riftgate v1.8.1 with all fixes...
echo - Cinema selector styling (Riftgate theme)
echo - Removed pagination caps
echo - Added free games platform support
echo.
call npm run release
echo.
echo Build complete! The installer will be in the dist folder.
echo After building, it will automatically push to GitHub releases.
pause
