import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VARIANTS = [
  'Nubank Ultravioleta',
  'Santander Unique',
  'Itaú Personnalité',
  'C6 Carbon',
  'Nubank Gold',
  'Inter',
];

async function main(): Promise<void> {
  const cards = await prisma.savedCard.findMany({
    select: { id: true },
    orderBy: { createdAt: 'asc' },
  });
  let i = 0;
  for (const c of cards) {
    await prisma.savedCard.update({
      where: { id: c.id },
      data: { issuer: VARIANTS[i % VARIANTS.length] },
    });
    i++;
  }
  console.log(`Cartões atualizados com variantes: ${cards.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
