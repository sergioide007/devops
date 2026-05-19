# On-Premise DevOps Platform — From Zero

> Build a complete on-premise DevOps infrastructure.
> This is what a bank or enterprise with data sovereignty requirements needs.
> We use Vagrant for the lab. On real hardware, skip the Vagrant parts.

---

## Architecture We Will Build

```
On-Premise Network: 192.168.56.0/24

┌─────────────────────────────────────────────────┐
│  control01  192.168.56.10  — Kubernetes master   │
│  worker01   192.168.56.11  — Kubernetes worker   │
│  worker02   192.168.56.12  — Kubernetes worker   │
│  services   192.168.56.20  — Jenkins, Nexus,     │
│                               SonarQube, Gitea   │
│  monitoring 192.168.56.30  — Prometheus, Grafana,│
│                               Loki, AlertManager │
└─────────────────────────────────────────────────┘
```

---

## Step 1: Create the Lab Environment with Vagrant

```ruby
# Vagrantfile — place in an empty directory
# Run: vagrant up

Vagrant.configure("2") do |config|

  # All VMs use Ubuntu 22.04
  config.vm.box = "ubuntu/jammy64"

  # Kubernetes control plane
  config.vm.define "control01" do |node|
    node.vm.hostname = "control01"
    node.vm.network "private_network", ip: "192.168.56.10"
    node.vm.provider "virtualbox" do |vb|
      vb.memory = "4096"
      vb.cpus = 2
      vb.name = "k8s-control01"
    end
    node.vm.provision "shell", path: "scripts/common.sh"
    node.vm.provision "shell", path: "scripts/control-plane.sh"
  end

  # Kubernetes workers
  [1, 2].each do |i|
    config.vm.define "worker0#{i}" do |node|
      node.vm.hostname = "worker0#{i}"
      node.vm.network "private_network", ip: "192.168.56.1#{i}"
      node.vm.provider "virtualbox" do |vb|
        vb.memory = "3072"
        vb.cpus = 2
        vb.name = "k8s-worker0#{i}"
      end
      node.vm.provision "shell", path: "scripts/common.sh"
      node.vm.provision "shell", path: "scripts/worker.sh"
    end
  end

  # Services VM (Jenkins, Nexus, SonarQube, Gitea)
  config.vm.define "services" do |node|
    node.vm.hostname = "services"
    node.vm.network "private_network", ip: "192.168.56.20"
    node.vm.provider "virtualbox" do |vb|
      vb.memory = "8192"
      vb.cpus = 4
      vb.name = "devops-services"
    end
    node.vm.provision "shell", path: "scripts/common.sh"
    node.vm.provision "shell", path: "scripts/services.sh"
  end

  # Monitoring VM
  config.vm.define "monitoring" do |node|
    node.vm.hostname = "monitoring"
    node.vm.network "private_network", ip: "192.168.56.30"
    node.vm.provider "virtualbox" do |vb|
      vb.memory = "4096"
      vb.cpus = 2
      vb.name = "devops-monitoring"
    end
    node.vm.provision "shell", path: "scripts/common.sh"
    node.vm.provision "shell", path: "scripts/monitoring.sh"
  end

end
```

```bash
# Create directories
mkdir -p lab/scripts
cd lab

# Start all VMs
vagrant up

# Or start one at a time
vagrant up control01
vagrant up worker01 worker02
vagrant up services
vagrant up monitoring

# SSH into a VM
vagrant ssh control01
```

---

## Step 2: Common Setup Script (All Servers)

```bash
#!/bin/bash
# scripts/common.sh — runs on every VM

set -euo pipefail

echo "=== Updating system ==="
apt-get update -qq
apt-get upgrade -y -qq

echo "=== Installing common tools ==="
apt-get install -y -qq \
    curl \
    wget \
    git \
    vim \
    htop \
    jq \
    net-tools \
    nfs-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release \
    software-properties-common

echo "=== Setting up /etc/hosts ==="
cat >> /etc/hosts <<EOF
192.168.56.10 control01
192.168.56.11 worker01
192.168.56.12 worker02
192.168.56.20 services jenkins.local nexus.local sonarqube.local gitea.local
192.168.56.30 monitoring grafana.local prometheus.local
EOF

echo "=== Configuring SSH ==="
# Allow vagrant user to sudo without password (for Ansible later)
echo "vagrant ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/vagrant
chmod 440 /etc/sudoers.d/vagrant

echo "=== Setting timezone ==="
timedatectl set-timezone America/Lima

echo "=== Common setup complete ==="
```

