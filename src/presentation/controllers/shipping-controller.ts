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

/**
 * Retirada na loja física: sempre disponível, sempre grátis, pronta em ~1 dia
 * útil. Independe do CEP, por isso é a PRIMEIRA opção em qualquer cálculo.
 */
function buildStorePickupOption(): ShippingOption {
  return {
    id: 'store-pickup',
    name: 'Retirar na loja',
    price: 0,
    estimatedDays: 1,
    carrier: 'Alegra Festas',
  };
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

/**
 * Estimativa de frete por TABELA DETERMINÍSTICA, com origem em MANAUS/AM
 * (sede da loja). NÃO é uma cotação em tempo real dos Correios — é uma
 * decisão de produto para o lançamento, calibrada por região de destino a
 * partir do primeiro dígito do CEP. Para cotação real, trocar
 * `estimateCorreios` por uma integração (Melhor Envio / Correios / Jadlog),
 * mantendo o mesmo contrato (ShippingOption[]).
 *
 * Regiões CEP (1º dígito): 0/1=SP, 2=RJ/ES, 3=MG, 4=BA/SE, 5=PE/PB/RN/AL,
 * 6=Norte/parte do NE (Manaus=69), 7=Centro-Oeste/RO, 8=PR/SC, 9=RS.
 * A partir de Manaus, o Norte (6) é o mais barato e o Sul (8/9) o mais caro.
 */
const REGION_TABLE: Record<number, { multiplier: number; extraDays: number }> = {
  6: { multiplier: 1.0, extraDays: 0 }, // Norte (origem)
  7: { multiplier: 1.25, extraDays: 3 }, // Centro-Oeste / Rondônia
  5: { multiplier: 1.45, extraDays: 4 }, // Nordeste (PE/PB/RN/AL)
  4: { multiplier: 1.5, extraDays: 5 }, // Bahia / Sergipe
  3: { multiplier: 1.7, extraDays: 6 }, // Minas Gerais
  2: { multiplier: 1.8, extraDays: 6 }, // RJ / ES
  1: { multiplier: 1.9, extraDays: 6 }, // SP
  0: { multiplier: 1.9, extraDays: 6 }, // SP (grande capital)
  8: { multiplier: 2.1, extraDays: 8 }, // PR / SC
  9: { multiplier: 2.2, extraDays: 9 }, // RS
};

// Preços-base (origem Manaus, ~1kg). Calibrados acima dos Correios reais
// para a região Norte, para nunca subdimensionar o frete no lançamento.
const PAC_BASE_PRICE = 22.9;
const SEDEX_BASE_PRICE = 42.9;
const PAC_BASE_DAYS = 6;
const SEDEX_BASE_DAYS = 2;

function estimateCorreios(cleanZip: string): ShippingOption[] {
  const region = parseInt(cleanZip.slice(0, 1), 10);
  // Defensivo: CEP é validado por schema, mas se a região for desconhecida
  // assumimos o pior caso (Sul) para não subestimar o custo.
  const tier = REGION_TABLE[region] ?? { multiplier: 2.2, extraDays: 9 };

  return [
    {
      id: 'pac',
      name: 'PAC - Encomenda Econômica',
      price: Math.round(PAC_BASE_PRICE * tier.multiplier * 100) / 100,
      estimatedDays: PAC_BASE_DAYS + tier.extraDays,
      carrier: 'Correios',
    },
    {
      id: 'sedex',
      name: 'SEDEX - Entrega Rápida',
      price: Math.round(SEDEX_BASE_PRICE * tier.multiplier * 100) / 100,
      estimatedDays: SEDEX_BASE_DAYS + tier.extraDays,
      carrier: 'Correios',
    },
  ];
}

export async function calculateShippingHandler(
  request: FastifyRequest<{ Body: CalculateShippingInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { zipCode } = request.body;
  const cleanZip = zipCode.replace(/\D/g, '');

  const correiosOptions = estimateCorreios(cleanZip);

  // "Retirar na loja" sempre encabeça a lista (grátis, ~1 dia útil).
  const deliveryOptions: ShippingOption[] = isManausZipCode(cleanZip)
    ? [buildManausLocalOption(), ...correiosOptions]
    : correiosOptions;

  const options: ShippingOption[] = [buildStorePickupOption(), ...deliveryOptions];

  void reply.status(200).send(successResponse(options));
}
