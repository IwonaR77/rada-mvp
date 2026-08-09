#!/usr/bin/env bash
# Instaluje Vercel CLI i Supabase CLI (npm global) do zarządzania produkcją
# (logi deploymentów, env vars, migracje bazy) bez przeglądarki.
# Uruchom ręcznie: bash scripts/install-vercel-supabase-cli.sh
set -euo pipefail

# Domyślny globalny prefiks npm (/usr) nie jest zapisywalny bez sudo.
# Przełącz na prefiks w $HOME, żeby instalować bez roota.
NPM_GLOBAL_PREFIX="$HOME/.npm-global"
if [ "$(npm config get prefix)" != "$NPM_GLOBAL_PREFIX" ]; then
  mkdir -p "$NPM_GLOBAL_PREFIX"
  npm config set prefix "$NPM_GLOBAL_PREFIX"
  echo "npm prefix ustawiony na $NPM_GLOBAL_PREFIX (bez sudo)"
fi
export PATH="$NPM_GLOBAL_PREFIX/bin:$PATH"
if ! grep -q "npm-global" "$HOME/.bashrc" 2>/dev/null; then
  {
    echo ''
    echo '# npm global packages (vercel, supabase CLI) — user-owned prefix, no sudo needed'
    echo "export PATH=\"$NPM_GLOBAL_PREFIX/bin:\$PATH\""
  } >> "$HOME/.bashrc"
  echo "Dodano $NPM_GLOBAL_PREFIX/bin do PATH w ~/.bashrc (nowy terminal albo: source ~/.bashrc)"
fi

if command -v vercel >/dev/null 2>&1; then
  echo "vercel już zainstalowane: $(vercel --version)"
else
  npm install -g vercel
  echo "Zainstalowano: $(vercel --version)"
fi

# Instalacja bywa wolna (postinstall pobiera natywny binarek) — nie ubijaj jej
# przez `timeout`/potokowanie do `tail`, bo to gubi output i sygnały zabijania
# nie zawsze docierają do procesu potomnego npm.
if command -v supabase >/dev/null 2>&1; then
  echo "supabase już zainstalowane: $(supabase --version)"
else
  npm install -g supabase
  echo "Zainstalowano: $(supabase --version)"
fi

echo
echo "Teraz zaloguj się i podepnij projekty (logowanie jest interaktywne):"
echo "  vercel login"
echo "  vercel link                                            # w katalogu projektu, projekt: rada3"
echo "  supabase login"
echo "  supabase link --project-ref nmsictzdvqbzevkolqpu"
