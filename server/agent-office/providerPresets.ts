export interface ProviderPreset {
  id: string;
  name: string;
  protocol_driver: string;
  base_url: string;
  auth_driver: string;
  auth_config?: Record<string, unknown>;
  headers?: Record<string, string>;
  query?: Record<string, string>;
  protocol_config?: Record<string, unknown>;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai',
    name: 'OpenAI',
    protocol_driver: 'openai_responses',
    base_url: 'https://api.openai.com',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/responses',
      models_path: '/v1/models',
    },
  },
  {
    id: 'openai-chat-compatible',
    name: 'OpenAI-compatible',
    protocol_driver: 'openai_chat',
    base_url: '',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    protocol_driver: 'anthropic_messages',
    base_url: 'https://api.anthropic.com',
    auth_driver: 'x-api-key',
    headers: {
      'anthropic-version': '2023-06-01',
    },
    protocol_config: {
      completion_path: '/v1/messages',
      models_path: '/v1/models',
    },
  },
  {
    id: 'google-gemini',
    name: 'Google Gemini',
    protocol_driver: 'google_gemini',
    base_url: 'https://generativelanguage.googleapis.com',
    auth_driver: 'custom_header',
    auth_config: {
      header_name: 'x-goog-api-key',
    },
    protocol_config: {
      api_version: 'v1beta',
      models_path: '/v1beta/models',
    },
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    protocol_driver: 'openai_chat',
    base_url: 'https://openrouter.ai/api',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'groq',
    name: 'Groq',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.groq.com/openai',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'xai',
    name: 'xAI',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.x.ai',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.deepseek.com',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/chat/completions',
      models_path: '/models',
    },
  },
  {
    id: 'moonshot',
    name: 'Moonshot / Kimi',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.moonshot.ai',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'together',
    name: 'Together AI',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.together.xyz',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.fireworks.ai/inference',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'mistral',
    name: 'Mistral',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.mistral.ai',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'cerebras',
    name: 'Cerebras',
    protocol_driver: 'openai_chat',
    base_url: 'https://api.cerebras.ai',
    auth_driver: 'bearer',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/v1/models',
    },
  },
  {
    id: 'ollama',
    name: 'Ollama local',
    protocol_driver: 'openai_chat',
    base_url: 'http://127.0.0.1:11434',
    auth_driver: 'none',
    protocol_config: {
      completion_path: '/v1/chat/completions',
      models_path: '/api/tags',
      models_format: 'ollama',
    },
  },
  {
    id: 'custom-json',
    name: 'Custom JSON API',
    protocol_driver: 'generic_json',
    base_url: '',
    auth_driver: 'bearer',
    protocol_config: {
      method: 'POST',
      completion_path: '/',
      request_template: {
        model: '{{model}}',
        messages: '{{messages}}',
      },
      response_text_path: 'text',
    },
  },
  {
    id: 'custom-sse',
    name: 'Custom SSE API',
    protocol_driver: 'generic_sse',
    base_url: '',
    auth_driver: 'bearer',
    protocol_config: {
      method: 'POST',
      completion_path: '/',
      request_template: {
        model: '{{model}}',
        messages: '{{messages}}',
        stream: true,
      },
      stream_text_path: 'text',
    },
  },
  {
    id: 'custom-ndjson',
    name: 'Custom NDJSON API',
    protocol_driver: 'generic_ndjson',
    base_url: '',
    auth_driver: 'bearer',
    protocol_config: {
      method: 'POST',
      completion_path: '/',
      request_template: {
        model: '{{model}}',
        messages: '{{messages}}',
        stream: true,
      },
      stream_text_path: 'text',
    },
  },
];

export function getProviderPreset(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}
