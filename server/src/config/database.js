import mongoose from 'mongoose';
import User from '../models/User.js';
import Chat from '../models/Chat.js';
import Message from '../models/Message.js';
export async function connectDatabase(uri = process.env.MONGODB_URI) {
  if (!uri)
    throw new Error('Set MONGODB_URI in server/.env. Hilltop requires its own Atlas database.');
  try {
    await mongoose.connect(uri, { dbName: 'hilltop_support', serverSelectionTimeoutMS: 10000 });
    await Promise.all([User.init(), Chat.init(), Message.init()]);
  } catch (error) {
    await mongoose.disconnect();
    throw error;
  }
}
