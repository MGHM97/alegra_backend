import { z } from 'zod';

/**
 * Valores de exemplo/placeholder que NUNCA podem chegar em produção.
 * Se algum deles for detectado com NODE_ENV=production, o boot é abortado.
 */
const PLACEHOLDER_FRAGMENTS = [
  'change-me',
  'your_stripe',
  'your-stripe',
  'your_webhook',
  'placeholder',
  'changeme',
  'example',
];

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('15m'),
  REFRESH_EXPIRES_IN: z.string().default('7d'),
  PORT: z.coerce.number().int().positive().default(3333),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  // Número de proxies reversos confiáveis IMEDIATAMENTE na frente da API,
  // repassado ao `trustProxy` do Fastify (ver app.ts). Cada hop além do
  // configurado é ignorado ao calcular `request.ip` a partir de
  // X-Forwarded-For — subestimar permite que o cliente forje o IP usado
  // pelo rate limiting; superestimar permite o mesmo forjando hops extras.
  // Topologia padrão do compose (docker-compose.yml raiz): só o nginx do
  // serviço `web` fica entre o cliente e a API -> 1. Com Caddy também na
  // frente do nginx para TLS (docker-compose.prod.yml, VPS com domínio
  // próprio): client -> Caddy -> nginx -> api -> 2. Mesma contagem para
  // Cloudflare/ALB + nginx.
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(20).default(12),
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, 'STRIPE_WEBHOOK_SECRET is required'),
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  SMTP_FROM: z.string().default('Alegra Festas <noreply@alegrafestas.com.br>'),
  // URL pública do site (frontend), usada para montar links absolutos em
  // conteúdo gerado pelo backend (GET /sitemap.xml, e-mail de lembrete de
  // avaliação pós-entrega). Distinta de CORS_ORIGIN (que pode ter múltiplas
  // origens separadas por vírgula e serve a um propósito de segurança, não
  // de link building).
  PUBLIC_SITE_URL: z.string().url().default('http://localhost'),
  // Frete grátis progressivo (ver shipping-controller.ts), em REAIS. Zona
  // "local" = Manaus (CEP 69000-000 a 69099-999); "national" = demais CEPs.
  FREE_SHIPPING_THRESHOLD_LOCAL: z.coerce.number().nonnegative().default(150),
  FREE_SHIPPING_THRESHOLD_NATIONAL: z.coerce.number().nonnegative().default(400),
});

export type Env = z.infer<typeof envSchema>;

function looksLikePlaceholder(value: string): boolean {
  const normalized = value.toLowerCase();
  return PLACEHOLDER_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Regras extras só aplicadas em produção. O objetivo é falhar no boot (e não
 * silenciosamente) quando o ambiente está configurado de forma insegura.
 */
function assertProductionSafety(env: Env): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const errors: string[] = [];

  if (looksLikePlaceholder(env.JWT_SECRET) || looksLikePlaceholder(env.JWT_REFRESH_SECRET)) {
    errors.push('JWT_SECRET/JWT_REFRESH_SECRET ainda usam valor de exemplo. Gere segredos aleatórios (openssl rand -base64 48).');
  }

  if (env.JWT_SECRET === env.JWT_REFRESH_SECRET) {
    errors.push('JWT_SECRET e JWT_REFRESH_SECRET devem ser diferentes.');
  }

  if (env.CORS_ORIGIN.split(',').some((origin) => /localhost|127\.0\.0\.1/.test(origin))) {
    errors.push('CORS_ORIGIN aponta para localhost em produção. Defina o(s) domínio(s) público(s) https.');
  }

  if (env.CORS_ORIGIN.split(',').some((origin) => origin.trim().startsWith('http://'))) {
    errors.push('CORS_ORIGIN deve usar https em produção.');
  }

  if (looksLikePlaceholder(env.STRIPE_SECRET_KEY) || looksLikePlaceholder(env.STRIPE_WEBHOOK_SECRET)) {
    errors.push('STRIPE_SECRET_KEY/STRIPE_WEBHOOK_SECRET ainda usam valor de exemplo.');
  }

  if (!env.STRIPE_SECRET_KEY.startsWith('sk_')) {
    errors.push('STRIPE_SECRET_KEY inválida (deve começar com sk_live_ ou sk_test_).');
  }

  if (!env.STRIPE_WEBHOOK_SECRET.startsWith('whsec_')) {
    errors.push('STRIPE_WEBHOOK_SECRET inválida (deve começar com whsec_).');
  }

  if (!env.SMTP_USER || !env.SMTP_PASS) {
    errors.push('SMTP_USER/SMTP_PASS são obrigatórios em produção (redefinição de senha depende de e-mail).');
  }

  if (/localhost|127\.0\.0\.1/.test(env.PUBLIC_SITE_URL)) {
    errors.push('PUBLIC_SITE_URL aponta para localhost em produção. Defina o domínio público do site.');
  }

  if (errors.length > 0) {
    throw new Error(
      `Configuração insegura para produção:\n${errors.map((e) => `  - ${e}`).join('\n')}`
    );
  }
}

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const formatted = parsed.error.flatten().fieldErrors;
    const message = Object.entries(formatted)
      .map(([key, errors]) => `  ${key}: ${(errors ?? []).join(', ')}`)
      .join('\n');

    throw new Error(`Invalid environment variables:\n${message}`);
  }

  assertProductionSafety(parsed.data);

  return parsed.data;
}

export const env = loadEnv();
