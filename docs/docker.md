# Docker Deployment Guide

This guide provides comprehensive instructions for running the Qwen Code CLI Wrapper using Docker, offering an alternative to Cloudflare Workers deployment with full control over the runtime environment.

## 📋 Prerequisites

- [Docker](https://docs.docker.com/get-docker/) (v20.10 or later)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0 or later)
- Git (for cloning the repository)

## 🚀 Quick Start

### 1. Choose Your Method

**Option A: Use Pre-built Image (Recommended)**
```bash
# Pull the latest pre-built image
docker pull ghcr.io/gewoonjaap/qwen-code-cli-wrapper:latest
```

**Option B: Build from Source**
```bash
git clone https://github.com/gewoonjaap/qwen-code-cli-wrapper.git
cd qwen-code-cli-wrapper
```

### 2. Configure Environment

Create your environment file:

```bash
cp .dev.vars.example .dev.vars
```

Edit `.dev.vars` with your Qwen OAuth configuration:

```bash
# Required: Qwen Code CLI authentication JSON
QWEN_CLI_AUTH={"access_token":"your_access_token","refresh_token":"your_refresh_token","expiry_date":1700000000000,"resource_url":"https://your-endpoint.com/v1","token_type":"Bearer"}

# Optional: API key for client authentication
# OPENAI_API_KEY=sk-your-secret-key-here

# Optional: Default model override
# OPENAI_MODEL=qwen3-coder-plus

# Optional: Custom base URL
# OPENAI_BASE_URL=https://api-inference.modelscope.cn/v1
```

### 3. Start the Service

**Option A: Using Pre-built Image**
```bash
# Create environment file
cp .dev.vars.example .dev.vars
# Edit .dev.vars with your configuration

# Run with pre-built image
docker run -d \
  --name qwen-code-wrapper \
  -p 8787:8787 \
  --env-file .dev.vars \
  ghcr.io/gewoonjaap/qwen-code-cli-wrapper:latest
```

**Option B: Using Docker Compose**
```bash
docker-compose up -d
```

The service will be available at `http://localhost:8787`

## 🔧 Configuration Options

### Environment Variables

| Variable | Description | Required | Default |
|----------|-------------|----------|---------|
| `QWEN_CLI_AUTH` | Qwen OAuth2 credentials JSON | ✅ | - |
| `OPENAI_API_KEY` | API key for client authentication | ❌ | - |
| `OPENAI_MODEL` | Default model override | ❌ | `qwen3-coder-plus` |
| `OPENAI_BASE_URL` | Custom Qwen API base URL | ❌ | Uses OAuth resource_url |

### Docker Compose Configuration

The `docker-compose.yml` includes:

- **Port Mapping**: `8787:8787` for API access
- **Volume Mounts**:
  - Source code for development hot-reloading
  - Persistent storage for KV data simulation
- **Health Checks**: Automatic service monitoring
- **Restart Policy**: Automatic restart on failure

## 🛠️ Development Setup

### Hot Reloading

For development with automatic code reloading:

```bash
# Start in development mode (default)
docker-compose up

# View logs in real-time
docker-compose logs -f qwen-code-wrapper

# Access the container shell
docker-compose exec qwen-code-wrapper sh
```

### Using Pre-built Images

The project provides pre-built Docker images via GitHub Container Registry:

```bash
# Pull the latest stable release
docker pull ghcr.io/gewoonjaap/qwen-code-cli-wrapper:latest

# Run with custom configuration
docker run -d \
  --name qwen-wrapper \
  -p 8787:8787 \
  --env-file .dev.vars \
  ghcr.io/gewoonjaap/qwen-code-cli-wrapper:latest
```

### Building from Source

If you need to customize the image or build from source:

```bash
# Build the Docker image
docker build -t qwen-code-cli-wrapper .

# Run with custom configuration
docker run -d \
  --name qwen-wrapper \
  -p 8787:8787 \
  --env-file .dev.vars \
  qwen-code-cli-wrapper
```

## 📊 Production Deployment

### 1. Production Environment File

Create `.env.production`:

```bash
NODE_ENV=production
QWEN_CLI_AUTH={"access_token":"your_prod_token","refresh_token":"your_prod_refresh","expiry_date":1700000000000,"resource_url":"https://your-prod-endpoint.com/v1","token_type":"Bearer"}
OPENAI_API_KEY=sk-your-production-key
OPENAI_MODEL=qwen3-coder-plus
```

### 2. Production Docker Compose

**Option A: Using Pre-built Image (Recommended)**

Create `docker-compose.prod.yml`:

```yaml
version: '3.8'

services:
  qwen-code-wrapper:
    image: ghcr.io/gewoonjaap/qwen-code-cli-wrapper:latest
    container_name: qwen-code-wrapper-prod
    ports:
      - "8787:8787"
    volumes:
      - qwen_storage_prod:/app/.mf
    env_file:
      - .env.production
    restart: always
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8787/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    environment:
      - NODE_ENV=production

volumes:
  qwen_storage_prod:
    driver: local
```

**Option B: Building from Source**

```yaml
version: '3.8'

services:
  qwen-code-wrapper:
    build:
      context: .
      dockerfile: Dockerfile
      args:
        NODE_ENV: production
    container_name: qwen-code-wrapper-prod
    ports:
      - "8787:8787"
    volumes:
      - qwen_storage_prod:/app/.mf
    env_file:
      - .env.production
    restart: always
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:8787/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s
    environment:
      - NODE_ENV=production

volumes:
  qwen_storage_prod:
    driver: local
```

### 3. Deploy Production

```bash
docker-compose -f docker-compose.prod.yml up -d
```

## 🔍 Monitoring and Troubleshooting

### Health Checks

The service includes built-in health monitoring:

```bash
# Check service health
curl http://localhost:8787/health

# Expected response
{"status":"ok","uptime":1700000000,"version":"qwen-worker-1.0.0"}
```

### Viewing Logs

```bash
# View real-time logs
docker-compose logs -f qwen-code-wrapper

# View last 100 lines
docker-compose logs --tail=100 qwen-code-wrapper

# Filter error logs
docker-compose logs qwen-code-wrapper | grep ERROR

# Filter authentication logs
docker-compose logs qwen-code-wrapper | grep "auth\|token"
```

### Container Management

```bash
# Stop the service
docker-compose down

# Restart the service
docker-compose restart qwen-code-wrapper

# Update and restart
git pull
docker-compose down
docker-compose up -d --build
```

### Data Persistence

The Docker setup includes persistent storage for:

- **KV Store Data**: Authentication tokens and cache
- **Configuration**: Environment-specific settings
- **Logs**: Application and error logs

```bash
# Backup persistent data
docker run --rm -v qwen_code_wrapper_storage:/data -v $(pwd):/backup ubuntu tar czf /backup/qwen-backup.tar.gz /data

# Restore persistent data
docker run --rm -v qwen_code_wrapper_storage:/data -v $(pwd):/backup ubuntu tar xzf /backup/qwen-backup.tar.gz -C /
```

## 🔐 Security Considerations

### Network Security

```bash
# Run on custom network
docker network create qwen-network
docker-compose up -d
```

### Secrets Management

For production deployments, consider using Docker secrets:

```yaml
# In docker-compose.prod.yml
services:
  qwen-code-wrapper:
    secrets:
      - qwen_oauth_auth
      - openai_api_key

secrets:
  qwen_oauth_auth:
    file: ./secrets/qwen_oauth_auth.json
  openai_api_key:
    file: ./secrets/openai_api_key.txt
```

### Container Security

- Uses non-root user (`worker:nodejs`)
- Minimal base image (`node:20-slim`)
- Security updates applied during build
- Read-only root filesystem option available

## 🔗 API Usage

Once deployed, the service provides OpenAI-compatible endpoints:

### Chat Completions

```bash
# Basic request
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# With authentication
curl -X POST http://localhost:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-your-api-key-here" \
  -d '{
    "model": "qwen3-coder-plus",
    "messages": [{"role": "user", "content": "Hello!"}],
    "stream": true
  }'
```

### Models List

```bash
curl http://localhost:8787/v1/models
```

### Health Check

```bash
curl http://localhost:8787/health
```

## 🆚 Docker vs Cloudflare Workers

| Feature | Docker | Cloudflare Workers |
|---------|--------|-------------------|
| **Deployment** | Self-hosted | Serverless |
| **Scaling** | Manual/Orchestrator | Automatic |
| **Cold Starts** | None (always warm) | ~10-50ms |
| **Cost** | Infrastructure costs | Pay-per-request |
| **Customization** | Full control | Limited runtime |
| **Maintenance** | Manual updates | Automatic platform updates |
| **Geographic Distribution** | Single region | Global edge network |
| **Storage** | Persistent volumes | KV with expiration |
| **Dependencies** | Full Node.js ecosystem | Limited runtime |

### Choose Docker when you need:

- **Full control** over the runtime environment
- **No cold start delays** for consistent performance
- **Custom dependencies** or system-level access
- **On-premises deployment** or private cloud
- **Persistent storage** without expiration limits
- **Advanced monitoring** and logging capabilities

### Choose Cloudflare Workers when you need:

- **Zero infrastructure management** (deploy globally with one command)
- **Automatic scaling** based on request load
- **Pay-per-use pricing** (no fixed infrastructure costs)
- **Global edge deployment** for worldwide users
- **Automatic platform updates** and maintenance

## 📚 Additional Resources

- [Main Documentation](../README.md)
- [Authentication Guide](./authentication.md)
- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Reference](https://docs.docker.com/compose/compose-file/)
- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)

