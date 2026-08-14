export type PageResult<T> = { data: T[] | null; error: unknown | null };

/** Retrieve a complete deterministic PostgREST result instead of silently stopping at its row cap. */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await fetchPage(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data || [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
