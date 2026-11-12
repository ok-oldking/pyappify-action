# PyAppify Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-PyAppify%20Action-blue.svg?colorA=24292e&colorB=0366d6&style=flat&logo=github)](https://github.com/marketplace/actions/pyappify)

Ship your Python app as a Windows installer, built automatically on every version tag.

This action packages your project with [PyAppify](https://github.com/ok-oldking/pyappify). PyAppify is a small Rust launcher that runs your code in its own Python environment and updates it from your git tags. On CI the action builds that launcher with your name and icon. It installs Python and your dependencies ahead of time, then bundles the result. Your users get an installer that works offline, and later versions arrive as small git updates rather than new downloads.

- **No freezing.** Your code runs as normal Python in a real venv. Any library works without hooks or hidden-import lists.
- **Antivirus friendly.** A small launcher plus an NSIS installer, not one large self-extracting exe.
- **Built-in updates.** Installed apps update from your repo's tags. Update and release notes come from your `CHANGELOG.md`, or from the commit messages when it has no entry.
- **Multiple profiles.** Ship variants such as `release`/`debug` or `cpu`/`cuda`, each with its own entry script, dependencies and settings.

> Windows only for now (`runs-on: windows-latest`).

## Quick start with an AI coding agent

Open your Python project in a coding agent (Claude Code, Codex, Cursor, Copilot, ...) and ask:

```text
setup pyappify using https://github.com/ok-oldking/pyappify-action
```

The agent inspects your project and asks you a few questions. It then writes `pyappify.yml` and `.github/workflows/build.yml` for you.

> **AI agents:** to set up PyAppify for the user's project, fetch and follow this guide verbatim:
> https://raw.githubusercontent.com/ok-oldking/pyappify-action/master/skills/pyappify-setup/SKILL.md

The guide is also an [Agent Skill](skills/pyappify-setup/SKILL.md). Install it with `npx skills add ok-oldking/pyappify-action`, and then "setup pyappify" works without the link.

## Manual setup

### 1. Add `pyappify.yml` to your repo root

```yaml
name: "my-app"            # English only; used for the exe and file names
icon: "icons/icon.png"    # optional, shown in the launcher window
profiles:
  - name: "release"
    git_url: "https://github.com/you/my-app.git"  # public HTTPS repo with version tags
    main_script: "main.py"
    requires_python: "3.12"
    requirements: "requirements.txt"
    use_pythonw: true     # GUI app: no console window

  - name: "debug"         # omitted keys are inherited from the first profile
    use_pythonw: false
```

Optionally add `icons/icon.ico` and `icons/icon.png` to the repo root to brand the launcher and installer.

### 2. Add `.github/workflows/build.yml`

```yaml
name: Build Application

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build with PyAppify
        uses: ok-oldking/pyappify-action@master
        with:
          version: 'v1.2.6'   # pin the PyAppify launcher, see https://github.com/ok-oldking/pyappify/releases
          package_zip: true   # also build portable archives

      - name: Release
        uses: softprops/action-gh-release@v2
        with:
          body_path: pyappify_release_notes.md   # CHANGELOG.md entry, or commit messages
          files: pyappify_dist/*
```

### 3. Push a tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow builds everything and attaches it to the GitHub release for that tag. To ship an update, push a new tag. Installed apps pick it up from your repo.

## What you get

Everything is written to `pyappify_dist/`. For an app named `my-app` with `release` and `debug` profiles:

| File | What it is |
|---|---|
| `my-app-win32-release-setup.exe` | **Offline installer** per profile: launcher, Python, venv, dependencies and your app. |
| `my-app-win32-online-setup.exe` | **Online installer**: the launcher only. Downloads Python, your code and dependencies on first run, and lets the user pick a profile. |
| `my-app-win32-release.7z` | **Portable archive** per profile (`package_zip: true`). Unpack and run `my-app.cmd`. No installer and no launcher UI. `my-app-updater.cmd` opens the update window ([portable updates](#portable-updates)). |
| `my-app-win32.zip` | The bare launcher exe, which behaves like the online installer without installing. |
| `win32_sha256.txt` | SHA-256 of the launcher exe. |

Every profile gets its own installer and archive, so `debug` also produces `my-app-win32-debug-setup.exe` and `my-app-win32-debug.7z`. With `add_version_name: true`, the tag version is added to the names, e.g. `my-app-win32-release-setup-1.0.0.exe`.

## `pyappify.yml` reference

Top level:

| Key | Required | Description |
|---|---|---|
| `name` | yes | App name, English only. |
| `profiles` | yes | One or more profiles. The first profile is the default, and its values fill in any key the others omit. |
| `icon` | | Image path relative to the app's working directory, shown in the launcher. |
| `website` | | URL opened by clicking the app title, and shown after a failed upgrade. |
| `keep_releases` | | Keep only the N newest release tags (plus newer prereleases) in the app's git repo. This makes packages and clones smaller. Omit to keep all. |
| `uac` | | `true` makes the launcher exe itself always request administrator rights. |

Profile keys:

| Key | Description |
|---|---|
| `name` | Profile name, English only. |
| `git_url` | HTTPS URL of the repo to clone. It must have version tags; semver like `v1.2.0` is recommended. |
| `main_script` | Entry point. A `.py` file runs with the venv's Python. Other names are looked up in the working directory and the venv's `Scripts` folder, e.g. a console script. |
| `requires_python` | Python version, `"3.7"` to `"3.13"`. |
| `requirements` | A requirements file such as `requirements.txt`, or a pyproject spec such as `"."` or `".[gui,cuda]"`. |
| `pip_args` | Extra `pip install` arguments, e.g. `"-i https://mirrors.aliyun.com/pypi/simple"` or `"--no-deps"`. |
| `PYTHONPATH` | `PYTHONPATH` for the app process, relative to the app's working directory, e.g. `"src"`. |
| `admin` | `true` runs the app elevated (UAC prompt). |
| `use_pythonw` | `true` runs with `pythonw.exe`, so no console window opens. |
| `show_add_defender` | `true` makes the launcher offer to add a Windows Defender exclusion. |

## Action inputs

All inputs are optional.

| Input | Default | Description |
|---|---|---|
| `version` | latest tag | PyAppify launcher version to build, e.g. `v1.2.6`. Pin it for reproducible builds. It must be v1.2.4 or newer. |
| `build_setup` | `true` | Build the online installer and one offline installer per profile. |
| `package_zip` | `false` | Build a portable archive per profile. Its `.cmd` honors `admin`, `use_pythonw` and `PYTHONPATH`. |
| `package_zip_updater` | `true` | Add `<name>-updater.cmd` to each archive. Skipped with a warning unless the app depends on `pyappify[standalone]` 1.0.20+. |
| `package_zip_format` | `7z` | `7z`: solid LZMA2, about a third smaller than zip. It opens natively on Windows 11 23H2+, otherwise needs 7-Zip. Or `zip`. |
| `add_version_name` | `false` | Append the tag version (without the leading `v`) to installer and archive names. |
| `app_version` | pushed tag | Exact app tag to package, prereleases included. On tag builds it defaults to that tag. Set it for manual or branch builds; otherwise they package the latest stable tag. |
| `use_release` | | GitHub release API URL, e.g. `https://api.github.com/repos/you/my-app/releases/tags/v1.0.0`. The launcher exe is taken from that release's assets instead of compiled, which saves the Rust build. |
| `build_exe_only` | `false` | Only build the launcher exe and output its path, so you can code-sign it. Then run the action again in the same job to package with the signed exe. |

At least one of `build_setup` and `package_zip` must be `true`.

### Portable updates

Portable archives have no launcher, so updates use the update window from the [`pyappify` Python package](https://pypi.org/project/pyappify/). Add it to your app's requirements:

```
pyappify[standalone]>=1.0.20
```

Each archive then also gets `my-app-updater.cmd`. It opens a window where users pick a version (releases, or pre-releases with "All") and read its notes. They can also choose the pip mirror. The window then checks the version out into the bundled repo, installs its dependencies, and restarts the app through `my-app.cmd`. The extra requires Python 3.10+ (for Dulwich). Without it the action builds the archive without the updater cmd and logs a warning. Set `package_zip_updater: false` to leave it out.

When the updater cmd is included, `my-app.cmd` no longer hardcodes the packaged version. `pyappify.app_version` is read from the repo instead, so it stays correct after an update.

### Outputs

| Output | Description |
|---|---|
| `dist-path` | The output directory (`pyappify_dist`). |
| `pyappify-assets` | Newline-separated list of the generated files. |
| `exe-path` | Launcher exe path (with `build_exe_only`). |
| `exe-folder` | Folder containing the launcher exe (with `build_exe_only`). |
| `release-notes` | Markdown notes for the packaged version ([release notes](#release-notes)). |
| `release-notes-path` | `pyappify_release_notes.md`, the same notes as a file for `body_path`. |

### Release notes

The action writes notes for the packaged version to `pyappify_release_notes.md`, the same way the PyAppify launcher and the update window build update notes:

- If `CHANGELOG.md` at that tag has an entry for the version, the notes are its entry, plus the entries of the prereleases since the previous release, repeated notes once.
- Otherwise they are the commit subjects since the previous version (the previous release for a release, the previous version tag for a prerelease), merges skipped.

The changelog format is described in [PyAppify's update notes](https://github.com/ok-oldking/pyappify#update-notes): `## v1.4.0` starts a version (`[v1.4.0]`, `1.4.0` and a trailing date also work), `- ` starts a note and an indented line continues it. Localized `CHANGELOG.<language>.md` files are used by the launcher; the release notes use the English `CHANGELOG.md`.

The file is written next to `pyappify_dist/`, not inside it, so `files: pyappify_dist/*` does not upload it. The notes are read from the bundled repo, so they are not written with `build_exe_only`.

## How it works

1. Clones [PyAppify](https://github.com/ok-oldking/pyappify) at the requested `version`. It then copies in your `pyappify.yml` and `icons/` and renames the project to your app name.
2. Compiles the launcher with Tauri/Rust, unless `use_release` provides one.
3. For each profile, runs the launcher's headless setup at the exact tag being released. This clones your repo, downloads Python, creates the venv and installs your requirements. The action then checks that the prepared version matches the tag.
4. Removes `__pycache__` folders, so the app's first start is a little slower. Trims the git history to `keep_releases` if set.
5. Bundles the prepared profile into an NSIS installer and/or a portable archive, then writes everything to `pyappify_dist/`.

## License

See [LICENSE.txt](LICENSE.txt).
