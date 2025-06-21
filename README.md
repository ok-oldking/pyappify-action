# PyAppify Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-PyAppify%20Action-blue.svg?colorA=24292e&colorB=0366d6&style=flat&logo=github)](https://github.com/marketplace/actions/pyappify-action)

This GitHub Action uses [PyAppify](https://github.com/ok-oldking/pyappify) to compile and package your Python application into cross-platform, standalone executables directly within your workflow.

## How It Works

The action automates the following steps:
1.  Clones the PyAppify repository.
2.  Reads your local `pyappify.yml` to get your application's name and build profiles.
3.  Copies your configuration and `icons` directory into the PyAppify source tree.
4.  Updates the PyAppify project files with your application's name.
5.  Builds the application binary using Tauri.
6.  Packages the final application, creating a separate zipped bundle for each profile defined in your configuration file.
7.  Outputs the path to the directory containing the generated artifacts.

## Prerequisites

Before using this action, you must have a `pyappify.yml` configuration file in the root of your repository. You may also include an `icons` directory for custom application icons.

### `pyappify.yml`

This file defines your application's name and its build profiles.

**Example `pyappify.yml`:**
```yaml
name: 'MyApp'
uac: true # (Windows only) Set to true to request administrator privileges

profiles:
  - name: 'basic'
    # Profile-specific configuration
  - name: 'premium'
    # Profile-specific configuration
```

## Inputs

| Input     | Description                                                                                               | Default        | Required |
|-----------|-----------------------------------------------------------------------------------------------------------|----------------|----------|
| `version` | The tag version of pyappify to use (e.g., `v0.1.0`). It is highly recommended to pin a version for consistency. | `latest` tag | `false`  |

## Outputs

| Output              | Description                                                                 | Example Value                                                 |
|---------------------|-----------------------------------------------------------------------------|---------------------------------------------------------------|
| `dist-path`         | The path to the directory containing the zipped application bundles.        | `pyappify_dist`                                               |
| `pyappify-assets`   | A newline-separated string listing the paths of all generated release files. | `pyappify_dist/MyApp-win32.zip\npyappify_dist/MyApp-win32-basic.zip` |

## Usage Example

This example demonstrates how to build your application on Windows, macOS, and Ubuntu, and then upload the resulting packages as a build artifact.

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
        platform: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.platform }}

    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install Rust stable
        uses: dtolnay/rust-toolchain@stable
        with:
          targets: ${{ matrix.platform == 'macos-latest' && 'aarch64-apple-darwin,x86_64-apple-darwin' || '' }}

      - name: Install dependencies (ubuntu only)
        if: matrix.platform == 'ubuntu-latest'
        run: |
          sudo apt-get update
          sudo apt-get install -y libwebkit2gtk-4.0-dev libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 8

      - name: Build with PyAppify Action
        id: build-app
        uses: ok-oldking/pyappify-action@v1 # Replace with the desired version
        with:
          version: 'v0.1.0' # Optional: Pin the PyAppify version

      - name: Upload Artifact
        uses: actions/upload-artifact@v4
        with:
          name: ${{ matrix.platform }}-build
          path: ${{ steps.build-app.outputs.dist-path }}
```