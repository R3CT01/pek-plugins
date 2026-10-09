# PEK plugin site (GitHub Pages)

Two pages, no build step:

- `index.html`  anyone: sign in with GitHub, upload a plugin .zip, see the status of your uploads
- `owner.html`  owners only: review uploads (permissions + code), approve/reject, publish official plugins, remove plugins

## Publish it

1. Make a **public** GitHub repository (for example `hesper-plugins`).
2. Upload everything in this folder to it (the files must be at the top of the repo).
3. Repo -> **Settings -> Pages** -> Source: *Deploy from a branch* -> branch `main`, folder `/ (root)` -> Save.
4. After a minute the site is live at `https://<your-name>.github.io/<repo>/`. Put that address in the worker's `SITE_URL` setting
   (see `cloud/DEPLOY.md`, "Plugin Store") and in the OAuth App's Homepage URL.
5. If your worker's address is different from the one in `config.js`, change it there.

The site holds no secrets. Sign-in happens on your worker, and GitHub's client secret only ever lives there.

## Notes for plugin authors (shown on the upload page)

- The zip needs `plugin.json` and `ui.js`, at the top or inside one folder. **The folder name becomes the plugin id**
  (lowercase letters, digits, `-` and `_`); a zip without a folder gets its id from the plugin's name.
- Same limits as installing in PEK: 200 files, 2 MB per file, 8 MB total, no hidden files, `.py` only up to 200 KB.
- To update a plugin, upload the new zip with the same folder name.
# pek-plugins
