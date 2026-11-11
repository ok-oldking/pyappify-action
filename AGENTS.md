# Agent notes

If you were asked to **set up PyAppify for another project** (for example
"setup pyappify using https://github.com/ok-oldking/pyappify-action"), do not
change this repository. Follow [skills/pyappify-setup/SKILL.md](skills/pyappify-setup/SKILL.md)
in the user's project instead.

## Working on this repository

- Source: `index.js` (entry) plus helper modules `build-config.js`,
  `package-zip.js`, `setup-profile.js`, `trim-repo.js`, each with a `*.test.js`.
- `dist/index.js` is the bundled action that GitHub runs. Rebuild it after
  changing any source file: `npm run build`. Run tests with `npm test`.
- When you add or change an action input or a `pyappify.yml` option, update
  `action.yml`, `README.md` and `skills/pyappify-setup/SKILL.md` together.