---

## Step 3: Kubernetes Cluster Setup

```bash
#!/bin/bash
# scripts/control-plane.sh — Kubernetes master node

set -euo pipefail

KUBERNETES_VERSION="1.30"
POD_CIDR="10.244.0.0/16"
CONTROL_IP="192.168.56.10"

echo "=== Disabling swap (required by Kubernetes) ==="
swapoff -a
sed -i '/swap/d' /etc/fstab

echo "=== Loading kernel modules ==="
cat > /etc/modules-load.d/k8s.conf <<EOF
overlay
br_netfilter
EOF

modprobe overlay
modprobe br_netfilter

cat > /etc/sysctl.d/k8s.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.bridge.bridge-nf-call-ip6tables = 1
net.ipv4.ip_forward                 = 1
EOF

sysctl --system

echo "=== Installing containerd (container runtime) ==="
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list

apt-get update -qq
apt-get install -y containerd.io

# Configure containerd to use systemd cgroup driver
mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd
systemctl enable containerd

echo "=== Installing Kubernetes components ==="
curl -fsSL https://pkgs.k8s.io/core:/stable:/v${KUBERNETES_VERSION}/deb/Release.key \
    | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg

echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] \
    https://pkgs.k8s.io/core:/stable:/v${KUBERNETES_VERSION}/deb/ /" \
    > /etc/apt/sources.list.d/kubernetes.list

apt-get update -qq
apt-get install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl   # prevent accidental upgrades

echo "=== Initializing Kubernetes control plane ==="
kubeadm init \
    --apiserver-advertise-address=$CONTROL_IP \
    --pod-network-cidr=$POD_CIDR \
    --node-name control01

echo "=== Configuring kubectl for vagrant user ==="
mkdir -p /home/vagrant/.kube
cp /etc/kubernetes/admin.conf /home/vagrant/.kube/config
chown -R vagrant:vagrant /home/vagrant/.kube

echo "=== Installing Calico CNI (network plugin) ==="
sudo -u vagrant kubectl apply -f \
    https://raw.githubusercontent.com/projectcalico/calico/v3.27.0/manifests/calico.yaml

echo "=== Saving join command for workers ==="
kubeadm token create --print-join-command > /vagrant/join-command.sh
chmod +x /vagrant/join-command.sh

echo "=== Control plane setup complete! ==="
echo "Run: vagrant ssh control01 -- kubectl get nodes"
```

```bash
#!/bin/bash
# scripts/worker.sh — Kubernetes worker node

set -euo pipefail

KUBERNETES_VERSION="1.30"

# Reuse same swap and kernel setup
swapoff -a
sed -i '/swap/d' /etc/fstab

cat > /etc/modules-load.d/k8s.conf <<EOF
overlay
br_netfilter
EOF
modprobe overlay
modprobe br_netfilter

cat > /etc/sysctl.d/k8s.conf <<EOF
net.bridge.bridge-nf-call-iptables  = 1
net.ipv4.ip_forward                 = 1
EOF
sysctl --system

# Install containerd (same as control plane)
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
    https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" \
    > /etc/apt/sources.list.d/docker.list
apt-get update -qq && apt-get install -y containerd.io

mkdir -p /etc/containerd
containerd config default | tee /etc/containerd/config.toml
sed -i 's/SystemdCgroup = false/SystemdCgroup = true/' /etc/containerd/config.toml
systemctl restart containerd && systemctl enable containerd

# Install Kubernetes
curl -fsSL https://pkgs.k8s.io/core:/stable:/v${KUBERNETES_VERSION}/deb/Release.key \
    | gpg --dearmor -o /etc/apt/keyrings/kubernetes-apt-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/kubernetes-apt-keyring.gpg] \
    https://pkgs.k8s.io/core:/stable:/v${KUBERNETES_VERSION}/deb/ /" \
    > /etc/apt/sources.list.d/kubernetes.list
apt-get update -qq && apt-get install -y kubelet kubeadm kubectl
apt-mark hold kubelet kubeadm kubectl

echo "=== Joining cluster ==="
# The join command was saved by control01
bash /vagrant/join-command.sh

echo "=== Worker setup complete ==="
```

