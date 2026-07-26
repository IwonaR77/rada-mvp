// Supabase/PostgREST enforces a server-side max-rows cap that a single
// request's .range() cannot exceed, no matter how wide a range you ask
// for — a single `.range(0, 9999)` call silently truncates at whatever
// that cap actually is. The only reliable fix is paging through results
// until a page comes back shorter than requested (end of data), not
// guessing the cap's exact value.
export async function fetchAllRows<T>(
  // PromiseLike, not Promise — Supabase's query builders are thenable but
  // aren't typed as Promise<...> until awaited.
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }

  return all;
}
