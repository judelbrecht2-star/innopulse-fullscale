// Keep backend reads complete under the Data API row cap. A fresh builder is
// required for each page; the stable ID order prevents ties from moving rows.
export async function checked(query) {
  const result = await query;
  if (result.error) throw new Error("Database operation failed.");
  return result;
}

export async function readAll(makeQuery) {
  const rows = [];
  let offset = 0;
  while (true) {
    const { data } = await checked(makeQuery().order("id", { ascending: true }).range(offset, offset + 499));
    if (!Array.isArray(data)) throw new Error("Database returned an invalid row set.");
    if (!data.length) return { data: rows };
    rows.push(...data);
    // Continue after short pages too: the server's configured cap may be
    // smaller than our requested range. Only an empty page ends the read.
    offset += data.length;
  }
}
