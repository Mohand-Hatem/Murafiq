import User from '../users/user.model.js';

// Auth and users share the same underlying document (User), so auth.repository.js is the one
// permitted exception to import a foreign module's model directly — see 01_PROJECT_STRUCTURE.md
// principle 3.

// otpAttempts must always be projected alongside the other OTP secrets: it is
// `select:false` on the schema, so any caller that loads a user with `withSecrets: true`
// to check/burn an OTP but omits this field silently reads `user.otpAttempts` as
// `undefined` on every call, and the 5-attempt lockout in auth.service.js can never
// trigger. See docs/AUDIT_2026_09_FULL_SYSTEM.md finding X3.
const SECRET_FIELDS = '+passwordHash +otpCode +otpExpiresAt +otpAttempts';

const findByEmail = (email, { withSecrets = false } = {}) => {
  const query = User.findOne({ email: email.toLowerCase() });
  if (withSecrets) query.select(SECRET_FIELDS);
  return query;
};

const findById = (id, { withSecrets = false } = {}) => {
  const query = User.findById(id);
  if (withSecrets) query.select(SECRET_FIELDS);
  return query;
};

const findByGoogleId = (googleId, { withSecrets = false } = {}) => {
  const query = User.findOne({ googleId });
  if (withSecrets) query.select(SECRET_FIELDS);
  return query;
};

const createUser = (data) => User.create(data);

export default { findByEmail, findById, findByGoogleId, createUser };
