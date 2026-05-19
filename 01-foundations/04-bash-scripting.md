# Bash Scripting for DevOps

> Bash is the language of automation in DevOps.
> If you can write Bash, you can automate almost anything on a Linux server.

---

## Bash Basics

```bash
#!/bin/bash
# This line is called "shebang" — it tells the OS to use bash

# Run the script
chmod +x my-script.sh
./my-script.sh

# Or directly
bash my-script.sh
```

---

## Variables

```bash
#!/bin/bash

# Define variables (no spaces around =)
NAME="production"
PORT=8080
DB_HOST="postgres.internal"

# Use variables with $
echo "Deploying to: $NAME"
echo "Port: $PORT"

# Command output as variable
CURRENT_DATE=$(date +%Y-%m-%d)
HOSTNAME=$(hostname)
FREE_MEM=$(free -m | awk 'NR==2{print $4}')

echo "Date: $CURRENT_DATE"
echo "Server: $HOSTNAME"
echo "Free memory: ${FREE_MEM}MB"

# Special variables
echo "Script name: $0"
echo "First argument: $1"
echo "Second argument: $2"
echo "All arguments: $@"
echo "Number of arguments: $#"
echo "Last exit code: $?"
echo "Current process ID: $$"
```

---

## Input and Output

```bash
#!/bin/bash

# Read user input
read -p "Enter environment (dev/staging/prod): " ENV
echo "Deploying to: $ENV"

# Prompt with default
read -p "Port [8080]: " PORT
PORT=${PORT:-8080}    # use 8080 if empty

# Read password (hidden)
read -s -p "Enter password: " PASSWORD
echo ""    # new line after hidden input

# Output to stderr (for errors)
echo "ERROR: File not found" >&2

# Redirect output
./script.sh > output.log 2>&1          # stdout and stderr to file
./script.sh >> output.log 2>&1         # append
./script.sh 2>/dev/null                # throw away errors
```

---

## Conditionals

```bash
#!/bin/bash

ENV="production"

# if/elif/else
if [ "$ENV" == "production" ]; then
    echo "CAUTION: This is production!"
elif [ "$ENV" == "staging" ]; then
    echo "Deploying to staging"
else
    echo "Deploying to dev"
fi

# File checks
if [ -f "/etc/nginx/nginx.conf" ]; then
    echo "Nginx config exists"
fi

if [ -d "/opt/app" ]; then
    echo "App directory exists"
else
    mkdir -p /opt/app
    echo "Created app directory"
fi

if [ ! -f "config.yml" ]; then
    echo "ERROR: config.yml not found" >&2
    exit 1
fi

# Numeric comparisons
COUNT=5
if [ $COUNT -gt 10 ]; then echo "More than 10"; fi
if [ $COUNT -lt 10 ]; then echo "Less than 10"; fi
if [ $COUNT -eq 5 ];  then echo "Exactly 5"; fi
if [ $COUNT -ne 0 ];  then echo "Not zero"; fi

# String comparisons
STATUS="running"
if [ "$STATUS" == "running" ]; then echo "Service is up"; fi
if [ -z "$STATUS" ];  then echo "Empty string"; fi
if [ -n "$STATUS" ];  then echo "Not empty"; fi

# Check command exit code
if curl -s http://localhost:8080/health > /dev/null; then
    echo "Health check passed"
else
    echo "Health check FAILED"
    exit 1
fi
```

---

## Loops

```bash
#!/bin/bash

# for loop — list
for SERVER in web1 web2 web3; do
    echo "Restarting nginx on $SERVER"
    ssh ec2-user@$SERVER "sudo systemctl restart nginx"
done

# for loop — range
for i in {1..5}; do
    echo "Attempt $i"
done

# for loop — files
for FILE in /var/log/app/*.log; do
    echo "Processing: $FILE"
    gzip "$FILE"
done

# while loop
RETRY=0
MAX_RETRIES=5
while [ $RETRY -lt $MAX_RETRIES ]; do
    if curl -s http://localhost:8080/health | grep -q "ok"; then
        echo "App is healthy!"
        break
    fi
    RETRY=$((RETRY + 1))
    echo "Retry $RETRY of $MAX_RETRIES..."
    sleep 5
done

if [ $RETRY -eq $MAX_RETRIES ]; then
    echo "ERROR: App did not start after $MAX_RETRIES retries" >&2
    exit 1
fi

# Read lines from a file
while IFS= read -r LINE; do
    echo "Processing: $LINE"
done < servers.txt
```

