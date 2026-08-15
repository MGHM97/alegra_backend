export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number, code: string, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, 'RESOURCE_NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403, 'FORBIDDEN');
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'VALIDATION_ERROR');
  }
}

export class InsufficientStockError extends AppError {
  constructor(productId: string, available: number, requested: number) {
    super(
      `Insufficient stock for product ${productId}: available=${available}, requested=${requested}`,
      409,
      'INSUFFICIENT_STOCK',
    );
  }
}

export class IdempotencyConflictError extends AppError {
  constructor() {
    super('Request already processed with this idempotency key', 409, 'IDEMPOTENCY_CONFLICT');
  }
}

export type CouponErrorCode =
  | 'COUPON_NOT_FOUND'
  | 'COUPON_INACTIVE'
  | 'COUPON_EXPIRED'
  | 'COUPON_NOT_YET_VALID'
  | 'COUPON_MAX_USES'
  | 'COUPON_MIN_ORDER';

export class CouponError extends AppError {
  constructor(message: string, code: CouponErrorCode, statusCode = 422) {
    super(message, statusCode, code);
  }
}

export class ReviewNotVerifiedPurchaseError extends AppError {
  constructor() {
    super(
      'Você precisa comprar e receber este produto para avaliá-lo.',
      403,
      'REVIEW_NOT_VERIFIED_PURCHASE',
    );
  }
}

export class ReviewAlreadyExistsError extends AppError {
  constructor() {
    super('Você já avaliou este produto.', 409, 'REVIEW_ALREADY_EXISTS');
  }
}

export class InvalidPasswordError extends AppError {
  constructor() {
    super('Senha incorreta.', 401, 'INVALID_PASSWORD');
  }
}

export class AccountAlreadyDeletedError extends AppError {
  constructor() {
    super('Esta conta já foi excluída.', 409, 'ACCOUNT_ALREADY_DELETED');
  }
}

export class PriceMismatchError extends AppError {
  constructor() {
    super(
      'O preço deste produto foi atualizado. Atualize seu carrinho e tente novamente.',
      409,
      'PRICE_MISMATCH',
    );
  }
}

/**
 * Lançado quando um update atômico (updateMany com filtro de status) não
 * afeta nenhuma linha — ou seja, o pedido já transicionou para outro status
 * entre a leitura e a escrita (corrida entre cancelamento/estorno/atualização
 * concorrentes). Indica ao chamador que a operação não é mais válida.
 */
export class OrderStateConflictError extends AppError {
  constructor(message = 'O pedido foi alterado por outra operação. Recarregue e tente novamente.') {
    super(message, 409, 'ORDER_STATE_CONFLICT');
  }
}
