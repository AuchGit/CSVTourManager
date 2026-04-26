@echo off
setlocal EnableDelayedExpansion

REM ============================================================================
REM   release.bat  -  bump version, push tag, trigger GitHub Actions release
REM
REM   Usage from project root (cmd.exe):
REM     release            -> patch bump (0.1.0 -> 0.1.1)
REM     release minor      -> minor bump (0.1.0 -> 0.2.0)
REM     release major      -> major bump (0.1.0 -> 1.0.0)
REM     release 1.4.2      -> set explicit version
REM
REM   Requires:  node, git, gh (GitHub CLI, authenticated via `gh auth login`)
REM ============================================================================

cd /d "%~dp0"

REM ── 1. Sanity checks ────────────────────────────────────────────────────────
where node >nul 2>&1 || ( echo [release] node not found in PATH & exit /b 1 )
where git  >nul 2>&1 || ( echo [release] git not found in PATH  & exit /b 1 )
where gh   >nul 2>&1 || ( echo [release] gh CLI not found in PATH ^(install: https://cli.github.com^) & exit /b 1 )

git diff --quiet
if errorlevel 1 (
    echo [release] working tree has uncommitted changes - commit or stash first.
    exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
    echo [release] staged-but-uncommitted changes present - commit first.
    exit /b 1
)

REM ── 2. Bump version ─────────────────────────────────────────────────────────
echo [release] bumping version (%~1)...
for /f "tokens=* usebackq" %%V in (`node scripts\bump-version.mjs %~1`) do set "NEW_VERSION=%%V"
if "!NEW_VERSION!"=="" (
    echo [release] version bump failed.
    exit /b 1
)
set "TAG=v!NEW_VERSION!"
echo [release] new version: !NEW_VERSION!  (tag: !TAG!)

REM ── 3. Commit + tag + push ──────────────────────────────────────────────────
git add package.json src-tauri\tauri.conf.json src-tauri\Cargo.toml
if errorlevel 1 goto :fail

git commit -m "Release !TAG!"
if errorlevel 1 goto :fail

git tag !TAG!
if errorlevel 1 goto :fail

echo [release] pushing commit and tag...
git push --follow-tags
if errorlevel 1 goto :fail

REM ── 4. Trigger workflow ─────────────────────────────────────────────────────
echo [release] triggering GitHub Actions workflow...
gh workflow run release.yml -f version=!TAG! -f draft=false
if errorlevel 1 goto :fail

echo.
echo [release] done. tag !TAG! pushed and workflow dispatched.
echo [release] watch progress: gh run watch
exit /b 0

:fail
echo [release] step failed - aborting. (Local files were modified; review with `git status`.)
exit /b 1
