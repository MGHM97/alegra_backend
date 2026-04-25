import type { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { listResponse, successResponse } from '../../shared/utils/response.js';
import { NotFoundError } from '../../domain/errors/app-error.js';

export async function listAdminUsersHandler(
  request: FastifyRequest<{
    Querystring: { search?: string; cursor?: string; limit?: string };
  }>,
  reply: FastifyReply,
): Promise<void> {
  const search = request.query.search?.trim();
  const cursor = request.query.cursor;
  const limit = Math.min(Math.max(parseInt(request.query.limit ?? '20', 10) || 20, 1), 100);

  const where: Prisma.UserWhereInput = {};

  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
    ];
  }

  const take = limit + 1;

  const users = await prisma.user.findMany({
    where,
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      _count: { select: { orders: true } },
    },
  });

  const hasMore = users.length > limit;
  const items = hasMore ? users.slice(0, limit) : users;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.id : null;

  const serialized = items.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    createdAt: user.createdAt.toISOString(),
    orderCount: user._count.orders,
  }));

  void reply.status(200).send(listResponse(serialized, nextCursor, hasMore));
}

export async function toggleUserStatusHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: { isActive: boolean } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) {
    throw new NotFoundError('User');
  }

  const updated = await prisma.user.update({
    where: { id },
    data: { isActive: request.body.isActive },
    select: {
      id: true,
      name: true,
      email: true,
      username: true,
      role: true,
      isActive: true,
      createdAt: true,
      _count: { select: { orders: true } },
    },
  });

  void reply.status(200).send(successResponse({
    id: updated.id,
    name: updated.name,
    email: updated.email,
    username: updated.username,
    role: updated.role,
    isActive: updated.isActive,
    createdAt: updated.createdAt.toISOString(),
    orderCount: updated._count.orders,
  }));
}
