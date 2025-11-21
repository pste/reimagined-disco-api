@echo off
rem REQUIREMENT: git, docker, logged in on Docker
rem cicd-11633

rem reimagined-disco-ui   reimagined-disco-api
SET APPNAME=reimagined-disco-api
SET TMPDIR=cicd-%random%

rem GIT: clone, move to latest tag
echo "Moving to %TEMP% ..."
cd /d %TEMP%
git clone https://github.com/pste/%APPNAME%.git %TMPDIR%
cd %TMPDIR%

for /f %%a in ('git describe --tags --abbrev^=0 origin/main') do set LATEST_TAG=%%a
echo The latest tag is: %LATEST_TAG%

git checkout %LATEST_TAG%

rem DOCKER: build, push
echo "Building pirraste/%APPNAME%:%LATEST_TAG%"
docker build -t pirraste/%APPNAME%:%LATEST_TAG% -f .docker/Dockerfile .
docker push pirraste/%APPNAME%:%LATEST_TAG%

rem Back to Home folder
cd %userprofile%