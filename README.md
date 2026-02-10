# NBDiff

A desktop app for visually diffing Mathematica notebooks (`.nb` files). Built for faster grading — drop in a solution key and a student submission, and instantly see what's different.

![Tauri](https://img.shields.io/badge/Tauri-v2-blue) ![React](https://img.shields.io/badge/React-19-61dafb) ![Platform](https://img.shields.io/badge/macOS-aarch64-lightgrey)

## How it works

1. **Drop** a key/solution `.nb` file on the left panel
2. **Drop** a student submission `.nb` file on the right panel
3. The app extracts input cells from each notebook using Wolfram Engine, then displays a **color-coded diff**:
   - 🟢 **Green** — lines added in the submission
   - 🔴 **Red** — lines removed (present in key but not submission)

You can also click either panel to open a file browser instead of dragging.

## Prerequisites

- [Wolfram Engine](https://www.wolfram.com/engine/) or Mathematica (for extracting notebook inputs)
- Python 3.10+ with `wolframclient` and `oauthlib`
- [Rust](https://rustup.rs/) and Node.js 20+

## Setup

```bash
# Install Python dependencies
pip install wolframclient oauthlib

# Install Node dependencies
npm install

# Build the Python sidecar binary
pip install pyinstaller
pyinstaller --onefile --name extract-inputs \
  --distpath src-tauri/binaries \
  --hidden-import=oauthlib --hidden-import=oauthlib.oauth1 \
  --collect-all wolframclient \
  --exclude-module PyQt6 --exclude-module PySide6 \
  --exclude-module matplotlib --exclude-module numpy \
  --exclude-module PIL --exclude-module tkinter \
  extract-inputs.py

# Rename with your target triple
mv src-tauri/binaries/extract-inputs \
   src-tauri/binaries/extract-inputs-$(rustc -vV | sed -n 's/host: //p')
```

## Development

```bash
npx tauri dev
```

## Build

```bash
npx tauri build
```

The bundled `.app` and `.dmg` will be in `src-tauri/target/release/bundle/`.

## Project structure

```
nbdiff/
├── extract-inputs.py          # Python script for .nb input extraction
├── src/
│   ├── App.tsx                # Main app — drop zones, drag-drop, file dialog
│   ├── components/
│   │   └── DiffView.tsx       # Side-by-side diff with color coding
│   ├── main.tsx               # React entry point
│   └── styles.css             # Dark theme UI
├── src-tauri/
│   ├── src/lib.rs             # Rust backend — sidecar invocation
│   ├── binaries/              # PyInstaller sidecar binary (gitignored)
│   ├── capabilities/          # Tauri permission config
│   └── tauri.conf.json        # Tauri app config
└── package.json
```

## Roadmap

- [ ] Accept a folder of student submissions on the right panel
- [ ] Arrow-key navigation between students for rapid grading
- [ ] Word-level diff highlighting within changed lines
