# AGENTS.md

Test (needs pyxdg): `python3 -m unittest discover -s tests`

Install and reload:

```sh
rsync -a --delete --exclude '.*' --exclude tests --exclude '*.md' ./ ~/.config/dms/plugins/xdgMenu/
dms ipc call plugins reload xdgMenu
```
