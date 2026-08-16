/**
 * Seed de AMOSTRAS para o piloto — popula o catálogo com produtos, reviews,
 * cupons e uma campanha sazonal que PARECEM reais (loja de festas em
 * Manaus), para as donas da loja testarem o site no ar. Diferente de
 * `prisma/seed.ts` (55 itens de dev, fotos aleatórias do picsum, bloqueado
 * em produção) e de `prisma/seed-pilot.ts` (só cria as contas admin/cliente
 * do piloto, nenhum produto) — este script assume que as contas do piloto
 * já existem e cobre exatamente o que falta: catálogo navegável.
 *
 * Diferente dos demais scripts de `prisma/*.ts`, este importa módulos de
 * `src/` (prisma singleton, cache Redis, `PUBLIC_SITE_URL`, recálculo de
 * agregado de review) — logo depende de `env.ts` validado por completo
 * (inclui STRIPE_* e SMTP_*). Isso é intencional: para gerar URLs de imagem
 * corretas (`PUBLIC_SITE_URL`) e invalidar os MESMOS caches que a API usa
 * em produção, é preciso reusar exatamente esses módulos — e, no fluxo real
 * de deploy (ver `deploy/DEPLOY.md`), este script só roda DEPOIS que o
 * `.env` de produção já está 100% preenchido (a própria API não sobe sem
 * isso). `seed-pilot.ts` evita essa dependência de propósito por rodar
 * potencialmente mais cedo no setup — não é o caso aqui.
 *
 * Idempotente: cada produto é UPSERT por `sku` (prefixo `AMOSTRA-`), cada
 * cupom por `code`, a campanha por `key`. Rodar de novo nunca duplica —
 * apenas garante que o catálogo de amostra volte ao estado canônico.
 *
 * Remoção: `PILOT_SAMPLES=remove yarn seed:samples` apaga exatamente o que
 * este script criou (produtos com `sku` prefixo `AMOSTRA-`, os 2 cupons).
 * Produtos com pedido associado (`OrderItem` existente) NUNCA são
 * excluídos — apenas desativados (`isActive: false`), para nunca quebrar o
 * histórico/integridade de um pedido real feito durante o piloto. A
 * campanha sazonal `dia-das-criancas` não é removida por este modo: ela é
 * uma chave compartilhada com `prisma/seed-seasonal-campaigns.ts` (que este
 * script não deve "possuir" sozinho) — remover apagaria uma campanha que
 * pode ter sido criada por aquele outro script.
 *
 * Comando: `yarn seed:samples` (ou `PILOT_SAMPLES=remove yarn seed:samples`
 * para remover).
 */
import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { prisma } from '../src/infra/database/prisma-client.js';
import { env } from '../src/infra/config/env.js';
import { cacheDelete, cacheInvalidatePattern } from '../src/infra/cache/cache-utils.js';
import { disconnectRedis } from '../src/infra/cache/redis-client.js';
import { SITEMAP_CACHE_KEY } from '../src/shared/utils/sitemap.js';
import { recalculateProductRatingAggregate } from '../src/application/services/product-rating-service.js';
import { invalidateProductReviewsCache } from '../src/application/services/review-cache-service.js';

const SKU_PREFIX = 'AMOSTRA-';
const TEST_CUSTOMER_EMAIL = 'alegra@alegrafestas.com.br';
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'products');

// -----------------------------------------------------------------------
// Geração de imagem placeholder (SVG 800x800, uma por produto)
// -----------------------------------------------------------------------

/** Paleta de fundo da marca — alterna por índice do produto no catálogo. */
const BRAND_BACKGROUNDS = ['#fdf4eb', '#eaf7f7', '#fef2f2', '#fffcf0'] as const;
const ICON_COLOR = '#019d9c';
const TEXT_COLOR = '#241f1d';
const MUTED_COLOR = '#8a7f76';

function pick<T>(items: readonly T[], index: number): T {
  const value = items[((index % items.length) + items.length) % items.length];
  if (value === undefined) {
    throw new Error('pick(): índice fora do array — não deveria acontecer com módulo.');
  }
  return value;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Quebra o nome do produto em até `maxLines` linhas de no máximo
 * `maxCharsPerLine` caracteres (SVG `<text>` não quebra linha sozinho).
 * Se sobrar texto além do que cabe, a última linha termina com "…".
 */
function wrapProductName(name: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = name.split(/\s+/).filter((word) => word.length > 0);
  const lines: string[] = [];
  let current = '';
  let wordIndex = 0;

  while (wordIndex < words.length && lines.length < maxLines) {
    const word = words[wordIndex];
    if (word === undefined) break;

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine || !current) {
      current = candidate;
      wordIndex++;
    } else {
      lines.push(current);
      current = '';
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
    // `current` acabou de ser movido para `lines` — limpar aqui é o que
    // faz `consumedAllWords` (abaixo) refletir a realidade quando o loop
    // saiu por ter consumido todas as palavras (em vez de por atingir
    // `maxLines`), evitando uma "…" falsa numa última linha completa.
    current = '';
  }

  const consumedAllWords = wordIndex >= words.length && current === '';
  if (!consumedAllWords && lines.length > 0) {
    const lastIndex = lines.length - 1;
    const lastLine = lines[lastIndex] ?? '';
    lines[lastIndex] =
      lastLine.length > maxCharsPerLine - 1
        ? `${lastLine.slice(0, maxCharsPerLine - 1).trimEnd()}…`
        : `${lastLine}…`;
  }

  return lines;
}

/** Franja de fitas verticais penduradas numa barra — cortinas metalizadas. */
function curtainFringeIcon(): string {
  const count = 7;
  const startX = -84;
  const endX = 84;
  const step = (endX - startX) / (count - 1);
  const lines: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = (startX + step * i).toFixed(1);
    const bottomY = i % 2 === 0 ? 80 : 55;
    lines.push(
      `<line x1="${x}" y1="-55" x2="${x}" y2="${bottomY}" stroke="${ICON_COLOR}" stroke-width="7" stroke-linecap="round"/>`,
    );
  }
  return `<rect x="-95" y="-70" width="190" height="14" rx="4" fill="${ICON_COLOR}"/>${lines.join('')}`;
}