---

## Step 4: Install DevOps Services with Docker Compose

```bash
#!/bin/bash
# scripts/services.sh — Jenkins, Nexus, SonarQube, Gitea

set -euo pipefail

echo "=== Installing Docker ==="
curl -fsSL https://get.docker.com | sh
usermod -aG docker vagrant
systemctl enable docker

echo "=== Installing Docker Compose ==="
apt-get install -y docker-compose-plugin

echo "=== Creating directories ==="
mkdir -p /opt/devops/{jenkins,nexus,sonarqube,gitea,nginx}
chown -R vagrant:vagrant /opt/devops

echo "=== Creating docker-compose.yml ==="
cat > /opt/devops/docker-compose.yml << 'COMPOSE_EOF'
version: '3.8'

networks:
  devops:
    driver: bridge

volumes:
  jenkins_home:
  nexus_data:
  sonarqube_data:
  sonarqube_extensions:
  sonarqube_logs:
  postgres_data:
  gitea_data:

services:

  # ── Nginx Reverse Proxy ────────────────────────────────────────
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - jenkins
      - nexus
      - sonarqube
      - gitea
    networks:
      - devops
    restart: unless-stopped

  # ── Jenkins CI/CD ─────────────────────────────────────────────
  jenkins:
    image: jenkins/jenkins:lts-jdk17
    container_name: jenkins
    user: root
    ports:
      - "8080:8080"
      - "50000:50000"
    environment:
      JAVA_OPTS: "-Djenkins.install.runSetupWizard=false -Xmx2g"
    volumes:
      - jenkins_home:/var/jenkins_home
      - /var/run/docker.sock:/var/run/docker.sock
      - /usr/bin/docker:/usr/bin/docker
    networks:
      - devops
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/login"]
      interval: 30s
      timeout: 10s
      retries: 5

  # ── PostgreSQL for SonarQube ───────────────────────────────────
  postgres:
    image: postgres:15-alpine
    container_name: postgres
    environment:
      POSTGRES_USER: sonar
      POSTGRES_PASSWORD: sonar_password
      POSTGRES_DB: sonarqube
    volumes:
      - postgres_data:/var/lib/postgresql/data
    networks:
      - devops
    restart: unless-stopped

  # ── SonarQube Code Quality ─────────────────────────────────────
  sonarqube:
    image: sonarqube:10-community
    container_name: sonarqube
    depends_on:
      - postgres
    environment:
      SONAR_JDBC_URL: jdbc:postgresql://postgres:5432/sonarqube
      SONAR_JDBC_USERNAME: sonar
      SONAR_JDBC_PASSWORD: sonar_password
      SONAR_SEARCH_JAVAADDITIONALOPTS: "-Dnode.store.allow_mmap=false"
    volumes:
      - sonarqube_data:/opt/sonarqube/data
      - sonarqube_extensions:/opt/sonarqube/extensions
      - sonarqube_logs:/opt/sonarqube/logs
    ports:
      - "9000:9000"
    networks:
      - devops
    restart: unless-stopped
    ulimits:
      nofile:
        soft: 65536
        hard: 65536

  # ── Nexus Artifact Repository ──────────────────────────────────
  nexus:
    image: sonatype/nexus3:latest
    container_name: nexus
    environment:
      INSTALL4J_ADD_VM_PARAMS: "-Xms2g -Xmx2g -XX:MaxDirectMemorySize=3g"
    volumes:
      - nexus_data:/nexus-data
    ports:
      - "8081:8081"
      - "8082:8082"   # Docker registry port
    networks:
      - devops
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/service/rest/v1/status"]
      interval: 30s
      timeout: 10s
      retries: 10

  # ── Gitea Git Server ───────────────────────────────────────────
  gitea:
    image: gitea/gitea:latest
    container_name: gitea
    environment:
      USER_UID: "1000"
      USER_GID: "1000"
      GITEA__database__DB_TYPE: sqlite3
      GITEA__server__DOMAIN: gitea.local
      GITEA__server__SSH_DOMAIN: gitea.local
      GITEA__server__HTTP_PORT: "3000"
      GITEA__server__ROOT_URL: http://gitea.local
    volumes:
      - gitea_data:/data
    ports:
      - "3000:3000"
      - "2222:22"
    networks:
      - devops
    restart: unless-stopped

COMPOSE_EOF

echo "=== Nginx config ==="
cat > /opt/devops/nginx/nginx.conf << 'NGINX_EOF'
events { worker_connections 1024; }

http {
    server {
        listen 80;
        server_name jenkins.local;
        location / { proxy_pass http://jenkins:8080; proxy_set_header Host $host; }
    }
    server {
        listen 80;
        server_name nexus.local;
        location / { proxy_pass http://nexus:8081; proxy_set_header Host $host; }
    }
    server {
        listen 80;
        server_name sonarqube.local;
        location / { proxy_pass http://sonarqube:9000; proxy_set_header Host $host; }
    }
    server {
        listen 80;
        server_name gitea.local;
        location / { proxy_pass http://gitea:3000; proxy_set_header Host $host; }
    }
}
NGINX_EOF

# Fix SonarQube kernel requirement
echo "vm.max_map_count=524288" >> /etc/sysctl.conf
sysctl -w vm.max_map_count=524288

echo "=== Starting all services ==="
cd /opt/devops
docker compose up -d

echo "=== Waiting for services to start (60 seconds) ==="
sleep 60

echo "=== Service URLs ==="
echo "  Jenkins:    http://192.168.56.20:8080"
echo "  SonarQube:  http://192.168.56.20:9000  (admin/admin)"
echo "  Nexus:      http://192.168.56.20:8081"
echo "  Gitea:      http://192.168.56.20:3000"
echo ""
echo "Jenkins initial password:"
docker exec jenkins cat /var/jenkins_home/secrets/initialAdminPassword
```