## 🐛 Common Issues

### Port Already in Use

```bash
# Check what's using port 8787
lsof -i :8787

# Use different port
docker-compose up -d -p 8788:8787
```

### Permission Errors

```bash
# Fix ownership issues
sudo chown -R $USER:$USER .
chmod -R 755 .
```

### Memory Issues

```bash
# Increase Docker memory limit
# Docker Desktop: Settings → Resources → Memory → Increase limit
# Linux: Edit /etc/docker/daemon.json
```

### Build Failures

```bash
# Clean build (remove cache)
docker-compose down
docker system prune -f
docker-compose up -d --build --force-recreate
```

### OAuth Authentication Issues

```bash
# Check QWEN_CLI_AUTH format
docker-compose logs qwen-code-wrapper | grep "loadInitialCredentials"

# Verify credentials are loaded
docker-compose exec qwen-code-wrapper cat /app/.mf/qwen_oauth_credentials.json
```

### Network Connectivity

```bash
# Test connection to Qwen API
docker-compose exec qwen-code-wrapper curl -I https://api-inference.modelscope.cn/v1

# Check DNS resolution
docker-compose exec qwen-code-wrapper nslookup api-inference.modelscope.cn
```

For additional support, please check the [main documentation](../README.md) or open an issue on GitHub.