---

## Functions

```bash
#!/bin/bash

# Define function
check_health() {
    local URL=$1
    local EXPECTED=$2

    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" "$URL")

    if [ "$RESPONSE" == "$EXPECTED" ]; then
        echo "OK: $URL returned $RESPONSE"
        return 0
    else
        echo "FAIL: $URL returned $RESPONSE (expected $EXPECTED)" >&2
        return 1
    fi
}

deploy_service() {
    local SERVICE=$1
    local VERSION=$2

    echo "Deploying $SERVICE version $VERSION"
    kubectl set image deployment/$SERVICE \
        $SERVICE=myregistry/$SERVICE:$VERSION

    # Wait for rollout
    kubectl rollout status deployment/$SERVICE --timeout=300s
    local EXIT_CODE=$?

    if [ $EXIT_CODE -ne 0 ]; then
        echo "ERROR: Deployment failed, rolling back..."
        kubectl rollout undo deployment/$SERVICE
        return 1
    fi

    echo "Deployment of $SERVICE $VERSION successful!"
}

log() {
    local LEVEL=$1
    shift
    local MESSAGE=$@
    local TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[$TIMESTAMP] [$LEVEL] $MESSAGE"
}

# Use functions
check_health "http://localhost:8080/health" "200"
deploy_service "api-service" "v1.5.2"
log "INFO" "Deployment complete"
log "ERROR" "Something went wrong"
```

---

## Real DevOps Scripts

### Deployment Script

```bash
#!/bin/bash
# deploy.sh — Deploy application to server
set -euo pipefail   # exit on error, undefined vars, pipe failures

# Configuration
APP_NAME="${1:?Usage: $0 <app-name> <version>}"
VERSION="${2:?Usage: $0 <app-name> <version>}"
DEPLOY_DIR="/opt/apps/$APP_NAME"
BACKUP_DIR="/opt/backups/$APP_NAME"
LOG_FILE="/var/log/deploy/$APP_NAME.log"

# Ensure directories exist
mkdir -p "$DEPLOY_DIR" "$BACKUP_DIR" "$(dirname $LOG_FILE)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }

log "Starting deployment: $APP_NAME $VERSION"

# Create backup
if [ -d "$DEPLOY_DIR/current" ]; then
    BACKUP="$BACKUP_DIR/backup-$(date +%Y%m%d-%H%M%S)"
    cp -r "$DEPLOY_DIR/current" "$BACKUP"
    log "Backup created: $BACKUP"
fi

# Download new version
log "Downloading $APP_NAME $VERSION..."
aws s3 cp "s3://my-artifacts/$APP_NAME/$VERSION.tar.gz" /tmp/app.tar.gz

# Extract
tar -xzf /tmp/app.tar.gz -C "$DEPLOY_DIR"

# Run database migrations
if [ -f "$DEPLOY_DIR/$VERSION/migrate.sh" ]; then
    log "Running migrations..."
    bash "$DEPLOY_DIR/$VERSION/migrate.sh"
fi

# Update symlink
ln -sfn "$DEPLOY_DIR/$VERSION" "$DEPLOY_DIR/current"

# Restart service
log "Restarting $APP_NAME..."
systemctl restart "$APP_NAME"

# Wait and verify
sleep 10
if systemctl is-active --quiet "$APP_NAME"; then
    log "SUCCESS: $APP_NAME $VERSION is running"
else
    log "ERROR: Service failed to start, rolling back..."
    if [ -n "$BACKUP" ]; then
        ln -sfn "$BACKUP" "$DEPLOY_DIR/current"
        systemctl restart "$APP_NAME"
    fi
    exit 1
fi
```

