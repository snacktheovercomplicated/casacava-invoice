import assert from "node:assert/strict";
import {
  CLIENT_ITERATIONS,
  computeVerifier,
  createCredential,
  deriveClientSecret,
  hashSessionToken,
  newServerSalt,
  newSessionToken,
  SERVER_ITERATIONS,
  timingSafeEqual,
  verifyCredential,
} from "../src/lib/password.ts";

const PASSWORD = "a long enough passphrase for mum";
const EMAIL = "omar@casacavco.com";

/* -------------------------------------------------------------------------- */
/* The ordinary path                                                          */
/* -------------------------------------------------------------------------- */

Deno.test("the right password logs in", async () => {
  const secret = await deriveClientSecret(PASSWORD, EMAIL);
  const stored = await createCredential(secret);
  assert.equal(await verifyCredential(secret, stored), true);
});

Deno.test("the wrong password does not", async () => {
  const stored = await createCredential(await deriveClientSecret(PASSWORD, EMAIL));
  const wrong = await deriveClientSecret(PASSWORD + "!", EMAIL);
  assert.equal(await verifyCredential(wrong, stored), false);
});

Deno.test("the same password under a different email is a different secret", async () => {
  const a = await deriveClientSecret(PASSWORD, "omar@casacavco.com");
  const b = await deriveClientSecret(PASSWORD, "mum@casacavco.com");
  assert.notEqual(a, b);
});

Deno.test("login is repeatable: same email and password always derive the same secret", async () => {
  // This has to hold, or nobody could ever log in from a second device.
  const a = await deriveClientSecret(PASSWORD, EMAIL);
  const b = await deriveClientSecret(PASSWORD, EMAIL);
  assert.equal(a, b);
  // and the email is treated case- and whitespace-insensitively
  assert.equal(await deriveClientSecret(PASSWORD, "  OMAR@CasaCavco.com "), a);
});

/* -------------------------------------------------------------------------- */
/* The attack this design exists to stop                                      */
/* -------------------------------------------------------------------------- */

Deno.test("THE STORED VALUE IS NOT THE TRANSMITTED VALUE", async () => {
  const secret = await deriveClientSecret(PASSWORD, EMAIL);
  const stored = await createCredential(secret);
  assert.notEqual(
    stored.passwordVerifier,
    secret,
    "storing the client secret verbatim would make the database a password file",
  );
});

Deno.test("ATTACK: someone holding a copy of the database cannot log in with it", async () => {
  const secret = await deriveClientSecret(PASSWORD, EMAIL);
  const stored = await createCredential(secret);

  // The attacker has everything in the users row: verifier, salt, iterations.
  // They have no password and no client secret. The only thing they can
  // replay is the stored verifier itself. Try it.
  const attempt = await verifyCredential(stored.passwordVerifier, stored);
  assert.equal(attempt, false, "replaying the stored verifier must not authenticate");

  // Nor does any other column they hold.
  assert.equal(await verifyCredential(stored.passwordSalt, stored), false);
  assert.equal(await verifyCredential(String(stored.passwordIters), stored), false);
});

Deno.test("ATTACK: the verifier is not a fixed point, at any iteration count", async () => {
  // Restated as a general property: hashing a value never returns that value,
  // so there is no self-replaying credential at any setting.
  const salt = newServerSalt();
  for (const iters of [1, 2, 600, 1000]) {
    const value = await computeVerifier("some client secret", salt, iters);
    const rehashed = await computeVerifier(value, salt, iters);
    assert.notEqual(rehashed, value, `fixed point at ${iters} iterations`);
  }
});

Deno.test("two users with the SAME password get different stored verifiers", async () => {
  // Because the server salt is random per user. Otherwise a leak would show
  // at a glance that two accounts share a password.
  const secret = await deriveClientSecret(PASSWORD, EMAIL);
  const a = await createCredential(secret);
  const b = await createCredential(secret);
  assert.notEqual(a.passwordSalt, b.passwordSalt);
  assert.notEqual(a.passwordVerifier, b.passwordVerifier);
  // and each still verifies against its own row
  assert.equal(await verifyCredential(secret, a), true);
  assert.equal(await verifyCredential(secret, b), true);
});

Deno.test("a verifier from one user's salt does not verify against another's", async () => {
  const secret = await deriveClientSecret(PASSWORD, EMAIL);
  const a = await createCredential(secret);
  const b = await createCredential(secret);
  assert.equal(
    await verifyCredential(secret, {
      ...b,
      passwordVerifier: a.passwordVerifier,
    }),
    false,
  );
});

/* -------------------------------------------------------------------------- */
/* The work factor                                                            */
/* -------------------------------------------------------------------------- */

Deno.test("the slow work happens on the device, not on the Worker", () => {
  assert.ok(
    CLIENT_ITERATIONS >= 200_000,
    "the device must pay a real password-hashing cost",
  );
  assert.ok(
    SERVER_ITERATIONS <= 2_000,
    "the Worker gets 10 ms of CPU on the free plan; it cannot afford more",
  );
});

Deno.test("the server side stays well inside the 10 ms CPU budget", async () => {
  const salt = newServerSalt();
  const secret = await deriveClientSecret(PASSWORD, EMAIL);
  await computeVerifier(secret, salt, SERVER_ITERATIONS); // warm

  const runs = 20;
  const started = performance.now();
  for (let i = 0; i < runs; i++) {
    await computeVerifier(secret, salt, SERVER_ITERATIONS);
  }
  const perCall = (performance.now() - started) / runs;

  // Measured at ~0.53 ms on the development machine. 3 ms leaves room for
  // Cloudflare's hardware being slower than this one.
  assert.ok(
    perCall < 3,
    `server-side hashing took ${perCall.toFixed(2)} ms, too close to the 10 ms limit`,
  );
});

/* -------------------------------------------------------------------------- */
/* Comparison and session tokens                                              */
/* -------------------------------------------------------------------------- */

Deno.test("comparison does not short-circuit on the first differing character", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "ab"), false);
  assert.equal(timingSafeEqual("", ""), true);
});

Deno.test("a session token is random, and only its hash is stored", async () => {
  const a = newSessionToken();
  const b = newSessionToken();
  assert.notEqual(a, b);
  assert.ok(a.length >= 40);
  assert.ok(/^[A-Za-z0-9_-]+$/.test(a), "must be safe in a cookie and a header");

  const hashed = await hashSessionToken(a);
  assert.notEqual(hashed, a, "a database dump must not contain a usable token");
  assert.equal(hashed, await hashSessionToken(a), "the same token must hash the same");
  assert.notEqual(hashed, await hashSessionToken(b));
  assert.equal(hashed.length, 64);
});

Deno.test("an empty password or secret is refused outright", async () => {
  await assert.rejects(() => deriveClientSecret("", EMAIL));
  await assert.rejects(() => computeVerifier("", newServerSalt()));
});
