import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),
  MONGO_URI: z.string().default('mongodb://127.0.0.1:27017/murafiq'),
  JWT_ACCESS_SECRET: z.string().default('dev_access_secret_change_me_in_prod'),
  JWT_REFRESH_SECRET: z.string().default('dev_refresh_secret_change_me_in_prod'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  CLOUDINARY_CLOUD_NAME: z.string().default('my_cloud_name'),
  CLOUDINARY_API_KEY: z.string().default('my_api_key'),
  CLOUDINARY_API_SECRET: z.string().default('my_api_secret'),
  MAIL_PROVIDER: z.enum(['gmail', 'sendgrid']).default('gmail'),
  GMAIL_USER: z.string().default('myemail@gmail.com'),
  GMAIL_APP_PASSWORD: z.string().default('my_app_password'),
  PAYMENT_PROVIDER: z.enum(['mock', 'paymob']).default('mock'),
  CLIENT_URL: z.string().default('http://localhost:3000'),
  PLATFORM_FEE_PERCENTAGE: z.string().default('15').transform(Number),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.format());
  process.exit(1);
}

export default parsed.data;
