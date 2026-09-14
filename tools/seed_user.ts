/**
 * Create the SQL for one login.
 *
 *   deno run --allow-all tools/seed_user.ts omar@casacavco.com "Omar" ar
 *
 * It asks for the password without echoing it, derives the client secret the
 * way the app will, hashes that again with a fresh server-side salt, and
 * prints the INSERT. The password itself is never written anywhere.
 */
import { createCredential, deriveClientSecret } from "../src/lib/password.ts";

function promptHidden(question: string): string {
  const stdin = Deno.stdin;
  Deno.stderr.writeSync(new TextEncoder().encode(question));
  stdin.setRaw(true);
  const bytes: number[] = [];
  const buffer = new Uint8Array(1);
  while (true) {
    const read = stdin.readSync(buffer);
    if (read === null || read === 0) break;
    const byte = buffer[0];
    if (byte === 13 || byte === 10) break; // enter
    if (byte === 3) { // ctrl-c
      stdin.setRaw(false);
      Deno.exit(130);
    }
    if (byte === 127 || byte === 8) { // backspace
      bytes.pop();
      continue;
    }
    bytes.push(byte);
  }
  stdin.setRaw(false);
  Deno.stderr.writeSync(new TextEncoder().encode("\n"));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function sqlString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

const [email, displayName, uiLanguage = "ar"] = Deno.args;

if (!email || !displayName) {
  console.error(
    'usage: deno run --allow-all tools/seed_user.ts <email> "<display name>" [ar|en]',
  );
  Deno.exit(1);
}
if (uiLanguage !== "ar" && uiLanguage !== "en") {
  console.error("the language must be 'ar' or 'en'");
  Deno.exit(1);
}

const password = promptHidden(`Password for ${email}: `);
if (password.length < 10) {
  console.error("Use at least 10 characters. This is the only lock on the data.");
  Deno.exit(1);
}
const again = promptHidden("Again: ");
if (password !== again) {
  console.error("The two passwords do not match.");
  Deno.exit(1);
}

const clientSecret = await deriveClientSecret(password, email);
const credential = await createCredential(clientSecret);
const id = crypto.randomUUID();

console.log(`-- ${email}. The password itself is not stored, here or anywhere.`);
console.log(
  `INSERT INTO users (id, email, password_verifier, password_salt, password_iters,\n` +
    `                   display_name, ui_language, is_active, created_at, updated_at)\n` +
    `VALUES (${sqlString(id)}, ${sqlString(email.trim().toLowerCase())},\n` +
    `        ${sqlString(credential.passwordVerifier)},\n` +
    `        ${sqlString(credential.passwordSalt)}, ${credential.passwordIters},\n` +
    `        ${sqlString(displayName)}, ${sqlString(uiLanguage)}, 1,\n` +
    `        datetime('now'), datetime('now'))\n` +
    `ON CONFLICT (email) DO UPDATE SET\n` +
    `  password_verifier = excluded.password_verifier,\n` +
    `  password_salt     = excluded.password_salt,\n` +
    `  password_iters    = excluded.password_iters,\n` +
    `  updated_at        = datetime('now');`,
);
