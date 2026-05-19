# Section 10 — Essential DevOps Tools

> The right tool saves hours. The wrong tool wastes days.
> Know your tools deeply.

---

## Topics in This Section

| File | Topic |
|------|-------|
| [01-vim-nano.md](./01-vim-nano.md) | Vim and nano — terminal editors |
| [02-jira-agile.md](./02-jira-agile.md) | Jira, Trello — Agile project management |
| [03-alpaquitay-ai.md](./03-alpaquitay-ai.md) | alpaquitay-ai — AI DevOps agents in VS Code |
| [04-ai-tools.md](./04-ai-tools.md) | AI tools for DevOps (Copilot, Gemini, Claude) |

---

## Essential CLI Tools Every DevOps Engineer Uses

```bash
# Install all at once (Ubuntu)
sudo apt install -y \
    vim \
    htop \
    jq \
    curl \
    wget \
    git \
    tmux \
    tree \
    ncdu \
    mtr \
    nmap \
    tcpdump \
    strace \
    lsof

# Install modern tools
# fzf — fuzzy finder (search commands, files, git history)
sudo apt install fzf

# bat — better cat (syntax highlighting)
sudo apt install bat

# fd — better find
sudo apt install fd-find

# ripgrep — better grep
sudo apt install ripgrep

# k9s — Kubernetes TUI (must-have for K8s work)
curl -sS https://webinstall.dev/k9s | bash

# kubectx + kubens — switch contexts and namespaces fast
sudo git clone https://github.com/ahmetb/kubectx /opt/kubectx
sudo ln -s /opt/kubectx/kubectx /usr/local/bin/kubectx
sudo ln -s /opt/kubectx/kubens /usr/local/bin/kubens

# Lens — Kubernetes GUI (great for onboarding)
# Download from: k8slens.dev
```

---

[← Back to Main](../README.md)
