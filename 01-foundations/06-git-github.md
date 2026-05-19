# Git and GitHub for DevOps

> Every DevOps engineer uses Git every day.
> Git is version control. GitHub/GitLab is where teams store and collaborate.

---

## Git Basics

```bash
# Configure Git (first time)
git config --global user.name "Your Name"
git config --global user.email "you@company.com"
git config --global core.editor "vim"
git config --global init.defaultBranch main

# Start a new project
git init my-project
cd my-project

# Clone an existing project
git clone https://github.com/company/my-app.git
git clone git@github.com:company/my-app.git   # SSH (recommended)
```

---

## Daily Git Workflow

```bash
# Check status
git status

# See what changed
git diff                     # unstaged changes
git diff --staged            # staged changes

# Stage files
git add file.txt
git add src/                 # add directory
git add .                    # add everything (be careful!)
git add -p                   # interactive — choose what to stage

# Commit
git commit -m "feat: add health check endpoint"
git commit -m "fix: correct database connection timeout"
git commit -m "chore: update dependencies"

# Commit message best practice (Conventional Commits):
# feat:     new feature
# fix:      bug fix
# chore:    maintenance (no code change)
# docs:     documentation
# refactor: code improvement (no feature change)
# test:     add or fix tests
# ci:       CI/CD changes

# Push to remote
git push origin main
git push origin feature/my-new-feature

# Pull updates from remote
git pull origin main
git fetch origin             # fetch without merging
```

---

## Branching Strategy

```bash
# Create branch
git checkout -b feature/payment-api
git switch -c feature/payment-api    # modern syntax

# List branches
git branch                   # local
git branch -a                # all (local + remote)
git branch -r                # remote only

# Switch branch
git checkout main
git switch main              # modern syntax

# Merge branch
git checkout main
git merge feature/payment-api
git merge --no-ff feature/payment-api   # keep merge commit

# Rebase (clean history)
git checkout feature/payment-api
git rebase main              # replay my commits on top of main

# Delete branch
git branch -d feature/payment-api   # safe (checks if merged)
git branch -D feature/payment-api   # force delete

# Push branch to remote
git push origin feature/payment-api
git push --set-upstream origin feature/payment-api
```

---

## GitFlow — Branching Model Used in Production

```
main        → production code (protected)
  ↑
release/1.5 → release preparation (created from develop)
  ↑
develop     → integration branch (all features merge here)
  ↑
feature/X   → one branch per feature
hotfix/Y    → urgent fix on main (goes directly to main + develop)
```

```bash
# GitFlow example
# 1. Start a feature
git checkout develop
git pull origin develop
git checkout -b feature/add-mfa

# 2. Work, commit, push
git add .
git commit -m "feat: add multi-factor authentication"
git push origin feature/add-mfa

# 3. Open Pull Request: feature/add-mfa → develop

# 4. After merge, create release
git checkout develop
git pull origin develop
git checkout -b release/1.5.0

# 5. Fix bugs in release branch, then merge to main
git checkout main
git merge --no-ff release/1.5.0
git tag -a v1.5.0 -m "Release 1.5.0"
git push origin main --tags
```

---

## Handling Conflicts

```bash
# Scenario: two developers changed the same file

git merge feature/other-dev
# Auto-merging src/config.js
# CONFLICT: Merge conflict in src/config.js

# Open the conflicted file
cat src/config.js
# <<<<<<< HEAD
# const timeout = 5000;
# =======
# const timeout = 3000;
# >>>>>>> feature/other-dev

# Fix the conflict manually:
# Remove the markers, keep the correct code
# const timeout = 5000;    # or 3000, or something else

# After fixing:
git add src/config.js
git commit -m "merge: resolve timeout conflict"

# Abort a merge
git merge --abort
```

---

## Git for DevOps — Infrastructure and Config Files