/** Confetes espalhados ao redor de um cone — lança-confetes. */
function confettiBurstIcon(): string {
  const dots = [
    { x: 15, y: -85, r: 7 },
    { x: 55, y: -55, r: 6 },
    { x: -15, y: -100, r: 5 },
    { x: 70, y: -85, r: 5 },
    { x: -35, y: -70, r: 6 },
  ];
  const dotMarkup = dots
    .map((dot) => `<circle cx="${dot.x}" cy="${dot.y}" r="${dot.r}" fill="${ICON_COLOR}"/>`)
    .join('');
  return `<path d="M -22 60 L 22 60 L 42 -50 L -42 -50 Z" fill="${ICON_COLOR}"/>${dotMarkup}`;
}

/** Um ícone SVG simples por categoria, desenhado em torno da origem (0,0). */
function categoryIconMarkup(category: string): string {
  switch (category) {
    case 'baloes':
      return `
        <ellipse cx="0" cy="-30" rx="62" ry="82" fill="${ICON_COLOR}"/>
        <path d="M -10 52 L 10 52 L 0 70 Z" fill="${ICON_COLOR}"/>
        <path d="M 0 70 C 22 95, -22 118, 0 148" stroke="${ICON_COLOR}" stroke-width="5" fill="none" stroke-linecap="round"/>
      `;
    case 'boleira-bandejas':
      return `
        <ellipse cx="0" cy="-8" rx="88" ry="16" fill="${ICON_COLOR}"/>
        <rect x="-9" y="-8" width="18" height="55" fill="${ICON_COLOR}"/>
        <ellipse cx="0" cy="52" rx="55" ry="13" fill="${ICON_COLOR}"/>
      `;
    case 'confeitaria':
      return `
        <path d="M -46 18 L 46 18 L 33 92 L -33 92 Z" fill="${ICON_COLOR}"/>
        <path d="M -52 18 C -52 -34 52 -34 52 18 C 20 2 -20 2 -52 18 Z" fill="${ICON_COLOR}"/>
        <circle cx="0" cy="-48" r="10" fill="${ICON_COLOR}"/>
      `;
    case 'bomboniere':
      return `
        <rect x="-56" y="-16" width="112" height="82" fill="${ICON_COLOR}"/>
        <rect x="-62" y="-38" width="124" height="26" fill="${ICON_COLOR}"/>
        <rect x="-9" y="-38" width="18" height="104" fill="${MUTED_COLOR}" opacity="0.35"/>
      `;
    case 'descartaveis':
      return `
        <circle cx="0" cy="0" r="82" fill="none" stroke="${ICON_COLOR}" stroke-width="9"/>
        <circle cx="0" cy="0" r="46" fill="none" stroke="${ICON_COLOR}" stroke-width="6"/>
      `;
    case 'papelaria':
      return `
        <rect x="-82" y="-52" width="164" height="112" rx="6" fill="${ICON_COLOR}"/>
        <path d="M -82 -52 L 0 24 L 82 -52" fill="none" stroke="#ffffff" stroke-width="7" opacity="0.55"/>
      `;
    case 'topos-de-bolo':
      return `
        <line x1="0" y1="-92" x2="0" y2="82" stroke="${ICON_COLOR}" stroke-width="7" stroke-linecap="round"/>
        <path d="M 0 -92 L 74 -66 L 0 -40 Z" fill="${ICON_COLOR}"/>
      `;
    case 'kits-festa':
      return `
        <rect x="-62" y="-8" width="124" height="88" fill="${ICON_COLOR}"/>
        <rect x="-68" y="-34" width="136" height="28" fill="${ICON_COLOR}"/>
        <circle cx="-26" cy="-46" r="17" fill="none" stroke="${ICON_COLOR}" stroke-width="7"/>
        <circle cx="26" cy="-46" r="17" fill="none" stroke="${ICON_COLOR}" stroke-width="7"/>
      `;
    case 'velas':
      return `
        <rect x="-15" y="-18" width="30" height="102" rx="3" fill="${ICON_COLOR}"/>
        <path d="M 0 -72 C 16 -52 16 -30 0 -18 C -16 -30 -16 -52 0 -72 Z" fill="${ICON_COLOR}"/>
      `;
    case 'lembrancinhas':
      return `
        <path d="M -56 -18 L 56 -18 L 46 92 L -46 92 Z" fill="${ICON_COLOR}"/>
        <path d="M -26 -18 C -26 -56 26 -56 26 -18" fill="none" stroke="${ICON_COLOR}" stroke-width="9"/>
      `;
    case 'lanca-confetes':
      return confettiBurstIcon();
    case 'cortinas-metalizadas':
      return curtainFringeIcon();
    default:
      // Fallback defensivo — nunca deve ser atingido com as 12 categorias
      // do frontend (ver alegra_frontend/src/config/categories.ts).
      return `<circle cx="0" cy="0" r="70" fill="${ICON_COLOR}"/>`;
  }
}

