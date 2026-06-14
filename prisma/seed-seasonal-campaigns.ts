/**
 * Seed pontual: insere as 8 campanhas sazonais portadas do frontend.
 * Execução segura: usa `skipDuplicates` para ser idempotente.
 * Comando: tsx prisma/seed-seasonal-campaigns.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log('Seeding seasonal campaigns...');

  const result = await prisma.seasonalCampaign.createMany({
    skipDuplicates: true,
    data: [
      {
        key: 'copa-2026',
        ribbon:
          'É Copa! Monte a festa da torcida com kits, balões e decoração nas cores do Brasil 🇧🇷',
        eyebrow: 'Especial Copa do Mundo 2026',
        emoji: '⚽',
        accent: '#019d9c',
        accentText: '#ffffff',
        startMonth: 6,
        startDay: 1,
        endMonth: 7,
        endDay: 20,
        year: 2026,
        priority: 100,
        isActive: true,
      },
      {
        key: 'festa-junina',
        ribbon: 'Arraiá chegando! Bandeirinhas, chapéus e tudo para o São João 🔥',
        eyebrow: 'Especial Festa Junina',
        emoji: '🎉',
        accent: '#d44848',
        accentText: '#ffffff',
        startMonth: 6,
        startDay: 1,
        endMonth: 6,
        endDay: 30,
        year: null,
        priority: 50,
        isActive: true,
      },
      {
        key: 'dia-dos-pais',
        ribbon: 'Dia dos Pais: celebre o melhor pai do mundo com a Alegra 👔',
        eyebrow: 'Especial Dia dos Pais',
        emoji: '👔',
        accent: '#018180',
        accentText: '#ffffff',
        startMonth: 8,
        startDay: 1,
        endMonth: 8,
        endDay: 14,
        year: null,
        priority: 60,
        isActive: true,
      },
      {
        key: 'dia-das-criancas',
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
      {
        key: 'natal',
        ribbon: 'Natal Alegra: decore sua ceia com magia e brilho 🎄',
        eyebrow: 'Especial de Natal',
        emoji: '🎄',
        accent: '#b33838',
        accentText: '#ffffff',
        startMonth: 12,
        startDay: 1,
        endMonth: 12,
        endDay: 25,
        year: null,
        priority: 70,
        isActive: true,
      },
      {
        key: 'ano-novo',
        ribbon: 'Réveillon! Tudo para virar o ano com muito brilho e festa 🎆',
        eyebrow: 'Réveillon & Ano Novo',
        emoji: '🎆',
        accent: '#bf8520',
        accentText: '#ffffff',
        startMonth: 12,
        startDay: 26,
        endMonth: 1,
        endDay: 6,
        year: null,
        priority: 80,
        isActive: true,
      },
      {
        key: 'carnaval',
        ribbon: 'Carnaval! Máscaras, confetes e adereços para cair na folia 🎭',
        eyebrow: 'Especial de Carnaval',
        emoji: '🎭',
        accent: '#019d9c',
        accentText: '#ffffff',
        startMonth: 2,
        startDay: 1,
        endMonth: 2,
        endDay: 20,
        year: null,
        priority: 60,
        isActive: true,
      },
      {
        key: 'pascoa',
        ribbon: 'Páscoa Alegra: doces, cestas e decoração para celebrar 🐰',
        eyebrow: 'Especial de Páscoa',
        emoji: '🐰',
        accent: '#e5a83a',
        accentText: '#241f1d',
        startMonth: 3,
        startDay: 25,
        endMonth: 4,
        endDay: 15,
        year: null,
        priority: 60,
        isActive: true,
      },
    ],
  });

  console.log(`  ${result.count} campanhas sazonais inseridas (${8 - result.count} já existiam).`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error('Seed de campanhas sazonais falhou:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
