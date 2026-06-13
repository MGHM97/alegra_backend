/**
 * Busca fotos reais e relevantes no Pexels por produto e atualiza o banco.
 *
 * - Cada categoria tem uma query EN; buscamos um pool e distribuímos fotos
 *   distintas entre os produtos da categoria (sem repetir).
 * - Nomes distintos (dinossauro, unicórnio, pirata, safari, princesa…) têm
 *   query dedicada para precisão.
 *
 * A chave NÃO fica no código: passe via env.
 *   PEXELS_KEY=xxxxx yarn tsx prisma/pexels-product-images.ts
 *
 * Fallback no cliente: placeholder SVG da marca (utils/imageFallback.ts).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const KEY = process.env.PEXELS_KEY;

const CATEGORY_QUERY: Record<string, string> = {
  'baloes': 'party balloons colorful',
  'boleira-bandejas': 'cake stand dessert table',
  'confeitaria': 'cupcakes baking sweets',
  'bomboniere': 'candy sweets colorful',
  'descartaveis': 'party tableware plates cups',
  'papelaria': 'party invitation stationery',
  'topos-de-bolo': 'birthday cake topper',
  'velas': 'birthday candles cake',
  'lembrancinhas': 'party favors gift boxes',
  'lanca-confetes': 'confetti celebration party',
  'cortinas-metalizadas': 'party backdrop foil decoration',
  'kits-festa': 'party decoration celebration',
};

const NAME_OVERRIDES: { match: RegExp; query: string }[] = [
  { match: /dinossauro|dino/i, query: 'dinosaur toy party' },
  { match: /unic[oó]rnio/i, query: 'unicorn party' },
  { match: /pirata/i, query: 'pirate party kids' },
  { match: /circo/i, query: 'circus carnival' },
  { match: /safari|selva|jungle/i, query: 'safari animals jungle' },
  { match: /sereia/i, query: 'mermaid party' },
  { match: /princesa/i, query: 'princess party pink' },
  { match: /flamingo/i, query: 'flamingo tropical party' },
  { match: /tropical|havai/i, query: 'tropical luau party' },
  { match: /churrasco|boteco/i, query: 'barbecue grill skewers' },
  { match: /fantasia/i, query: 'costume party celebration' },
  { match: /futebol|copa|sele[cç][aã]o/i, query: 'soccer football party' },
];

interface PexelsPhoto {
  src: { original: string };
}

function squareUrl(original: string, size: number): string {
  return `${original}?auto=compress&cs=tinysrgb&fit=crop&w=${size}&h=${size}`;
}

async function search(query: string, perPage: number): Promise<string[]> {
  const url = `https://api.pexels.com/v1/search?query=${encodeURIComponent(
    query,
  )}&per_page=${perPage}&orientation=square`;
  const res = await fetch(url, { headers: { Authorization: KEY ?? '' } });
  if (!res.ok) {
    console.warn(`Pexels ${res.status} para "${query}"`);
    return [];
  }
  const data = (await res.json()) as { photos: PexelsPhoto[] };
  return data.photos.map((p) => p.src.original);
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error('Defina PEXELS_KEY no ambiente.');
    process.exitCode = 1;
    return;
  }

  const products = await prisma.product.findMany({
    select: { id: true, slug: true, category: true, name: true },
  });

  // Pré-busca pools por categoria (1 request cada).
  const categories = [...new Set(products.map((p) => p.category))];
  const pools = new Map<string, string[]>();
  for (const cat of categories) {
    const q = CATEGORY_QUERY[cat] ?? 'party celebration';
    pools.set(cat, await search(q, 20));
  }

  // Cache de queries de override.
  const overrideCache = new Map<string, string[]>();

  const catCursor = new Map<string, number>();
  let updated = 0;
  let placeholders = 0;

  for (const p of products) {
    let originals: string[] = [];

    const ov = NAME_OVERRIDES.find((o) => o.match.test(p.name));
    if (ov) {
      if (!overrideCache.has(ov.query)) {
        overrideCache.set(ov.query, await search(ov.query, 10));
      }
      originals = overrideCache.get(ov.query) ?? [];
    }

    if (originals.length === 0) {
      const pool = pools.get(p.category) ?? [];
      const idx = catCursor.get(p.category) ?? 0;
      catCursor.set(p.category, idx + 1);
      if (pool.length > 0) {
        originals = [pool[idx % pool.length]!, pool[(idx + 1) % pool.length]!];
      }
    }

    if (originals.length === 0) {
      placeholders++;
      continue; // mantém o que está; cliente cai no placeholder se falhar
    }

    const primary = originals[0]!;
    const secondary = originals[1] ?? originals[0]!;
    await prisma.product.update({
      where: { id: p.id },
      data: {
        thumbnailUrl: squareUrl(primary, 800),
        images: [squareUrl(primary, 1200), squareUrl(secondary, 1200)],
      },
    });
    updated++;
  }

  console.log(`✅ Pexels: ${updated} produtos atualizados (${placeholders} sem foto → placeholder).`);
}

main()
  .catch((err) => {
    console.error('Falha:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