function buildProductSvg(name: string, category: string, backgroundColor: string): string {
  const lines = wrapProductName(name, 20, 3);
  const centerY = 580;
  const lineHeight = 56;
  const startOffset = -((lines.length - 1) * lineHeight) / 2;
  const textMarkup = lines
    .map((line, index) => {
      const y = centerY + startOffset + index * lineHeight;
      return `<text x="400" y="${y}" text-anchor="middle" font-family="'Fredoka', 'Segoe UI', sans-serif" font-weight="700" font-size="42" fill="${TEXT_COLOR}">${escapeXml(line)}</text>`;
    })
    .join('\n    ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800" role="img">
    <title>${escapeXml(name)}</title>
    <rect width="800" height="800" fill="${backgroundColor}"/>
    <g transform="translate(400,260)">${categoryIconMarkup(category)}</g>
    ${textMarkup}
    <text x="400" y="756" text-anchor="middle" font-family="'Fredoka', 'Segoe UI', sans-serif" font-style="italic" font-size="22" fill="${MUTED_COLOR}">imagem ilustrativa</text>
  </svg>`;
}

// -----------------------------------------------------------------------
// Utilitários de produto
// -----------------------------------------------------------------------

/**
 * Mesmo algoritmo de `admin-product-controller.ts` (função não exportada de
 * lá) — mantido em sincronia manualmente. Se aquele arquivo mudar o
 * algoritmo de slug, replicar aqui.
 */
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function computeInstallments(price: number): {
  maxInstallments: number;
  installmentPrice: number | null;
} {
  if (price < 50) {
    return { maxInstallments: 1, installmentPrice: null };
  }
  const installments = price >= 150 ? 3 : 2;
  return { maxInstallments: installments, installmentPrice: Math.round((price / installments) * 100) / 100 };
}

// -----------------------------------------------------------------------
// Catálogo de amostra — 12 categorias do frontend, 2-3 produtos cada
// -----------------------------------------------------------------------

interface ReviewFixture {
  rating: number;
  comment: string;
  soldCount: number;
}

interface DirectAggregate {
  averageRating: number;
  reviewCount: number;
  soldCount: number;
}

interface SampleProductSeed {
  skuSuffix: string;
  name: string;
  category: string;
  subcategory?: string;
  shortDescription: string;
  description: string;
  price: number;
  originalPrice?: number;
  stock: number;
  weight: number;
  badges?: ReadonlyArray<'mais-vendido' | 'novo' | 'promocao' | 'exclusivo'>;
  specifications?: Record<string, string>;
  /** Agregado denormalizado escrito direto (produto sem review real). */
  directAggregate?: DirectAggregate;
  /** Uma review real do cliente de teste, recalculada via o serviço oficial. */
  reviewFixture?: ReviewFixture;
}

const SAMPLE_PRODUCTS: readonly SampleProductSeed[] = [
  // ---- Balões ----------------------------------------------------------
  {
    skuSuffix: 'BAL-N5-PRATA-70',
    name: 'Balão Metalizado Número 5 Prata 70cm',
    category: 'baloes',
    subcategory: 'metalizados',
    shortDescription: 'Balão metalizado numeral 5, prata, 70 cm.',
    description:
      'Balão metalizado em formato numeral 5, na cor prata, com 70 cm de altura. Perfeito para compor o painel de fotos ou a mesa do bolo em festas de aniversário. Vem murcho, pronto para ser inflado com hélio ou ar.',
    price: 24.9,
    stock: 45,
    weight: 0.05,
    badges: ['novo'],
    specifications: { Material: 'Poliéster metalizado', Altura: '70 cm', Cor: 'Prata' },
    reviewFixture: {
      rating: 5,
      comment: 'Balão lindo e resistente, ficou perfeito no painel de fotos da festa!',
      soldCount: 34,
    },
  },
  {
    skuSuffix: 'BAL-KIT50-ROSA-9',
    name: "Kit 50 Balões Látex Rosa Bebê 9''",
    category: 'baloes',
    subcategory: 'latex',
    shortDescription: 'Kit com 50 balões de látex rosa bebê, 9 polegadas.',
    description:
      'Kit com 50 balões de látex na cor rosa bebê, tamanho 9 polegadas, ideais para arcos e cascatas de balões. Material resistente, com boa capacidade de encher e manter a forma por mais tempo.',
    price: 34.9,
    originalPrice: 44.9,
    stock: 80,
    weight: 0.4,
    badges: ['promocao', 'mais-vendido'],
    specifications: {
      Material: 'Látex',
      Quantidade: '50 unidades',
      Tamanho: '9 polegadas',
      Cor: 'Rosa bebê',
    },
    directAggregate: { averageRating: 4.8, reviewCount: 23, soldCount: 210 },
  },
  {
    skuSuffix: 'BAL-BUBBLE-CONFETE-45',
    name: 'Balão Bubble Transparente com Confete Dourado 45cm',
    category: 'baloes',
    subcategory: 'bubble',
    shortDescription: 'Balão bubble transparente com confete dourado, 45 cm.',
    description:
      'Balão bubble em PVC transparente com confetes dourados soltos em seu interior, 45 cm de diâmetro. Um efeito de destaque para decorações de aniversário e chá revelação.',
    price: 18.9,
    stock: 2,
    weight: 0.1,
    badges: ['exclusivo'],
    specifications: { Material: 'PVC transparente', Diâmetro: '45 cm', Detalhe: 'Confete dourado' },
  },
  // ---- Boleira e Bandejas -----------------------------------------------
  {
    skuSuffix: 'BOL-VIDRO-PE-30',
    name: 'Boleira de Vidro com Pé Alto 30cm',
    category: 'boleira-bandejas',
    subcategory: 'boleiras',
    shortDescription: 'Boleira de vidro com pé alto, 30 cm de diâmetro.',
    description:
      'Boleira de vidro temperado com pé alto, 30 cm de diâmetro, ideal para exibir o bolo principal da festa com elegância. Base estável e acabamento transparente que combina com qualquer tema de decoração.',
    price: 89.9,
    stock: 15,
    weight: 1.8,
    specifications: { Material: 'Vidro temperado', Diâmetro: '30 cm', Altura: '12 cm' },
    reviewFixture: {
      rating: 5,
      comment: 'Boleira elegante e muito bem-acabada, superou minhas expectativas.',
      soldCount: 19,
    },
  },
  {
    skuSuffix: 'BAND-ESPELHO-DOURADA-35',
    name: 'Bandeja Espelhada Redonda Dourada 35cm',
    category: 'boleira-bandejas',
    subcategory: 'bandejas',
    shortDescription: 'Bandeja espelhada redonda, borda dourada, 35 cm.',
    description:
      'Bandeja redonda em acrílico espelhado com borda dourada, 35 cm de diâmetro. Realça docinhos e salgados na mesa principal, refletindo a decoração ao redor.',
    price: 69.9,
    originalPrice: 89.9,
    stock: 20,
    weight: 0.6,
    badges: ['promocao'],
    specifications: { Material: 'Acrílico espelhado', Diâmetro: '35 cm', Cor: 'Dourado' },
  },
  // ---- Confeitaria --------------------------------------------------------
  {
    skuSuffix: 'CONF-FORM-N4-DOURADA-100',
    name: 'Forminha para Doces Nº 4 Dourada c/ 100',
    category: 'confeitaria',
    subcategory: 'forminhas',
    shortDescription: 'Forminha de papel laminado nº 4 dourada, pacote com 100 unidades.',
    description:
      'Forminha de papel laminado numeração 4, na cor dourada, pacote com 100 unidades. Uso indicado para brigadeiros, docinhos e trufas — acabamento resistente que não desbota com a gordura do doce.',
    price: 12.9,
    stock: 120,
    weight: 0.15,
    badges: ['mais-vendido'],
    specifications: { Material: 'Papel laminado', Quantidade: '100 unidades', Numeração: 'Nº 4', Cor: 'Dourado' },
    directAggregate: { averageRating: 4.5, reviewCount: 15, soldCount: 340 },
  },
  {
    skuSuffix: 'CONF-PEROLA-PRATA-100G',
    name: 'Confeitos de Açúcar Perolizados Prata 100g',
    category: 'confeitaria',
    subcategory: 'confeitos',
    shortDescription: 'Confeitos de açúcar perolizados prateados, pote de 100g.',
    description:
      'Confeitos de açúcar perolizados na cor prata, pote com 100g. Ideais para decorar bolos, cupcakes e doces finos, dando um acabamento brilhante e sofisticado.',
    price: 15.9,
    stock: 60,
    weight: 0.1,
    specifications: { Peso: '100g', Cor: 'Prata', Uso: 'Decoração de bolos e doces' },
  },
  {
    skuSuffix: 'CONF-PASTA-BRANCA-1KG',
    name: 'Pasta Americana Branca 1kg',
    category: 'confeitaria',
    subcategory: 'pasta-americana',
    shortDescription: 'Pasta americana branca, pacote de 1kg.',
    description:
      'Pasta americana branca pronta para modelar, pacote de 1kg, com rendimento para cobrir um bolo de até 25 cm de diâmetro. Textura macia e fácil de trabalhar, mesmo para iniciantes.',
    price: 32.9,
    stock: 40,
    weight: 1.0,
    specifications: { Peso: '1kg', Cor: 'Branca', Rendimento: 'Cobre bolo de até 25 cm' },
  },
  // ---- Bomboniere ---------------------------------------------------------
  {
    skuSuffix: 'BOMB-CAIXA-BEMCASADO-20',
    name: 'Caixinha para Bem-Casado Kraft c/ 20',
    category: 'bomboniere',
    subcategory: 'caixinhas',
    shortDescription: 'Caixinha kraft para bem-casado, pacote com 20 unidades.',
    description:
      'Caixinha de papel kraft para embalar bem-casados, pacote com 20 unidades. Acabamento rústico e elegante, combina com casamentos e chás de casa nova.',
    price: 19.9,
    stock: 55,
    weight: 0.2,
    specifications: { Material: 'Papel kraft', Quantidade: '20 unidades' },
    reviewFixture: {
      rating: 4,
      comment: 'Caixinhas bonitas e chegaram muito bem embaladas, recomendo.',
      soldCount: 41,
    },
  },
  {
    skuSuffix: 'BOMB-FORM-TRUFA-N5-50',
    name: 'Forminha de Papel para Trufas Nº 5 Branca c/ 50',
    category: 'bomboniere',
    subcategory: 'forminhas',
    shortDescription: 'Forminha de papel para trufas nº 5, branca, pacote com 50.',
    description:
      'Forminha de papel branca, numeração 5, própria para trufas e docinhos maiores, pacote com 50 unidades. Base reforçada que mantém a forma mesmo com doces mais pesados.',
    price: 9.9,
    stock: 90,
    weight: 0.1,
    specifications: { Material: 'Papel', Quantidade: '50 unidades', Numeração: 'Nº 5', Cor: 'Branca' },
  },
  // ---- Descartáveis -------------------------------------------------------
  {
    skuSuffix: 'DESC-PRATO-18-BRANCO-10',
    name: 'Prato Descartável 18cm Branco c/ 10',
    category: 'descartaveis',
    subcategory: 'pratos',
    shortDescription: 'Prato descartável branco, 18 cm, pacote com 10 unidades.',
    description:
      'Prato descartável branco de 18 cm, pacote com 10 unidades, resistente para servir salgados e docinhos. Prático para o dia a dia e para festas de qualquer tamanho.',
    price: 8.9,
    stock: 100,
    weight: 0.25,
    specifications: { Material: 'Papel laminado', Tamanho: '18 cm', Quantidade: '10 unidades', Cor: 'Branco' },
  },
  {
    skuSuffix: 'DESC-COPO-200-DOURADO-25',
    name: 'Copo Descartável 200ml Listrado Dourado c/ 25',
    category: 'descartaveis',
    subcategory: 'copos',
    shortDescription: 'Copo descartável 200ml, listrado dourado, pacote com 25.',
    description:
      'Copo descartável de 200ml com listras douradas, pacote com 25 unidades. Combina com decorações douradas e festas de gala, sem perder a praticidade do descartável.',
    price: 11.9,
    originalPrice: 14.9,
    stock: 70,
    weight: 0.3,
    badges: ['promocao'],
    specifications: { Capacidade: '200 ml', Quantidade: '25 unidades', Estampa: 'Listrado dourado' },
  },
  {
    skuSuffix: 'DESC-GUARD-ESTAMPADO-20',
    name: 'Guardanapo de Papel Estampado Festa 33cm c/ 20',
    category: 'descartaveis',
    subcategory: 'guardanapos',
    shortDescription: 'Guardanapo de papel estampado, 33 cm, pacote com 20.',
    description:
      'Guardanapo de papel estampado para festa, 33 cm, pacote com 20 unidades. Papel macio de dupla camada, com estampa colorida que completa a decoração da mesa.',
    price: 7.9,
    stock: 85,
    weight: 0.1,
    specifications: { Tamanho: '33 cm x 33 cm', Quantidade: '20 unidades', Camadas: '2' },
  },
  // ---- Papelaria ------------------------------------------------------
  {
    skuSuffix: 'PAP-CONVITE-CHAREV-10',
    name: 'Convite Chá Revelação c/ 10',
    category: 'papelaria',
    subcategory: 'convites',
    shortDescription: 'Convite para chá revelação, pacote com 10 unidades.',
    description:
      'Convite impresso para chá revelação, pacote com 10 unidades, com espaço para preencher data, horário e local. Papel de boa gramatura, pronto para entregar aos convidados.',
    price: 16.9,
    stock: 50,
    weight: 0.1,
    specifications: { Quantidade: '10 unidades', Tamanho: '10 cm x 15 cm' },
    reviewFixture: {
      rating: 5,
      comment: 'Convites lindos! Todos os convidados elogiaram no chá revelação.',
      soldCount: 27,
    },
  },
  {
    skuSuffix: 'PAP-ROTULO-PERSONALIZAVEL-30',
    name: 'Rótulo Adesivo Personalizável Festa c/ 30',
    category: 'papelaria',
    subcategory: 'rotulos',
    shortDescription: 'Rótulo adesivo personalizável para festa, pacote com 30.',
    description:
      'Rótulo adesivo em papel couché, personalizável com nome e data, pacote com 30 unidades. Uso indicado para latinhas, garrafinhas e potes de lembrancinha.',
    price: 14.9,
    stock: 45,
    weight: 0.05,
    specifications: { Quantidade: '30 unidades', Formato: 'Redondo 4 cm' },
  },
  {
    skuSuffix: 'PAP-PLAQUINHA-DIVERTIDA-12',
    name: 'Plaquinha Divertida para Festa c/ 12',
    category: 'papelaria',
    subcategory: 'plaquinhas',
    shortDescription: 'Plaquinha divertida para festa em bastão, pacote com 12.',
    description:
      'Plaquinha divertida impressa em papel rígido com bastão de madeira, pacote com 12 modelos variados. Ótima para fotos e para animar a pista de dança.',
    price: 22.9,
    stock: 30,
    weight: 0.1,
    specifications: { Quantidade: '12 unidades', Material: 'Papel rígido + bastão de madeira' },
  },
  // ---- Topos de Bolo ----------------------------------------------------
  {
    skuSuffix: 'TOPO-PERSONALIZAVEL-DOURADO',
    name: 'Topo de Bolo Personalizável Dourado',
    category: 'topos-de-bolo',
    subcategory: 'personalizaveis',
    shortDescription: 'Topo de bolo dourado, com espaço para personalizar o nome.',
    description:
      'Topo de bolo em MDF espelhado dourado, com espaço para personalizar com o nome do aniversariante. Fixação simples direto na cobertura do bolo.',
    price: 29.9,
    stock: 0,
    weight: 0.03,
    specifications: { Material: 'MDF espelhado', Cor: 'Dourado', Personalização: 'Nome do aniversariante' },
  },
  {
    skuSuffix: 'TOPO-FELIZANIV-GLITTER-ROSA',
    name: 'Topo de Bolo Feliz Aniversário Glitter Rosa',
    category: 'topos-de-bolo',
    subcategory: 'mensagens',
    shortDescription: 'Topo de bolo "Feliz Aniversário" com glitter rosa.',
    description:
      'Topo de bolo com a frase "Feliz Aniversário" em acrílico glitter rosa. Pronto para usar, sem necessidade de montagem.',
    price: 22.9,
    stock: 18,
    weight: 0.03,
    badges: ['novo'],
    specifications: { Material: 'Acrílico glitter', Cor: 'Rosa', Frase: 'Feliz Aniversário' },
  },
  // ---- Kits de Festa ------------------------------------------------------
  {
    skuSuffix: 'KIT-DINOSSAURO-20CONV',
    name: 'Kit Festa Completo Dinossauro 20 Convidados',
    category: 'kits-festa',
    subcategory: 'temas-infantis',
    shortDescription: 'Kit festa tema dinossauro, completo para 20 convidados.',
    description:
      'Kit festa completo com tema dinossauro para 20 convidados: pratos, copos, guardanapos, toalha de mesa e balões combinando. Praticidade total para decorar sem precisar comprar item por item.',
    price: 249.9,
    originalPrice: 299.9,
    stock: 10,
    weight: 2.5,
    badges: ['promocao', 'exclusivo'],
    specifications: { Tema: 'Dinossauro', Convidados: '20 pessoas', Itens: 'Pratos, copos, guardanapos, toalha e balões' },
    reviewFixture: {
      rating: 5,
      comment: 'Kit completo e prático, facilitou muito a decoração da festa do meu filho.',
      soldCount: 12,
    },
  },
  {
    skuSuffix: 'KIT-UNICORNIO-15CONV',
    name: 'Kit Festa Unicórnio Rosa e Dourado 15 Convidados',
    category: 'kits-festa',
    subcategory: 'temas-infantis',
    shortDescription: 'Kit festa tema unicórnio rosa e dourado, para 15 convidados.',
    description:
      'Kit festa tema unicórnio nas cores rosa e dourado, para 15 convidados: descartáveis, topo de bolo e balões combinando. Decoração pronta em poucos minutos.',
    price: 199.9,
    stock: 12,
    weight: 2.0,
    specifications: { Tema: 'Unicórnio', Convidados: '15 pessoas', Cores: 'Rosa e dourado' },
  },
  {
    skuSuffix: 'KIT-SAFARI-10CONV',
    name: 'Kit Decoração Safári Aventura 10 Convidados',
    category: 'kits-festa',
    subcategory: 'temas-infantis',
    shortDescription: 'Kit decoração tema safári aventura, para 10 convidados.',
    description:
      'Kit de decoração tema safári aventura para 10 convidados, com bandeirinhas, balões e centro de mesa temáticos. Ideal para festas menores com decoração completa.',
    price: 149.9,
    stock: 3,
    weight: 1.5,
    specifications: { Tema: 'Safári', Convidados: '10 pessoas' },
  },
  // ---- Velas --------------------------------------------------------------
  {
    skuSuffix: 'VELA-N1-DOURADA',
    name: 'Vela Número 1 Dourada',
    category: 'velas',
    subcategory: 'numeros',
    shortDescription: 'Vela de aniversário numeral 1, dourada.',
    description:
      'Vela de aniversário em formato numeral 1, na cor dourada, com cerca de 8 cm de altura. Destaque elegante para o bolo do primeiro aninho.',
    price: 9.9,
    stock: 75,
    weight: 0.02,
    specifications: { Formato: 'Numeral 1', Cor: 'Dourada', Altura: '8 cm' },
    reviewFixture: {
      rating: 4,
      comment: 'Vela bonita e de boa qualidade, destacou bastante no bolo.',
      soldCount: 63,
    },
  },
  {
    skuSuffix: 'VELA-ESPIRAL-COLORIDA-12',
    name: 'Vela de Aniversário Colorida Espiral c/ 12',
    category: 'velas',
    subcategory: 'decorativas',
    shortDescription: 'Vela de aniversário espiral colorida, pacote com 12.',
    description:
      'Vela de aniversário em espiral, cores sortidas, pacote com 12 unidades. Acompanha suporte plástico para facilitar a fixação no bolo.',
    price: 7.9,
    stock: 100,
    weight: 0.08,
    specifications: { Formato: 'Espiral', Quantidade: '12 unidades', Cores: 'Sortidas' },
  },
  // ---- Lembrancinhas -----------------------------------------------------
  {
    skuSuffix: 'LEMB-SACOLA-KRAFT-10',
    name: 'Lembrancinha Sacola Kraft c/ 10',
    category: 'lembrancinhas',
    subcategory: 'sacolas',
    shortDescription: 'Sacola kraft para lembrancinha, pacote com 10 unidades.',
    description:
      'Sacola de papel kraft com alça, pronta para montar lembrancinhas personalizadas, pacote com 10 unidades. Visual rústico que combina com qualquer tema de festa.',
    price: 14.9,
    stock: 65,
    weight: 0.15,
    specifications: { Material: 'Papel kraft', Quantidade: '10 unidades', Alça: 'Cordão' },
  },
  {
    skuSuffix: 'LEMB-POTE-VIDRO-10',
    name: 'Potinho de Vidro para Lembrancinha c/ 10',
    category: 'lembrancinhas',
    subcategory: 'potes',
    shortDescription: 'Potinho de vidro com tampa para lembrancinha, pacote com 10.',
    description:
      'Potinho de vidro com tampa, ideal para lembrancinhas de doces ou artesanato, pacote com 10 unidades. Formato compacto que fica bonito já na mesa de doces.',
    price: 24.9,
    stock: 30,
    weight: 0.9,
    specifications: { Material: 'Vidro', Quantidade: '10 unidades', Capacidade: '50 ml' },
    reviewFixture: {
      rating: 5,
      comment: 'Potinhos lindos, usei nas lembrancinhas e todo mundo amou o resultado.',
      soldCount: 22,
    },
  },
  {
    skuSuffix: 'LEMB-TAG-OBRIGADA-20',
    name: 'Tag Personalizada Obrigada por Vir c/ 20',
    category: 'lembrancinhas',
    subcategory: 'tags',
    shortDescription: 'Tag "Obrigada por vir" personalizável, pacote com 20.',
    description:
      'Tag de papel com a frase "Obrigada por vir", espaço para personalizar com o nome do aniversariante, pacote com 20 unidades. Já vem com furo para amarrar o cordão.',
    price: 12.9,
    stock: 8,
    weight: 0.03,
    specifications: { Quantidade: '20 unidades', Frase: 'Obrigada por vir' },
  },
  // ---- Lança Confetes -----------------------------------------------------
  {
    skuSuffix: 'LANCA-CONFETE-METALIZADO-40',
    name: 'Lança Confete Metalizado 40cm',
    category: 'lanca-confetes',
    subcategory: 'metalizados',
    shortDescription: 'Lança confete metalizado, 40 cm, disparo manual.',
    description:
      'Lança confete de 40 cm com confetes metalizados coloridos, disparo manual por puxar o cordão. Momento clássico para abertura da festa ou corte do bolo.',
    price: 16.9,
    stock: 50,
    weight: 0.05,
    badges: ['mais-vendido'],
    specifications: { Tamanho: '40 cm', Acionamento: 'Manual (cordão)', Confete: 'Metalizado colorido' },
    directAggregate: { averageRating: 4.9, reviewCount: 40, soldCount: 180 },
  },
  {
    skuSuffix: 'LANCA-CANHAO-DUPLO-COLORIDO',
    name: 'Canhão de Confete Colorido Duplo',
    category: 'lanca-confetes',
    subcategory: 'canhoes',
    shortDescription: 'Canhão de confete colorido, disparo duplo.',
    description:
      'Canhão de confete com disparo duplo, confetes coloridos sortidos. Fácil de usar, ótimo para o momento da festa em que todos brindam juntos.',
    price: 21.9,
    stock: 40,
    weight: 0.15,
    specifications: { Acionamento: 'Duplo', Confete: 'Colorido sortido' },
  },
  // ---- Cortinas Metalizadas -------------------------------------------
  {
    skuSuffix: 'CORT-METALIZADA-DOURADA-1X2',
    name: 'Cortina Metalizada Dourada 1x2m',
    category: 'cortinas-metalizadas',
    subcategory: 'franjas',
    shortDescription: 'Cortina de franja metalizada dourada, 1m x 2m.',
    description:
      'Cortina decorativa de franja metalizada na cor dourada, dimensões 1m x 2m. Perfeita para fundo de mesa de bolo, photobooth e decoração de ambientes.',
    price: 19.9,
    stock: 55,
    weight: 0.2,
    badges: ['mais-vendido'],
    specifications: { Material: 'PVC metalizado', Dimensões: '1m x 2m', Cor: 'Dourado' },
    directAggregate: { averageRating: 5.0, reviewCount: 7, soldCount: 58 },
  },
  {
    skuSuffix: 'CORT-METALIZADA-ROSAGOLD-1X2',
    name: 'Cortina Metalizada Rosa Gold Fringe 1x2m',
    category: 'cortinas-metalizadas',
    subcategory: 'franjas',
    shortDescription: 'Cortina de franja metalizada rosa gold, 1m x 2m.',
    description:
      'Cortina decorativa de franja metalizada na cor rosa gold, dimensões 1m x 2m. Combina com decorações delicadas de aniversário e chá de bebê.',
    price: 19.9,
    originalPrice: 24.9,
    stock: 60,
    weight: 0.2,
    badges: ['promocao'],
    specifications: { Material: 'PVC metalizado', Dimensões: '1m x 2m', Cor: 'Rosa gold' },
  },
];

/** As 12 categorias que o frontend conhece (ver alegra_frontend/src/config/categories.ts). */
const EXPECTED_CATEGORIES = [
  'baloes',
  'boleira-bandejas',
  'confeitaria',
  'bomboniere',
  'descartaveis',
  'papelaria',
  'topos-de-bolo',
  'kits-festa',
  'velas',
  'lembrancinhas',
  'lanca-confetes',
  'cortinas-metalizadas',
] as const;

// -----------------------------------------------------------------------
// Seed de produtos
// -----------------------------------------------------------------------

interface SeededProduct {
  id: string;
  sku: string;
  name: string;
  category: string;
  imageUrl: string;
}

async function upsertSampleProduct(item: SampleProductSeed, index: number): Promise<SeededProduct> {
  const sku = `${SKU_PREFIX}${item.skuSuffix}`;
  const slug = generateSlug(item.name);
  const filename = `amostra-${sku.toLowerCase()}.svg`;
  const filePath = path.join(UPLOADS_DIR, filename);
  const publicBaseUrl = env.PUBLIC_SITE_URL.replace(/\/+$/, '');
  const imageUrl = `${publicBaseUrl}/uploads/products/${filename}`;

  const backgroundColor = pick(BRAND_BACKGROUNDS, index);
  const svg = buildProductSvg(item.name, item.category, backgroundColor);
  await fs.promises.writeFile(filePath, svg, 'utf-8');

  const { maxInstallments, installmentPrice } = computeInstallments(item.price);

  const aggregateFields = item.directAggregate
    ? {
        averageRating: item.directAggregate.averageRating,
        reviewCount: item.directAggregate.reviewCount,
        soldCount: item.directAggregate.soldCount,
      }
    : item.reviewFixture
      ? { soldCount: item.reviewFixture.soldCount }
      : {};

  const data = {
    name: item.name,
    slug,
    description: item.description,
    shortDescription: item.shortDescription,
    price: item.price,
    originalPrice: item.originalPrice ?? null,
    currency: 'BRL',
    category: item.category,
    subcategory: item.subcategory ?? null,
    images: [imageUrl],
    thumbnailUrl: imageUrl,
    badges: item.badges ? [...item.badges] : [],
    specifications: item.specifications ?? {},
    stock: item.stock,
    weight: item.weight,
    isActive: true,
    maxInstallments,
    installmentPrice,
    ...aggregateFields,
  };

  const product = await prisma.product.upsert({
    where: { sku },
    update: data,
    create: { ...data, sku },
  });

  return { id: product.id, sku: product.sku, name: product.name, category: product.category, imageUrl };
}

// -----------------------------------------------------------------------
// Reviews reais do cliente de teste (1 por produto, dado o
// @@unique([userId, productId]) do model Review)
// -----------------------------------------------------------------------

interface ReviewSeedResult {
  created: number;
  warning?: string;
}

async function seedReviews(seededProducts: readonly SeededProduct[]): Promise<ReviewSeedResult> {
  const customer = await prisma.user.findUnique({ where: { email: TEST_CUSTOMER_EMAIL } });

  if (!customer) {
    const warning = `Cliente de teste (${TEST_CUSTOMER_EMAIL}) não encontrado — reviews de amostra NÃO foram criadas.`;
    console.warn(`  Aviso: ${warning}`);
    return { created: 0, warning };
  }

  const productBySkuSuffix = new Map(seededProducts.map((p) => [p.sku.slice(SKU_PREFIX.length), p]));

  let created = 0;
  for (const item of SAMPLE_PRODUCTS) {
    const fixture = item.reviewFixture;
    if (!fixture) continue;

    const product = productBySkuSuffix.get(item.skuSuffix);
    if (!product) continue; // não deveria acontecer — o produto acabou de ser upsertado

    await prisma.$transaction(async (tx) => {
      await tx.review.upsert({
        where: { userId_productId: { userId: customer.id, productId: product.id } },
        update: {
          rating: fixture.rating,
          comment: fixture.comment,
          userName: customer.name,
          isVerifiedPurchase: true,
        },
        create: {
          userId: customer.id,
          productId: product.id,
          userName: customer.name,
          rating: fixture.rating,
          comment: fixture.comment,
          photos: [],
          isVerifiedPurchase: true,
        },
      });

      // Fonte de verdade dos agregados averageRating/reviewCount — nunca
      // escritos manualmente quando existe review real (ver
      // product-rating-service.ts), para nunca divergir do que a página do
      // produto realmente lista.
      await recalculateProductRatingAggregate(tx, product.id);
    });

    await invalidateProductReviewsCache(product.id);
    created++;
  }

  return { created };
}

// -----------------------------------------------------------------------
// Cupons
// -----------------------------------------------------------------------

const BEMVINDA_CODE = 'BEMVINDA10';
const FRETEFESTA_CODE = 'FRETEFESTA';

async function seedCoupons(): Promise<string[]> {
  const now = new Date();
  const ninetyDaysFromNow = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

  // maxUses/validFrom/validUntil só são definidos na CRIAÇÃO — reexecutar o
  // seed não pode empurrar a janela de validade nem o limite de usos de um
  // cupom que já está rodando em produção.
  const bemVinda = await prisma.coupon.upsert({
    where: { code: BEMVINDA_CODE },
    update: {
      discountType: 'PERCENTAGE',
      discountValue: 10,
      minOrderAmount: 50,
      description: 'Cupom de boas-vindas: 10% de desconto no primeiro pedido.',
      isActive: true,
    },
    create: {
      code: BEMVINDA_CODE,
      discountType: 'PERCENTAGE',
      discountValue: 10,
      maxUses: 100,
      validFrom: now,
      validUntil: ninetyDaysFromNow,
      minOrderAmount: 50,
      description: 'Cupom de boas-vindas: 10% de desconto no primeiro pedido.',
      isActive: true,
    },
  });

  const freteFesta = await prisma.coupon.upsert({
    where: { code: FRETEFESTA_CODE },
    update: {
      discountType: 'FIXED',
      discountValue: 15,
      minOrderAmount: 120,
      description: 'R$ 15 de desconto no frete para pedidos a partir de R$ 120.',
      isActive: true,
    },
    create: {
      code: FRETEFESTA_CODE,
      discountType: 'FIXED',
      discountValue: 15,
      maxUses: null,
      validFrom: null,
      validUntil: null,
      minOrderAmount: 120,
      description: 'R$ 15 de desconto no frete para pedidos a partir de R$ 120.',
      isActive: true,
    },
  });

  return [
    `${bemVinda.code} (10%, pedido mín. R$ 50, 100 usos, válido 90 dias)`,
    `${freteFesta.code} (R$ 15 fixo, pedido mín. R$ 120)`,
  ];
}

// -----------------------------------------------------------------------
// Campanha sazonal — Dia das Crianças (12/10), a próxima data comemorativa
// a partir de hoje. Só banner: SeasonalCampaign não tem relação com
// Product no schema, então não há "produtos vinculados" possível aqui.
// -----------------------------------------------------------------------

const DIA_DAS_CRIANCAS_KEY = 'dia-das-criancas';

async function seedSeasonalCampaign(): Promise<string> {
  const campaign = await prisma.seasonalCampaign.upsert({
    where: { key: DIA_DAS_CRIANCAS_KEY },
    update: { isActive: true },
    create: {
      key: DIA_DAS_CRIANCAS_KEY,
      ribbon: 'Dia das Crianças! Diversão garantida com nossos kits e lembrancinhas 🎈',
      eyebrow: 'Especial Dia das Crianças',
      emoji: '🎈',
      accent: '#eb6464',
      accentText: '#ffffff',
      startMonth: 10,
      startDay: 1,
      endMonth: 10,
      endDay: 12,
      year: null,
      priority: 60,
      isActive: true,
    },
  });

  return `${campaign.key} (ativa, 01/10 a 12/10 — banner apenas, schema não vincula produtos)`;
}

// -----------------------------------------------------------------------
// Remoção (PILOT_SAMPLES=remove)
// -----------------------------------------------------------------------

async function removeGeneratedImages(imageUrls: readonly string[]): Promise<void> {
  for (const url of imageUrls) {
    const filename = url.split('/').pop();
    if (!filename) continue;
    await fs.promises.unlink(path.join(UPLOADS_DIR, filename)).catch(() => undefined);
  }
}

async function removeSamples(): Promise<void> {
  console.log('PILOT_SAMPLES=remove — removendo amostras do piloto...');

  const products = await prisma.product.findMany({
    where: { sku: { startsWith: SKU_PREFIX } },
    select: { id: true, sku: true, images: true },
  });

  let deleted = 0;
  let deactivated = 0;

  for (const product of products) {
    const orderItemCount = await prisma.orderItem.count({ where: { productId: product.id } });

    if (orderItemCount > 0) {
      await prisma.product.update({ where: { id: product.id }, data: { isActive: false } });
      deactivated++;
      console.log(`  Desativado (possui pedido associado): ${product.sku}`);
      continue;
    }

    try {
      await prisma.product.delete({ where: { id: product.id } });
      await removeGeneratedImages(product.images);
      deleted++;
    } catch (err: unknown) {
      // Fallback defensivo: RESTRICT em inventory_logs (P2003) ou qualquer
      // outra referência inesperada não pode derrubar o script inteiro —
      // desativa em vez de excluir.
      await prisma.product
        .update({ where: { id: product.id }, data: { isActive: false } })
        .catch(() => undefined);
      deactivated++;
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`  Não foi possível excluir ${product.sku} (${reason}) — desativado em vez de excluído.`);
    }
  }

  for (const code of [BEMVINDA_CODE, FRETEFESTA_CODE]) {
    const coupon = await prisma.coupon.findUnique({ where: { code } });
    if (!coupon) continue;

    if (coupon.usedCount > 0) {
      await prisma.coupon.update({ where: { code }, data: { isActive: false } });
      console.log(`  Cupom ${code} já foi utilizado — desativado em vez de excluído.`);
    } else {
      await prisma.coupon.delete({ where: { code } });
      console.log(`  Cupom ${code} removido.`);
    }
  }

  await cacheInvalidatePattern('products:*');
  await cacheDelete(SITEMAP_CACHE_KEY);

  console.log(
    `Remoção concluída: ${deleted} produto(s) excluído(s), ${deactivated} desativado(s) (possuíam pedido ou não puderam ser excluídos).`,
  );
}

// -----------------------------------------------------------------------
// main
// -----------------------------------------------------------------------

async function main(): Promise<void> {
  if (process.env['PILOT_SAMPLES'] === 'remove') {
    await removeSamples();
    return;
  }

  console.log('Seed de amostras do piloto — iniciando...');
  await fs.promises.mkdir(UPLOADS_DIR, { recursive: true });

  const seededProducts: SeededProduct[] = [];
  for (let index = 0; index < SAMPLE_PRODUCTS.length; index++) {
    const item = SAMPLE_PRODUCTS[index];
    if (!item) continue;
    seededProducts.push(await upsertSampleProduct(item, index));
  }

  const reviewResult = await seedReviews(seededProducts);
  const couponSummaries = await seedCoupons();
  const campaignSummary = await seedSeasonalCampaign();

  await cacheInvalidatePattern('products:*');
  await cacheDelete(SITEMAP_CACHE_KEY);

  const distinctCategories = new Set(seededProducts.map((p) => p.category));
  const missingCategories = EXPECTED_CATEGORIES.filter((category) => !distinctCategories.has(category));
  const sampleImage = seededProducts[0]?.imageUrl ?? '(nenhum produto criado)';

  console.log('');
  console.log('Resumo do seed de amostras:');
  console.log(`  Produtos: ${seededProducts.length} (${distinctCategories.size}/12 categorias cobertas)`);
  if (missingCategories.length > 0) {
    console.warn(`  Aviso: categorias sem produto de amostra: ${missingCategories.join(', ')}`);
  }
  console.log(
    `  Reviews: ${reviewResult.created} criada(s)/atualizada(s)${reviewResult.warning ? ` — ${reviewResult.warning}` : ''}`,
  );
  console.log(`  Cupons: ${couponSummaries.join(' | ')}`);
  console.log(`  Campanha sazonal: ${campaignSummary}`);
  console.log(`  Imagem de exemplo (conferir no navegador): ${sampleImage}`);
  console.log('Seed de amostras concluído.');
}

main()
  .catch((err: unknown) => {
    console.error('Seed de amostras falhou:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
    await disconnectRedis();
  });
