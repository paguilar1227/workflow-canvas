import type { Express } from 'express';
import pg from 'pg';

const MARKER = /^[A-Za-z0-9._:-]{1,64}$/;
let pool: pg.Pool | null = null;

function database(): pg.Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    const host = new URL(url).hostname;
    const local = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(host);
    pool = new pg.Pool({ connectionString: url, max: 2, ssl: local ? false : { rejectUnauthorized: true } });
  }
  return pool;
}

/** Preview-platform readiness: a real write/read through the injected database credentials. Inactive without DATABASE_URL. */
export function mountReadiness(app: Express) {
  app.post('/db-marker', async (req, res) => {
    const db = database();
    if (!db) { res.status(404).json({ status: 'error', message: 'No database configured' }); return; }
    const marker = req.body?.marker;
    if (typeof marker !== 'string' || !MARKER.test(marker)) { res.status(400).json({ status: 'error', message: 'marker must be 1-64 letters, numbers, dot, colon, underscore or dash' }); return; }
    try {
      await db.query('CREATE TABLE IF NOT EXISTS wfc_readiness_marker (marker_key text PRIMARY KEY, marker_value text NOT NULL)');
      await db.query('INSERT INTO wfc_readiness_marker (marker_key, marker_value) VALUES ($1, $2) ON CONFLICT (marker_key) DO UPDATE SET marker_value = EXCLUDED.marker_value', ['readiness', marker]);
      const row = (await db.query('SELECT marker_value, current_schema() AS schema_name, current_user AS role_name FROM wfc_readiness_marker WHERE marker_key = $1', ['readiness'])).rows[0];
      res.json({ status: 'ok', database: { marker: row.marker_value, schema: row.schema_name, role: row.role_name } });
    } catch (err) {
      res.status(500).json({ status: 'error', message: (err as Error).message });
    }
  });
}
