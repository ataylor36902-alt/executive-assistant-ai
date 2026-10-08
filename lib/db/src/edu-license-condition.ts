import { sql } from "drizzle-orm";
import { classscribeEduInstitutionAgreementsTable as agreements, classscribeEduLicenseGrantsTable as grants } from "./schema/classscribe-edu-licenses";

/** Legacy individual grants remain valid; school grants additionally require the verified agreement. */
export function activeInstitutionCondition(at: Date) {
  return sql`(${grants.issuerUserId} is null and not exists (select 1 from ${agreements} school where school.signed_agreement_ref = ${grants.signedAgreementRef})
    or exists (select 1 from ${agreements} school where school.signed_agreement_ref = ${grants.signedAgreementRef}
      and school.verified_at <= ${at} and school.expires_at > ${at} and school.revoked_at is null))`;
}