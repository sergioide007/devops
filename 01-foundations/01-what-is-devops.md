# What is DevOps?

> **Simple answer:** DevOps is a way of working where developers and operations teams
> work together to deliver software faster and with fewer errors.

---

## The Problem DevOps Solves

Before DevOps, there were two separate teams:

- **Dev team** — writes code, wants to ship fast
- **Ops team** — manages servers, wants stability

They had different goals. This caused problems:
- Code worked on the developer's machine, but broke in production
- Deployments took weeks or months
- Nobody knew who was responsible when something went wrong

DevOps solves this by making these teams work as **one team**.

---

## The DevOps Lifecycle

```
Plan → Code → Build → Test → Release → Deploy → Operate → Monitor
  ↑____________________________________________________|
                    Continuous feedback
```

Each step connects to the next. The loop never stops.

---

## Core Principles

### 1. Continuous Integration (CI)
Developers push code many times per day.
Each push runs automated tests automatically.

```bash
# Example: What happens when you push code
git push origin main
# → GitHub Actions / Jenkins runs tests automatically
# → If tests pass: code is ready to deploy
# → If tests fail: developer gets notified immediately
```

### 2. Continuous Delivery (CD)
After tests pass, the code is automatically deployed to staging or production.

### 3. Infrastructure as Code (IaC)
Servers and infrastructure are defined in files, not configured by hand.

```hcl
# Example: Terraform creates an AWS server with this code
resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
}
```

### 4. Monitoring and Observability
You cannot fix what you cannot see. Monitor everything.

### 5. Automation First
If you do something more than once, automate it.

---

## DevOps vs. Traditional IT

| Traditional IT | DevOps |
|---------------|--------|
| Dev and Ops are separate | One team, shared responsibility |
| Deploy once a month | Deploy many times per day |
| Manual server setup | Infrastructure as Code |
| Find bugs in production | Find bugs before production |
| Long release cycles | Short, fast release cycles |

---

## DevOps in Real Life

### Cloud Environment (AWS, Azure, GCP)
- Auto-scaling: servers grow when traffic is high
- Managed services: AWS handles the database server for you
- Pay per use: no wasted infrastructure

### On-Premise Environment
- Physical servers in a data center
- You manage everything: hardware, OS, network
- More control, more responsibility

### Hybrid Environment
- Some systems in the cloud, some on-premise
- Connected via VPN or Direct Connect
- Common in banks and government (for compliance)

---

## Key DevOps Tools

```
Source Control:   Git, GitHub, GitLab, Bitbucket
CI/CD:            Jenkins, GitHub Actions, GitLab CI
Containers:       Docker, Kubernetes
IaC:              Terraform, Ansible
Monitoring:       Prometheus, Grafana, Loki
Cloud:            AWS, Azure, GCP
Scripting:        Bash, Python, Go
```

---

## CALMS Framework

DevOps culture is described by CALMS:

| Letter | Meaning | Example |
|--------|---------|---------|
| **C** | Culture | Teams collaborate, not blame |
| **A** | Automation | Scripts replace manual work |
| **L** | Lean | Remove waste, keep it simple |
| **M** | Measurement | Measure deployment frequency, MTTR |
| **S** | Sharing | Document everything, share knowledge |

---

## Key Metrics Every DevOps Engineer Knows

These are the **DORA metrics** (used by Google, Amazon, Netflix):

| Metric | Good Performance | How to Improve |
|--------|-----------------|---------------|
| **Deployment Frequency** | Multiple per day | Automate deployments |
| **Lead Time for Changes** | Less than 1 hour | Improve CI/CD pipeline |
| **Change Failure Rate** | Less than 5% | Add more tests |
| **MTTR** (Mean Time to Recover) | Less than 1 hour | Better monitoring + runbooks |

---

## Interview Questions — What is DevOps?

**Q: Can you explain DevOps in simple terms?**
> "DevOps is a practice where development and operations teams work together
> using automation, continuous integration, and continuous delivery to ship
> software faster and more reliably. The goal is to reduce the time from
> writing code to running it in production, while maintaining high quality."

**Q: What is the difference between CI and CD?**
> "CI — Continuous Integration — means developers merge code frequently and
> automated tests run on each merge. CD — Continuous Delivery — means that
> after tests pass, the code is automatically prepared for deployment.
> Continuous Deployment goes one step further: it deploys automatically to production."

**Q: What DORA metrics do you use?**
> "I track deployment frequency to see how fast we ship, lead time for changes
> to measure pipeline efficiency, change failure rate to see code quality, and
> MTTR to measure how fast we recover from incidents."

---

[← Back to Section](./README.md) | [Next: Linux Fundamentals →](./02-linux-fundamentals.md)
