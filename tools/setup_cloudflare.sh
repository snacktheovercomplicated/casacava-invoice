#!/usr/bin/env bash
#
# Set up the live system on Cloudflare. Run this once, after `wrangler login`.
#
#   deno run -A npm:wrangler login       # opens your browser, once
#   bash tools/setup_cloudflare.sh
#
# It creates the tables, loads your company details and the 23 products, asks
# for the two passwords, and deploys the app. Everything it does is safe to
# run again except the passwords, which it will simply overwrite.

set -euo pipefail
cd "$(dirname "$0")/.."

DB=casacava-invoice
WRANGLER="deno run -A npm:wrangler@latest"
say() { printf "\n\033[1m%s\033[0m\n" "$*"; }

say "1/6  Checking you are signed in to Cloudflare"
$WRANGLER whoami >/dev/null

say "2/6  Creating the tables"
# CREATE TABLE fails if the table is already there, so a second run of this
# script would stop here. Check first, and skip if the schema is in place.
EXISTING=$($WRANGLER d1 execute "$DB" --remote --json --yes \
  --command "SELECT name FROM sqlite_master WHERE type='table' AND name='invoices'" \
  2>/dev/null | grep -c '"invoices"' || true)
if [ "$EXISTING" -gt 0 ]; then
  echo "      already there, skipping"
else
  for file in db/migrations/*.sql; do
    echo "      $file"
    $WRANGLER d1 execute "$DB" --remote --file="$file" --yes >/dev/null
  done
fi

say "3/6  Loading your company details and the number series"
$WRANGLER d1 execute "$DB" --remote --file=db/seed_company.sql --yes >/dev/null

say "4/6  Loading the 23 products"
deno run --allow-read tools/import_items.ts db/seed_items.csv > /tmp/casacava-items.sql
$WRANGLER d1 execute "$DB" --remote --file=/tmp/casacava-items.sql --yes >/dev/null
rm -f /tmp/casacava-items.sql

say "5/6  Setting the two passwords"
echo "      Your password is turned into a digest on this machine and never"
echo "      leaves it. Nothing readable is stored or sent anywhere."
: > /tmp/casacava-users.sql
deno run --allow-all tools/seed_user.ts omar@casacavco.com "Omar" ar >> /tmp/casacava-users.sql
deno run --allow-all tools/seed_user.ts mum@casacavco.com  "Mum"  ar >> /tmp/casacava-users.sql
$WRANGLER d1 execute "$DB" --remote --file=/tmp/casacava-users.sql --yes >/dev/null
rm -f /tmp/casacava-users.sql

say "6/6  Building and deploying"
deno task build:web
$WRANGLER deploy

say "Done."
echo "      Sign in at the URL above with omar@casacavco.com"
echo "      To change a password later, run step 5 again for that address."
echo
echo "      NOTE: copy the https://...workers.dev address printed above into"
echo "      VITE_API_BASE in .github/workflows/package.yml before building the"
echo "      Windows, Linux or Android apps — they need to know where to call."
