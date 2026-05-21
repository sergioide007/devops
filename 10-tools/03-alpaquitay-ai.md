# alpaquitay-ai — AI DevOps Agents in VS Code

> alpaquitay-ai is a VS Code extension that brings AI-powered DevOps assistance
> directly to your editor. It uses Anthropic Claude, OpenAI, or local models (Ollama).

---

## What Is alpaquitay-ai?

alpaquitay-ai is an all-in-one AI coding assistant for VS Code with:
- **Chat** — ask questions about your code, infrastructure, and DevOps
- **Spec** — Spec-Driven Development (manage requirements in `spec.md`)
- **Board** — Kanban board for tasks
- **Git History** — AI analysis of commits
- **Skills** — Agent Skill System for automated workflows

---

## Install

```bash
# Option 1: From VS Code Marketplace
# Open VS Code → Extensions → Search "alpaquitay-ai" → Install

# Option 2: From VSIX file (local build)
cd alpaquitay-ai
npm install
npm run compile
npx @vscode/vsce package
code --install-extension alpaquitay-ai-2.0.0.vsix
```

---

## Configure AI Provider

```json
// VS Code settings.json (Ctrl+Shift+P → "Open Settings JSON")
{
    "alpaquitay-ai.provider": "anthropic",
    "alpaquitay-ai.anthropic.model": "claude-sonnet-4-6",
    "alpaquitay-ai.maxTokens": 4096,
    "alpaquitay-ai.temperature": 0.3,

    // For Ollama (local models — free, private)
    // "alpaquitay-ai.provider": "ollama",
    // "alpaquitay-ai.ollama.model": "codellama",
    // "alpaquitay-ai.ollama.endpoint": "http://localhost:11434",
}
```

---

## DevOps Use Cases

### 1. Review Kubernetes YAML

```
In VS Code: open deployment.yaml
In alpaquitay-ai Chat: "Review this Kubernetes deployment for production readiness.
Check: resource limits, health probes, security context, image tag."
```

AI will check:
- Is `latest` tag used? (bad practice)
- Are resource requests and limits set?
- Is there a liveness and readiness probe?
- Is a non-root user configured?
- Are secrets referenced correctly (not hardcoded)?

---

### 2. Generate Terraform Code

```
In alpaquitay-ai Chat:
"Create Terraform code for an RDS PostgreSQL database in a private subnet with:
- Multi-AZ for high availability
- KMS encryption at rest
- Automated backups (7 days)
- Security group that allows access only from EKS pods"
```

---

### 3. Explain a CI/CD Pipeline

```
Open your Jenkinsfile or .github/workflows/ci.yml
In alpaquitay-ai Chat: "Explain what this pipeline does step by step.
What happens if the SonarQube quality gate fails?"
```

---

### 4. Debug Bash Scripts

```
Open a failing script
In alpaquitay-ai Chat: "This script fails with 'unbound variable' on line 23.
Here is the error: [paste error]. What is wrong and how do I fix it?"
```

---

## DevOps Agent Skills

alpaquitay-ai has a Skills system with built-in DevOps capabilities:

```
Skills Panel (in the alpaquitay-ai panel):
├── DailyStandup    → generates standup from git activity
├── CreateFile      → creates files from description
├── Refactor        → refactors code
└── GenerateTests   → generates test cases
```

### Daily Standup Skill

The DailyStandup skill is a DeepAgent pipeline:
1. **git-analysis step** → reads recent commits
2. **spec-analysis step** → reads spec.md for context
3. **standup step** → generates the standup report

