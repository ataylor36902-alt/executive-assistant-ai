import { Storage, type File } from "@google-cloud/storage";
import { Client as ReplitObjectStorageClient } from "@replit/object-storage";

const sidecar = "http://127.0.0.1:1106";
export const objectStorageClient = new Storage({
  credentials: {
    audience: "replit", subject_token_type: "access_token",
    token_url: `${sidecar}/token`, type: "external_account",
    credential_source: { url: `${sidecar}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  } as never,
  projectId: "",
});
export class ObjectNotFoundError extends Error {}
function parsePath(path: string) {
  const clean = path.replace(/^\/+/, "");
  const slash = clean.indexOf("/");
  return { bucket: clean.slice(0, slash), object: clean.slice(slash + 1) };
}
export class ObjectStorageService {
  private client = new ReplitObjectStorageClient({
    bucketId: process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID,
  });
  private dir() {
    const dir = process.env.PRIVATE_OBJECT_DIR;
    if (!dir) throw new Error("PRIVATE_OBJECT_DIR is not configured");
    return dir.replace(/^\/+|\/+$/g, "");
  }
  async uploadObject(path: string, contents: Buffer, contentType: string) {
    const fullPath = `${this.dir()}/${path.replace(/^\/objects\//, "")}`;
    const { bucket, object } = parsePath(fullPath);
    const result = await this.client.uploadFromBytes(object, contents);
    if (!result.ok) throw new Error(result.error.message);
    await objectStorageClient.bucket(bucket).file(object).setMetadata({ contentType });
  }
  normalizeObjectEntityPath(raw: string) {
    if (raw.startsWith("/objects/")) return raw;
    const url = new URL(raw);
    const prefix = `/${this.dir()}/`;
    return url.pathname.startsWith(prefix) ? `/objects/${url.pathname.slice(prefix.length)}` : raw;
  }
  async getObjectEntityFile(path: string): Promise<File> {
    if (!path.startsWith("/objects/")) throw new ObjectNotFoundError("Invalid object path");
    const { bucket, object } = parsePath(`${this.dir()}/${path.slice("/objects/".length)}`);
    const file = objectStorageClient.bucket(bucket).file(object);
    const [exists] = await file.exists();
    if (!exists) throw new ObjectNotFoundError("Object not found");
    return file;
  }
  async deleteObject(path: string) {
    if (!path.startsWith("/objects/")) throw new ObjectNotFoundError("Invalid object path");
    const relativePath = path.slice("/objects/".length);
    if (!relativePath || relativePath.split("/").some(part => !part || part === "." || part === "..")) {
      throw new ObjectNotFoundError("Invalid object path");
    }
    const { bucket, object } = parsePath(`${this.dir()}/${relativePath}`);
    await objectStorageClient.bucket(bucket).file(object).delete({ ignoreNotFound: true });
  }
  async getObjectMetadata(path: string) {
    const file = await this.getObjectEntityFile(path);
    const [metadata] = await file.getMetadata();
    return { file, size: Number(metadata.size ?? 0), contentType: metadata.contentType ?? "" };
  }
}