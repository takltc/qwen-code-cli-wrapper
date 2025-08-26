# 🤖 Qwen Code CLI Wrapper

Transform Qwen Code CLI into OpenAI-compatible endpoints using Cloudflare Workers. Access advanced AI capabilities through a standardized API interface, powered by OAuth2 authentication and seamless integration with the Qwen Code ecosystem.

## ✨ Features

- 🔐 **OAuth2 Authentication** - Uses your Qwen Code CLI credentials seamlessly
- 🎯 **OpenAI-Compatible API** - Drop-in replacement for OpenAI endpoints
- 📚 **OpenAI SDK Support** - Works with official OpenAI SDKs and libraries
- 🌐 **Third-party Integration** - Compatible with Open WebUI, Cline, and more
- 🛡️ **API Key Security** - Optional authentication layer for endpoint access
- ⚡ **Cloudflare Workers** - Global edge deployment with low latency
- 🔄 **Smart Token Management** - Automatic token refresh with KV storage
- 📡 **Real-time Streaming** - Server-sent events for live responses
- 🏗️ **Clean Architecture** - Well-structured, maintainable codebase
- 📊 **Debug Logging** - Comprehensive logging for troubleshooting

## 🚀 Quick Start

### Prerequisites

1. **Qwen Account** with Code CLI access
2. **Cloudflare Account** with Workers enabled
3. **Wrangler CLI** installed (`npm install -g wrangler`)

### Step 1: Get OAuth2 Credentials

You need OAuth2 credentials from the official Qwen Code CLI.

#### Using Qwen Code CLI

1. **Install Qwen Code CLI**:
   ```bash
   npm install -g @qwen-code/qwen-code@latest
   ```

2. **Start Qwen Code and authenticate**:
   ```bash
   qwen
   ```

   Select your preferred authentication method when prompted.

3. **Locate the credentials file**:

   **Windows:**
   ```
   C:\Users\USERNAME\.qwen\oauth_creds.json
   ```

   **macOS/Linux:**
   ```
   ~/.qwen/oauth_creds.json
   ```

4. **Copy the credentials**:
   The file contains JSON in this format:
   ```json
   {
     "access_token": "your_access_token_here",
     "refresh_token": "your_refresh_token_here",
     "expiry_date": 1700000000000,
     "resource_url": "https://your-endpoint.com/v1",
     "token_type": "Bearer"
   }
   ```

### Step 2: Create KV Namespace

```bash
# Create a KV namespace for token caching
wrangler kv namespace create "QWEN_KV"
```

Note the namespace ID returned and update `wrangler.toml`:
```toml
kv_namespaces = [
  { binding = "QWEN_KV", id = "your-kv-namespace-id" }
]
```

### Step 3: Environment Setup

Create a `.dev.vars` file:
```bash
# Required: Qwen Code CLI authentication JSON
QWEN_CLI_AUTH={"access_token":"your_access_token","refresh_token":"your_refresh_token","expiry_date":1700000000000,"resource_url":"https://your-endpoint.com/v1","token_type":"Bearer"}

# Optional: API key for client authentication (if set, users must provide it in Authorization header)
# OPENAI_API_KEY=sk-your-secret-key-here

# Optional: Default model override
# OPENAI_MODEL=qwen3-coder-plus

# Optional: Custom base URL (will use resource_url from OAuth if available)
# OPENAI_BASE_URL=https://api-inference.modelscope.cn/v1
```

For production, set the secrets:
```bash
wrangler secret put QWEN_CLI_AUTH
# Enter your OAuth credentials JSON
```

### Step 4: Deploy

```bash
# Install dependencies
npm install

# Deploy to Cloudflare Workers
npm run deploy

# Or run locally for development
npm run dev
```

The service will be available at `https://your-worker.your-subdomain.workers.dev`

## 🔧 Configuration

### Environment Variables

#### Core Configuration

| Variable | Required | Description |
|----------|----------|-------------|
| `QWEN_CLI_AUTH` | ✅ | OAuth2 credentials JSON from Qwen Code CLI |
| `OPENAI_API_KEY` | ❌ | API key for client authentication |
| `OPENAI_MODEL` | ❌ | Default model override |
| `OPENAI_BASE_URL` | ❌ | Custom base URL (uses OAuth resource_url if available) |

#### Authentication Security

- When `OPENAI_API_KEY` is set, all `/v1/*` endpoints require authentication
- Clients must include the header: `Authorization: Bearer <your-api-key>`
- Recommended format: `sk-` followed by a random string
- Without this variable, endpoints are publicly accessible (not recommended for production)

#### OAuth Token Management

- **Automatic Refresh**: Tokens are automatically refreshed when expired
- **KV Persistence**: Refreshed tokens are stored in Cloudflare KV
- **Fallback Logic**: KV cache → environment → refresh → retry
- **Debug Logging**: Comprehensive token source tracking

### KV Namespaces