```typescript
// How DailyStandupSkill works internally (in alpaquitay-ai codebase):
// src/skills/built-in/DailyStandupSkill.ts

const skill = new DeepAgentSkill('daily-standup', 'Daily Standup', 'Generate standup', [
    {
        name: 'git-analysis',
        async run(ctx, outputs) {
            const git = new GitIntegration(ctx.workspaceRoot);
            return await git.getRecentCommits(24);  // last 24 hours
        }
    },
    {
        name: 'spec-analysis',
        async run(ctx, outputs) {
            const spec = new SpecManager(ctx.workspaceRoot);
            return await spec.getActiveItems();
        }
    },
    {
        name: 'standup',
        async run(ctx, outputs) {
            const prompt = `
                Git activity: ${outputs['git-analysis']}
                Active spec items: ${outputs['spec-analysis']}
                Generate a brief standup report.
            `;
            return await ctx.complete(prompt);
        }
    }
]);
```

---

## Parallel DevOps Review with alpaquitay-ai

```typescript
// In your code or as a custom skill
// Uses ParallelSkill to run multiple reviews simultaneously

const devopsReview = new ParallelSkill('devops-review', 'DevOps Review', [
    'security-audit',        // check for security issues
    'cost-optimization',     // check for cost inefficiencies
    'performance-review',    // check for performance issues
]);

// This runs all three in parallel (up to alpaquitay-ai.skill.maxParallel)
// Returns combined report
```

---

## Integration with DevOps Workflow

```
Your Git commit triggers CI
         ↓
CI fails with cryptic error
         ↓
Copy error to alpaquitay-ai Chat
"This Jenkins build failed with this error: [error].
My Jenkinsfile is: [paste]. What is wrong?"
         ↓
alpaquitay-ai reads your Jenkinsfile and explains the issue
         ↓
You fix it and push again
```

---

## Ollama for Local DevOps AI (No API Key Needed)

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull models good for DevOps/code tasks
ollama pull codellama:13b       # code generation
ollama pull mixtral:8x7b        # general tasks (slower, better)
ollama pull llama3.2:3b         # fast, good for simple tasks

# Configure alpaquitay-ai to use Ollama
# VS Code settings:
# "alpaquitay-ai.provider": "ollama"
# "alpaquitay-ai.ollama.model": "codellama:13b"

# Test Ollama
ollama run codellama "Write a Bash script to check disk usage and alert at 80%"
```

---

## Privacy Features

alpaquitay-ai includes built-in privacy controls (GDPR/CCPA):
- No conversation history sent to servers (when using Ollama)
- API keys stored in OS keychain (not in VS Code settings files)
- Privacy mode for sensitive code (code is not sent to AI)

```json
// Enable privacy mode for specific file patterns
{
    "alpaquitay-ai.privacy.excludePatterns": [
        "**/*.env",
        "**/secrets/**",
        "**/pci/**",
        "**/*password*",
        "**/*key*.pem"
    ]
}
```

---

## alpaquitay-ai and Spec-Driven DevOps

Use alpaquitay-ai's Spec feature for DevOps project management:

```markdown
# spec.md — DevOps tasks managed in alpaquitay-ai

## Infrastructure
- [x] Create VPC with public/private subnets
- [x] Set up EKS cluster with Terraform
- [ ] Configure autoscaling (HPA + Cluster Autoscaler)
- [ ] Set up Prometheus + Grafana monitoring

## CI/CD
- [x] Jenkins pipeline for API service
- [ ] GitHub Actions pipeline for frontend
- [ ] SonarQube integration
- [ ] Slack notifications on deployment

## Security
- [ ] Enable CloudTrail in all accounts
- [ ] Set up GuardDuty
- [ ] Rotate all IAM access keys
```

The Board view shows these as Kanban cards.
The Git history view correlates commits to spec items.
The AI can tell you which spec items are blocked or need attention.

---

## Interview Tip

When asked about AI in your workflow:

> "I use alpaquitay-ai in VS Code to speed up DevOps tasks. It has helped me review
> Kubernetes YAML for production readiness, generate Terraform code faster, and debug
> Bash scripts. For sensitive environments, I run it with a local Ollama model so no
> code leaves my machine. The Skills system lets me automate repetitive tasks like
> daily standup generation by chaining git analysis and spec review into a single action."

---

[← Back to Section](./README.md)
