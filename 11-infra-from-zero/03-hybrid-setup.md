# Hybrid Infrastructure — On-Premise + Cloud

> Hybrid is the reality for banks, enterprises, and regulated industries.
> Some data stays on-premise (compliance). Some workloads move to the cloud (scalability).
> The key is a unified control plane that manages both.

---

## Hybrid Architecture

```
CORPORATE NETWORK (on-premise)
192.168.0.0/16

┌──────────────────────────────────────┐
│  Legacy systems (must stay on-prem)  │
│  Mainframe / Oracle / SAP            │
│  Sensitive PII data                  │
│  SWIFT financial messaging           │
│  K3s cluster (batch processing)      │
└──────────────┬───────────────────────┘
               │ AWS Site-to-Site VPN
               │ OR AWS Direct Connect
               │ (1-10 Gbps dedicated)
┌──────────────▼───────────────────────┐
│  AWS VPC 10.0.0.0/16                 │
│  EKS (customer-facing APIs)          │
│  Lambda (event-driven processing)    │
│  S3 (document storage)               │
│  CloudFront (global CDN)             │
└──────────────────────────────────────┘

UNIFIED CONTROL PLANE:
  - ArgoCD (GitOps both clusters)
  - Grafana (metrics from both)
  - Ansible (configure both)
  - Terraform (provision both)
```

---

## Step 1: AWS Site-to-Site VPN

```bash
#!/bin/bash
# setup-site-to-site-vpn.sh

ON_PREM_PUBLIC_IP="203.0.113.100"   # your office/datacenter public IP
ON_PREM_BGP_ASN="65000"             # your BGP ASN (use 65000-65535 for private)
AWS_BGP_ASN="64512"                 # AWS side
VPC_ID="vpc-12345678"

echo "=== Step 1: Create Customer Gateway (your side) ==="
CGW=$(aws ec2 create-customer-gateway \
    --type ipsec.1 \
    --public-ip $ON_PREM_PUBLIC_IP \
    --bgp-asn $ON_PREM_BGP_ASN \
    --query CustomerGateway.CustomerGatewayId \
    --output text)
echo "Customer Gateway: $CGW"

echo "=== Step 2: Create Virtual Private Gateway (AWS side) ==="
VGW=$(aws ec2 create-vpn-gateway \
    --type ipsec.1 \
    --amazon-side-asn $AWS_BGP_ASN \
    --query VpnGateway.VpnGatewayId \
    --output text)
echo "Virtual Private Gateway: $VGW"

echo "=== Step 3: Attach VGW to VPC ==="
aws ec2 attach-vpn-gateway \
    --vpn-gateway-id $VGW \
    --vpc-id $VPC_ID

echo "=== Step 4: Create VPN Connection ==="
VPN=$(aws ec2 create-vpn-connection \
    --type ipsec.1 \
    --customer-gateway-id $CGW \
    --vpn-gateway-id $VGW \
    --options '{"StaticRoutesOnly": false}' \
    --query VpnConnection.VpnConnectionId \
    --output text)
echo "VPN Connection: $VPN"

echo "=== Step 5: Get tunnel configuration ==="
aws ec2 describe-vpn-connections \
    --vpn-connection-ids $VPN \
    --query 'VpnConnections[0].CustomerGatewayConfiguration' \
    --output text > vpn-config.xml

echo "VPN config saved to vpn-config.xml"
echo "Configure your on-premise VPN device with this file"
echo ""
echo "Common on-premise VPN devices:"
echo "  Cisco ASA/IOS: aws.amazon.com/vpn/faqs/ (download Cisco config)"
echo "  PfSense: use the IPSec settings from vpn-config.xml"
echo "  StrongSwan (Linux): use below"

cat << 'EOF'

# StrongSwan config (/etc/ipsec.conf) — extracted from AWS config
conn aws-vpn-tunnel1
    authby=secret
    auto=start
    left=%defaultroute
    leftid=203.0.113.100           # your public IP
    right=52.0.0.1                 # AWS tunnel endpoint (from config XML)
    type=tunnel
    ikelifetime=28800s
    keylife=3600s
    rekeymargin=3m
    keyingtries=%forever
    ike=aes128-sha1-modp1024
    esp=aes128-sha1
    leftsubnet=192.168.0.0/16      # your on-prem network
    rightsubnet=10.0.0.0/16        # AWS VPC
    mark=100
    leftupdown=/etc/ipsec-aws/updown.sh

# /etc/ipsec.secrets
203.0.113.100 52.0.0.1 : PSK "your-pre-shared-key-from-aws-config"
EOF
```

