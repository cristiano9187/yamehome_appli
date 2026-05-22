@echo off
REM Deploie uniquement la fonction mail "nouveau prospect" (codebase Firebase : archive)
cd /d "%~dp0\.."
echo Deploiement: functions:archive:onProspectCreatedSendEmail
firebase deploy --only functions:archive:onProspectCreatedSendEmail
if errorlevel 1 (
  echo Echec. Verifie: firebase login, projet actif ^(firebase use^), et npm dans functions.
  pause
  exit /b 1
)
echo Termine.
pause
