# GitHub Actions — CI/CD in GitHub

> GitHub Actions is built into GitHub.
> No extra server needed. Free for public repos.
> Used by millions of open source and enterprise projects.

---

## How GitHub Actions Works

```
.github/
└── workflows/
    ├── ci.yml           → runs on every push/PR
    ├── deploy.yml       → deploys to production
    └── security.yml     → runs security scans
```

**Triggers:**
- `push` — code is pushed
- `pull_request` — PR is opened or updated
- `schedule` — cron schedule
- `workflow_dispatch` — manual trigger
- `release` — a release is published
- `workflow_call` — called by another workflow

---

## Complete CI Workflow — Node.js + Docker + AWS

```yaml
# .github/workflows/ci-cd.yml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]
  workflow_dispatch:
    inputs:
      environment:
        description: 'Deploy to environment'
        required: true
        default: 'staging'
        type: choice
        options: [staging, production]

env:
  REGISTRY: ghcr.io
  IMAGE_NAME: ${{ github.repository }}

jobs:
  # ─── JOB 1: Test ───────────────────────────────────────────────
  test:
    name: Test
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:15
        env:
          POSTGRES_DB: testdb
          POSTGRES_USER: test
          POSTGRES_PASSWORD: test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run linting
        run: npm run lint

      - name: Run unit tests
        run: npm run test:unit -- --coverage

      - name: Run integration tests
        env:
          DATABASE_URL: postgres://test:test@localhost:5432/testdb
          REDIS_URL: redis://localhost:6379
        run: npm run test:integration

      - name: Upload coverage to Codecov
        uses: codecov/codecov-action@v4
        with:
          token: ${{ secrets.CODECOV_TOKEN }}
          fail_ci_if_error: true

  # ─── JOB 2: Code Quality ───────────────────────────────────────
  quality:
    name: Code Quality
    runs-on: ubuntu-latest
    needs: test

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # SonarQube needs full history

      - name: SonarQube Scan
        uses: SonarSource/sonarcloud-github-action@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
        with:
          args: >
            -Dsonar.projectKey=my-app
            -Dsonar.organization=my-org
            -Dsonar.sources=src
            -Dsonar.tests=test
            -Dsonar.javascript.lcov.reportPaths=coverage/lcov.info

  # ─── JOB 3: Build Docker Image ─────────────────────────────────
  build:
    name: Build and Push Image
    runs-on: ubuntu-latest
    needs: [test, quality]
    if: github.ref == 'refs/heads/main' || github.ref == 'refs/heads/develop'

    outputs:
      image-tag: ${{ steps.meta.outputs.tags }}
      image-digest: ${{ steps.build.outputs.digest }}

    permissions:
      contents: read
      packages: write

    steps:
      - uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Login to GitHub Container Registry
        uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Extract Docker metadata
        id: meta
        uses: docker/metadata-action@v5
        with:
          images: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}
          tags: |
            type=ref,event=branch
            type=sha,prefix={{branch}}-
            type=raw,value=latest,enable={{is_default_branch}}

      - name: Build and push Docker image
        id: build
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ${{ steps.meta.outputs.tags }}
          labels: ${{ steps.meta.outputs.labels }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
          platforms: linux/amd64,linux/arm64

      - name: Scan image for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: ${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:latest
          format: 'sarif'
          output: 'trivy-results.sarif'
          severity: 'CRITICAL,HIGH'
          exit-code: '1'

      - name: Upload Trivy scan results
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: 'trivy-results.sarif'

  # ─── JOB 4: Deploy to Staging ──────────────────────────────────
  deploy-staging:
    name: Deploy to Staging
    runs-on: ubuntu-latest
    needs: build
    environment:
      name: staging
      url: https://staging.myapp.com

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_STAGING_ROLE_ARN }}
          aws-region: us-east-1

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name staging-cluster --region us-east-1

      - name: Deploy to staging
        run: |
          IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:main-${{ github.sha }}"
          kubectl set image deployment/my-app my-app="$IMAGE" -n staging
          kubectl rollout status deployment/my-app -n staging --timeout=5m

      - name: Run smoke tests
        run: |
          sleep 30
          STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://staging.myapp.com/health)
          if [ "$STATUS" != "200" ]; then
            echo "Smoke test failed: got $STATUS"
            kubectl rollout undo deployment/my-app -n staging
            exit 1
          fi
          echo "Staging smoke tests passed"

  # ─── JOB 5: Deploy to Production ───────────────────────────────
  deploy-production:
    name: Deploy to Production
    runs-on: ubuntu-latest
    needs: deploy-staging
    if: github.ref == 'refs/heads/main'
    environment:
      name: production
      url: https://myapp.com

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_PROD_ROLE_ARN }}
          aws-region: us-east-1

      - name: Update kubeconfig
        run: aws eks update-kubeconfig --name production-cluster --region us-east-1

      - name: Deploy to production (Blue-Green)
        run: |
          IMAGE="${{ env.REGISTRY }}/${{ env.IMAGE_NAME }}:main-${{ github.sha }}"

          # Update green deployment
          kubectl set image deployment/my-app-green my-app="$IMAGE" -n production
          kubectl rollout status deployment/my-app-green -n production --timeout=10m

          # Switch traffic to green
          kubectl patch service my-app -n production \
              -p '{"spec":{"selector":{"version":"green"}}}'

          echo "Production deployment complete: $IMAGE"

      - name: Notify Slack
        if: always()
        uses: slackapi/slack-github-action@v1.26.0
        with:
          payload: |
            {
              "text": "${{ job.status == 'success' && '✅' || '❌' }} Production deployment ${{ job.status }}",
              "blocks": [
                {
                  "type": "section",
                  "text": {
                    "type": "mrkdwn",
                    "text": "*${{ github.repository }}* was deployed to production\nCommit: `${{ github.sha }}`\nBy: ${{ github.actor }}"
                  }
                }
              ]
            }
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

---

## Reusable Workflows

```yaml
# .github/workflows/reusable-deploy.yml
name: Reusable Deploy Workflow

