# Section 03 — CI/CD Pipelines

> CI/CD is the heart of DevOps.
> It automates testing, building, and deploying code.
> A good CI/CD pipeline catches bugs before they reach production.

---

## Topics in This Section

| Guide | Content | Level |
|-------|---------|-------|
| [Jenkins](javascript:dvGo('jenkins')) | Pipelines, locks, releases, logs, debugging, Kafka, cloud integrations | Intermediate |
| [GitHub Actions](javascript:dvGo('github-actions')) | Workflows, OIDC auth, matrix builds, reusable workflows | Intermediate |
| [GitLab CI/CD](javascript:dvGo('gitlab-cicd')) | `.gitlab-ci.yml`, runners, environments, ArgoCD integration | Intermediate |

---

## What You Learn in Jenkins

The Jenkins guide covers every real interview question about CI/CD operations:

- **Pipeline as Code** — full Jenkinsfile with Docker, SonarQube, Trivy, Kubernetes deploy
- **Lock errors** — what Lockable Resources are, how to identify a blocked pipeline, how to enter the Jenkins container (`docker exec` / `kubectl exec`) and release locks via Script Console
- **Deadlock (blocking loops)** — how two pipelines block each other, how to detect it, how to break it, how to prevent it
- **Reading Jenkins logs** — paths in `$JENKINS_HOME`, exit codes, grep across builds, Loki integration
- **Creating releases** — semantic versioning from commit messages, Git tags, GitHub Releases via API
- **New Jenkins from scratch** — Helm install, Kubernetes pod agents, JCasC (Configuration as Code)
- **CI/CD tool comparison** — Jenkins vs GitHub Actions vs GitLab CI with cloud integrations (AWS OIDC, EKS)
- **Kafka and deployments** — why Kafka decouples services, how it enables independent deploys, `kafka-consumer-groups.sh` for monitoring lag

---

## The DevOps Pipeline — Big Picture

```
Developer pushes code
        ↓
[Source Control] Git push → GitHub/GitLab
        ↓
[CI — Continuous Integration]
  → Run unit tests
  → Run integration tests
  → Run SonarQube analysis (code quality)
  → Build Docker image
  → Push image to registry
        ↓
[CD — Continuous Delivery]
  → Deploy to staging
  → Run smoke tests
  → Wait for approval (production)
        ↓
[CD — Continuous Deployment]
  → Deploy to production
  → Monitor metrics
  → Alert if errors spike
        ↓
[Feedback]
  → Notify team on Slack
  → Update dashboard
```

---

## Why Each Tool?

| Tool | Why Use It |
|------|-----------|
| **Jenkins** | Maximum flexibility, plugins for everything, used in 60% of enterprises |
| **GitHub Actions** | Zero setup if you use GitHub, great for open source |
| **GitLab CI** | All-in-one platform, built-in container registry, used in enterprises |
| **SonarQube** | Finds security vulnerabilities and code smells automatically |
| **Nexus** | Stores artifacts (JARs, Docker images, npm packages) securely |

---

## CI/CD Environments

| Environment | Purpose | Who Deploys |
|-------------|---------|------------|
| **Development** | Individual testing | Developers (on every commit) |
| **Staging** | Integration testing | Automated pipeline |
| **UAT** | Business validation | Automated + manual |
| **Production** | Live customers | Automated + approval gate |

---

[← Back to Main](/) | [Next: Containers →](/containers/)
