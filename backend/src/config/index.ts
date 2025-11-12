import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables
dotenv.config();

// Environment variables schema
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('4000'),
  API_PREFIX: z.string().default('/api'),

  // Database
  DATABASE_URL: z.string(),

  // Redis
  REDIS_URL: z.string().default('redis://localhost:6379'),

  // JWT
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('7d'),

  // File Upload
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_FILE_SIZE: z.string().default('5368709120'), // 5GB (5368709120 bytes)
  ALLOWED_FILE_TYPES: z.string().default('.mbox,.csv,.txt,.pdf,.docx,.json'),
  CONFIG_STORAGE_DIR: z.string().default('./config-uploads'),

  // AI Services
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('claude-3-5-sonnet-20241022'),
  AI_MAX_TOKENS: z.string().default('4000'),
  AI_TEMPERATURE: z.string().default('0.0'),
  AI_TIMEOUT: z.string().default('30000'),
  AI_RETRY_ATTEMPTS: z.string().default('3'),
  AI_CACHE_ENABLED: z.string().default('true'),
  AI_CACHE_TTL_DAYS: z.string().default('30'),

  // Email (optional for Phase 1)
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().optional(),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3200'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

// Parse and validate environment variables
const env = envSchema.parse(process.env);

// Export typed configuration
export const config = {
  env: env.NODE_ENV,
  port: parseInt(env.PORT, 10),
  apiPrefix: env.API_PREFIX,

  databaseUrl: env.DATABASE_URL,
  redisUrl: env.REDIS_URL,

  jwt: {
    secret: env.JWT_SECRET,
    expiresIn: env.JWT_EXPIRES_IN,
  },

  upload: {
    directory: env.UPLOAD_DIR,
    maxFileSize: parseInt(env.MAX_FILE_SIZE, 10),
    allowedTypes: env.ALLOWED_FILE_TYPES.split(','),
  },
  configStorage: {
    directory: env.CONFIG_STORAGE_DIR,
  },

  ai: {
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    openaiApiKey: env.OPENAI_API_KEY,
  },

  // AI Extraction Configuration
  aiModel: env.AI_MODEL,
  aiMaxTokens: parseInt(env.AI_MAX_TOKENS, 10),
  aiTemperature: parseFloat(env.AI_TEMPERATURE),
  aiTimeout: parseInt(env.AI_TIMEOUT, 10),
  aiRetryAttempts: parseInt(env.AI_RETRY_ATTEMPTS, 10),
  aiCacheEnabled: env.AI_CACHE_ENABLED === 'true',
  aiCacheTTLDays: parseInt(env.AI_CACHE_TTL_DAYS, 10),

  // Expose anthropic key at root level for backward compat
  anthropicApiKey: env.ANTHROPIC_API_KEY,

  email: {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ? parseInt(env.SMTP_PORT, 10) : undefined,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.EMAIL_FROM,
  },

  cors: {
    origin: env.CORS_ORIGIN,
  },

  logLevel: env.LOG_LEVEL,
};

export default config;
