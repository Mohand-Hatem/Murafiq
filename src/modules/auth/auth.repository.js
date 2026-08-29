import User from '../users/user.model.js';

// Auth and users share the same underlying document (User), so auth.repository.js is the one
// permitted exception to import a foreign module's model directly — see 01_PROJECT_STRUCTURE.md
// principle 3.

const findByEmail = (email, { withSecrets = false } = {}) => {
  const query = User.findOne({ email: email.toLowerCase() });
  if (withSecrets) query.select('+passwordHash +otpCode +otpExpiresAt');
  return query;
};

const findById = (id, { withSecrets = false } = {}) => {
  const query = User.findById(id);
  if (withSecrets) query.select('+passwordHash +otpCode +otpExpiresAt');
  return query;
};

const findByGoogleId = (googleId, { withSecrets = false } = {}) => {
  const query = User.findOne({ googleId });
  if (withSecrets) query.select('+passwordHash +otpCode +otpExpiresAt');
  return query;
};

const createUser = (data) => User.create(data);

export default { findByEmail, findById, findByGoogleId, createUser };