---

## Step 2: Enable Route Propagation

```bash
# After VPN is established, enable route propagation in AWS

# Get route tables in the VPC
aws ec2 describe-route-tables \
    --filters Name=vpc-id,Values=$VPC_ID \
    --query 'RouteTables[*].{ID:RouteTableId,Name:Tags[?Key==`Name`].Value|[0]}'

# Enable VGW route propagation on private route tables
for RT_ID in rtb-private1 rtb-private2 rtb-private3; do
    aws ec2 enable-vgw-route-propagation \
        --route-table-id $RT_ID \
        --gateway-id $VGW
done

# Add static route for on-premise network
aws ec2 create-vpn-connection-route \
    --vpn-connection-id $VPN \
    --destination-cidr-block "192.168.0.0/16"

# Verify VPN status
aws ec2 describe-vpn-connections \
    --vpn-connection-ids $VPN \
    --query 'VpnConnections[0].VgwTelemetry[*].{IP:OutsideIpAddress,Status:Status,LastStatusChange:LastStatusChange}'
```

---

## Step 3: Unified Ansible — Manage Both

```yaml
# inventory/hybrid-hosts.yml
all:
  children:
    on_premise:
      children:
        on_prem_k8s:
          hosts:
            control01:
              ansible_host: 192.168.56.10
              ansible_user: vagrant
              cluster_type: k3s
              location: datacenter-1
        on_prem_services:
          hosts:
            services:
              ansible_host: 192.168.56.20
              ansible_user: vagrant

    cloud:
      children:
        aws_eks_nodes:
          hosts:
            aws_node_1:
              ansible_host: 10.0.11.100  # reachable via VPN
              ansible_user: ec2-user
              ansible_ssh_private_key_file: ~/.ssh/prod.pem
              cluster_type: eks
              location: aws-us-east-1

    monitoring:
      hosts:
        grafana_server:
          ansible_host: 192.168.56.30    # on-prem monitoring (reaches both via VPN)
```

```yaml
# playbooks/hybrid-deploy.yml — Deploy to BOTH environments
---
- name: Deploy to on-premise K3s
  hosts: on_prem_k8s
  tasks:
    - name: Update Kubernetes manifests
      shell: |
        kubectl apply -f /opt/apps/{{ app_name }}/k8s/
        kubectl rollout status deployment/{{ app_name }} --timeout=5m
      become: yes

- name: Deploy to AWS EKS (via VPN)
  hosts: aws_eks_nodes[0]   # use one node as jump
  tasks:
    - name: Update EKS deployment
      shell: |
        aws eks update-kubeconfig --name production-cluster --region us-east-1
        kubectl set image deployment/{{ app_name }} \
            {{ app_name }}={{ image_tag }}
        kubectl rollout status deployment/{{ app_name }} --timeout=5m
```

---

## Step 4: Unified Grafana — See Everything in One Place

