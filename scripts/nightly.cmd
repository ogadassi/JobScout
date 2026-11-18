@echo off
rem Runs the JobScout pipeline from the repo folder and appends output to data\nightly.log.
rem Used by Windows Task Scheduler (see README).
cd /d "%~dp0.."
if not exist data mkdir data
call npm run pipeline >> data\nightly.log 2>&1
