export function ageBandFromBirthMonthYear(monthValue, yearValue, currentDate = new Date()) {
  const month = Number(monthValue);
  const year = Number(yearValue);
  if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year) || year < 1900 || year > currentDate.getFullYear()) return 'invalid';
  const age = currentDate.getFullYear() - year - (currentDate.getMonth() + 1 <= month ? 1 : 0);
  if (age < 13) return 'under13';
  return age >= 18 ? '18+' : '13-17';
}