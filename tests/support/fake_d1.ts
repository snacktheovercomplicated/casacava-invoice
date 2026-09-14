/**
 * A stand-in for D1, backed by the SQLite that Deno already ships with.
 *
 * It implements only the calls src/worker actually makes, and it runs the
 * real migration files, so the triggers and CHECK constraints under test are
 * the same ones that will run on Cloudflare. Every trigger here was also
 * confirmed against a live D1 instance.
 */
import { DatabaseSync } from "node:sqlite";
import type {
  D1Database,
  D1PreparedStatement,
  D1Result,
  Env,
} from "../../src/worker/types.ts";

type Row = Record<string, unknown>;

function normalise(row: unknown): Row {
  // node:sqlite hands back null-prototype objects; JSON and spread prefer plain ones.
  return row === null || row === undefined ? {} : { ...(row as Row) };
}

class FakeStatement implements D1PreparedStatement {
  constructor(
    private readonly db: DatabaseSync,
    private readonly sql: string,
    private readonly binds: unknown[] = [],
  ) {}

  bind(...values: unknown[]): D1PreparedStatement {
    return new FakeStatement(this.db, this.sql, values);
  }

  private params(): unknown[] {
    // node:sqlite accepts null, number, bigint, string and Uint8Array only.
    return this.binds.map((value) => {
      if (value === undefined) return null;
      if (typeof value === "boolean") return value ? 1 : 0;
      return value;
    });
  }

  first<T = Row>(): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params() as never[]);
    return Promise.resolve(row === undefined ? null : normalise(row) as T);
  }

  all<T = Row>(): Promise<D1Result<T>> {
    const rows = this.db.prepare(this.sql).all(...this.params() as never[]);
    return Promise.resolve({
      results: (rows as unknown[]).map(normalise) as T[],
      success: true,
      meta: { changes: 0, last_row_id: 0, rows_read: rows.length, rows_written: 0 },
    });
  }

  run<T = Row>(): Promise<D1Result<T>> {
    const result = this.db.prepare(this.sql).run(...this.params() as never[]);
    return Promise.resolve({
      results: [],
      success: true,
      meta: {
        changes: Number(result.changes ?? 0),
        last_row_id: Number(result.lastInsertRowid ?? 0),
        rows_read: 0,
        rows_written: Number(result.changes ?? 0),
      },
    });
  }
}

class FakeD1 implements D1Database {
  constructor(readonly db: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new FakeStatement(this.db, query);
  }

  /** D1 batches are atomic: all of it lands, or none of it does. */
  async batch<T = Row>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.db.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        results.push(await statement.run<T>());
      }
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

const NOW = "2026-09-14T09:00:00.000Z";

export interface TestEnv extends Env {
  DB: D1Database;
  raw: DatabaseSync;
}

export function createTestEnv(
  options: { defaultVatRateBp?: number } = {},
): TestEnv {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  for (
    const file of [
      "0001_init.sql",
      "0002_immutability.sql",
      "0003_unused_numbers.sql",
    ]
  ) {
    db.exec(Deno.readTextFileSync(new URL(`../../db/migrations/${file}`, import.meta.url)));
  }
  db.exec(`
    INSERT INTO company_settings (id, trade_name_ar, trade_name_en,
                                  tax_registration_number, commercial_register_number,
                                  address_ar, address_en, phone,
                                  default_vat_rate_bp, updated_at)
    VALUES (1, 'كازا كافا', 'Casa Cava', '123-456-789', '45678',
            'القاهرة، جمهورية مصر العربية', 'Cairo, Egypt', '01094715831',
            ${options.defaultVatRateBp ?? 0}, '${NOW}');
  `);
  return { DB: new FakeD1(db), raw: db };
}

/** Load the 23 seeded products through the real importer. */
export function seedItems(env: TestEnv): void {
  const command = new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", "tools/import_items.ts", "db/seed_items.csv"],
    cwd: new URL("../..", import.meta.url).pathname,
  });
  const { code, stdout } = command.outputSync();
  if (code !== 0) throw new Error("the item importer failed");
  env.raw.exec(new TextDecoder().decode(stdout));
}

export async function seedUser(
  env: TestEnv,
  email: string,
  password: string,
  displayName = "Test User",
): Promise<string> {
  const { createCredential, deriveClientSecret } = await import("../../src/lib/password.ts");
  const credential = await createCredential(await deriveClientSecret(password, email));
  const id = crypto.randomUUID();
  env.raw.prepare(
    `INSERT INTO users (id,email,password_verifier,password_salt,password_iters,
                        display_name,ui_language,is_active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,'ar',1,?,?)`,
  ).run(
    id, email, credential.passwordVerifier, credential.passwordSalt,
    credential.passwordIters, displayName, NOW, NOW,
  );
  return id;
}
