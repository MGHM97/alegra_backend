/**
 * Atualiza as imagens dos produtos para fotos reais e relevantes por categoria,
 * servidas pelo CDN do Unsplash (images.unsplash.com) — confiável e raramente
 * bloqueado (ao contrário de loremflickr/unsplash-source). IDs verificados.
 *
 * Rodar: yarn tsx prisma/update-product-images.ts
 *
 * Se uma imagem ainda assim falhar no cliente, o frontend cai num placeholder
 * SVG da marca com ícone da categoria (ver utils/imageFallback.ts).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Cada categoria → fotos reais (Unsplash photo IDs verificados, 200 OK).
const CATEGORY_PHOTOS: Record<string, string[]> = {
  'baloes': ['1530103862676-de8c9debad1d', '1492684223066-81342ee5ff30'],
  'boleira-bandejas': ['1464349095431-e9a21285b5f3', '1578985545062-69928b1d9587'],
  'confeitaria': ['1578985545062-69928b1d9587', '1464349095431-e9a21285b5f3'],
  'topos-de-bolo': ['1464349095431-e9a21285b5f3', '1578985545062-69928b1d9587'],
  'bomboniere': ['1499195333224-3ce974eecb47', '1582058091505-f87a2e55a40f'],
  'descartaveis': ['1414235077428-338989a2e8c0', '1555244162-803834f70033'],
  'papelaria': ['1586281380349-632531db7ed4'],
  'velas': ['1578985545062-69928b1d9587', '1464349095431-e9a21285b5f3'],
  'lembrancinhas': ['1513885535751-8b9238bd345a', '1607344645866-009c320b63e0'],
  'lanca-confetes': ['1513151233558-d860c5398176', '1492684223066-81342ee5ff30'],
  'cortinas-metalizadas': ['1492684223066-81342ee5ff30', '1513151233558-d860c5398176'],
  'kits-festa': ['1527529482837-4698179dc6ce', '1530103862676-de8c9debad1d'],
};

const FALLBACK = ['1530103862676-de8c9debad1d', '1527529482837-4698179dc6ce'];

// Overrides por palavra-chave no NOME do produto (mais precisos que a categoria).
// IDs verificados. Adicionar mais conforme novas fotos confiáveis forem achadas.
const NAME_OVERRIDES: { match: RegExp; ids: string[] }[] = [
  { match: /dinossauro|dino/i, ids: ['1606856110002-d0991ce78250'] },
  { match: /safari/i, ids: ['1547721064-da6cfb341d50'] },
  { match: /churrasco|boteco|bbq/i, ids: ['1555939594-58d7cb561ad1'] },
];

function hash(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

function img(id: string, size: number): string {
  return `https://images.unsplash.com/photo-${id}?w=${size}&h=${size}&fit=crop&q=80`;
}

async function main(): Promise<void> {
  const products = await prisma.product.findMany({
    select: { id: true, slug: true, category: true, name: true },
  });

  let updated = 0;
  for (const p of products) {
    const override = NAME_OVERRIDES.find((o) => o.match.test(p.name));
    const pool = override?.ids ?? CATEGORY_PHOTOS[p.category] ?? FALLBACK;
    const h = hash(p.slug);
    // Rotaciona o ponto de partida por produto, para variar dentro da categoria.
    const primary = pool[h % pool.length]!;
    const secondary = pool[(h + 1) % pool.length]!;

    const thumbnailUrl = img(primary, 800);
    const images = [img(primary, 1200), img(secondary, 1200)];

    await prisma.product.update({
      where: { id: p.id },
      data: { thumbnailUrl, images },
    });
    updated++;
  }

  console.log(`✅ Imagens (Unsplash) atualizadas em ${updated} produtos.`);
}

main()
  .catch((err) => {
    console.error('Falha ao atualizar imagens:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
