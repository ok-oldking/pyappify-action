---
name: pyappify-setup
description: Set up PyAppify packaging for a Python project. Inspects the project, asks the user for the remaining options, then generates pyappify.yml plus a GitHub Actions workflow (.github/workflows/build.yml) that builds on every version tag, a local build script (build-pyappify.cmd) for Windows, or both, using ok-oldking/pyappify-action to produce a Windows launcher, setup installers and/or portable 7z/zip archives. Apps can be packaged from a public git repo (with updates) or from the local files (no git repo needed). Use when the user asks to set up, configure or add pyappify, to "set up https://github.com/ok-oldking/pyappify-action for this project", or to package a Python app as a Windows exe/installer.
---

# Set up PyAppify for a Python project

You are configuring the user's Python project (the current working directory) to
be packaged by [PyAppify](https://github.com/ok-oldking/pyappify) with
[ok-oldking/pyappify-action](https://github.com/ok-oldking/pyappify-action),
either as a GitHub Action, as a local build on the user's Windows machine, or both.

You will create:

1. `pyappify.yml` in the project root
2. For a GitHub build: `.github/workflows/build.yml` (or another name if that file already exists)
3. For a local build: `build-pyappify.cmd` in the project root, plus `.gitignore` entries
4. Optionally an `icons/` folder note (you do not generate icon images)

How PyAppify works, so your choices make sense: the built launcher clones the
app from `git_url` at a **git tag**, downloads an isolated Python
(`requires_python`), creates a venv, `pip install`s `requirements`, and runs
`main_script`. The action pre-does this at build time so the installer/archive
works offline. Updates are delivered by pushing new tags, so **the repo should use
version tags** (semver like `v1.0.0` recommended; `v1.2`, `release-1.2.0` and
`1.2.3rc1` also work, see "Version tags" in the action's README). Without any
version tag, the 30 most recent commits of the default branch are the versions.

**Without a git repo**: leave `git_url` out (or set the action input
`use_git_url: false`) and the action packages the project's local files
instead. That needs no remote, no push and no tags, but installed apps get no
updates, there is no online setup and archives get no updater cmd. It needs a
PyAppify launcher (`version`) newer than v1.2.7.

Follow the steps in order. Do not ask the user anything you can detect.

## Step 1: Inspect the project

Gather these facts silently (read files, run read-only git commands):

| Fact | Where to look |
|---|---|
| Existing config | `pyappify.yml` already present? If so, read it and update it instead of replacing it. Same for `.github/workflows/*.yml` that already use `pyappify-action`. |
| Entry script | `main.py`, `app.py`, `run.py`, `gui.py`, `<pkg>/__main__.py`, `[project.scripts]` / `[project.gui-scripts]` in `pyproject.toml`, `if __name__ == "__main__"` blocks. The path is relative to the repo root. A console-script name (no `.py`) also works: PyAppify then looks for it in the working dir and the venv's `Scripts`/`bin`. Prefer an existing `.py` script; for a src-layout package either use `requirements: "."` (installs the package) or set `PYTHONPATH: "src"`. |
| Debug/alternate entry | e.g. `main_debug.py`, `cli.py`, a CPU/GPU variant. Each can become an extra profile. |
| Python version | `requires-python` in `pyproject.toml`, `.python-version`, `runtime.txt`, CI files, `setup.py` `python_requires`. Pick one concrete `major.minor` between 3.7 and 3.13: the version the project's CI/dev setup already uses if known, else 3.12 when allowed (widest wheel coverage), else the highest allowed. |
| Requirements | `requirements.txt` (or `requirements/*.txt`); otherwise `pyproject.toml`, written as `.` or `.[extra1,extra2]`. |
| GUI or console | Uses tkinter, PySide/PyQt, wx, pywebview, Kivy, Flet, pygame, etc. with no console output needed → GUI candidate for `use_pythonw`. |
| Needs admin | Code that writes to Program Files, edits the registry (HKLM), uses `ctypes.windll.shell32.IsUserAnAdmin`, drivers, game memory/input hooks → candidate for `admin`. |
| Git repo | Is the project a git work tree (`git rev-parse --is-inside-work-tree`)? Is it on GitHub (CI possible)? |
| Git URL | `git remote get-url origin`. Convert SSH (`git@github.com:o/r.git`) to HTTPS (`https://github.com/o/r.git`). The end user's launcher clones this, so it must be **publicly readable over HTTPS**. No remote, or a private one → packaging from local files is the only option that works. |
| Tags | `git tag --sort=-v:refname`. Note whether version tags exist (`v1.2.3`, `1.2`, `release-1.2.0`, `1.2.3rc1` ...; a single number needs a `v`). |
| Icons | `icons/icon.ico` and `icons/icon.png` in the repo root? |
| Large data | Git-ignored folders the app needs at run time (model weights such as `checkpoints/`, downloaded assets). Candidates for `extra_files`; note how they are downloaded (e.g. `modelscope download ...`). |
| Default branch | `git symbolic-ref refs/remotes/origin/HEAD` or `git branch --show-current`. |
| Local build tools | Only matters for a local build, on Windows: `node --version` (20+), `git --version`, `cargo --version` (Rust), and `7z` on PATH or in `C:\Program Files\7-Zip` for 7z archives. The Visual Studio C++ build tools cannot be checked reliably; mention them. Do not install anything yourself. |
| Launcher version | Newest tag at https://github.com/ok-oldking/pyappify/tags if you can check it. Packaging local files needs one newer than v1.2.7. |

## Step 2: Ask the user for what is left

Ask in **one** message (or one multiple-choice prompt if your tool supports it).
Pre-fill every question with what you detected and your recommended default, so
the user can just confirm. Only ask the questions that apply:

1. **Where to build** – on GitHub Actions for every pushed version tag
   (default for a GitHub repo), locally on this Windows machine with
   `build-pyappify.cmd` (default when there is no GitHub repo), or both.
   A local build compiles the Rust launcher on the first run (10–20 minutes);
   later runs reuse it.
2. **App source** – clone the public git repo at a version tag (default when
   there is a public HTTPS remote; installed apps update from new tags), or
   package the local files (default otherwise: no push or tags needed, but no
   updates, no online setup and no updater cmd in archives). If the newest
   launcher is v1.2.7 or older, say that packaging local files is not available
   yet.
3. **App name** – English letters, digits, `-`/`_` only (used for exe and file
   names). Default: the repo/project name.
4. **Profiles** – just one `release` profile, or extra ones (e.g. `debug` with a
   console entry script, `cpu`/`cuda` with different requirements)? Profile
   names: English only.
5. **GUI app?** – run with `pythonw.exe` and no console window (`use_pythonw`).
6. **Run as administrator?** – per profile (`admin`).
7. **pip mirror / extra pip args?** – e.g. users in China:
   `-i https://mirrors.aliyun.com/pypi/simple`. Default: none.
8. **Outputs** – setup installer exe (`build_setup`, default yes), portable
   archive per profile (`package_zip`, default no), archive format
   (`7z` default, or `zip`). At least one of installer/archive must be on.
   With archives, the archive also gets an `<name>-updater.cmd` that opens the
   pyappify update window (`package_zip_updater`, default yes). It needs
   `pyappify[standalone]>=1.0.20` in the app's requirements and Python 3.10+.
   If the user wants it, add that line to the requirements file `requirements`
   points at. Otherwise the action skips it with a warning. Packaging local
   files never adds the updater cmd, so skip this part then.
9. **Version in file names?** (`add_version_name`, e.g. `MyApp-win32-release-setup-1.2.0.exe`). Default: no.
10. **Limit kept releases?** (`keep_releases`, e.g. 30, shrinks the bundled git
    repo and future clones). Default: keep all. Only for a git repo source.
11. **Website URL** (optional) – opened by clicking the app title in the launcher.

If the user says "use defaults" or similar, proceed with your defaults.

## Step 3: Write `pyappify.yml`

Schema (top level):

| Key | Required | Meaning |
|---|---|---|
| `name` | yes | App name, English only. Becomes the exe name and archive/installer prefix. |
| `icon` | no | Image path relative to the app working dir, shown in the launcher UI, e.g. `"icons/icon.png"`. |
| `website` | no | URL opened by clicking the app title and shown after a failed upgrade. |
| `keep_releases` | no | Positive integer. Keep only the N newest release tags (plus newer prereleases) in the app's git repo. Omit to keep all. |
| `uac` | no | `true` builds the launcher exe itself with a "require administrator" manifest. Rarely needed; prefer per-profile `admin`. |
| `profiles` | yes | List of profiles, at least one. The **first profile is the default** and supplies defaults for every key the other profiles omit. |

Profile keys:

| Key | Meaning |
|---|---|
| `name` | Profile name, English only. Required. |
| `git_url` | HTTPS repo URL to clone. Its version tags are the versions (else its 30 most recent commits). Set it on the first profile. Omit it (or set the action input `use_git_url: false`) to package the local files instead: no updates, no online setup, no updater cmd in archives. |
| `main_script` | Entry point. Ending in `.py` → run with the venv's Python; otherwise searched in the working dir and the venv's `Scripts`/`bin`. |
| `requires_python` | Python version, `"3.7"` – `"3.13"`, quoted string. |
| `requirements` | `requirements.txt`-style file, or a pyproject spec like `"."` or `".[gui,cuda]"`. |
| `pip_args` | Extra args passed to `pip install`, e.g. `"-i https://mirrors.aliyun.com/pypi/simple"` or `"--no-deps"`. |
| `PYTHONPATH` | Value for `PYTHONPATH` when running the app (relative to the app working dir), e.g. `"src"` for a src-layout project run as a plain script. |
| `admin` | `true` → start the Python process elevated (UAC prompt). Default `false`. |
| `use_pythonw` | `true` → run with `pythonw.exe` (no console window). Default `false`. |
| `show_add_defender` | `true` → launcher offers to add a Windows Defender exclusion. Default `false`. |
| `extra_files` | List of paths relative to the app directory (often git-ignored data such as model weights, e.g. `["checkpoints"]`) put into the offline installers and archives at the same paths, outside git. The build must find them in the app directory: download them before the build. Updates keep them. Installers are limited to 2 GB, so large data needs `package_zip: true` and `build_setup: false`. |

Rules:

- Quote all string values. Add short comments only where they help the user.
- Put every shared setting on the first profile; extra profiles list only what differs.
- Do not invent keys that are not in the tables above.

Example:

```yaml
name: "my-app" # English only
icon: "icons/icon.png"
# keep_releases: 30
profiles:
  - name: "release"
    git_url: "https://github.com/owner/my-app.git" # leave out to package the local files
    main_script: "main.py"
    requires_python: "3.12"
    requirements: "requirements.txt"
    use_pythonw: true

  - name: "debug" # inherits everything else from "release"
    main_script: "main_debug.py"
    use_pythonw: false
```

When packaging local files, leave `git_url` and `keep_releases` out.

## Step 4: Choose the action inputs

The same inputs drive the GitHub workflow (`with:` entries) and the local build
(`--<input> <value>` arguments). All are optional:

| Input | Default | Use |
|---|---|---|
| `build_setup` | `true` | Build the online setup exe and one offline setup exe per profile. Without a git repo there is no online setup. |
| `package_zip` | `false` | Also build a portable archive per profile: app-name folder with the prepared `data` (Python + venv + app) and `<name>.cmd` launcher. Honors `admin` and `use_pythonw`. |
| `package_zip_updater` | `true` | Add `<name>-updater.cmd` to each archive: opens the pyappify Tk update window (version list with notes, pip mirror, update, restart via `<name>.cmd`). Needs `pyappify[standalone]>=1.0.20` (Python 3.10+) in the app's requirements; skipped with a warning otherwise. Never added when packaging local files. |
| `package_zip_format` | `7z` | `7z` (much smaller; opens natively on Windows 11 23H2+, otherwise needs 7-Zip; a local build needs 7-Zip installed) or `zip`. |
| `add_version_name` | `false` | Append the tag version (name prefix and leading `v` removed) to installer/archive names; the short commit hash when there is no version tag. |
| `version` | latest | Pin a PyAppify launcher tag, e.g. `v1.2.6`, from https://github.com/ok-oldking/pyappify/tags. Must be v1.2.4+, and newer than v1.2.7 when packaging local files. Recommended for reproducible builds. |
| `use_git_url` | `true` | `false` packages the project's files (tracked + untracked, minus ignored) instead of cloning `git_url`. Also the behavior when no profile has `git_url`. |
| `app_version` | the pushed tag | Exact app tag to package. On GitHub only needed for manual/branch builds. In a local build with a git source it picks the tag, which must be pushed. When packaging local files it names the version; without it the version is a commit hash. |
| `build_exe_only` | `false` | Only build the launcher exe (output `exe-path`) so it can be code-signed, then run the action again with the signed exe. |

At least one of `build_setup` / `package_zip` must be `true`.
Only set inputs that differ from their defaults, plus `version`: pin it by
default to the newest tag at https://github.com/ok-oldking/pyappify/tags if you
can check it. Everything the action produces is in `pyappify_dist/`.

Then do Step 5, Step 6 or both, as the user chose.

## Step 5: GitHub build: write the workflow

Create `.github/workflows/build.yml` (pick another name if it exists and is
unrelated). Builds run on `windows-latest` only (other platforms are not
supported yet) when a `v*` tag is pushed.

Template:

```yaml
name: Build Application

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write # needed to create the GitHub release

jobs:
  build:
    runs-on: windows-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Build with PyAppify
        id: build-app
        uses: ok-oldking/pyappify-action@master
        with:
          version: 'v1.2.6'  # pin the PyAppify launcher version
          package_zip: true  # also build a portable archive per profile

      - name: Release
        uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/')
        with:
          body_path: pyappify_release_notes.md # CHANGELOG.md entry, else commit messages
          files: pyappify_dist/*
```

Replace the `with:` entries with the user's choices. If no inputs are set,
remove the `with:` line entirely (a `with:` holding only comments is invalid
for Actions). When packaging local files, the pushed tag still names the
version, and the checked-out files are what gets packaged.

## Step 6: Local build: write `build-pyappify.cmd`

Create `build-pyappify.cmd` in the project root. It runs the latest
[`pyappify`](https://www.npmjs.com/package/pyappify) npm package (the action's
`local.js`) on this project through `npx`. If `PYAPPIFY_ACTION_DIR` is set, it
runs `local.js` from that pyappify-action checkout instead, which needs
`npm install` run in it once. Put the user's input choices on the last line as
`--<input> <value>`:

```bat
@echo off
rem Builds this app with PyAppify on this Windows machine. Output: pyappify_dist\
rem Extra arguments are passed on, e.g.: build-pyappify.cmd --app_version v1.2.0
rem Needs Node.js 20+, git, Rust with the Visual Studio C++ build tools,
rem and 7-Zip for 7z archives. The first run compiles the launcher into p\.
setlocal
set "PYAPPIFY=npx -y pyappify@latest"
if defined PYAPPIFY_ACTION_DIR set "PYAPPIFY=node "%PYAPPIFY_ACTION_DIR%\local.js""
call %PYAPPIFY% --app-dir "%~dp0." --version v1.2.6 --package_zip true %*
```

Write the file in plain ASCII. Then add these lines to `.gitignore` (create it
if missing, skip lines already there). They cover the build folder, the output
and the release notes:

```
p/
pyappify_dist/
pyappify_release_notes.md
```

How a local build differs from a GitHub build:

- pip's downloads are cached in `p/cache` and reused by later runs and profiles.
- The launcher is compiled in `p/` and reused. Delete `p/` to rebuild it after
  changing `version`, `uac` or `icons/`.
- There is no workflow tag. With a git source, the launcher prepares the latest
  stable pushed tag unless `--app_version` names one.
- Nothing is uploaded or released.

## Step 7: Validate and hand off

Check before finishing:

- `pyappify.yml` parses as YAML; `name` and `profiles` exist; first profile has
  `git_url` (unless packaging local files), `main_script`, `requires_python`, `requirements`.
- `main_script` and the requirements file exist at the given paths. With a git
  source they must be **committed and pushed** (the launcher clones from git,
  untracked files are missing). When packaging local files they only need to
  exist and not be git-ignored.
- `git_url` is HTTPS and public, unless the user chose to package local files.
- The workflow file, if any, parses as YAML, and at least one output type is enabled.
- For a local build, report which build tools from Step 1 are missing and where
  to get them: https://nodejs.org, https://rustup.rs, the C++ build tools in
  https://tauri.app/start/prerequisites/#windows, and https://www.7-zip.org.
- If `icons/icon.ico` / `icons/icon.png` are missing, tell the user the default
  PyAppify icon will be used and that they can add `icons/icon.ico` (multi-size
  Windows icon) and `icons/icon.png` (e.g. 512×512) to the repo root.

Then tell the user, briefly:

1. Which files you created and the key choices (where it builds, app source,
   profiles, Python version, outputs).
2. For a GitHub build, how to release: commit and push the files, then tag and push:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   The workflow builds and attaches the installer/archives to a GitHub release
   for that tag. Every later version is just a new tag. With a git source,
   installed apps update from the tags.
3. Suggest the next tag: if no version tag exists, `v1.0.0` (or the version in
   `pyproject.toml`); otherwise bump the latest tag (existing tags were created
   before the workflow existed and will not trigger a build).
4. For a local build: run `build-pyappify.cmd`, adding `--app_version v1.0.0` to
   name the version. The first run compiles Rust and takes 10–20 minutes. The
   files land in `pyappify_dist\`. With a git source, push the tag first. Do not
   start the build yourself unless the user asks; if they do, run it in the
   background.

Do not commit, tag or push unless the user asks you to.
