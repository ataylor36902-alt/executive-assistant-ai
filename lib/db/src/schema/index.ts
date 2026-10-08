// Export your models here. Add one export per file
// export * from "./posts";
//
// Each model/table should ideally be split into different files.
// Each model/table should define a Drizzle table, insert schema, and types:
//
//   import { pgTable, text, serial } from "drizzle-orm/pg-core";
//   import { createInsertSchema } from "drizzle-zod";
//   import { z } from "zod/v4";
//
//   export const postsTable = pgTable("posts", {
//     id: serial("id").primaryKey(),
//     title: text("title").notNull(),
//   });
//
//   export const insertPostSchema = createInsertSchema(postsTable).omit({ id: true });
//   export type InsertPost = z.infer<typeof insertPostSchema>;
//   export type Post = typeof postsTable.$inferSelect;

export * from "./classscribe";
export * from "./classscribe-edu";
export * from "./classscribe-edu-licenses";
export * from "./classscribe-edu-learning";
export * from "./classscribe-edu-media";
export * from "./study-plans";
export * from "./grades";
export * from "./classscribe-legacy";
export * from "./classscribe-credits";
export * from "./classscribe-privacy";
export * from "./classscribe-consents";