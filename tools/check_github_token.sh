#!/usr/bin/env bash
#
# Work out what is actually wrong with a GitHub token.
#
#   bash tools/check_github_token.sh
#
# It asks for the token without showing it, asks GitHub four questions, and
# says which one fails. The token is never written to a file, never put in
# your shell history, and never printed.

set -uo pipefail

REPO="${1:-snacktheovercomplicated/casacava-invoice}"
OWNER="${REPO%%/*}"

printf "Paste the token (nothing will appear), then press Enter: "
read -rs TOKEN
printf "\n\n"

if [ -z "$TOKEN" ]; then
  echo "Nothing was pasted. The paste did not reach the terminal."
  echo "Try Ctrl+Shift+V, or right-click paste."
  exit 1
fi

# A stray newline or space from copying is a common cause on its own.
CLEANED=$(printf '%s' "$TOKEN" | tr -d '[:space:]')
if [ "$CLEANED" != "$TOKEN" ]; then
  echo "NOTE: the token had whitespace around it. Using the trimmed version."
  TOKEN="$CLEANED"
fi

case "$TOKEN" in
  github_pat_*) KIND="fine-grained" ;;
  ghp_*)        KIND="classic" ;;
  gho_*|ghu_*)  KIND="an OAuth token (wrong kind for this)" ;;
  *)            KIND="NOT a GitHub token — it does not start with github_pat_ or ghp_" ;;
esac
echo "Token looks like: $KIND"
echo "Length: ${#TOKEN} characters"
echo

ask() { curl -sS -o /tmp/gh-body.$$ -w "%{http_code}" -H "Authorization: Bearer $TOKEN" \
        -H "Accept: application/vnd.github+json" "https://api.github.com$1"; }

echo "1. Is the token valid at all?"
CODE=$(ask /user)
if [ "$CODE" = "200" ]; then
  WHO=$(grep -o '"login"[^,]*' /tmp/gh-body.$$ | head -1 | cut -d'"' -f4)
  echo "   YES — it belongs to: $WHO"
  if [ "$WHO" != "$OWNER" ]; then
    echo "   BUT the repo is under '$OWNER', not '$WHO'."
  fi
else
  echo "   NO — GitHub returned $CODE."
  echo "   The token is wrong, expired, or was never generated."
  rm -f /tmp/gh-body.$$; exit 1
fi

echo
echo "2. Can it see $REPO?"
CODE=$(ask "/repos/$REPO")
case "$CODE" in
  200) echo "   YES" ;;
  404) echo "   NO (404) — either the repo does not exist yet, or the token"
       echo "   was not granted access to it. A fine-grained token must list"
       echo "   this repository under 'Repository access'."
       rm -f /tmp/gh-body.$$; exit 1 ;;
  *)   echo "   NO — GitHub returned $CODE"; rm -f /tmp/gh-body.$$; exit 1 ;;
esac

echo
echo "3. Is it allowed to push?"
if grep -q '"push":true' /tmp/gh-body.$$; then
  echo "   YES"
else
  echo "   NO — the token can read but not write."
  echo "   Give it Repository permissions -> Contents: Read and write."
  rm -f /tmp/gh-body.$$; exit 1
fi
rm -f /tmp/gh-body.$$

# This repository contains .github/workflows/package.yml. GitHub refuses any
# push that touches a workflow file unless the token is allowed to, and the
# refusal happens at the END of the push, after everything is uploaded.
echo
echo "4. Is it allowed to touch .github/workflows?"
SCOPES=$(curl -sS -D - -o /dev/null -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/user | tr -d '\r' | grep -i '^x-oauth-scopes:' | cut -d' ' -f2-)
case "$KIND" in
  classic)
    if printf '%s' "$SCOPES" | grep -q 'workflow'; then
      echo "   YES"
    else
      echo "   NO — a classic token also needs the 'workflow' scope."
      echo "   Scopes it has: ${SCOPES:-none}"
      echo "   Regenerate at https://github.com/settings/tokens/new with repo + workflow."
      exit 1
    fi
    ;;
  *)
    echo "   Cannot be read from the API for a fine-grained token."
    echo "   Make sure it has Repository permissions -> Workflows: Read and write."
    echo "   Without it the push fails at the very end with:"
    echo "     refusing to allow a Personal Access Token to create or update workflow"
    ;;
esac

echo
echo "The token is good. The problem was in how it reached git, not the token."
echo

HELPER=$(git config --global credential.helper || true)
if [ -z "$HELPER" ]; then
  echo "Git is not set up to remember it, so it will ask again every push."
  echo "  1) remember for a week, in memory only (forgotten on reboot)"
  echo "  2) remember permanently, in plain text in ~/.git-credentials"
  echo "  3) do not remember; I will paste it each time"
  printf "Choose 1, 2 or 3: "
  read -r CHOICE
  case "$CHOICE" in
    1) git config --global credential.helper "cache --timeout=604800"; HELPER=cache ;;
    2) git config --global credential.helper store; HELPER=store ;;
    *) HELPER="" ;;
  esac
fi

if [ -n "$HELPER" ]; then
  printf 'protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n' "$OWNER" "$TOKEN" \
    | git credential approve
  echo "Stored. Now run:"
else
  echo "Now run this, and paste the same token at the password prompt:"
fi
echo "   git -C ~/claude/casacava-invoice-v2 push -u origin main"
