#!/usr/bin/env bash
# Instaluje GitHub CLI (gh) na Debian/Ubuntu wg oficjalnej instrukcji
# (https://github.com/cli/cli/blob/trunk/docs/install_linux.md).
# Wymaga sudo — uruchom ręcznie: bash scripts/install-gh-cli.sh
set -euo pipefail

if command -v gh >/dev/null 2>&1; then
  echo "gh już zainstalowane: $(gh --version | head -1)"
  exit 0
fi

type -p wget >/dev/null || (sudo apt update && sudo apt-get install wget -y)

sudo mkdir -p -m 755 /etc/apt/keyrings
out=$(mktemp)
wget -nv -O "$out" https://cli.github.com/packages/githubcli-archive-keyring.gpg
cat "$out" | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null
sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg

sudo mkdir -p -m 755 /etc/apt/sources.list.d
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
  | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null

sudo apt update
sudo apt install gh -y

echo "Zainstalowano: $(gh --version | head -1)"
echo "Teraz uruchom: gh auth login"
