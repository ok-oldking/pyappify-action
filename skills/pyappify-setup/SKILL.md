---
name: pyappify-setup
description: Set up PyAppify packaging for a Python project. Inspects the project, asks the user for the remaining options, then generates pyappify.yml and a GitHub Actions workflow (.github/workflows/build.yml) that uses ok-oldking/pyappify-action to build a Windows launcher, setup installers and/or portable 7z/zip archives on every version tag. Use when the user asks to set up, configure or add pyappify, or to package a Python app as a Windows exe/installer with https://github.com/ok-oldking/pyappify-action.
---

# Set up PyAppify for a Python project

You are configuring the user's Python project (the current working directory) to
be packaged by [PyAppify](https://github.com/ok-oldking/pyappify) through the
GitHub Action [ok-oldking/pyappify-action](https://github.com/ok-oldking/pyappify-action).

You will create:

1. `pyappify.yml` in the project root
2. `.github/workflows/build.yml` (or another name if that file already exists)
3. Optionally an `icons/` folder note (you do not generate icon images)

How PyAppify works, so your choices make sense: the built launcher clones the
app from `git_url` at a **git tag**, downloads an isolated Python
(`requires_python`), creates a venv, `pip install`s `requirements`, and runs
`main_script`. The action pre-does this on CI so the installer/archive works
offline. Updates are delivered by pushing new tags, so **the repo must use
version tags** (semver like `v1.0.0` recommended).

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
| Git URL | `git remote get-url origin`. Convert SSH (`git@github.com:o/r.git`) to HTTPS (`https://github.com/o/r.git`). The end user's launcher clones this, so it must be **publicly readable over HTTPS**. |
| Tags | `git tag --sort=-v:refname`. Note whether semver tags exist. |
| Icons | `icons/icon.ico` and `icons/icon.png` in the repo root? |
| Default branch | `git symbolic-ref refs/remotes/origin/HEAD` or `git branch --show-current`. |

## Step 2: Ask the user for what is left

Ask in **one** message (or one multiple-choice prompt if your tool supports it).
Pre-fill every question with what you detected and your recommended default, so
the user can just confirm. Only ask the questions that apply:

1. **App name** – English letters, digits, `-`/`_` only (used for exe and file
   names). Default: the repo/project name.
2. **Profiles** – just one `release` profile, or extra ones (e.g. `debug` with a
   console entry script, `cpu`/`cuda` with different requirements)? Profile
   names: English only.
3. **GUI app?** – run with `pythonw.exe` and no console window (`use_pythonw`).
4. **Run as administrator?** – per profile (`admin`).
5. **pip mirror / extra pip args?** – e.g. users in China:
   `-i https://mirrors.aliyun.com/pypi/simple`. Default: none.
6. **Outputs** – setup installer exe (`build_setup`, default yes), portable
   archive per profile (`package_zip`, default no), archive format
   (`7z` default, or `zip`). At least one of installer/archive must be on.
7. **Version in file names?** (`add_version_name`, e.g. `MyApp-win32-release-setup-1.2.0.exe`). Default: no.
8. **Limit kept releases?** (`keep_releases`, e.g. 30, shrinks the bundled git
   repo and future clones). Default: keep all.
9. **Website URL** (optional) – opened by clicking the app title in the launcher.

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
| `git_url` | HTTPS repo URL to clone. Must have version tags. Set it on the first profile. |
| `main_script` | Entry point. Ending in `.py` → run with the venv's Python; otherwise searched in the working dir and the venv's `Scripts`/`bin`. |
| `requires_python` | Python version, `"3.7"` – `"3.13"`, quoted string. |
| `requirements` | `requirements.txt`-style file, or a pyproject spec like `"."` or `".[gui,cuda]"`. |
| `pip_args` | Extra args passed to `pip install`, e.g. `"-i https://mirrors.aliyun.com/pypi/simple"` or `"--no-deps"`. |
| `PYTHONPATH` | Value for `PYTHONPATH` when running the app (relative to the app working dir), e.g. `"src"` for a src-layout project run as a plain script. |
| `admin` | `true` → start the Python process elevated (UAC prompt). Default `false`. |
| `use_pythonw` | `true` → run with `pythonw.exe` (no console window). Default `false`. |
| `show_add_defender` | `true` → launcher offers to add a Windows Defender exclusion. Default `false`. |

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
    git_url: "https://github.com/owner/my-app.git"
    main_script: "main.py"
    requires_python: "3.12"
    requirements: "requirements.txt"
    use_pythonw: true

  - name: "debug" # inherits everything else from "release"
    main_script: "main_debug.py"
    use_pythonw: false
```

## Step 4: Write the GitHub Actions workflow

Create `.github/workflows/build.yml` (pick another name if it exists and is
unrelated). Builds run on `windows-latest` only (other platforms are not
supported yet) when a `v*` tag is pushed. Action inputs (all optional):

| Input | Default | Use |
|---|---|---|
| `build_setup` | `true` | Build the online setup exe and one offline setup exe per profile. |
| `package_zip` | `false` | Also build a portable archive per profile: app-name folder with the prepared `data` (Python + venv + app) and `<name>.cmd` launcher. Honors `admin` and `use_pythonw`. |
| `package_zip_format` | `7z` | `7z` (much smaller; opens natively on Windows 11 23H2+, otherwise needs 7-Zip) or `zip`. |
| `add_version_name` | `false` | Append the tag version (leading `v` removed) to installer/archive names. |
| `version` | latest | Pin a PyAppify launcher tag, e.g. `v1.2.6`, from https://github.com/ok-oldking/pyappify/releases. Must be v1.2.4+. Recommended for reproducible builds. |
| `app_version` | the pushed tag | Exact app tag to package; only needed for manual/branch builds. |
| `use_release` | – | GitHub release API URL whose launcher exe is reused to skip the Rust build. |
| `build_exe_only` | `false` | Only build the launcher exe (output `exe-path`) so it can be code-signed, then run the action again with the signed exe. |

At least one of `build_setup` / `package_zip` must be `true`.
Only include inputs that differ from their defaults, plus `version` (pin it
by default).

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
          files: pyappify_dist/*
```

Replace the `with:` entries with the user's choices. If no inputs are set,
remove the `with:` line entirely (a `with:` holding only comments is invalid
for Actions). For `version`, use the newest tag listed at
https://github.com/ok-oldking/pyappify/tags if you can check it. Everything the
action produces is in `pyappify_dist/`.

## Step 5: Validate and hand off

Check before finishing:

- `pyappify.yml` parses as YAML; `name` and `profiles` exist; first profile has
  `git_url`, `main_script`, `requires_python`, `requirements`.
- `main_script` and the requirements file exist at the given paths **in the
  committed repo** (the launcher clones from git, untracked files are missing).
- `git_url` is HTTPS and public.
- The workflow file parses as YAML and at least one output type is enabled.
- If `icons/icon.ico` / `icons/icon.png` are missing, tell the user the default
  PyAppify icon will be used and that they can add `icons/icon.ico` (multi-size
  Windows icon) and `icons/icon.png` (e.g. 512×512) to the repo root.

Then tell the user, briefly:

1. Which files you created and the key choices (profiles, Python version, outputs).
2. How to release: commit and push the files, then tag and push:
   ```bash
   git tag v1.0.0
   git push origin v1.0.0
   ```
   The workflow builds and attaches the installer/archives to a GitHub release
   for that tag. Every later version is just a new tag; installed apps update
   from the tags.
3. Suggest the next tag: if no semver tag exists, `v1.0.0` (or the version in
   `pyproject.toml`); otherwise bump the latest tag (existing tags were created
   before the workflow existed and will not trigger a build).

Do not commit, tag or push unless the user asks you to.
