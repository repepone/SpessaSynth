#!/usr/bin/env bash
# Descarga los soundfonts y sus licencias a lab-sintesis-ligera/.cache/soundfonts (ignorado por git).
# Fuentes elegidas porque eran las únicas accesibles desde el entorno del laboratorio
# (raw.githubusercontent.com y PyPI); ver INFORME-LAB-SINTESIS-LIGERA.md.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)/.cache/soundfonts"
mkdir -p "$DIR"
cd "$DIR"
get() { [ -s "$2" ] || curl -fsSL --retry 3 -o "$2" "$1"; }

# GeneralUser GS 2.0.3 (S. Christian Collins) — licencia propia v2.0
get https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/GeneralUser-GS.sf2 GeneralUser-GS.sf2
get https://raw.githubusercontent.com/mrbumpy409/GeneralUser-GS/main/documentation/LICENSE.txt GeneralUser-GS.LICENSE.txt

# FluidR3Mono_GM.sf3 tal como lo distribuye MuseScore 3.6.2 (INAM interno: "MS_General v0.1") — MIT
get https://raw.githubusercontent.com/musescore/MuseScore/v3.6.2/share/sound/FluidR3Mono_GM.sf3 FluidR3Mono_GM.sf3
get https://raw.githubusercontent.com/musescore/MuseScore/v3.6.2/share/sound/FluidR3Mono_License.md FluidR3Mono_License.md

# TimGM6mb.sf2, extraído de la rueda de pretty_midi en PyPI (licencia del soundfont NO leída en su fuente)
if [ ! -s TimGM6mb.sf2 ]; then
  url=$(curl -fsSL https://pypi.org/pypi/pretty_midi/0.2.11.post0/json | python3 -I -c \
    "import json,sys;print([u['url'] for u in json.load(sys.stdin)['urls'] if u['filename'].endswith('.whl')][0])")
  curl -fsSL -o pretty_midi.whl "$url"
  python3 -I -c "import zipfile;open('TimGM6mb.sf2','wb').write(zipfile.ZipFile('pretty_midi.whl').read('pretty_midi/TimGM6mb.sf2'))"
  rm -f pretty_midi.whl
fi

# GeneralUserGS.sf3 que ya trae este repositorio (versión comprimida por SpessaSynth)
cp -n ../../../soundfonts/GeneralUserGS.sf3 GeneralUserGS.sf3 2>/dev/null || true
ls -la "$DIR"