```bash
# .gitignore — don't commit these!
cat .gitignore
# *.env
# *.key
# *.pem
# .terraform/
# node_modules/
# __pycache__/
# *.log
# secrets.yml

# Tag releases
git tag -a v1.5.2 -m "Release 1.5.2 — add MFA support"
git push origin v1.5.2
git push origin --tags

# Find when a bug was introduced
git log --oneline --graph --all
git bisect start
git bisect bad HEAD           # current version is broken
git bisect good v1.4.0        # this version was fine
# Git checks out middle commit — test it, then:
git bisect good                # or: git bisect bad
# Git finds the exact commit that broke things!
git bisect reset

# See who changed what
git blame src/payment.js
git log --follow -p src/payment.js   # full history of a file

# Undo things
git revert <commit-hash>      # safe: creates new commit that undoes
git reset --soft HEAD~1       # undo last commit, keep staged changes
git reset --hard HEAD~1       # CAREFUL: undo last commit, lose changes

# Stash work in progress
git stash
git stash save "WIP: fixing auth bug"
git stash list
git stash pop                 # apply and remove stash
git stash apply               # apply but keep stash
```

---

## GitHub — Working with Teams

```bash
# Fork a repository (get your own copy)
# Click "Fork" on GitHub, then clone your fork:
git clone git@github.com:YOUR_USER/original-repo.git

# Keep your fork up to date
git remote add upstream git@github.com:original-owner/original-repo.git
git fetch upstream
git merge upstream/main

# Pull Request workflow
# 1. Fork the repo
# 2. Create a feature branch
git checkout -b fix/payment-bug

# 3. Make changes and commit
git commit -m "fix: prevent duplicate payment processing"

# 4. Push to your fork
git push origin fix/payment-bug

# 5. Open Pull Request on GitHub
# Title: fix: prevent duplicate payment processing
# Description: explain what, why, how to test

# 6. Code review, address comments
git commit -m "review: add test for duplicate prevention"
git push origin fix/payment-bug   # PR updates automatically
```

---

## GitHub Actions — Basics (CI/CD in GitHub)

```yaml
# .github/workflows/ci.yml
name: CI Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run tests
        run: |
          npm install
          npm test

      - name: SonarQube analysis
        uses: SonarSource/sonarcloud-github-action@master
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

---

## Git Hooks — Automate Quality Checks

```bash
# Git hooks run automatically on git actions
ls .git/hooks/
# pre-commit, pre-push, post-merge, etc.

# Example: pre-commit hook — run tests before commit
cat .git/hooks/pre-commit
#!/bin/bash
echo "Running tests before commit..."
npm test
if [ $? -ne 0 ]; then
    echo "Tests failed. Commit aborted."
    exit 1
fi

chmod +x .git/hooks/pre-commit

# Use Husky (Node.js) for team-shared hooks
# package.json:
{
  "husky": {
    "hooks": {
      "pre-commit": "npm test",
      "commit-msg": "commitlint -E HUSKY_GIT_PARAMS"
    }
  }
}
```

---

## Protect Your Main Branch

```bash
# On GitHub:
# Settings → Branches → Branch protection rules
# ✓ Require a pull request before merging
# ✓ Require approvals (at least 1)
# ✓ Require status checks to pass (CI must pass)
# ✓ Include administrators (nobody bypasses rules)
# ✓ Restrict who can push to matching branches

# This prevents direct pushes to main
# All changes go through Pull Requests
# All changes are reviewed and tested
```

---

## Interview Questions — Git

**Q: What is the difference between merge and rebase?**
> "Merge creates a new merge commit that combines two branches — the history shows all
> branches. Rebase replays your commits on top of another branch — the history is linear
> and cleaner. I use merge for integrating features to main (to preserve history), and
> rebase to update my feature branch with the latest main (to keep it clean)."

**Q: What is a Pull Request and why is it important?**
> "A Pull Request is a request to merge your branch into another branch. It is important
> because it triggers code review — teammates can check the code before it goes to main.
> It also triggers CI — tests run automatically. In production environments, I enforce
> branch protection so nothing goes to main without a PR and CI passing."

**Q: How do you handle a hotfix in production?**
> "I create a hotfix branch from main (not develop). I fix the bug, test it, and merge
> to both main and develop. I tag the release. This way, the fix goes to production
> immediately and also gets included in future releases."

---

[← Previous: YAML/JSON](./05-yaml-json.md) | [Next: Cloud Section →](../02-cloud/README.md)
