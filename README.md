# PyAppify Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-PyAppify%20Action-blue.svg?colorA=24292e&colorB=0366d6&style=flat&logo=github)](https://github.com/marketplace/actions/pyappify)

This GitHub Action uses [PyAppify](https://github.com/ok-oldking/pyappify) to compile and package your Python application into cross-platform, standalone executables directly within your workflow.

## Prerequisites

Before using this action, you must have a `pyappify.yml` configuration file in the root of your repository. You may also include an optional `icons` directory for custom application icons.

* pyappify.yml
* icons
  * icon.ico
  * icon.png


### `pyappify.yml`

This file defines your application's name and its build profiles.

**Example `pyappify.yml`:**

```yaml
name: "pyappify-sample" # English only
keep_releases: 30 # optional: keep only the 30 newest releases (plus newer prereleases) in the app's git repo, cutting older history; omit to keep all
profiles:
  - name: "release_正式版" # can use Unicode chars
    git_url: "https://github.com/ok-oldking/pyappify-action.git" # the repo url to clone, must have tags for the version management, semver is recommended
    main_script: "main.py" # if ending with .py will use python venv to run, else will search in the working dir and the venv's Script/bin path
    requires_python: "3.12" # supports python 3.7 - 3.13
    requirements: "requirements.txt"  # support using a *.txt or pyproject.toml's .[dev,docs]
    pip_args: "--index-url https://mirrors.cloud.tencent.com/pypi/simple" # optional

  - name: "debug" # can use Unicode chars
    main_script: "main_debug.py" # you can omit other properties, will use the first profile's as default
    pip_args: "-i https://mirrors.aliyun.com/pypi/simple" # optional
```

## Inputs

| Input     | Description                                                                                               | Default        | Required |
|-----------|-----------------------------------------------------------------------------------------------------------|----------------|----------|
| `app_version` | Exact application tag to package, including prereleases. Requires PyAppify v1.2.4 or newer. | Workflow tag on tag builds; latest stable otherwise | `false` |
| `version` | The tag version of pyappify to use (e.g., `v0.1.0`). It is highly recommended to pin a version for consistency. You can checkout the versions at https://github.com/ok-oldking/pyappify/releases | `latest` tag | `false`  |
| `use_release` | A GitHub release API url whose assets are reused to skip building the exe. | | `false` |
| `build_exe_only` | Only build the exe and output `exe-path` so it can be signed before running the action again. | `false` | `false` |
| `build_setup` | Build the online and per-profile setup executables. Set to `false` for portable archives only. | `true` | `false` |
| `add_version_name` | Add the app version (the pushed git tag, leading `v` removed) to the setup exe names, e.g. `xxx-setup-1.1.0.exe` or `xxx-setup-1.1.0-beta.1.exe`. | `false` | `false` |
| `package_zip_format` | Archive format of the `package_zip` output: `7z` (solid LZMA2, about a third smaller than zip and smaller than the setup exe; opens in File Explorer on Windows 11 23H2+, otherwise needs 7-Zip) or `zip`. | `7z` | `false` |
| `package_zip` | Also create a portable archive per profile, `<name>-<platform>-<profile>.7z` or `.zip` per `package_zip_format` (version appended when `add_version_name` is on). Its root folder is the app name and holds the prepared `data` folder (Python env + app) and a `<name>.cmd` that runs the main script with the bundled Python. No Tauri exe, no installer. The `.cmd` honors the profile's `admin` (relaunches itself elevated via UAC) and `use_pythonw` (runs with `pythonw.exe` and closes its console right away). | `false` | `false` |

## Usage Example

At least one of `build_setup` or `package_zip` must be `true`. The
`build_exe_only` signing step is exempt and returns only the launcher binary.
Setting `build_setup: false` skips all installer bundling; the launcher is still
built or reused to prepare each profile's portable archive.

This example demonstrates how to build your application on Windows, macOS, and Ubuntu(Currently only support windows), and then release the resulting packages. 

```yaml
name: Build Application

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        platform: [windows-latest] # will support ubuntu-latest, macos-latest in the future
    runs-on: ${{ matrix.platform }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4
      
      - name: Build with PyAppify Action
        id: build-app
        uses: ok-oldking/pyappify-action@master
        with:
          version: 'v0.1.0' # Optional: Pin the PyAppify version, you can checkout the version at https://github.com/ok-oldking/pyappify/releases
          use_release: 'https://api.github.com/repos/ok-oldking/pyappify-action/releases/tags/v1.0.0' # Optional: Use a existing release's assets to skip the building process, use when you didn't change the icons and the pyappify.yml

      - name: Release
        uses: softprops/action-gh-release@v2
        if: startsWith(github.ref, 'refs/tags/')
        with:
          body: | 
            Your Release Note
          files: pyappify_dist/*
```

## How It Works

`__pycache__` folders are removed from each profile's prepared data before it is
bundled into the setup exe and the `package_zip` archive. Python recreates them
on the app's first start, which makes that first start somewhat slower.

Tag-triggered builds prepare that exact application tag before installing Python
dependencies. Branch or manual builds can set `app_version` explicitly; without
it they retain the launcher's latest stable default. The action checks the
prepared `app.json` before bundling and fails if its version differs. Update any
pinned PyAppify `version` to v1.2.4 or newer. Executables supplied through
`use_release` must also support `--setup-version`; older launchers fail the check.

The action automates the following steps:
1.  Clones the PyAppify repository.
2.  Reads your local `pyappify.yml` to get your application's name and build profiles.
3.  Copies your configuration and `icons` directory into the PyAppify source tree.
4.  Updates the PyAppify project files with your application's name.
5.  Builds the application binary using Tauri.
6.  Packages the final application, creating a separate zipped bundle for each profile defined in your configuration file.
7.  Outputs the path to the directory containing the generated artifacts.
