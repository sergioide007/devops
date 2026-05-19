# GitLab CI/CD

> GitLab is an all-in-one DevOps platform: source code, CI/CD, container registry,
> security scanning, and project management — all in one tool.
> Very popular in enterprises and European companies.

---

## GitLab CI vs GitHub Actions vs Jenkins

| Feature | GitLab CI | GitHub Actions | Jenkins |
|---------|-----------|---------------|---------|
| Setup | Zero (built-in) | Zero (built-in) | Server needed |
| Runner | Shared or self-hosted | GitHub-hosted | Your server |
| Container registry | Built-in | GitHub Packages | External |
| Security scanning | Built-in (SAST, DAST) | Via actions | Plugins |
| Best for | Full DevOps lifecycle | Open source, GitHub projects | Enterprise, legacy |

---

## .gitlab-ci.yml — Basic Structure

```yaml
# .gitlab-ci.yml
stages:
  - test
  - build
  - security
  - deploy

variables:
  IMAGE: $CI_REGISTRY_IMAGE/$CI_PROJECT_NAME
  TAG: $CI_COMMIT_SHORT_SHA

# ── Templates (reusable) ─────────────────────
.docker-login: &docker-login
  before_script:
    - docker login -u $CI_REGISTRY_USER -p $CI_REGISTRY_PASSWORD $CI_REGISTRY

# ── Test Stage ───────────────────────────────
unit-tests:
  stage: test
  image: node:20-alpine
  services:
    - name: postgres:15-alpine
      alias: postgres
  variables:
    POSTGRES_DB: testdb
    POSTGRES_USER: test
    POSTGRES_PASSWORD: test
  cache:
    key: "$CI_COMMIT_REF_NAME"
    paths:
      - node_modules/
  script:
    - npm ci
    - npm run test -- --coverage
  coverage: '/Lines\s*:\s*(\d+\.?\d*)%/'
  artifacts:
    reports:
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml
      junit: test-results/junit.xml
    paths:
      - coverage/
    expire_in: 7 days

lint:
  stage: test
  image: node:20-alpine
  script:
    - npm ci
    - npm run lint

# ── Build Stage ──────────────────────────────
build-image:
  stage: build
  image: docker:24
  services:
    - docker:24-dind
  <<: *docker-login
  script:
    - docker build -t $IMAGE:$TAG .
    - docker build -t $IMAGE:latest .
    - docker push $IMAGE:$TAG
    - docker push $IMAGE:latest
  only:
    - main
    - develop
    - tags

# ── Security Stage ───────────────────────────
container-scanning:
  stage: security
  image:
    name: aquasec/trivy:latest
    entrypoint: [""]
  script:
    - trivy image
        --exit-code 1
        --severity HIGH,CRITICAL
        --format json
        --output trivy-report.json
        $IMAGE:$TAG
  artifacts:
    reports:
      container_scanning: trivy-report.json
    paths:
      - trivy-report.json
  allow_failure: false
  only:
    - main

sast:
  stage: security
  include:
    - template: Security/SAST.gitlab-ci.yml

# ── Deploy Stage ─────────────────────────────
deploy-staging:
  stage: deploy
  image: bitnami/kubectl:latest
  environment:
    name: staging
    url: https://staging.myapp.com
  script:
    - kubectl config use-context $STAGING_K8S_CONTEXT
    - kubectl set image deployment/my-api my-api=$IMAGE:$TAG -n staging
    - kubectl rollout status deployment/my-api -n staging --timeout=5m
  only:
    - main

deploy-production:
  stage: deploy
  image: bitnami/kubectl:latest
  environment:
    name: production
    url: https://myapp.com
  script:
    - kubectl config use-context $PROD_K8S_CONTEXT
    - kubectl set image deployment/my-api my-api=$IMAGE:$TAG -n production
    - kubectl rollout status deployment/my-api -n production --timeout=10m
  when: manual           # requires manual approval!
  only:
    - main
```

---

## GitLab Environments and Deployments

```yaml
# GitLab tracks deployments automatically
# Configuration in .gitlab-ci.yml

deploy-production:
  environment:
    name: production
    url: https://myapp.com
    action: start        # or: stop, prepare, verify
    on_stop: stop-production    # run this job to stop the environment

stop-production:
  environment:
    name: production
    action: stop
  when: manual
  script:
    - kubectl delete namespace production
```

---

## GitLab Variables and Secrets

```bash
# In GitLab: Settings → CI/CD → Variables

# Types of variables:
# Variable    → regular variable (shown in logs)
# File        → content is written to a file, path is in variable
# Masked      → hidden from logs
# Protected   → only available in protected branches (main, production)

# Access in .gitlab-ci.yml:
# $MY_SECRET_TOKEN    → regular access
# $CI_REGISTRY        → built-in: registry URL
# $CI_REGISTRY_USER   → built-in: registry username
# $CI_COMMIT_SHA      → built-in: full commit hash
# $CI_COMMIT_SHORT_SHA → built-in: short commit hash (8 chars)
# $CI_ENVIRONMENT_NAME → built-in: environment name
# $CI_PROJECT_NAME    → built-in: project name
```

---

## GitLab Runners

```bash
# Install GitLab Runner on your server
curl -L https://packages.gitlab.com/install/repositories/runner/gitlab-runner/script.deb.sh | sudo bash
sudo apt install gitlab-runner

# Register runner
sudo gitlab-runner register \
    --url https://gitlab.com/ \
    --registration-token YOUR_TOKEN \
    --executor docker \
    --docker-image alpine:latest \
    --description "Production runner" \
    --tag-list "production,linux,docker"

# Runner in Kubernetes (recommended for scalability)
helm repo add gitlab https://charts.gitlab.io
helm install gitlab-runner gitlab/gitlab-runner \
    --namespace gitlab \
    --create-namespace \
    --set gitlabUrl=https://gitlab.com \
    --set runnerToken=YOUR_TOKEN \
    --set rbac.create=true
```

---

## Interview Questions — GitLab CI

**Q: How do you protect secrets in GitLab CI/CD?**
> "I store secrets in GitLab CI/CD Variables with Masked and Protected flags. Masked
> prevents the value from appearing in logs. Protected means the variable is only
> available in protected branches (main, tags). For AWS credentials, I use the
> HashiCorp Vault integration or GitLab's built-in Vault integration — the pipeline
> gets a short-lived token, not long-lived credentials."

---

[← Previous: GitHub Actions](./02-github-actions.md) | [Next: Nexus + SonarQube →](./04-nexus-sonarqube.md)
