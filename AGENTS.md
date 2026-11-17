# AGENTS.md

Test: `node --test tests/*.test.mjs`

Install and reload:

```sh
scripts/package.sh
rm -rf ~/.config/dms/plugins/xdgMenu && unzip -q dist/xdgMenu.zip -d ~/.config/dms/plugins/
systemctl --user restart dms.service
```

Release: bump `version` in plugin.json and push to main; CI tags and publishes.

`menu.js` is plain JavaScript shared by QML and node: no QML APIs, and nothing the QML engine lacks (such as `Array.prototype.flatMap`).