### Health Check Script

```bash
#!/bin/bash
# health-check.sh — Check all services and send alerts

SERVICES=("nginx" "postgresql" "redis" "my-api")
SLACK_WEBHOOK="${SLACK_WEBHOOK_URL:?SLACK_WEBHOOK_URL not set}"
FAILED_SERVICES=()

check_service() {
    local SERVICE=$1
    if ! systemctl is-active --quiet "$SERVICE"; then
        echo "FAIL: $SERVICE is not running"
        FAILED_SERVICES+=("$SERVICE")
        return 1
    fi
    echo "OK: $SERVICE"
}

send_slack_alert() {
    local MESSAGE=$1
    curl -s -X POST "$SLACK_WEBHOOK" \
        -H "Content-Type: application/json" \
        -d "{\"text\": \"$MESSAGE\"}" \
        > /dev/null
}

for SERVICE in "${SERVICES[@]}"; do
    check_service "$SERVICE"
done

if [ ${#FAILED_SERVICES[@]} -gt 0 ]; then
    MSG=":red_circle: ALERT: Failed services on $(hostname): ${FAILED_SERVICES[*]}"
    send_slack_alert "$MSG"
    echo "Alert sent to Slack"
    exit 1
fi

echo "All services are healthy"
```

### Log Rotation and Cleanup Script

```bash
#!/bin/bash
# cleanup.sh — Clean old logs and backups

LOG_DIR="/var/log/app"
BACKUP_DIR="/opt/backups"
MAX_LOG_DAYS=30
MAX_BACKUP_DAYS=7

echo "Cleaning logs older than $MAX_LOG_DAYS days..."
find "$LOG_DIR" -name "*.log" -mtime +$MAX_LOG_DAYS -delete
find "$LOG_DIR" -name "*.log.gz" -mtime +$MAX_LOG_DAYS -delete

echo "Cleaning backups older than $MAX_BACKUP_DAYS days..."
find "$BACKUP_DIR" -name "backup-*" -mtime +$MAX_BACKUP_DAYS -exec rm -rf {} + 2>/dev/null

# Compress logs older than 3 days
find "$LOG_DIR" -name "*.log" -mtime +3 -not -name "*.gz" | while read FILE; do
    gzip "$FILE"
    echo "Compressed: $FILE"
done

# Report disk usage
echo "Disk usage after cleanup:"
df -h "$LOG_DIR" "$BACKUP_DIR"
```

---

## Using AI to Write Bash Scripts

```bash
# With GitHub Copilot or alpaquitay-ai, describe what you want:
# "Write a bash script that checks if a Docker container is healthy,
#  restarts it if not, and sends a Slack alert if restart fails"

# With Gemini CLI:
gemini "write a bash script that monitors disk usage
        and alerts when it exceeds 80%"

# Always review AI-generated scripts:
# 1. Check for security issues (command injection, etc.)
# 2. Test in a non-production environment first
# 3. Add error handling if missing
# 4. Add logging
```

---

## Interview Questions — Bash

**Q: Write a script that checks if a port is open and retries 5 times.**
```bash
#!/bin/bash
check_port() {
    local HOST=$1 PORT=$2 RETRIES=5 WAIT=5
    for i in $(seq 1 $RETRIES); do
        if nc -zw3 "$HOST" "$PORT"; then
            echo "Port $PORT is open on $HOST"
            return 0
        fi
        echo "Attempt $i/$RETRIES failed. Waiting ${WAIT}s..."
        sleep $WAIT
    done
    echo "ERROR: Port $PORT not reachable after $RETRIES attempts"
    return 1
}
check_port "database.internal" "5432"
```

**Q: What does `set -euo pipefail` do?**
> "`-e` exits the script if any command fails. `-u` exits if you use an undefined variable.
> `-o pipefail` makes pipelines fail if any command in the pipe fails.
> Together, they make scripts safer and easier to debug."

---

[← Previous: Networking](./03-networking-basics.md) | [Next: YAML and JSON →](./05-yaml-json.md)
