import Stripe from 'stripe';
import { env } from './env.js';

/**
 * Cliente Stripe único e compartilhado. Centralizado aqui (em vez de
 * instanciado em cada service) para que testes possam mockar um único
 * módulo (`vi.mock('.../infra/config/stripe.js')`) e para evitar múltiplas
 * instâncias do SDK apontando para a mesma conta.
 */
export const stripe = new Stripe(env.STRIPE_SECRET_KEY);
