#!/bin/sh
# Builds dist/xdgMenu.zip: an xdgMenu/ directory with only the files the plugin needs at runtime.
set -eu
cd "$(dirname "$0")/.."
rm -rf dist
mkdir -p dist/xdgMenu
cp -r plugin.json XdgMenu.qml favorites.js xdg-menu.py data translations LICENSE dist/xdgMenu/
cd dist
zip -qr xdgMenu.zip xdgMenu
rm -rf xdgMenu