on:
  workflow_call:
    inputs:
      environment:
        required: true
        type: string
      image-tag:
        required: true
        type: string
    secrets:
      AWS_ROLE_ARN:
        required: true

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}

    steps:
      - uses: actions/checkout@v4

      - name: Configure AWS
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: ${{ secrets.AWS_ROLE_ARN }}
          aws-region: us-east-1

      - name: Deploy
        run: |
          aws eks update-kubeconfig --name ${{ inputs.environment }}-cluster
          kubectl set image deployment/my-app my-app=${{ inputs.image-tag }} -n ${{ inputs.environment }}
          kubectl rollout status deployment/my-app -n ${{ inputs.environment }}

# Use the reusable workflow:
# .github/workflows/production.yml
jobs:
  deploy:
    uses: ./.github/workflows/reusable-deploy.yml
    with:
      environment: production
      image-tag: ghcr.io/myorg/my-app:${{ github.sha }}
    secrets:
      AWS_ROLE_ARN: ${{ secrets.PROD_AWS_ROLE_ARN }}
```

---

## GitHub Actions — Useful Patterns

```yaml
# Matrix builds — test multiple versions
strategy:
  matrix:
    node-version: [18, 20, 22]
    os: [ubuntu-latest, windows-latest]

# Conditional steps
- name: Deploy only on tag
  if: startsWith(github.ref, 'refs/tags/v')
  run: ./deploy.sh

# Timeout
- name: Wait for service
  timeout-minutes: 10
  run: ./wait-for-service.sh

# Continue on error
- name: Optional scan
  continue-on-error: true
  run: npm run security-scan

# Job needs (run after)
job2:
  needs: [job1a, job1b]   # runs after BOTH are done

# Outputs between jobs
jobs:
  build:
    outputs:
      version: ${{ steps.get-version.outputs.version }}
    steps:
      - id: get-version
        run: echo "version=$(cat package.json | jq -r .version)" >> $GITHUB_OUTPUT

  deploy:
    needs: build
    steps:
      - run: echo "Deploying version ${{ needs.build.outputs.version }}"
```

---

## Interview Questions — GitHub Actions

**Q: How do you prevent secrets from leaking in GitHub Actions?**
> "I store all secrets in GitHub Secrets (Settings → Secrets). I never echo secrets
> in steps. I use OIDC with AWS instead of long-lived access keys — the workflow
> assumes an IAM role with temporary credentials. For sensitive environments, I use
> GitHub Environments with protection rules — required reviewers must approve before
> the production job runs. I also use Dependabot to keep action versions up to date
> to prevent supply chain attacks."

**Q: How do you run tests in parallel in GitHub Actions?**
> "I use a matrix strategy — multiple jobs run in parallel with different configurations.
> For large test suites, I split tests across jobs using test sharding. I also use
> job-level parallelism — unit tests, integration tests, and lint run as separate
> parallel jobs. This reduced our test time from 20 minutes to 5 minutes."

---

[← Previous: Jenkins](./01-jenkins.md) | [Next: GitLab CI/CD →](./03-gitlab-cicd.md)
