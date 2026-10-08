# EDU license operations

Only a trusted operator who has independently verified a signed agreement should run these commands. No public API can register a school agreement or designate its administrator.

```sh
# Record a new verified agreement once, designate the administrator's existing Clerk user ID,
# and issue school credentials (number and PIN are printed once).
pnpm --filter @workspace/scripts run edu-license -- school user_... agreement:opaque-reference 2027-12-31T23:59:59Z

# Immediately suspend the whole school, including existing sessions and courses,
# while preserving agreement, approval, and course records:
pnpm --filter @workspace/scripts run edu-license -- revoke-school user_... agreement:opaque-reference
```

The administrator signs into the EDU portal, verifies the school credential pair in their own session, and opens **School instructors** to approve existing Clerk user IDs. Instructors sign in, copy their own ID from the activation screen, and have their administrator independently confirm they belong under the agreement. The administrator distributes the number and PIN to authorized instructors and students through a secure channel. The PIN is not recoverable from the portal. Each instructor must verify the credentials in their own session before teaching. The administrator can revoke an instructor without deleting their courses; an expired or revoked agreement denies everyone in the school immediately.

The existing `grant` and `revoke` actions remain available for operator-managed individual agreements; they do not designate a school administrator. Re-registering a revoked school requires a newly verified agreement reference.