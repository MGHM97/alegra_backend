import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '../../shared/utils/response.js';
import type { CalculateShippingInput } from '../schemas/shipping-schemas.js';

interface ShippingOption {
  id: string;
  name: string;
  price: number;
  estimatedDays: number;
  carrier: string;
}

/**
 * Manaus (capital do Amazonas) CEP range: 69000-000 a 69099-999.
 * Decisão de produto: para esses CEPs adicionamos uma opção fixa de
 * "Entrega Local Manaus" R$ 15,00 (1-2 dias úteis) ANTES das opções
 * dos Correios. As opções padrão (PAC/SEDEX) continuam sendo retornadas
 * para que o cliente escolha. Isto preserva o response shape
 * (ShippingOption[]) consumido pelo Checkout.
 */
const MANAUS_CEP_PREFIX_MIN = 69000;
const MANAUS_CEP_PREFIX_MAX = 69099;

function isManausZipCode(cleanZip: string): boolean {
  if (cleanZip.length !== 8) return false;
  const prefix = parseInt(cleanZip.slice(0, 5), 10);
  if (Number.isNaN(prefix)) return false;
  return prefix >= MANAUS_CEP_PREFIX_MIN && prefix <= MANAUS_CEP_PREFIX_MAX;
}

function buildManausLocalOption(): ShippingOption {
  return {
    id: 'manaus-local',
    // Prazo apresentado no FE como "1 a 2 dias úteis"; manteremos
    // estimatedDays no valor superior do range para cálculos defensivos.
    name: 'Entrega Local Manaus',
    price: 15.0,
    estimatedDays: 2,
    carrier: 'Alegra Festas',
  };
}

export async function calculateShippingHandler(
  request: FastifyRequest<{ Body: CalculateShippingInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { zipCode } = request.body;
  const cleanZip = zipCode.replace(/\D/g, '');

  // In production, integrate with Melhor Envio, Correios, or Jadlog API.
  // For MVP, return mock options based on region.
  const region = parseInt(cleanZip.slice(0, 1), 10);

  const baseOptions: ShippingOption[] = [
    {
      id: 'pac',
      name: 'PAC - Encomenda Economica',
      price: 18.9,
      estimatedDays: 8,
      carrier: 'Correios',
    },
    {
      id: 'sedex',
      name: 'SEDEX - Entrega Rapida',
      price: 35.9,
      estimatedDays: 3,
      carrier: 'Correios',
    },
  ];

  // Adjust price/days by region distance (SP = region 0/1)
  const regionMultiplier = region <= 1 ? 1.0 : region <= 3 ? 1.2 : region <= 5 ? 1.4 : 1.6;
  const extraDays = region <= 1 ? 0 : region <= 3 ? 1 : region <= 5 ? 2 : 3;

  const correiosOptions: ShippingOption[] = baseOptions.map((opt) => ({
    ...opt,
    price: Math.round(opt.price * regionMultiplier * 100) / 100,
    estimatedDays: opt.estimatedDays + extraDays,
  }));

  const options: ShippingOption[] = isManausZipCode(cleanZip)
    ? [buildManausLocalOption(), ...correiosOptions]
    : correiosOptions;

  void reply.status(200).send(successResponse(options));
}