```yaml
# grafana-datasources.yml — Configure Grafana data sources for hybrid

apiVersion: 1
datasources:
  # On-premise Prometheus
  - name: Prometheus-OnPremise
    type: prometheus
    url: http://192.168.56.30:9090
    access: proxy
    isDefault: false
    jsonData:
      timeInterval: "15s"
      customQueryParameters: "environment=on-premise"

  # AWS CloudWatch
  - name: CloudWatch-Production
    type: cloudwatch
    access: proxy
    jsonData:
      authType: default    # uses IAM role
      defaultRegion: us-east-1

  # Loki on-premise
  - name: Loki-OnPremise
    type: loki
    url: http://192.168.56.30:3100
    access: proxy

  # AWS Loki (if deployed)
  - name: Loki-AWS
    type: loki
    url: http://loki.monitoring.svc.cluster.local:3100
    access: proxy
```

```json
// Hybrid Overview Dashboard (import in Grafana)
{
  "title": "Hybrid Infrastructure Overview",
  "panels": [
    {
      "title": "On-Premise Node Health",
      "type": "stat",
      "targets": [{
        "datasource": "Prometheus-OnPremise",
        "expr": "count(up{job='node-exporter'} == 1)"
      }]
    },
    {
      "title": "AWS EKS Pod Count",
      "type": "stat",
      "targets": [{
        "datasource": "CloudWatch-Production",
        "metricName": "pod_number_of_running_pods",
        "namespace": "ContainerInsights",
        "dimensions": {"ClusterName": "production-cluster"}
      }]
    },
    {
      "title": "VPN Tunnel Status",
      "type": "stat",
      "targets": [{
        "datasource": "CloudWatch-Production",
        "metricName": "TunnelState",
        "namespace": "AWS/VPN"
      }],
      "thresholds": {
        "steps": [{"value": 0, "color": "red"}, {"value": 1, "color": "green"}]
      }
    }
  ]
}
```

---

## Step 5: Terraform for Hybrid — Providers

```hcl
# hybrid-terraform/main.tf — manage both on-premise and AWS

terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.40"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.12"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.27"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# Connect to on-premise Kubernetes (via kubeconfig)
provider "kubernetes" {
  alias          = "onpremise"
  config_path    = "~/.kube/config-onpremise"
  config_context = "k3s-control01"
}

# Connect to AWS EKS
provider "kubernetes" {
  alias                  = "aws_eks"
  host                   = data.aws_eks_cluster.production.endpoint
  cluster_ca_certificate = base64decode(data.aws_eks_cluster.production.certificate_authority[0].data)
  token                  = data.aws_eks_cluster_auth.production.token
}

# Deploy the same app to BOTH clusters
resource "kubernetes_deployment" "api_onpremise" {
  provider = kubernetes.onpremise
  metadata {
    name      = "my-api"
    namespace = "production"
  }
  spec {
    replicas = 2
    # ... same spec as AWS
  }
}

resource "kubernetes_deployment" "api_aws" {
  provider = kubernetes.aws_eks
  metadata {
    name      = "my-api"
    namespace = "production"
  }
  spec {
    replicas = 3   # more replicas on cloud (more scalable)
    # ... same spec
  }
}
```

---

## When to Use Each Environment

```
ON-PREMISE:
  ✓ Data that cannot leave the country (data sovereignty)
  ✓ Legacy systems with latency requirements (mainframe integration)
  ✓ PII / sensitive financial data (GDPR, banking regulation)
  ✓ SWIFT network integration (financial sector)
  ✓ High-frequency trading systems
  
CLOUD (AWS):
  ✓ Customer-facing APIs (auto-scaling for traffic spikes)
  ✓ Machine learning workloads (GPU instances)
  ✓ Global CDN (CloudFront for worldwide users)
  ✓ Disaster recovery (backup of on-prem data)
  ✓ Dev/staging environments (pay only when used)
  ✓ Batch processing (run big jobs, terminate after)

HYBRID (BOTH):
  ✓ Core banking + digital channels (bank architecture)
  ✓ Enterprise with compliance + scale requirements
  ✓ Migration phase (moving from on-prem to cloud)
```

---

[← Previous: Cloud](./02-cloud-from-zero.md) | [Next: Kubernetes Production →](./04-kubernetes-production.md)
