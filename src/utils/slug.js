const crypto = require('crypto');

function generateSlug(length = 7) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.randomBytes(length);

  let slug = '';
  for (let index = 0; index < length; index += 1) {
    slug += alphabet[bytes[index] % alphabet.length];
  }

  return slug;
}

module.exports = {
  generateSlug
};