---

## Step 5: Jenkins Initial Configuration (Automated)

```groovy
// /opt/devops/jenkins/init.groovy.d/00-basic-security.groovy
// Place this before starting Jenkins for zero-touch setup

import jenkins.model.*
import hudson.security.*
import jenkins.install.InstallState

def instance = Jenkins.getInstance()

// Create admin user
def hudsonRealm = new HudsonPrivateSecurityRealm(false)
hudsonRealm.createAccount("admin", "Admin@2026!")
instance.setSecurityRealm(hudsonRealm)

// Set authorization
def strategy = new FullControlOnceLoggedInAuthorizationStrategy()
strategy.setAllowAnonymousRead(false)
instance.setAuthorizationStrategy(strategy)

// Skip setup wizard
instance.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)
instance.save()
```

```bash
#!/bin/bash
# install-jenkins-plugins.sh — install required plugins

JENKINS_URL="http://192.168.56.20:8080"
JENKINS_USER="admin"
JENKINS_PASS="Admin@2026!"

# Wait for Jenkins to be ready
until curl -s -u $JENKINS_USER:$JENKINS_PASS "$JENKINS_URL/api/json" > /dev/null 2>&1; do
    echo "Waiting for Jenkins..."
    sleep 10
done

# Download Jenkins CLI
wget -q "$JENKINS_URL/jnlpJars/jenkins-cli.jar" -O jenkins-cli.jar

# Install plugins
PLUGINS=(
    "git"
    "github"
    "pipeline-stage-view"
    "blueocean"
    "docker-workflow"
    "kubernetes"
    "sonar"
    "nexus-artifact-uploader"
    "slack"
    "credentials"
    "aws-credentials"
    "configuration-as-code"   # JCasC — Jenkins config as code
)

for PLUGIN in "${PLUGINS[@]}"; do
    echo "Installing: $PLUGIN"
    java -jar jenkins-cli.jar \
        -s $JENKINS_URL \
        -auth $JENKINS_USER:$JENKINS_PASS \
        install-plugin $PLUGIN -deploy
done

# Restart Jenkins after installing plugins
java -jar jenkins-cli.jar -s $JENKINS_URL -auth $JENKINS_USER:$JENKINS_PASS safe-restart
echo "Jenkins restart triggered. Wait 60 seconds..."
```

---

## Step 6: Jenkins Configuration as Code (JCasC)

