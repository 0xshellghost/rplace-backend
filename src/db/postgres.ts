import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

const connectionString = process.env.DATABASE_URL ?? 'postgresql://laksh:laksh@localhost:5432/rplace';

export const postgresPool = new Pool({ connectionString });
export const db = drizzle(postgresPool);

export const checkPostgresConnection = async () => {
    try {
        await postgresPool.query('SELECT 1');
        console.log('PostgreSQL is ready');
        await postgresPool.query(`
            CREATE TABLE IF NOT EXISTS pixel_placements (
                stream_id text PRIMARY KEY NOT NULL,
                sequence bigint NOT NULL,
                user_id text NOT NULL,
                "offset" integer NOT NULL,
                color smallint NOT NULL,
                placement_id text NOT NULL,
                created_at timestamp with time zone DEFAULT now() NOT NULL
            );
            CREATE UNIQUE INDEX IF NOT EXISTS pixel_placements_sequence_idx ON pixel_placements USING btree (sequence);
            CREATE INDEX IF NOT EXISTS pixel_placements_offset_idx ON pixel_placements USING btree ("offset");
        `);
        console.log('PostgreSQL pixel_placements table verified');
    } catch (err) {
        console.error('PostgreSQL connection/init error (canvas will still function via Redis):', err);
    }
};