import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../src/models/User.js';
import { connectDatabase } from '../src/config/database.js';
import { parse, userInput } from '../src/lib/validation.js';
try {
  const input = parse(userInput, {
    name: process.env.AGENT_NAME,
    email: process.env.AGENT_EMAIL,
    password: process.env.AGENT_PASSWORD,
  });
  await connectDatabase();
  if (await User.exists({ email: input.email }))
    throw new Error('Account already exists; no account was changed.');
  await User.create({
    name: input.name,
    email: input.email,
    passwordHash: await bcrypt.hash(input.password, 12),
    role: 'agent',
  });
  console.log(
    'Agent created. Keep credentials private and remove AGENT_PASSWORD from the provisioning environment.',
  );
} catch (error) {
  console.error(
    'Agent provisioning failed:',
    error.name === 'HttpError'
      ? error.message
      : 'Check configuration, connection and whether the account already exists.',
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