```yaml
# /opt/devops/jenkins/casc.yaml — Configure Jenkins declaratively
# Set env var: CASC_JENKINS_CONFIG=/opt/devops/jenkins/casc.yaml

jenkins:
  systemMessage: "DevOps Platform — Configured by JCasC"
  numExecutors: 0    # no builds on master — use agents only
  mode: EXCLUSIVE

  securityRealm:
    local:
      allowsSignup: false
      users:
        - id: "admin"
          password: "${JENKINS_ADMIN_PASSWORD}"   # from env var
        - id: "developer"
          password: "${JENKINS_DEV_PASSWORD}"

  authorizationStrategy:
    roleBased:
      roles:
        global:
          - name: "admin"
            permissions:
              - "Overall/Administer"
            assignments:
              - "admin"
          - name: "developer"
            permissions:
              - "Job/Build"
              - "Job/Read"
              - "View/Read"
            assignments:
              - "developer"

credentials:
  system:
    domainCredentials:
      - credentials:
          - usernamePassword:
              id: "nexus-credentials"
              username: "admin"
              password: "${NEXUS_PASSWORD}"
              description: "Nexus admin credentials"

          - string:
              id: "sonarqube-token"
              secret: "${SONARQUBE_TOKEN}"
              description: "SonarQube analysis token"

          - string:
              id: "slack-webhook"
              secret: "${SLACK_WEBHOOK_URL}"
              description: "Slack notifications webhook"

          - sshUserPrivateKey:
              id: "gitea-ssh"
              username: "jenkins"
              privateKeySource:
                directEntry:
                  privateKey: "${GITEA_SSH_PRIVATE_KEY}"

tool:
  git:
    installations:
      - name: "Default"
        home: "git"

  maven:
    installations:
      - name: "Maven 3.9"
        properties:
          - installSource:
              installers:
                - maven:
                    id: "3.9.6"

  nodejs:
    installations:
      - name: "Node 20"
        properties:
          - installSource:
              installers:
                - nodeJSInstaller:
                    id: "20.11.0"
                    npmPackagesRefreshHours: 72

unclassified:
  sonarGlobalConfiguration:
    buildWrapperEnabled: true
    installations:
      - name: "SonarQube"
        serverUrl: "http://sonarqube:9000"
        credentialsId: "sonarqube-token"

  slackNotifier:
    teamDomain: "mycompany"
    tokenCredentialId: "slack-webhook"
    room: "#deployments"
```

---

## Step 7: Nexus Repository Setup

```bash
#!/bin/bash
# setup-nexus.sh — Configure Nexus repositories via REST API

NEXUS_URL="http://192.168.56.20:8081"
# Get initial admin password
ADMIN_PASS=$(docker exec nexus cat /nexus-data/admin.password 2>/dev/null || echo "admin123")

# Wait for Nexus
until curl -s -u admin:$ADMIN_PASS "$NEXUS_URL/service/rest/v1/status" | grep -q '"edition"'; do
    echo "Waiting for Nexus..."
    sleep 15
done

# Change default password
curl -s -X PUT "$NEXUS_URL/service/rest/v1/security/users/admin/change-password" \
    -u admin:$ADMIN_PASS \
    -H "Content-Type: text/plain" \
    -d "Admin@2026!"
ADMIN_PASS="Admin@2026!"

# Create repositories
# 1. Maven releases
curl -s -X POST "$NEXUS_URL/service/rest/v1/repositories/maven/hosted" \
    -u admin:$ADMIN_PASS \
    -H "Content-Type: application/json" \
    -d '{
        "name": "maven-releases",
        "online": true,
        "storage": {"blobStoreName": "default", "strictContentTypeValidation": true, "writePolicy": "ALLOW_ONCE"},
        "maven": {"versionPolicy": "RELEASE", "layoutPolicy": "STRICT"}
    }'

# 2. Maven snapshots
curl -s -X POST "$NEXUS_URL/service/rest/v1/repositories/maven/hosted" \
    -u admin:$ADMIN_PASS \
    -H "Content-Type: application/json" \
    -d '{
        "name": "maven-snapshots",
        "online": true,
        "storage": {"blobStoreName": "default", "strictContentTypeValidation": true, "writePolicy": "ALLOW"},
        "maven": {"versionPolicy": "SNAPSHOT", "layoutPolicy": "STRICT"}
    }'

# 3. npm hosted
curl -s -X POST "$NEXUS_URL/service/rest/v1/repositories/npm/hosted" \
    -u admin:$ADMIN_PASS \
    -H "Content-Type: application/json" \
    -d '{"name": "npm-hosted", "online": true, "storage": {"blobStoreName": "default", "writePolicy": "ALLOW"}}'

# 4. Docker hosted (on port 8082)
curl -s -X POST "$NEXUS_URL/service/rest/v1/repositories/docker/hosted" \
    -u admin:$ADMIN_PASS \
    -H "Content-Type: application/json" \
    -d '{
        "name": "docker-registry",
        "online": true,
        "storage": {"blobStoreName": "default", "strictContentTypeValidation": true, "writePolicy": "ALLOW"},
        "docker": {"v1Enabled": false, "forceBasicAuth": true, "httpPort": 8082}
    }'

echo "=== Nexus repositories created ==="
echo "  Maven releases:   $NEXUS_URL/repository/maven-releases/"
echo "  Maven snapshots:  $NEXUS_URL/repository/maven-snapshots/"
echo "  npm:              $NEXUS_URL/repository/npm-hosted/"
echo "  Docker registry:  http://192.168.56.20:8082"
```

