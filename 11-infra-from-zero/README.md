# Section 11 — Infrastructure from Zero to Expert

> This section is 100% practical.
> You will build a complete DevOps platform from scratch.
> Every command is real. Every script is complete. Every step is explained.

---

## What You Will Build

By the end of this section, you have a production-ready DevOps platform:

```mermaid
graph TD
    %% ==========================================
    %% CONFIGURACIÓN DE ESTILOS PREMIUM (Paleta SpecSolid)
    %% ==========================================
    classDef onPremStyle fill:#1a202c,stroke:#4a5568,stroke-width:2px,color:#cbd5e0;
    classDef cloudStyle fill:#111c2e,stroke:#3182ce,stroke-width:2px,color:#63b3ed;
    classDef hybridStyle fill:#0f2426,stroke:#319795,stroke-width:2px,color:#4fd1c5;
    classDef toolStyle fill:#0d1117,stroke:#30363d,stroke-width:1px,color:#e6edf3;

    %% ==========================================
    %% PILLAR 1: ON-PREMISE INFRASTRUCTURE
    %% ==========================================
    subgraph ONPREM ["ON-PREMISE ENVIRONMENT"]
        direction TB
        LVM["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/linux/linux-original.svg' width='20'/> <br/> <b>Linux VMs</b><br/>Core Compute"]
        K3S["<img src='https://raw.githubusercontent.com/cncf/artwork/master/projects/k3s/icon/color/k3s-icon-color.svg' width='20'/> <br/> <b>K3s Cluster</b><br/>Local Kubernetes"]
        GIT["<img src='https://dl.gitea.com/art/gitea-lg.png' width='20'/> <br/> <b>Gitea</b><br/>Source Control"]
        JEN["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/jenkins/jenkins-original.svg' width='20'/> <br/> <b>Jenkins</b><br/>CI Automation"]
        NEX["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/sonarqube/sonarqube-original.svg' width='20'/> <br/> <b>Nexus</b><br/>Artifact Registry"]
        PROM["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/prometheus/prometheus-original.svg' width='20'/> <br/> <b>Prometheus</b><br/>Local Metrics"]
        GRAF["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/grafana/grafana-original.svg' width='20'/> <br/> <b>Grafana</b><br/>Local Analytics"]
        
        %% Flujo interno On-Prem
        GIT --> JEN --> NEX
        K3S -.-> PROM --> GRAF
    end
    class ONPREM onPremStyle;
    class LVM,K3S,GIT,JEN,NEX,PROM,GRAF toolStyle;

    %% ==========================================
    %% PILLAR 2: HYBRID ORCHESTRATION & NETWORK
    %% ==========================================
    subgraph HYBRID ["HYBRID LAYER & ORCHESTRATION"]
        direction TB
        VPN["<b>VPN / Direct Connect</b><br/>Secure Tunneling"]
        NET["<b>On-Prem ↔ AWS</b><br/>Network Mesh"]
        
        TF["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/terraform/terraform-original.svg' width='20'/> <br/> <b>Terraform</b><br/>Provisions Infra"]
        ANS["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/ansible/ansible-original.svg' width='20'/> <br/> <b>Ansible</b><br/>Manages Both Envs"]
        ARG["<img src='https://raw.githubusercontent.com/cncf/artwork/master/projects/argo/icon/color/argo-icon-color.svg' width='20'/> <br/> <b>ArgoCD GitOps</b><br/>Declarative CD"]
        
        UMON["<b>Unified Monitoring</b><br/>Global Data Scrape"]
        SVIEW["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/grafana/grafana-original.svg' width='20'/> <br/> <b>Single Grafana View</b><br/>Centralized Glass"]
        
        %% Relaciones capa híbrida
        VPN --- NET
        TF --> ANS --> ARG
        UMON --> SVIEW
    end
    class HYBRID hybridStyle;
    class VPN,NET,TF,ANS,ARG,UMON,SVIEW toolStyle;

    %% ==========================================
    %% PILLAR 3: AWS CLOUD INFRASTRUCTURE
    %% ==========================================
    subgraph CLOUD ["AWS CLOUD ENVIRONMENT"]
        direction TB
        AWS["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/amazonwebservices/amazonwebservices-original-wordmark.svg' width='35'/> <br/> <b>AWS Account</b><br/>Cloud Footprint"]
        EKS["<b>EKS Cluster</b><br/>Managed K8s"]
        ECR["<b>ECR Registry</b><br/>Container Images"]
        GHA["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/github/github-original.svg' width='20'/> <br/> <b>GitHub Actions</b><br/>Cloud Pipelines"]
        S3["<b>S3 Artifacts</b><br/>Object Storage"]
        CW["<b>CloudWatch</b><br/>Native Logs"]
        GRC["<img src='https://raw.githubusercontent.com/devicons/devicon/master/icons/grafana/grafana-original.svg' width='20'/> <br/> <b>Grafana Cloud</b><br/>Managed SaaS"]
        
        %% Flujo interno Cloud
        GHA --> ECR
        GHA --> S3
        EKS -.-> CW --> GRC
    end
    class CLOUD cloudStyle;
    class AWS,EKS,ECR,GHA,S3,CW,GRC toolStyle;

    %% ==========================================
    %% CROSS-ENVIRONMENT ORCHESTRATION (Líneas limpias sin cruces)
    %% ==========================================
    %% Aprovisionamiento de Terraform y Ansible hacia los dos mundos
    TF ==>|Provisions| LVM
    TF ==>|Provisions| AWS
    
    %% Flujo de Despliegue GitOps unificado
    ARG ==>|Syncs| K3S
    ARG ==>|Syncs| EKS
    
    %% Telemetría unificada al panel central
    GRAF ==> UMON
    GRC ==> UMON
```

---

## Topics in This Section

| File | Topic | Time |
|------|-------|------|
| [Onpremise from zero](javascript:dvGo('onpremise-from-zero')) | Build on-premise DevOps platform | 2–3 hours |
| [Cloud from zero](javascript:dvGo('cloud-from-zero')) | Build AWS cloud platform from scratch | 2–3 hours |
| [Hybrid setup](javascript:dvGo('hybrid-setup')) | Connect on-premise to cloud | 1–2 hours |
| [Kubernetes production](javascript:dvGo('kubernetes-production')) | Production-grade Kubernetes | 2 hours |
| [Complete CI/CD platform](javascript:dvGo('complete-cicd-platform')) | Jenkins + Nexus + SonarQube + Slack | 2 hours |
| [Full Observability](javascript:dvGo('full-observability')) | Prometheus + Grafana + Loki + Alerting | 2 hours |

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

[← Back to Main](/) | [Next: Compliance →](/compliance/)
