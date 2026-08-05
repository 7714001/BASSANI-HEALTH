// Shared field validators used across public and admin forms that collect
// South African identity/contact details (PublicRegister.js, Views.js Sales Agent wizard).

export function validateSAID(id) {
  if (!/^\d{13}$/.test(id)) return false;
  const month = parseInt(id.substring(2, 4), 10);
  const day   = parseInt(id.substring(4, 6), 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  let sum = 0;
  for (let pos = 1; pos <= 13; pos++) {
    let d = parseInt(id[13 - pos], 10);
    if (pos % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export function validateSAPhone(phone) {
  const stripped = phone.trim().replace(/[\s\-()]/g, "");
  return /^(\+27|0)\d{9}$/.test(stripped);
}

// Passport numbers are issuing-country-dependent alphanumeric strings with no
// universal checksum (unlike an SA ID, which is always 13 digits and
// Luhn-checkable) — this is a length/character sanity check only, not a
// format guarantee.
export function validatePassport(passport) {
  return /^[A-Za-z0-9]{5,15}$/.test(passport.trim());
}
