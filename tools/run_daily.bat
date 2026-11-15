@echo off
pushd "%~dp0.."
if not exist "data\batch\logs" mkdir "data\batch\logs"
node "tools\batch.mjs" --today >> "data\batch\logs\scheduler.log" 2>&1
set RC=%errorlevel%
popd
exit /b %RC%
