#!/usr/bin/env node
/**
 * Bump and synchronise the project version across:
 *   - package.json
 *   - src-tauri/tauri.conf.json
 *   - src-tauri/Cargo.toml   (the [package] version field)
 *
 * Usage:
 *   node scripts/bump-version.mjs patch        # 0.1.0 -> 0.1.1
 *   node scripts/bump-version.mjs minor        # 0.1.0 -> 0.2.0
 *   node scripts/bump-version.mjs major        # 0.1.0 -> 1.0.0
 *   node scripts/bump-version.mjs 1.4.2        # set explicit version
 *
 * Prints the new version (without 'v' prefix) to stdout on the LAST line so
 * the calling .bat can capture it via FOR /F.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const pkgPath  = join(root, 'package.json');
const confPath = join(root, 'src-tauri', 'tauri.conf.json');
const cargoPath = join(root, 'src-tauri', 'Cargo.toml');

function bump(current, kind) {
  if (/^\d+\.\d+\.\d+$/.test(kind)) return kind;
  const [maj, min, pat] = current.split('.').map(Number);
  switch (kind) {
    case 'major': return `${maj + 1}.0.0`;
    case 'minor': return `${maj}.${min + 1}.0`;
    case 'patch':
    case undefined:
    case '':
      return `${maj}.${min}.${pat + 1}`;
    default:
      throw new Error(`unknown bump kind: ${kind}`);
  }
}

const kind = process.argv[2];

// package.json
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const next = bump(pkg.version, kind);
pkg.version = next;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

// tauri.conf.json
const conf = JSON.parse(readFileSync(confPath, 'utf8'));
conf.version = next;
writeFileSync(confPath, JSON.stringify(conf, null, 2) + '\n');

// Cargo.toml — only replace the FIRST `version = "..."` line under [package]
const cargo = readFileSync(cargoPath, 'utf8');
const updatedCargo = cargo.replace(
  /(\[package\][\s\S]*?\nversion\s*=\s*")[^"]+(")/,
  `$1${next}$2`
);
if (updatedCargo === cargo) {
  throw new Error('failed to locate [package] version in Cargo.toml');
}
writeFileSync(cargoPath, updatedCargo);

// Last line = new version (consumed by release.bat)
process.stdout.write(next + '\n');
