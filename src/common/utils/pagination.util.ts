export const MAX_PAGINATION_LIMIT = 200;

export function normalizePagination(
  page?: number | string,
  limit?: number | string,
  defaultLimit = 10,
  maxLimit = MAX_PAGINATION_LIMIT,
): { page: number; limit: number } {
  const parsedPage = Number(page);
  const parsedLimit = Number(limit);

  const safePage = Number.isFinite(parsedPage) && parsedPage >= 1 ? Math.floor(parsedPage) : 1;
  const safeLimit =
    Number.isFinite(parsedLimit) && parsedLimit >= 1
      ? Math.min(Math.floor(parsedLimit), maxLimit)
      : defaultLimit;

  return { page: safePage, limit: safeLimit };
}
