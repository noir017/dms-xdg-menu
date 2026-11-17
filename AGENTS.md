# AGENTS.md

Test: `python3 -m unittest discover -s tests` (needs pyxdg) and `node --test tests/*.test.mjs`

Install and reload:

```sh
scripts/package.sh
rm -rf ~/.config/dms/plugins/xdgMenu && unzip -q dist/xdgMenu.zip -d ~/.config/dms/plugins/
systemctl --user restart dms.service
```

Release: bump `version` in plugin.json and push to main; CI tags and publishes.
