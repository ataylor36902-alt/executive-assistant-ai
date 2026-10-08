import { Readable } from "node:stream";

const objects = new Map();
let failDelete = false;
let failUpload = false;
let nextUploadPause;

export const storedObjectKeys = () => [...objects.keys()];
export const setFailDelete = value => { failDelete = value; };
export const setFailUpload = value => { failUpload = value; };
export function pauseNextUpload() {
  let started;
  let release;
  const entered = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  nextUploadPause = { started, wait };
  return { entered, release };
}

export class ObjectNotFoundError extends Error {}

export class ObjectStorageService {
  async uploadObject(path, contents, contentType) {
    objects.set(path, { contents: Buffer.from(contents), contentType });
    if (nextUploadPause) {
      const pause = nextUploadPause; nextUploadPause = undefined;
      pause.started(); await pause.wait;
    }
    if (failUpload) throw new Error("Fixture upload failed after bytes");
  }

  async getObjectEntityFile(path) {
    const key = path.replace(/^\/objects\//, "");
    const object = objects.get(key);
    if (!object) throw new ObjectNotFoundError("Object not found");
    return {
      createReadStream: () => Readable.from(object.contents),
      delete: async () => { if (failDelete) throw new Error("Fixture deletion failed"); objects.delete(key); },
    };
  }

  async deleteObject(path) {
    if (failDelete) throw new Error("Fixture object deletion failed");
    objects.delete(path.replace(/^\/objects\//, ""));
  }
}