---

## Step 8: Monitoring Stack Setup

```bash
#!/bin/bash
# scripts/monitoring.sh — Prometheus, Grafana, Loki, AlertManager

set -euo pipefail

apt-get install -y docker.io docker-compose-plugin
systemctl enable docker

mkdir -p /opt/monitoring/{prometheus,grafana,loki,alertmanager}
chown -R vagrant:vagrant /opt/monitoring

# ── Prometheus configuration ───────────────────────────────────
cat > /opt/monitoring/prometheus/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    environment: 'on-premise'
    datacenter: 'dc1'

rule_files:
  - "alert_rules.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets: ['alertmanager:9093']

scrape_configs:
  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']

  - job_name: 'jenkins'
    metrics_path: '/prometheus'
    static_configs:
      - targets: ['192.168.56.20:8080']

  - job_name: 'node-exporter'
    static_configs:
      - targets:
          - '192.168.56.10:9100'   # control01
          - '192.168.56.11:9100'   # worker01
          - '192.168.56.12:9100'   # worker02
          - '192.168.56.20:9100'   # services
          - '192.168.56.30:9100'   # monitoring

  - job_name: 'kubernetes-pods'
    kubernetes_sd_configs:
      - role: pod
        api_server: 'https://192.168.56.10:6443'
        tls_config:
          insecure_skip_verify: true
        bearer_token_file: /etc/prometheus/k8s-token

  - job_name: 'kubernetes-nodes'
    scheme: https
    tls_config:
      insecure_skip_verify: true
    bearer_token_file: /etc/prometheus/k8s-token
    kubernetes_sd_configs:
      - role: node
        api_server: 'https://192.168.56.10:6443'
        tls_config:
          insecure_skip_verify: true
        bearer_token_file: /etc/prometheus/k8s-token
EOF

# ── Alerting Rules ─────────────────────────────────────────────
cat > /opt/monitoring/prometheus/alert_rules.yml << 'EOF'
groups:
  - name: infrastructure
    rules:

      - alert: HostDown
        expr: up == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Host {{ $labels.instance }} is down"
          description: "{{ $labels.instance }} has been down for more than 1 minute."

      - alert: HighCPUUsage
        expr: 100 - (avg by(instance)(irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU on {{ $labels.instance }}"
          description: "CPU usage is {{ humanize $value }}%."

      - alert: HighMemoryUsage
        expr: (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * 100 > 90
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High memory on {{ $labels.instance }}"
          description: "Memory usage is {{ humanize $value }}%."

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) * 100 < 15
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Low disk space on {{ $labels.instance }}"
          description: "Disk {{ $labels.mountpoint }} has {{ humanize $value }}% free."

  - name: kubernetes
    rules:
      - alert: PodCrashLooping
        expr: increase(kube_pod_container_status_restarts_total[15m]) > 3
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Pod {{ $labels.pod }} is crash looping"

      - alert: PodNotRunning
        expr: kube_pod_status_phase{phase!~"Running|Succeeded"} == 1
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Pod {{ $labels.pod }} is {{ $labels.phase }}"

  - name: jenkins
    rules:
      - alert: JenkinsQueueHigh
        expr: jenkins_queue_size_value > 5
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "Jenkins build queue has {{ $value }} items"
EOF

# ── AlertManager configuration ─────────────────────────────────
cat > /opt/monitoring/alertmanager/alertmanager.yml << 'EOF'
global:
  resolve_timeout: 5m
  slack_api_url: 'YOUR_SLACK_WEBHOOK_URL'

route:
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 12h
  receiver: 'slack-default'
  routes:
    - match:
        severity: critical
      receiver: 'slack-critical'
      repeat_interval: 1h
    - match:
        severity: warning
      receiver: 'slack-warning'
      repeat_interval: 6h

receivers:
  - name: 'slack-default'
    slack_configs:
      - channel: '#alerts'
        send_resolved: true
        title: '{{ template "slack.default.title" . }}'
        text: '{{ template "slack.default.text" . }}'

  - name: 'slack-critical'
    slack_configs:
      - channel: '#alerts-critical'
        send_resolved: true
        color: 'danger'
        title: ':red_circle: CRITICAL: {{ .CommonAnnotations.summary }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

  - name: 'slack-warning'
    slack_configs:
      - channel: '#alerts'
        color: 'warning'
        title: ':warning: WARNING: {{ .CommonAnnotations.summary }}'
        text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

inhibit_rules:
  - source_match:
      severity: 'critical'
    target_match:
      severity: 'warning'
    equal: ['alertname', 'instance']
EOF

# ── Docker Compose for monitoring ─────────────────────────────
cat > /opt/monitoring/docker-compose.yml << 'EOF'
version: '3.8'

networks:
  monitoring:
    driver: bridge

volumes:
  prometheus_data:
  grafana_data:
  loki_data:

services:

  prometheus:
    image: prom/prometheus:latest
    container_name: prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.enable-lifecycle'
      - '--web.enable-admin-api'
    volumes:
      - ./prometheus:/etc/prometheus
      - prometheus_data:/prometheus
    ports:
      - "9090:9090"
    networks:
      - monitoring
    restart: unless-stopped

  alertmanager:
    image: prom/alertmanager:latest
    container_name: alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
    volumes:
      - ./alertmanager:/etc/alertmanager
    ports:
      - "9093:9093"
    networks:
      - monitoring
    restart: unless-stopped

  grafana:
    image: grafana/grafana:latest
    container_name: grafana
    environment:
      GF_SECURITY_ADMIN_USER: admin
      GF_SECURITY_ADMIN_PASSWORD: Admin@2026!
      GF_INSTALL_PLUGINS: grafana-piechart-panel,grafana-clock-panel
    volumes:
      - grafana_data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning
    ports:
      - "3000:3000"
    networks:
      - monitoring
    restart: unless-stopped

  loki:
    image: grafana/loki:latest
    container_name: loki
    command: -config.file=/etc/loki/loki.yaml
    volumes:
      - ./loki/loki.yaml:/etc/loki/loki.yaml
      - loki_data:/loki
    ports:
      - "3100:3100"
    networks:
      - monitoring
    restart: unless-stopped

  alloy:
    image: grafana/alloy:latest
    container_name: alloy
    volumes:
      - ./alloy/config.alloy:/etc/alloy/config.alloy
      - /var/log:/var/log:ro
      - /var/lib/docker/containers:/var/lib/docker/containers:ro
    command: run --server.http.listen-addr=0.0.0.0:12345 /etc/alloy/config.alloy
    ports:
      - "12345:12345"
    networks:
      - monitoring
    restart: unless-stopped

  node-exporter:
    image: prom/node-exporter:latest
    container_name: node-exporter
    command:
      - '--path.rootfs=/host'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/host:ro
    ports:
      - "9100:9100"
    pid: host
    networks:
      - monitoring
    restart: unless-stopped

EOF

cd /opt/monitoring
docker compose up -d

echo "=== Monitoring stack running ==="
echo "  Prometheus:   http://192.168.56.30:9090"
echo "  Grafana:      http://192.168.56.30:3000  (admin/Admin@2026!)"
echo "  Loki:         http://192.168.56.30:3100"
echo "  AlertManager: http://192.168.56.30:9093"
```

