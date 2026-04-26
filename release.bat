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
REM   Requires:  node, git
REM ============================================================================

cd /d "%~dp0"

REM ── 1. Sanity checks ────────────────────────────────────────────────────────
where node >nul 2>&1 || ( echo [release] node not found in PATH & exit /b 1 )
where git  >nul 2>&1 || ( echo [release] git not found in PATH  & exit /b 1 )

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
REM Stage the bumped files PLUS any other modified tracked files (e.g. local
REM tweaks to workflow / source) so a single "Release vX.Y.Z" commit captures
REM everything. Untracked files are intentionally NOT staged — those need a
REM deliberate `git add` from the user.
git add package.json src-tauri\tauri.conf.json src-tauri\Cargo.toml
if errorlevel 1 goto :fail
git add -u
if errorlevel 1 goto :fail

REM Commit only if anything is actually staged. `git diff --cached --quiet`
REM exits 0 when there is nothing staged, 1 when there is.
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Release !TAG!"
    if errorlevel 1 goto :fail
) else (
    echo [release] no file changes to commit - tagging current HEAD.
)

git tag !TAG!
if errorlevel 1 goto :fail

echo [release] pushing commit and tag (this triggers the GitHub Actions build)...
git push --follow-tags
if errorlevel 1 goto :fail

echo.
echo [release] done. tag !TAG! pushed.
echo [release] workflow runs at: https://github.com/AuchGit/CSVTourManager/actions
exit /b 0

:fail
echo [release] step failed - aborting. (Local files were modified; review with `git status`.)
exit /b 1
