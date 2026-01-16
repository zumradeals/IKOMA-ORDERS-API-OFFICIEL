import { FastifyPluginCallback } from 'fastify';
import fp from 'fastify-plugin';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../db/schema.js';

const dbPlugin: FastifyPluginCallback = (fastify, opts, done) => {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });

  const db = drizzle(pool, { schema });

  fastify.decorate('db', db);
  fastify.decorate('pool', pool);

  fastify.addHook('onClose', async (instance) => {
    await pool.end();
  });

  done();
};

export default fp(dbPlugin);
