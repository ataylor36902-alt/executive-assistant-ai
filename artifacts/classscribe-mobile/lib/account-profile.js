export const ACCOUNT_PROFILE_FIELDS = ['firstName', 'lastName', 'school', 'level', 'major', 'term', 'learningMode'];

export function accountProfilePatch(profile, base) {
  const patch = {};
  ACCOUNT_PROFILE_FIELDS.forEach((key) => {
    if (profile[key] !== base[key]) patch[key] = profile[key];
  });
  return patch;
}