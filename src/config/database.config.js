import env from './env.config.js';

export default {
  uri: env.MONGO_URI,
  options: {
    maxPoolSize: 50,
    minPoolSize: 5,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  },
};