---

## Step 9: Complete Ansible Playbook — Provision Everything

```bash
# Install Ansible on your workstation
pip3 install ansible

# Create project structure
mkdir -p on-premise-setup/{inventory,playbooks,roles}
cd on-premise-setup
```

```yaml
# inventory/hosts.yml
all:
  vars:
    ansible_user: vagrant
    ansible_ssh_private_key_file: ~/.vagrant.d/insecure_private_key
    ansible_python_interpreter: /usr/bin/python3

  children:
    k8s_masters:
      hosts:
        control01:
          ansible_host: 192.168.56.10

    k8s_workers:
      hosts:
        worker01:
          ansible_host: 192.168.56.11
        worker02:
          ansible_host: 192.168.56.12

    services_servers:
      hosts:
        services:
          ansible_host: 192.168.56.20

    monitoring_servers:
      hosts:
        monitoring:
          ansible_host: 192.168.56.30
```

```yaml
# playbooks/site.yml — Master playbook
---
- name: Configure all servers
  hosts: all
  become: yes
  roles:
    - common
    - security-hardening

- name: Configure Kubernetes control plane
  hosts: k8s_masters
  become: yes
  roles:
    - kubernetes-common
    - kubernetes-master

- name: Configure Kubernetes workers
  hosts: k8s_workers
  become: yes
  roles:
    - kubernetes-common
    - kubernetes-worker

- name: Configure DevOps services
  hosts: services_servers
  become: yes
  roles:
    - docker
    - devops-services

- name: Configure monitoring
  hosts: monitoring_servers
  become: yes
  roles:
    - docker
    - monitoring-stack
```

