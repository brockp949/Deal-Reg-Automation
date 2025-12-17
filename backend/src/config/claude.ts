/**
 * Claude Skills and Agents Configuration
 *
 * Centralized configuration for all Claude-powered features
 */

import { config } from './index';

export interface SkillConfig {
  enabled: boolean;
  model: string;
  maxTokens: number;
  temperature: number;
  cacheEnabled: boolean;
  cacheTTL: number; // hours
}

export interface AgentConfig {
  enabled: boolean;
  model: string;
  maxTokens: number;
  temperature: number;
}

export const claudeConfig = {
  // Global settings
  enabled: config.env === 'production' || process.env.CLAUDE_SKILLS_ENABLED === 'true',

  // Default model settings
  defaultModel: config.aiModel,
  defaultMaxTokens: config.aiMaxTokens,
  defaultTemperature: config.aiTemperature,

  // Caching settings
  cacheEnabled: config.aiCacheEnabled,
  cacheTTLHours: config.aiCacheTTLDays * 24,

  // Skills configuration
  skills: {
    intelligentColumnMapper: {
      enabled: process.env.FEATURE_INTELLIGENT_COLUMN_MAPPING !== 'false',
      model: config.aiModel,
      maxTokens: 4000,
      temperature: 0.0, // Deterministic for consistent mappings
      cacheEnabled: true,
      cacheTTL: 24, // Cache for 24 hours
    } as SkillConfig,

    semanticEntityExtractor: {
      enabled: process.env.FEATURE_SEMANTIC_ENTITY_EXTRACTION !== 'false',
      model: config.aiModel,
      maxTokens: 4000,
      temperature: 0.0,
      cacheEnabled: true,
      cacheTTL: 24,
    } as SkillConfig,

    semanticDuplicateDetector: {
      enabled: process.env.FEATURE_SEMANTIC_DUPLICATE_DETECTION !== 'false',
      model: config.aiModel,
      maxTokens: 2000,
      temperature: 0.0,
      cacheEnabled: true,
      cacheTTL: 24,
    } as SkillConfig,

    buyingSignalAnalyzer: {
      enabled: process.env.FEATURE_BUYING_SIGNAL_ANALYZER !== 'false',
      model: config.aiModel,
      maxTokens: 4000,
      temperature: 0.3, // Slightly higher for nuanced analysis
      cacheEnabled: true,
      cacheTTL: 24,
    } as SkillConfig,
  },

  // Agents configuration
  agents: {
    fileValidation: {
      enabled: process.env.CLAUDE_AGENT_VALIDATION_ENABLED === 'true',
      model: config.aiModel,
      maxTokens: 4000,
      temperature: 0.0,
    } as AgentConfig,

    adaptiveOrchestrator: {
      enabled: process.env.CLAUDE_AGENT_ORCHESTRATOR_ENABLED === 'true',
      model: config.aiModel,
      maxTokens: 3000,
      temperature: 0.0,
    } as AgentConfig,

    continuousLearning: {
      enabled: process.env.CLAUDE_AGENT_LEARNING_ENABLED === 'true',
      model: config.aiModel,
      maxTokens: 4000,
      temperature: 0.0,
    } as AgentConfig,
  },

  // Performance settings
  performance: {
    parallelChunkSize: parseInt(process.env.PARALLEL_CHUNK_SIZE || '1000', 10),
    maxConcurrentChunks: parseInt(process.env.MAX_CONCURRENT_CHUNKS || '5', 10),
    chunkedUploadSizeMB: parseInt(process.env.CHUNKED_UPLOAD_SIZE_MB || '5', 10),
  },

  // Cost monitoring
  costMonitoring: {
    dailyCostAlertThreshold: 50, // Alert if daily cost exceeds $50
    enableUsageTracking: true,
  },
};

/**
 * Check if a specific skill is enabled
 */
export function isSkillEnabled(skillName: keyof typeof claudeConfig.skills): boolean {
  return claudeConfig.enabled && claudeConfig.skills[skillName].enabled;
}

/**
 * Check if a specific agent is enabled
 */
export function isAgentEnabled(agentName: keyof typeof claudeConfig.agents): boolean {
  return claudeConfig.enabled && claudeConfig.agents[agentName].enabled;
}

/**
 * Get skill configuration
 */
export function getSkillConfig(skillName: keyof typeof claudeConfig.skills): SkillConfig {
  return claudeConfig.skills[skillName];
}

/**
 * Get agent configuration
 */
export function getAgentConfig(agentName: keyof typeof claudeConfig.agents): AgentConfig {
  return claudeConfig.agents[agentName];
}

export default claudeConfig;
