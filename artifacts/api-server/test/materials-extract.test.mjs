import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import express from "express";
import { db, classscribeLegacyDocumentsTable } from "@workspace/db";
import materialsExtractRouter from "../src/routes/classscribe-materials-extract.ts";

const hash = (value) => createHash("sha256").update(value).digest("hex");

function makePdf(content) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

async function withServer(run) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { error() {} }; next(); });
  app.use("/api", materialsExtractRouter);
  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise((resolve) => server.once("listening", resolve));
    await run(`http://127.0.0.1:${server.address().port}/api`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function postFile(base, uid, bytes, contentType = "text/plain") {
  return fetch(`${base}/materials/extract`, {
    method: "POST",
    headers: { "X-CS-User": uid, "Content-Type": contentType },
    body: bytes,
  });
}

test("materials extraction returns capped text and leaves the saved import to private legacy notes", async () => {
  const uid = `u_${randomUUID().replaceAll("-", "")}`;
  const noteId = randomUUID();
  const notePath = `data/users/${uid}/lib/notes/${noteId}`;
  const noteBody = "A".repeat(30_001);
  const paths = [notePath];
  await withServer(async (base) => {
    try {
      const plain = await postFile(base, uid, Buffer.from(noteBody), "text/plain; charset=utf-8");
      assert.equal(plain.status, 200);
      assert.deepEqual(await plain.json(), {
        text: noteBody.slice(0, 30_000),
        truncated: true,
        originalLength: 30_001,
      });

      const markdown = await postFile(base, uid, Buffer.from("# Study notes\n\nUTF-8: café"), "text/plain");
      assert.equal(markdown.status, 200);
      assert.equal((await markdown.json()).text, "# Study notes\n\nUTF-8: café");

      const pdf = await postFile(base, uid, makePdf("BT /F1 18 Tf 20 90 Td (PDF words) Tj ET"), "application/pdf");
      assert.equal(pdf.status, 200);
      assert.match((await pdf.json()).text, /PDF words/);

      const now = new Date().toISOString();
      const imported = {
        id: noteId,
        courseId: "",
        lectureId: "",
        title: "Imported reading",
        body: noteBody.slice(0, 30_000),
        sourceType: "reading",
        sourceName: "reading.md",
        created: now,
        updated: now,
        pinned: false,
      };
      await db.insert(classscribeLegacyDocumentsTable).values({ path: notePath, data: imported });
      const [stored] = await db.select({ data: classscribeLegacyDocumentsTable.data })
        .from(classscribeLegacyDocumentsTable).where(eq(classscribeLegacyDocumentsTable.path, notePath));
      assert.deepEqual(stored.data, imported);
      assert.equal(JSON.stringify(stored.data).includes("%PDF-"), false);
      assert.equal(plain.headers.get("cache-control"), "private, no-store");
    } finally {
      await db.delete(classscribeLegacyDocumentsTable)
        .where(inArray(classscribeLegacyDocumentsTable.path, paths));
    }
  });
});

test("materials extraction rejects unauthorized, revoked, oversized, mismatched, malformed, and scanned uploads", async () => {
  const uid = `u_${randomUUID().replaceAll("-", "")}`;
  const revokedUid = `u_${randomUUID().replaceAll("-", "")}`;
  const revokedPath = `revoked/${hash(revokedUid)}`;
  try {
    await db.insert(classscribeLegacyDocumentsTable).values({ path: revokedPath, data: { revoked: true } });
    await withServer(async (base) => {
      assert.equal((await postFile(base, "invalid", Buffer.from("text"))).status, 403);
      assert.equal((await postFile(base, revokedUid, Buffer.from("text"))).status, 403);
      assert.equal((await postFile(base, uid, Buffer.alloc(0))).status, 400);
      assert.equal((await postFile(base, uid, Buffer.from([0xff, 0xfe]))).status, 400);
      assert.equal((await postFile(base, uid, Buffer.alloc(8 * 1024 * 1024 + 1))).status, 413);
      assert.equal((await postFile(base, uid, Buffer.from("not a pdf"), "application/pdf")).status, 415);
      assert.equal((await postFile(base, uid, Buffer.from("%PDF-broken"), "application/pdf")).status, 400);
      const scanned = await postFile(base, uid, makePdf("BT /F1 18 Tf 20 90 Td () Tj ET"), "application/pdf");
      assert.equal(scanned.status, 422, JSON.stringify(await scanned.json()));
      assert.equal((await postFile(base, uid, Buffer.from("%PDF-1.4"), "text/plain")).status, 415);
    });
  } finally {
    await db.delete(classscribeLegacyDocumentsTable)
      .where(inArray(classscribeLegacyDocumentsTable.path, [revokedPath]));
  }
});