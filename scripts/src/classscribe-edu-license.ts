import { clerkClient } from "@clerk/express";
import { pool } from "@workspace/db";
import { parseEduLicenseCommand, runEduLicenseCommand } from "./classscribe-edu-license-command.js";

const args = process.argv.slice(2);

try {
  const command = parseEduLicenseCommand(args);
   if (command.action !== "revoke-school" && !process.env.CLERK_SECRET_KEY?.trim()) {
    throw new Error("CLERK_SECRET_KEY is required to verify the Clerk account; no license change was written.");
  }
   const client = await pool.connect();
   let credentials;
   try {
     await client.query("BEGIN");
     credentials = await runEduLicenseCommand(args, {
       lookupClerkUser: userId => clerkClient.users.getUser(userId),
       query: async (query, values) => {
         const result = await client.query(query, values);
         return { rows: result.rows };
       },
     });
     await client.query("COMMIT");
   } catch (error) {
     await client.query("ROLLBACK");
     throw error;
   } finally {
     client.release();
   }
   if ((command.action === "grant" || command.action === "school") && credentials) {
    process.stdout.write(
       `EDU client credentials (displayed once; store securely and share with authorized school members):\nLicense number: ${credentials.licenseNumber}\nClient PIN: ${credentials.clientPin}\n`,
    );
  } else {
     process.stdout.write(`EDU ${command.action === "revoke-school" ? "school agreement" : "license grant"} revoked for ${command.userId}.\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "EDU license operation failed"}\n`);
  process.exitCode = 1;
} finally {
  await pool.end();
}