import { getSql, closeDb } from './src/db/client';
const sql = getSql();
for (let i = 0; i < 60; i++) {
  try {
    const [r] = await sql<any[]>`SELECT (SELECT count(*) FROM sources)::text s,
                                        (SELECT count(*) FROM chunks)::text c`;
    console.log(`DB UP after ${i * 15}s — sources ${r.s} · chunks ${r.c}`);
    break;
  } catch {
    await new Promise((res) => setTimeout(res, 15000));
  }
}
await closeDb();
