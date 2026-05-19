# YAML and JSON for DevOps

> Almost every DevOps tool uses YAML or JSON for configuration.
> Kubernetes, Docker Compose, GitHub Actions, Ansible — all use YAML.
> AWS APIs, Terraform outputs, API responses — all use JSON.

---

## JSON — JavaScript Object Notation

```json
{
  "name": "my-api",
  "version": "1.5.2",
  "port": 8080,
  "enabled": true,
  "tags": ["production", "api", "v2"],
  "database": {
    "host": "postgres.internal",
    "port": 5432,
    "name": "mydb"
  },
  "servers": [
    { "name": "web1", "ip": "10.0.1.10" },
    { "name": "web2", "ip": "10.0.1.11" }
  ]
}
```

**JSON rules:**
- Keys must be in double quotes
- No comments allowed
- No trailing commas
- Values: string, number, boolean, null, object, array

```bash
# Parse JSON with jq (must-have tool)
sudo apt install jq

# Get a field
echo '{"name":"my-api","port":8080}' | jq '.name'
# "my-api"

# Get nested field
cat config.json | jq '.database.host'
# "postgres.internal"

# Get array element
cat config.json | jq '.servers[0].ip'
# "10.0.1.10"

# Get all IPs from array
cat config.json | jq '.servers[].ip'

# Filter + format
aws ec2 describe-instances | jq '.Reservations[].Instances[] | {id: .InstanceId, ip: .PrivateIpAddress}'

# Useful jq options
jq -r '.name'         # raw output (no quotes)
jq -c '.'             # compact (single line)
jq '.'                # pretty print

# Check if field exists
cat config.json | jq 'has("database")'
# true

# Update a value
cat config.json | jq '.port = 9090'
```

---

## YAML — YAML Ain't Markup Language

YAML is like JSON but easier to read.

```yaml
# This is a comment
name: my-api
version: 1.5.2
port: 8080
enabled: true

# Nested object (use 2 spaces for indentation — never tabs!)
database:
  host: postgres.internal
  port: 5432
  name: mydb

# Array (list)
tags:
  - production
  - api
  - v2

# Array of objects
servers:
  - name: web1
    ip: 10.0.1.10
  - name: web2
    ip: 10.0.1.11

# Multi-line string (| preserves newlines)
startup_script: |
  #!/bin/bash
  echo "Starting server..."
  systemctl start nginx

# Multi-line string (> folds into one line)
description: >
  This is a long description that
  wraps across multiple lines but
  becomes one line in the output.

# Null value
backup_path: null
# or
backup_path: ~

# Boolean values
debug: false
verbose: true
```

---

## YAML in Kubernetes

```yaml
# deployment.yaml — Deploy an app on Kubernetes
apiVersion: apps/v1
kind: Deployment
metadata:
  name: my-api
  namespace: production
  labels:
    app: my-api
    version: v1.5.2
spec:
  replicas: 3                   # run 3 copies
  selector:
    matchLabels:
      app: my-api
  template:
    metadata:
      labels:
        app: my-api
    spec:
      containers:
        - name: my-api
          image: myregistry/my-api:v1.5.2
          ports:
            - containerPort: 8080
          env:
            - name: APP_ENV
              value: "production"
            - name: DB_HOST
              valueFrom:
                secretKeyRef:
                  name: db-credentials
                  key: host
          resources:
            requests:             # minimum needed
              memory: "128Mi"
              cpu: "100m"
            limits:               # maximum allowed
              memory: "256Mi"
              cpu: "500m"
          livenessProbe:          # is the app alive?
            httpGet:
              path: /health
              port: 8080
            initialDelaySeconds: 30
            periodSeconds: 10
          readinessProbe:         # is the app ready for traffic?
            httpGet:
              path: /ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
```

---

## YAML in Docker Compose

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    image: myregistry/my-api:v1.5.2
    ports:
      - "8080:8080"             # host:container
    environment:
      - APP_ENV=production
      - DATABASE_URL=postgresql://user:pass@db:5432/mydb
    depends_on:
      db:
        condition: service_healthy
    networks:
      - backend
    volumes:
      - ./config:/app/config:ro  # :ro = read only
    restart: unless-stopped

  db:
    image: postgres:15
    environment:
      POSTGRES_DB: mydb
      POSTGRES_USER: user
      POSTGRES_PASSWORD: pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U user -d mydb"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - backend

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass mypassword
    networks:
      - backend

