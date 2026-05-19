# Docker Fundamentals

> Docker makes "it works on my machine" a thing of the past.
> Build once, run anywhere.

---

## Install Docker

```bash
# Ubuntu
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (no sudo needed)
sudo usermod -aG docker $USER
newgrp docker

# Verify
docker --version
docker run hello-world

# Docker Compose
sudo apt install docker-compose-plugin -y
docker compose version
```

---

## Docker Core Concepts

```
Image    → blueprint (read-only)
Container → running instance of an image
Registry  → storage for images (Docker Hub, ECR, GHCR)
Volume    → persistent storage for containers
Network   → communication between containers
```

---

## Essential Docker Commands

```bash
# ── Images ────────────────────────────────────────────────
# Pull an image from registry
docker pull nginx:latest
docker pull postgres:15-alpine

# List images
docker images
docker images ls

# Remove image
docker rmi nginx:latest
docker image prune -a      # remove all unused images

# ── Containers ────────────────────────────────────────────
# Run a container
docker run nginx                           # runs and attaches
docker run -d nginx                        # run in background
docker run -d --name my-nginx nginx        # with a name
docker run -d -p 8080:80 nginx             # map ports: host:container
docker run -d -p 8080:80 -v /data:/usr/share/nginx/html nginx  # mount volume

# Run interactively (for debugging)
docker run -it ubuntu:22.04 bash
docker run -it --rm alpine sh             # --rm removes container after exit

# List containers
docker ps                    # running containers
docker ps -a                 # all containers (including stopped)

# Start/stop/restart
docker start my-nginx
docker stop my-nginx
docker restart my-nginx

# Execute command in running container
docker exec -it my-nginx bash
docker exec my-nginx nginx -t             # test nginx config

# View logs
docker logs my-nginx
docker logs -f my-nginx                   # follow logs
docker logs --tail 100 my-nginx
docker logs --since 1h my-nginx

# Inspect container
docker inspect my-nginx
docker inspect my-nginx | jq '.[0].NetworkSettings.IPAddress'

# Copy files
docker cp my-nginx:/etc/nginx/nginx.conf ./nginx.conf  # from container
docker cp ./nginx.conf my-nginx:/etc/nginx/nginx.conf  # to container

# Remove containers
docker rm my-nginx                        # must be stopped
docker rm -f my-nginx                     # force remove (running)
docker container prune                    # remove all stopped containers
```

---

## Dockerfile — Build Your Own Image

```dockerfile
# Dockerfile for a Node.js API

# Base image
FROM node:20-alpine

# Set working directory inside container
WORKDIR /app

# Copy package files first (for better caching)
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY src/ ./src/

# Create non-root user (security best practice)
RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs

# Change ownership
RUN chown -R appuser:nodejs /app

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget -q -O - http://localhost:8080/health || exit 1

# Start command
CMD ["node", "src/server.js"]
```

```bash
# Build the image
docker build -t my-api:v1.0.0 .
docker build -t my-api:v1.0.0 -f Dockerfile.production .

# Tag for registry
docker tag my-api:v1.0.0 myregistry.com/my-api:v1.0.0
docker tag my-api:v1.0.0 myregistry.com/my-api:latest

# Push to registry
docker push myregistry.com/my-api:v1.0.0
docker push myregistry.com/my-api:latest

# Run your image
docker run -d \
    --name my-api \
    -p 8080:8080 \
    -e APP_ENV=production \
    -e DATABASE_URL=postgres://... \
    --restart unless-stopped \
    myregistry.com/my-api:v1.0.0
```

---

## Multi-Stage Build — Smaller, Safer Images

```dockerfile
# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: Run (much smaller!)
FROM node:20-alpine AS production

WORKDIR /app

# Only copy what we need
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package*.json ./

RUN npm ci --only=production

RUN addgroup -g 1001 -S nodejs && \
    adduser -S appuser -u 1001 -G nodejs
USER appuser

EXPOSE 8080
CMD ["node", "dist/server.js"]
```

```bash
# Why multi-stage?
# Without multi-stage: image ~800MB (includes dev dependencies, source code)
# With multi-stage:    image ~120MB (only production code and deps)

# Inspect image size
docker images | grep my-api
docker history my-api:latest    # see each layer
```