| Binding | Purpose |
|---------|---------|
| `QWEN_KV` | OAuth token caching and refresh storage |

## 🎯 API Endpoints

### Base URL
```
https://your-worker.your-subdomain.workers.dev
```

### OpenAI-Compatible Endpoints

#### Chat Completions
```http
POST /v1/chat/completions
Authorization: Bearer sk-your-api-key-here (if OPENAI_API_KEY is set)
Content-Type: application/json

{
  "model": "qwen3-coder-plus",
  "messages": [
    {
      "role": "system",
      "content": "You are a helpful coding assistant."
    },
    {
      "role": "user",
      "content": "Write a Python function to calculate fibonacci numbers"
    }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1000
}
```

#### List Models
```http
GET /v1/models
Authorization: Bearer sk-your-api-key-here (if OPENAI_API_KEY is set)
```

**Response:**
```json
{
  "object": "list",
  "data": [
    {
      "id": "qwen3-coder-plus",
      "object": "model",
      "created": 1700000000,
      "owned_by": "qwen"
    },
    {
      "id": "qwen3-coder-flash",
      "object": "model",
      "created": 1700000000,
      "owned_by": "qwen"
    }
  ]
}
```

### Utility Endpoints

#### Health Check
```http
GET /health
```
*No authentication required*

**Response:**
```json
{
  "status": "ok",
  "uptime": 1700000000,
  "version": "qwen-worker-1.0.0"
}
```

## 💻 Usage Examples

### OpenAI SDK (Python)
```python
from openai import OpenAI

# Initialize with your worker endpoint
client = OpenAI(
    base_url="https://your-worker.workers.dev/v1",
    api_key="sk-your-secret-api-key-here"  # Only if OPENAI_API_KEY is set
)

# Chat completion
response = client.chat.completions.create(
    model="qwen3-coder-plus",
    messages=[
        {"role": "system", "content": "You are a helpful coding assistant."},
        {"role": "user", "content": "Write a binary search algorithm in Python"}
    ],
    temperature=0.2,
    max_tokens=500,
    stream=True
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")
```

### OpenAI SDK (JavaScript/TypeScript)
```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  baseURL: 'https://your-worker.workers.dev/v1',
  apiKey: 'sk-your-secret-api-key-here', // Only if OPENAI_API_KEY is set
});

const stream = await openai.chat.completions.create({
  model: 'qwen3-coder-plus',
  messages: [
    { role: 'user', content: 'Explain async/await in JavaScript' }
  ],
  stream: true,
  temperature: 0.7,
});

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content || '';
  process.stdout.write(content);
}
```

### cURL Examples
```bash
# Chat completion (non-streaming)
curl -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-secret-api-key-here" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [
      {"role": "user", "content": "Hello! How are you?"}
    ],
    "temperature": 0.7
  }'

# Chat completion (streaming)
curl -N -X POST https://your-worker.workers.dev/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-secret-api-key-here" \
  -d '{
    "model": "qwen3-coder-flash",
    "messages": [
      {"role": "user", "content": "Write a TypeScript hello world"}
    ],
    "stream": true
  }'

# List available models
curl https://your-worker.workers.dev/v1/models \
  -H "Authorization: Bearer sk-your-secret-api-key-here"

# Health check
curl https://your-worker.workers.dev/health
```

### Open WebUI Integration

1. **Add as OpenAI-compatible endpoint**:
   - Base URL: `https://your-worker.workers.dev/v1`
   - API Key: `sk-your-secret-api-key-here` (only if `OPENAI_API_KEY` is set)

2. **Auto-discovery**:
   Open WebUI will automatically discover available models through the `/v1/models` endpoint.

## 🏗️ How It Works

```mermaid
graph TD
    A[Client Request] --> B[Cloudflare Worker]
    B --> C[API Key Validation]
    C --> D{Valid API Key?}
    D -->|No| E[401 Unauthorized]
    D -->|Yes| F{Token in KV Cache?}
    F -->|Yes| G[Use Cached Token]
    F -->|No| H[Check Environment Token]
    H --> I{Token Valid?}
    I -->|Yes| J[Cache & Use Token]
    I -->|No| K[Refresh Token via Qwen API]
    K --> L[Cache New Token]
    G --> M[Call Qwen API]
    J --> M
    L --> M
    M --> N{Streaming?}
    N -->|Yes| O[Forward SSE Stream]
    N -->|No| P[Return JSON Response]
    O --> Q[Client Receives Stream]
    P --> Q
```

The wrapper acts as a secure translation layer, managing OAuth2 authentication automatically while providing OpenAI-compatible responses.

## 🚨 Troubleshooting

### Common Issues

**401 Authentication Error**
- Verify your `OPENAI_API_KEY` is correctly set (if using API key auth)
- Check if client is sending `Authorization: Bearer <key>` header
- Ensure the API key format is valid

**OAuth Token Issues**
- Check if your `QWEN_CLI_AUTH` credentials are valid
- Ensure the refresh token hasn't expired
- Verify the JSON format matches the expected structure

