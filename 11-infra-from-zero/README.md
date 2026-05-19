# Section 11 — Infrastructure from Zero to Expert

> This section is 100% practical.
> You will build a complete DevOps platform from scratch.
> Every command is real. Every script is complete. Every step is explained.

---

## What You Will Build

By the end of this section, you have a production-ready DevOps platform:

```
┌─────────────────────────────────────────────────────────────┐
│                 COMPLETE DEVOPS PLATFORM                     │
├──────────────┬──────────────────┬──────────────────────────┤
│  ON-PREMISE  │      CLOUD       │        HYBRID            │
│              │                  │                          │
│  Linux VMs   │  AWS Account     │  VPN / Direct Connect    │
│  K3s cluster │  EKS cluster     │  On-prem ↔ AWS           │
│  Gitea       │  ECR registry    │  Ansible manages both    │
│  Jenkins     │  GitHub Actions  │  Terraform provisions    │
│  Nexus       │  S3 artifacts    │  Unified monitoring      │
│  Prometheus  │  CloudWatch      │  ArgoCD GitOps           │
│  Grafana     │  Grafana Cloud   │  Single Grafana view     │
└──────────────┴──────────────────┴──────────────────────────┘
```

---

## Topics in This Section

| File | Topic | Time |
|------|-------|------|
| [01-onpremise-from-zero.md](./01-onpremise-from-zero.md) | Build on-premise DevOps platform | 2–3 hours |
| [02-cloud-from-zero.md](./02-cloud-from-zero.md) | Build AWS cloud platform from scratch | 2–3 hours |
| [03-hybrid-setup.md](./03-hybrid-setup.md) | Connect on-premise to cloud | 1–2 hours |
| [04-kubernetes-production.md](./04-kubernetes-production.md) | Production-grade Kubernetes | 2 hours |
| [05-complete-cicd-platform.md](./05-complete-cicd-platform.md) | Jenkins + Nexus + SonarQube + Slack | 2 hours |
| [06-full-observability.md](./06-full-observability.md) | Prometheus + Grafana + Loki + Alerting | 2 hours |

---

## Before You Start

### Hardware Requirements

```
On-premise lab (minimum):
  1 server or VM with 8 CPU cores, 16GB RAM, 200GB SSD
  → We will create multiple VMs with Vagrant + VirtualBox

Cloud (free tier):
  AWS account (free tier covers most of this)
  GitHub account (free)
```

### Software to Install on Your Workstation

```bash
# Windows workstation — install these tools:
# 1. WSL2 (Windows Subsystem for Linux)
wsl --install -d Ubuntu

# 2. VirtualBox (for local VMs)
# Download: virtualbox.org

# 3. Vagrant (VM automation)
# Download: vagrantup.com

# 4. kubectl
# Download: kubernetes.io/docs/tasks/tools/install-kubectl-windows/

# 5. Helm
# Download: helm.sh/docs/intro/install/

# 6. Terraform
# Download: developer.hashicorp.com/terraform/install

# 7. AWS CLI v2
# Download: aws.amazon.com/cli/

# 8. VS Code + alpaquitay-ai extension
# + GitLens, Kubernetes extension, Terraform extension
```

---

[← Back to Main](../README.md) | [Next: Compliance →](../12-compliance-frameworks/README.md)
