import Stripe from 'stripe';
import { env } from './env.js';

/**
 * Cliente Stripe único e compartilhado. Centralizado aqui (em vez de
 * instanciado em cada service) para que testes possam mockar um único
 * módulo (`vi.mock('.../infra/config/stripe.js')`) e para evitar múltiplas
 * instâncias do SDK apontando para a mesma conta.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY, {
  // Pinada na versão exigida pelo SDK instalado (ver
  // node_modules/stripe/cjs/apiVersion.d.ts -> ApiVersion) para que uma
  // atualização de conta na Stripe não mude o formato das respostas por
  // baixo dos nossos pés sem passarmos antes por um upgrade deliberado do
  // pacote `stripe`.
  apiVersion: '2026-07-29.dahlia',
  appInfo: { name: 'Alegra Festas', version: '1.0.0' },
});
