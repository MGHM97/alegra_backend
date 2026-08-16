/**
 * Seed do PILOTO — cria SOMENTE as contas necessárias para operar/testar o
 * ambiente de produção do piloto: um admin e um cliente de teste com um
 * endereço em Manaus (agiliza smoke test de checkout/frete local). NÃO cria
 * produtos, pedidos nem reviews — isso é feito manualmente pelo admin
 * (ver deploy/DEPLOY.md, checklist de smoke test).
 *
 * Idempotente: upsert por e-mail. Em re-execuções, a senha só é
 * sobrescrita se PILOT_RESET_PASSWORDS=true — caso contrário o script
 * detecta a conta existente e não mexe na senha (evita derrubar uma senha
 * já trocada manualmente pelo dono do admin).
 *
 * Uso (local):
 *   PILOT_ADMIN_EMAIL=admin@... PILOT_ADMIN_PASSWORD=... \
 *   PILOT_USER_EMAIL=cliente@... PILOT_USER_PASSWORD=... \
 *   yarn seed:pilot
 *
 * Uso (deploy, ver deploy/DEPLOY.md): as variáveis PILOT_* vêm do .env do
 * backend, e o script roda via `docker compose run --rm migrate yarn seed:pilot`.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// Mesmo custo usado em src/shared/utils/password.ts (min recomendado pelo
// checklist de segurança do projeto). Não importamos env.ts aqui de
// propósito: env.ts exige STRIPE_*/SMTP_* completos (inclusive as
// validações extras de produção), e este script deve poder rodar mesmo
// antes de todo o resto do .env estar 100% finalizado.
const BCRYPT_ROUNDS = 12;
const MIN_PASSWORD_LENGTH = 12;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PilotAccountConfig {
  readonly envLabel: string;
  readonly email: string;
  readonly password: string;
  readonly username: string;
  readonly name: string;
  readonly role: 'ADMIN' | 'CUSTOMER';
}

function readRequiredEnv(varName: string): string {
  const raw = process.env[varName];
  const value = raw?.trim();
  if (!value) {
    throw new Error(
      `${varName} não definida. Defina-a no .env antes de rodar 'yarn seed:pilot' (ver .env.production.example).`,
    );
  }
  return value;
}

function validateAccountConfig(config: {
  envLabel: string;
  emailVarName: string;
  passwordVarName: string;
  username: string;
  name: string;
  role: 'ADMIN' | 'CUSTOMER';
}): PilotAccountConfig {
  const email = readRequiredEnv(config.emailVarName).toLowerCase();
  const password = readRequiredEnv(config.passwordVarName);

  if (!EMAIL_REGEX.test(email)) {
    throw new Error(`${config.emailVarName}='${email}' não parece um e-mail válido.`);
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `${config.passwordVarName} tem menos de ${MIN_PASSWORD_LENGTH} caracteres. ` +
        `Gere uma senha forte, ex.: openssl rand -base64 18`,
    );
  }

  return {
    envLabel: config.envLabel,
    email,
    password,
    username: config.username,
    name: config.name,
    role: config.role,
  };
}

async function upsertPilotUser(config: PilotAccountConfig, resetPasswords: boolean): Promise<{ id: string; created: boolean; passwordUpdated: boolean }> {
  const existing = await prisma.user.findUnique({ where: { email: config.email } });

  if (!existing) {
    const passwordHash = await bcrypt.hash(config.password, BCRYPT_ROUNDS);
    const created = await prisma.user.create({
      data: {
        email: config.email,
        username: config.username,
        passwordHash,
        name: config.name,
        role: config.role,
        isActive: true,
      },
    });
    return { id: created.id, created: true, passwordUpdated: true };
  }

  const updateData: { role: 'ADMIN' | 'CUSTOMER'; name: string; isActive: true; passwordHash?: string } = {
    role: config.role,
    name: config.name,
    isActive: true,
  };

  if (resetPasswords) {
    updateData.passwordHash = await bcrypt.hash(config.password, BCRYPT_ROUNDS);
  }

  await prisma.user.update({ where: { id: existing.id }, data: updateData });
  return { id: existing.id, created: false, passwordUpdated: resetPasswords };
}

async function ensurePilotAddress(userId: string, recipientName: string): Promise<boolean> {
  const existingCount = await prisma.address.count({ where: { userId } });
  if (existingCount > 0) {
    return false;
  }

  await prisma.address.create({
    data: {
      userId,
      label: 'Casa',
      street: 'Rua 26 de Agosto',
      number: '601',
      complement: null,
      neighborhood: 'Cidade Nova',
      city: 'Manaus',
      state: 'AM',
      zipCode: '69095-187',
      additionalInfo: 'Endereço de teste do piloto — checkout/frete local (Manaus)',
      addressType: 'HOME',
      recipientName,
      recipientPhone: '92999998888',
      isDefault: true,
    },
  });
  return true;
}

async function main(): Promise<void> {
  const resetPasswords = process.env.PILOT_RESET_PASSWORDS === 'true';

  const adminConfig = validateAccountConfig({
    envLabel: 'admin do piloto',
    emailVarName: 'PILOT_ADMIN_EMAIL',
    passwordVarName: 'PILOT_ADMIN_PASSWORD',
    username: 'piloto_admin',
    name: 'Admin Alegra Festas (Piloto)',
    role: 'ADMIN',
  });

  const userConfig = validateAccountConfig({
    envLabel: 'cliente de teste do piloto',
    emailVarName: 'PILOT_USER_EMAIL',
    passwordVarName: 'PILOT_USER_PASSWORD',
    username: 'piloto_cliente',
    name: 'Cliente Teste (Piloto)',
    role: 'CUSTOMER',
  });

  if (adminConfig.email === userConfig.email) {
    throw new Error('PILOT_ADMIN_EMAIL e PILOT_USER_EMAIL não podem ser o mesmo e-mail.');
  }

  console.log('Seed do piloto — iniciando...');
  if (resetPasswords) {
    console.log('  PILOT_RESET_PASSWORDS=true: senhas de contas já existentes SERÃO sobrescritas.');
  }

  const adminResult = await upsertPilotUser(adminConfig, resetPasswords);
  console.log(
    `  Admin (${adminConfig.email} / username '${adminConfig.username}'): ` +
      `${adminResult.created ? 'criado' : 'já existia'}` +
      `${adminResult.passwordUpdated ? ' — senha definida a partir de PILOT_ADMIN_PASSWORD' : ' — senha mantida (defina PILOT_RESET_PASSWORDS=true para trocar)'}.`,
  );

  const userResult = await upsertPilotUser(userConfig, resetPasswords);
  console.log(
    `  Cliente de teste (${userConfig.email} / username '${userConfig.username}'): ` +
      `${userResult.created ? 'criado' : 'já existia'}` +
      `${userResult.passwordUpdated ? ' — senha definida a partir de PILOT_USER_PASSWORD' : ' — senha mantida (defina PILOT_RESET_PASSWORDS=true para trocar)'}.`,
  );

  const addressCreated = await ensurePilotAddress(userResult.id, userConfig.name);
  console.log(
    addressCreated
      ? '  Endereço de teste (Manaus, Cidade Nova) criado para o cliente de teste.'
      : '  Cliente de teste já possui endereço(s) cadastrado(s) — nenhum endereço criado.',
  );

  console.log('Seed do piloto concluído. Nenhum produto/pedido/review foi criado por este script.');
}

main()
  .catch((e: unknown) => {
    console.error('Seed do piloto falhou:', e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
