import bcrypt from 'bcrypt';
import mongoose from 'mongoose';
import env from '../src/config/env.config.js';
import User from '../src/modules/users/user.model.js';
import { connectDB } from '../src/database/connection.js';

const SALT_ROUNDS = 12;

const seedAdmin = async () => {
  const email = (process.env.SEED_ADMIN_EMAIL || 'admin@murafiq.dev').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD || 'AdminPass123!';

  if (env.NODE_ENV === 'production') {
    if (!process.env.SEED_ADMIN_EMAIL || !process.env.SEED_ADMIN_PASSWORD) {
      console.error('❌ In production, SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD environment variables are required.');
      process.exit(1);
    }
    if (password.length < 10 || password === 'AdminPass123!') {
      console.error('❌ SEED_ADMIN_PASSWORD must be at least 10 characters and cannot use default dev password in production.');
      process.exit(1);
    }
  }

  console.log(`Connecting to database...`);
  await connectDB();

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      existingUser.role = 'admin';
      existingUser.passwordHash = passwordHash;
      existingUser.isEmailVerified = true;
      existingUser.accountStatus = 'active';
      existingUser.verification = {
        status: 'verified',
        verifiedAt: new Date(),
      };
      await existingUser.save();
      console.log(`✅ Existing user '${email}' successfully updated to verified Admin.`);
    } else {
      await User.create({
        name: 'System Admin',
        email,
        passwordHash,
        role: 'admin',
        isEmailVerified: true,
        accountStatus: 'active',
        verification: {
          status: 'verified',
          verifiedAt: new Date(),
        },
      });
      console.log(`✅ Admin user '${email}' successfully created.`);
    }
  } catch (error) {
    console.error(`❌ Admin seeding failed: ${error.message}`);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('Database connection closed.');
  }
};

seedAdmin();
