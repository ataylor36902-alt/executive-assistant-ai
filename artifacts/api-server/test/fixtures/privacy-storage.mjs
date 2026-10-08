export class ObjectStorageService {
  async getObjectEntityFile() {
    const error = new Error("Object not found");
    error.name = "ObjectNotFoundError";
    throw error;
  }
}