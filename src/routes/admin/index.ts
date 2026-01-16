import { FastifyPluginAsync } from 'fastify';
import serversRoutes from './servers.js';
import runnersRoutes from './runners.js';
import playbooksRoutes from './playbooks.js';
import ordersRoutes from './orders.js';

const adminRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', (fastify as any).verifyAdmin);

  fastify.register(serversRoutes);
  fastify.register(runnersRoutes);
  fastify.register(playbooksRoutes);
  fastify.register(ordersRoutes);
};

export default adminRoutes;
