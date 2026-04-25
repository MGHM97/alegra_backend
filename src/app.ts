import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './infra/config/env.js';
import { registerRoutes } from './presentation/routes/index.js';
import { globalErrorHandler } from './shared/middlewares/error-handler.js';
import { prisma } from './infra/database/prisma-client.js';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'warn' : 'info',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
  });

  fastify.addContentTypeParser(
    'application/json',
    { parseAs: 'string' },
    (req, body, done) => {
      // Store raw body for Stripe webhook signature verification
      (req as unknown as { rawBody: string }).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  await fastify.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  await fastify.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  await fastify.register(cookie, {
    secret: env.JWT_SECRET,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.currentUser?.sub ?? request.ip;
    },
  });

  fastify.setErrorHandler(globalErrorHandler);

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  fastify.get('/sitemap.xml', async (_request, reply) => {
    const baseUrl = env.CORS_ORIGIN.split(',')[0]?.trim() ?? 'https://www.alegrafestas.com.br';

    const products = await prisma.product.findMany({
      where: { isActive: true },
      select: { slug: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    });

    const staticPages = [
      { loc: '/', priority: '1.0', changefreq: 'daily' },
      { loc: '/produtos', priority: '0.9', changefreq: 'daily' },
      { loc: '/contato', priority: '0.5', changefreq: 'monthly' },
      { loc: '/faq', priority: '0.5', changefreq: 'monthly' },
      { loc: '/trocas-devolucoes', priority: '0.4', changefreq: 'monthly' },
      { loc: '/termos-de-uso', priority: '0.3', changefreq: 'yearly' },
      { loc: '/privacidade', priority: '0.3', changefreq: 'yearly' },
    ];

    const categories = [
      'baloes', 'boleira-bandejas', 'confeitaria', 'bomboniere',
      'descartaveis', 'papelaria', 'topos-de-bolo', 'kits-festa',
      'velas', 'lembrancinhas', 'lanca-confetes', 'cortinas-metalizadas',
    ];

    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
    xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

    for (const page of staticPages) {
      xml += `  <url>\n    <loc>${baseUrl}${page.loc}</loc>\n    <changefreq>${page.changefreq}</changefreq>\n    <priority>${page.priority}</priority>\n  </url>\n`;
    }

    for (const cat of categories) {
      xml += `  <url>\n    <loc>${baseUrl}/produtos?category=${cat}</loc>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    }

    for (const product of products) {
      const lastmod = product.updatedAt.toISOString().split('T')[0];
      xml += `  <url>\n    <loc>${baseUrl}/produto/${product.slug}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }

    xml += '</urlset>';

    void reply.header('Content-Type', 'application/xml').status(200).send(xml);
  });

  await registerRoutes(fastify);

  return fastify;
}
