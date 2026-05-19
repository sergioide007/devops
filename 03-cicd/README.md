# Section 03 — CI/CD Pipelines

> CI/CD is the heart of DevOps.
> It automates testing, building, and deploying code.
> A good CI/CD pipeline catches bugs before they reach production.

---

## Topics in This Section

| File | Topic | Level |
|------|-------|-------|
| [01-jenkins.md](./01-jenkins.md) | Jenkins — The classic CI/CD tool | Intermediate |
| [02-github-actions.md](./02-github-actions.md) | GitHub Actions — CI/CD in GitHub | Intermediate |
| [03-gitlab-cicd.md](./03-gitlab-cicd.md) | GitLab CI/CD | Intermediate |
| [04-nexus-sonarqube.md](./04-nexus-sonarqube.md) | Nexus (artifacts) + SonarQube (code quality) | Intermediate |
| [05-complete-pipeline.md](./05-complete-pipeline.md) | End-to-end pipeline with all tools | Advanced |

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

[← Back to Main](../README.md) | [Next: Containers →](../04-containers/README.md)
