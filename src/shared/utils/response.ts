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
): ListResponse<T> {
  return {
    status: 'success',
    data,
    meta: { cursor, hasMore },
  };
}