**KV Storage Issues**
- Confirm KV namespace is correctly configured in `wrangler.toml`
- Check KV namespace permissions in Cloudflare dashboard
- Verify the binding name matches (`QWEN_KV`)

**Streaming Problems**
- Check the worker logs for streaming-related errors
- Ensure the upstream Qwen API supports streaming for the requested model
- Verify the resource_url in your OAuth credentials

### Debug Logging

The worker provides comprehensive debug logging:

```bash
# Run locally to see logs
npm run dev
```

Look for these log patterns:
```
=== New chat completion request ===
Environment loaded: { hasKv: true, hasCliAuth: true, ... }
Authentication passed
loadInitialCredentials called with json: present
Token validity check: { hasAccessToken: true, expiryDate: ..., tokenValid: true }
Base URL resolved: https://your-endpoint.com/v1
Making upstream request...
Captured usage in stream: {...}
```

### Debug Endpoints

```bash
# Health check with detailed info
curl https://your-worker.workers.dev/health

# Check if KV credentials are loaded (logs will show)
curl https://your-worker.workers.dev/v1/models
```

## 🧠 Architecture

### Project Structure
```
src/
├── types/                 # TypeScript type definitions
│   ├── bindings.ts       # Cloudflare bindings
│   ├── openai.ts         # OpenAI API types
│   ├── qwen.ts           # Qwen-specific types
│   └── common.ts         # Shared utilities
├── config/               # Configuration management
│   ├── constants.ts      # App constants
│   ├── validation.ts     # Request validation
│   └── index.ts          # Config exports
├── services/             # Business logic services
│   ├── qwenOAuthKvClient.ts    # OAuth client with KV storage
│   ├── qwenProxy.ts            # HTTP proxy to Qwen API
│   ├── openaiMapper.ts         # Request/response mapping
│   ├── auth.ts                 # API key authentication
│   └── credentials.ts          # Legacy (can be removed)
├── routes/               # HTTP route handlers
│   ├── chat.ts          # Chat completions endpoint
│   ├── health.ts        # Health check endpoint
│   └── models.ts        # Models listing endpoint
└── index.ts             # Hono bootstrap
```

### Key Components

1. **OAuth Client** (`services/qwenOAuthKvClient.ts`)
   - Manages Qwen OAuth tokens with KV persistence
   - Automatic token refresh when expired
   - Bootstrap from environment credentials

2. **Request Mapping** (`services/openaiMapper.ts`)
   - Transforms OpenAI requests to Qwen-compatible format
   - Maps sampling parameters (temperature, top_p, etc.)
   - Validates request structure

3. **HTTP Proxy** (`services/qwenProxy.ts`)
   - Calls Qwen API with proper authentication
   - Resolves base URL from OAuth resource_url
   - Handles both streaming and non-streaming responses

4. **Authentication** (`services/auth.ts`)
   - Optional API key validation for endpoint access
   - Bearer token format validation

## 🤝 Contributing

1. Fork the repository: `https://github.com/gewoonjaap/qwen-code-cli-wrapper`
2. Create a feature branch: `git checkout -b feature-name`
3. Make your changes and add tests
4. Run linting: `npm run lint`
5. Test thoroughly: `npm test`
6. Commit your changes: `git commit -am 'Add feature'`
7. Push to the branch: `git push origin feature-name`
8. Submit a pull request

### Development Setup

```bash
git clone https://github.com/gewoonjaap/qwen-code-cli-wrapper.git
cd qwen-code-cli-wrapper
npm install
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your Qwen OAuth credentials
npm run dev
```

### Available Scripts

```bash
npm run dev          # Start development server
npm run deploy       # Deploy to Cloudflare Workers
npm run lint         # Run ESLint and TypeScript checks
npm run format       # Format code with Prettier
npm test             # Run test suite
npm run build        # Build the project
```

## 📄 License

This codebase is provided for personal use and self-hosting only.

Redistribution of the codebase, whether in original or modified form, is not permitted without prior written consent from the author.

You may fork and modify the repository solely for the purpose of running and self-hosting your own instance.

Any other form of distribution, sublicensing, or commercial use is strictly prohibited unless explicitly authorized.

## 🙏 Acknowledgments

- Built on [Cloudflare Workers](https://workers.cloudflare.com/)
- Uses [Hono](https://hono.dev/) web framework
- Inspired by the official [Qwen Code CLI](https://github.com/QwenLM/qwen-code)
- OAuth patterns adapted from Qwen Code CLI implementation

---

**⚠️ Important**: This project uses Qwen's API which may have usage limits and terms of service. Please ensure compliance with Qwen's policies when using this wrapper.

[![Star History Chart](https://api.star-history.com/svg?repos=gewoonjaap/qwen-code-cli-wrapper&type=Date)](https://www.star-history.com/#gewoonjaap/qwen-code-cli-wrapper&Date)
