export interface SuccessResponse<T> {
  status: 'success';
  data: T;
}

export interface ErrorResponse {
  status: 'error';
  message: string;
  code: string;
}

export interface ListResponse<T> {
  status: 'success';
  data: T[];
  meta: {
    cursor: string | null;
    hasMore: boolean;
    // Opcional: só GET /v1/products preenche hoje ("Mostrando N de M").
    // Omitido (não `undefined` explícito) para outros listResponse() —
    // count com os mesmos filtros custa uma query extra, só vale a pena
    // onde o front realmente exibe o total.
    total?: number;
  };
}

export function successResponse<T>(data: T): SuccessResponse<T> {
  return { status: 'success', data };
}

export function errorResponse(message: string, code: string): ErrorResponse {
  return { status: 'error', message, code };
}

export function listResponse<T>(
  data: T[],
  cursor: string | null,
  hasMore: boolean,
  total?: number,
): ListResponse<T> {
  return {
    status: 'success',
    data,
    meta: total === undefined ? { cursor, hasMore } : { cursor, hasMore, total },
  };
}
