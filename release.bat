@echo off
setlocal EnableDelayedExpansion

REM ============================================================================
REM   release.bat
REM
REM   One-shot release: pre-flight build, version bump, commit, tag, push.
REM   Pushing the tag (`vX.Y.Z`) auto-triggers .github/workflows/release.yml
REM   on GitHub, which builds Windows + macOS-Universal installers and
REM   publishes them to a Release.
REM
REM   Usage (from the project root, in cmd.exe):
REM     release            -> patch bump (e.g. 1.0.14 -> 1.0.15)
REM     release minor      -> minor bump (e.g. 1.0.14 -> 1.1.0)
REM     release major      -> major bump (e.g. 1.0.14 -> 2.0.0)
REM     release 1.4.2      -> set the version explicitly
REM
REM   Requires: node, git, npm   (cargo is optional; skipped if missing)
REM ============================================================================

cd /d "%~dp0"

REM ── 1. Sanity checks ────────────────────────────────────────────────────────
where node >nul 2>&1 || ( echo [release] ERROR: node not found in PATH & exit /b 1 )
where git  >nul 2>&1 || ( echo [release] ERROR: git not found in PATH  & exit /b 1 )
where npm  >nul 2>&1 || ( echo [release] ERROR: npm not found in PATH  & exit /b 1 )

REM Print the current branch so the user notices if they're not on main —
REM the workflow triggers on tag-push regardless, but main is conventional.
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%B"
echo [release] branch: !BRANCH!
if /I not "!BRANCH!"=="main" (
    echo [release] NOTE: you are not on "main". Continuing anyway.
)

REM ── 2. Pre-flight build (TS + Vite) ─────────────────────────────────────────
echo [release] pre-flight: npm run build...
call npm run build >nul 2>&1
if errorlevel 1 (
    echo [release] ERROR: npm run build failed - aborting before any version bump.
    echo [release]        Run "npm run build" manually to see the errors.
    exit /b 1
)

REM ── 3. Pre-flight cargo check (skipped if cargo isn't installed) ───────────
where cargo >nul 2>&1
if not errorlevel 1 (
    echo [release] pre-flight: cargo check...
    call cargo check --manifest-path src-tauri\Cargo.toml --quiet
    if errorlevel 1 (
        echo [release] ERROR: cargo check failed - aborting.
        exit /b 1
    )
) else (
    echo [release] cargo not found locally - skipping pre-flight, GitHub Actions will compile.
)

REM ── 4. Bump version ─────────────────────────────────────────────────────────
echo [release] bumping version (%~1)...
for /f "tokens=* usebackq" %%V in (`node scripts\bump-version.mjs %~1`) do set "NEW_VERSION=%%V"
if "!NEW_VERSION!"=="" (
    echo [release] ERROR: version bump failed.
    exit /b 1
)
set "TAG=v!NEW_VERSION!"
echo [release] new version: !NEW_VERSION!  (tag: !TAG!)

REM ── 5. Stage everything respecting .gitignore ───────────────────────────────
REM `git add -A` picks up modifications, deletions AND new files in tracked
REM directories — important so newly added components / hooks / utils land
REM in the release commit instead of being silently dropped.
REM .gitignore protects node_modules / target / dist / etc.
git add -A
if errorlevel 1 goto :fail

REM Commit only if anything is actually staged. (git diff --cached --quiet
REM exits 0 when there is nothing staged, 1 when there is.)
git diff --cached --quiet
if errorlevel 1 (
    git commit -m "Release !TAG!"
    if errorlevel 1 goto :fail
) else (
    echo [release] no file changes to commit - tagging current HEAD.
)

REM ── 6. Tag + push ──────────────────────────────────────────────────────────
git tag !TAG!
if errorlevel 1 goto :fail

echo [release] pushing commit and tag...
git push --follow-tags
if errorlevel 1 goto :fail

echo.
echo [release] DONE. tag !TAG! pushed.
echo [release] CI will build Windows + macOS bundles automatically:
echo [release]   https://github.com/AuchGit/CSVTourManager/actions
exit /b 0

:fail
echo [release] step failed - aborting. Review with `git status`.
exit /b 1
