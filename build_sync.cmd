@echo off
REM Build + sync.
REM   1) src/ -> lib/        TypeScript compile
REM   2) client.js -> lib/client.js   (package.json exports["./client"] points at
REM      lib/client.js; the root client.js is the source of truth and gets copied
REM      here at build time so there is only one file to edit)
REM   3) sync into the DSH profile, unless that entry is a symlink back to this
REM      workspace (the normal dev setup) - then the build is already live.
cd /d D:\DeepSeekHarness\dsh-memory-gateway

call node_modules\.bin\tsc -p tsconfig.json
if errorlevel 1 (echo TSC_FAILED & exit /b 1)
echo TSC_OK

copy /Y client.js lib\client.js >nul
if errorlevel 1 (echo CLIENT_COPY_FAILED & exit /b 1)
echo CLIENT_SYNCED

node tools\sync-profile.mjs
if errorlevel 1 (echo SYNC_FAILED & exit /b 1)