networks:
  backend:
    driver: bridge

volumes:
  postgres_data:
```

---

## YAML in GitHub Actions

```yaml
# .github/workflows/deploy.yml
name: Deploy to Production

on:
  push:
    branches:
      - main
  workflow_dispatch:             # allow manual trigger

env:
  IMAGE_NAME: my-api
  REGISTRY: ghcr.io

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run tests
        run: npm test

  build-and-push:
    needs: test
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
    steps:
      - uses: actions/checkout@v4

      - name: Login to registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ env.REGISTRY }}/${{ github.repository }}/${{ env.IMAGE_NAME }}:${{ github.sha }}

  deploy:
    needs: build-and-push
    runs-on: ubuntu-latest
    environment: production
    steps:
      - name: Deploy to EKS
        run: |
          aws eks update-kubeconfig --name my-cluster --region us-east-1
          kubectl set image deployment/my-api \
            my-api=${{ env.REGISTRY }}/${{ github.repository }}/${{ env.IMAGE_NAME }}:${{ github.sha }}
          kubectl rollout status deployment/my-api --timeout=300s
```

---

## YAML in Ansible

```yaml
# playbook.yml
---
- name: Configure web servers
  hosts: web_servers
  become: yes           # use sudo

  vars:
    app_user: devops
    app_dir: /opt/my-api
    nginx_port: 80

  tasks:
    - name: Install required packages
      apt:
        name:
          - nginx
          - curl
          - git
        state: present
        update_cache: yes

    - name: Create app directory
      file:
        path: "{{ app_dir }}"
        state: directory
        owner: "{{ app_user }}"
        mode: '0755'

    - name: Copy nginx config
      template:
        src: nginx.conf.j2
        dest: /etc/nginx/sites-available/my-api
      notify:
        - Reload nginx

    - name: Start and enable nginx
      systemd:
        name: nginx
        state: started
        enabled: yes

  handlers:
    - name: Reload nginx
      systemd:
        name: nginx
        state: reloaded
```

---

## Validate YAML and JSON

```bash
# Validate YAML
python3 -c "import yaml; yaml.safe_load(open('config.yaml'))" && echo "Valid YAML"

# Install yamllint
pip install yamllint
yamllint deployment.yaml

# Validate JSON
python3 -m json.tool config.json > /dev/null && echo "Valid JSON"
# or
jq . config.json > /dev/null && echo "Valid JSON"

# Convert JSON to YAML
python3 -c "import json,yaml; print(yaml.dump(json.load(open('config.json'))))"

# Convert YAML to JSON
python3 -c "import json,yaml; print(json.dumps(yaml.safe_load(open('config.yaml')), indent=2))"

# Validate Kubernetes YAML
kubectl --dry-run=client apply -f deployment.yaml
```

---

## Common YAML Mistakes

```yaml
# WRONG — using tabs (use 2 spaces always)
name: my-api
	port: 8080    # TAB here — ERROR!

# CORRECT
name: my-api
  port: 8080    # 2 spaces

# WRONG — string that looks like a number
version: 1.10   # YAML reads this as 1.1 (drops trailing zero!)

# CORRECT
version: "1.10"  # quote it

# WRONG — boolean-like strings
enabled: yes    # YAML reads as true
enabled: no     # YAML reads as false
enabled: on     # YAML reads as true
enabled: off    # YAML reads as false

# CORRECT (if you want string)
enabled: "yes"

# WRONG — null confusion
value:          # this is null, not empty string!

# CORRECT
value: ""       # empty string
value: null     # explicit null
```

---

## Interview Questions — YAML and JSON

**Q: What is the difference between YAML and JSON?**
> "Both are data formats used for configuration. JSON is strict — no comments,
> keys in double quotes, no trailing commas. YAML is more human-readable —
> it supports comments, uses indentation for structure, and has simpler syntax.
> Kubernetes uses YAML, AWS CLI returns JSON. For complex configs I prefer YAML;
> for API responses I work with JSON using jq."

**Q: How do you validate a Kubernetes YAML file before applying it?**
> "`kubectl --dry-run=client apply -f deployment.yaml` — this validates the file
> against the Kubernetes schema without actually creating anything. I also use
> `yamllint` for syntax checking and `kubeval` for schema validation in CI pipelines."

---

[← Previous: Bash Scripting](./04-bash-scripting.md) | [Next: Git and GitHub →](./06-git-github.md)