---

## Docker Networking

```bash
# List networks
docker network ls

# Network types:
# bridge  → default, containers talk to each other by name
# host    → container uses host networking (no isolation)
# none    → no networking
# overlay → multi-host (Docker Swarm)

# Create custom network
docker network create my-network

# Run containers on same network (they can reach each other by name!)
docker run -d --name postgres --network my-network postgres:15
docker run -d --name api --network my-network -e DB_HOST=postgres my-api

# Inside api container, you can connect to "postgres:5432"
# Docker DNS resolves container names automatically

# Inspect network
docker network inspect my-network

# Connect existing container to network
docker network connect my-network existing-container
```

---

## Docker Volumes — Persistent Storage

```bash
# Problem: containers are ephemeral — data is lost when container stops

# Solution 1: Named volume (managed by Docker)
docker volume create my-data
docker run -v my-data:/var/lib/postgresql/data postgres:15

# Solution 2: Bind mount (use host directory)
docker run -v /host/path:/container/path nginx

# Solution 3: tmpfs (memory, faster but not persistent)
docker run --tmpfs /tmp my-app

# Manage volumes
docker volume ls
docker volume inspect my-data
docker volume rm my-data
docker volume prune          # remove unused volumes

# Backup a volume
docker run --rm \
    -v my-data:/source \
    -v $(pwd):/backup \
    alpine tar czf /backup/backup.tar.gz -C /source .

# Restore
docker run --rm \
    -v my-data:/target \
    -v $(pwd):/backup \
    alpine tar xzf /backup/backup.tar.gz -C /target
```

---

## Docker in Production — Best Practices

```bash
# 1. Always use specific version tags (not :latest in production)
FROM postgres:15.3-alpine    # good
FROM postgres:latest         # bad — might break when version changes

# 2. Scan images for vulnerabilities
docker scout cves my-image:latest
trivy image my-image:latest

# 3. Never run as root
USER appuser    # in Dockerfile

# 4. Use .dockerignore
cat .dockerignore
node_modules/
.git/
*.log
.env
*.test.js
coverage/
.DS_Store

# 5. Limit container resources
docker run \
    --memory=512m \
    --cpus=0.5 \
    my-api

# 6. Use health checks
HEALTHCHECK --interval=30s --timeout=10s \
    CMD curl -f http://localhost:8080/health || exit 1

# 7. Log to stdout/stderr (not to files)
# Docker collects stdout/stderr automatically
# docker logs works with this
# Centralized logging (CloudWatch, ELK) can pick it up
```

---

## Docker System Maintenance

```bash
# See disk usage
docker system df

# Clean everything (CAREFUL in production!)
docker system prune -a --volumes

# Clean step by step
docker container prune       # remove stopped containers
docker image prune -a        # remove unused images
docker volume prune          # remove unused volumes
docker network prune         # remove unused networks

# Remove old images (keep last 3 tags)
docker images | grep my-api | tail -n +4 | awk '{print $3}' | xargs docker rmi
```

---

## Interview Questions — Docker

**Q: What is the difference between an image and a container?**
> "An image is a read-only blueprint — it contains the application code, runtime,
> libraries, and config. Think of it like a class in object-oriented programming.
> A container is a running instance of an image — it has its own filesystem, process,
> and network. You can run multiple containers from the same image, each isolated
> from the others."

**Q: Why use multi-stage builds?**
> "Multi-stage builds separate the build environment from the runtime environment.
> The build stage needs compilers, dev dependencies, test frameworks — all large tools
> that you don't need in production. The final stage only copies the compiled output.
> This makes images much smaller (sometimes 10x smaller), faster to pull, and reduces
> the attack surface — fewer packages means fewer vulnerabilities."

**Q: How do you pass configuration to containers without hardcoding it?**
> "Environment variables are the standard way — either with `-e` flag in docker run or
> in docker-compose under `environment`. For secrets, I use Docker Secrets or integrate
> with a secrets manager like AWS Secrets Manager. The app reads secrets from environment
> variables at startup. Never bake secrets into the image — anyone who has the image
> can extract them."

---

[← Back to Section](./README.md) | [Next: Docker Advanced →](./02-docker-advanced.md)