```bash
# Run the full setup
ansible-playbook -i inventory/hosts.yml playbooks/site.yml

# Run only specific parts
ansible-playbook -i inventory/hosts.yml playbooks/site.yml --tags kubernetes
ansible-playbook -i inventory/hosts.yml playbooks/site.yml --limit monitoring_servers
```

---

## Step 10: Verify the Complete Platform

```bash
# From control01, verify Kubernetes
vagrant ssh control01
kubectl get nodes
# NAME         STATUS   ROLES           AGE   VERSION
# control01    Ready    control-plane   10m   v1.30.0
# worker01     Ready    <none>          8m    v1.30.0
# worker02     Ready    <none>          8m    v1.30.0

kubectl get pods -A
# Verify all system pods are Running

# Test deploying an application
kubectl create deployment hello-world --image=nginx
kubectl expose deployment hello-world --port=80 --type=NodePort
kubectl get service hello-world
# Access at: http://192.168.56.11:NODE_PORT

# Verify services
curl http://192.168.56.20:8080/login   # Jenkins
curl http://192.168.56.20:9000         # SonarQube
curl http://192.168.56.20:8081         # Nexus
curl http://192.168.56.30:9090/-/ready # Prometheus
curl http://192.168.56.30:3000         # Grafana
```

---

## On-Premise Security Hardening Checklist

```bash
#!/bin/bash
# security-hardening.sh — Apply to ALL production servers

# 1. Disable unnecessary services
systemctl disable avahi-daemon cups bluetooth 2>/dev/null || true

# 2. SSH hardening
cat >> /etc/ssh/sshd_config << 'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
AuthorizedKeysFile .ssh/authorized_keys
MaxAuthTries 3
ClientAliveInterval 300
ClientAliveCountMax 2
AllowTcpForwarding no
X11Forwarding no
EOF
systemctl restart sshd

# 3. Firewall rules (UFW)
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp comment "SSH"
ufw allow from 192.168.56.0/24  # allow internal network
ufw --force enable

# 4. Fail2ban
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local << 'EOF'
[sshd]
enabled = true
port = 22
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
EOF
systemctl enable fail2ban
systemctl start fail2ban

# 5. Automatic security updates
apt-get install -y unattended-upgrades
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Download-Upgradeable-Packages "1";
APT::Periodic::AutocleanInterval "7";
APT::Periodic::Unattended-Upgrade "1";
EOF

# 6. Audit daemon (for compliance)
apt-get install -y auditd
cat >> /etc/audit/rules.d/audit.rules << 'EOF'
-a always,exit -F arch=b64 -S execve -k exec
-w /etc/passwd -p wa -k identity
-w /etc/group -p wa -k identity
-w /etc/sudoers -p wa -k sudo_access
-w /var/log/auth.log -p wa -k auth_log
EOF
systemctl enable auditd
systemctl start auditd

echo "Security hardening complete"
```

---

[← Back to Section](./README.md) | [Next: Cloud from Zero →](./02-cloud-from-zero.md)
