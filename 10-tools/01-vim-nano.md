# Vim and Nano — Terminal Editors

> You will need to edit files on servers with no GUI.
> Vim is everywhere. Learn at least the basics.

---

## Nano — For Beginners

Nano is simple. The commands are shown at the bottom of the screen.

```bash
# Open a file
nano /etc/nginx/nginx.conf

# Commands (shown at bottom):
# Ctrl+O  → Save (Write Out)
# Ctrl+X  → Exit
# Ctrl+K  → Cut current line
# Ctrl+U  → Paste
# Ctrl+W  → Search
# Ctrl+G  → Help

# Jump to a line
# Ctrl+_ then type line number

# Enable syntax highlighting (add to ~/.nanorc)
include "/usr/share/nano/*.nanorc"
```

---

## Vim — For Power Users

Vim has modes. This confuses beginners. Once you know it, it's very fast.

```
NORMAL mode  → navigate and commands (default when you open vim)
INSERT mode  → type text (press i to enter)
VISUAL mode  → select text (press v to enter)
COMMAND mode → :commands (press : to enter)
```

```bash
# Open vim
vim /etc/nginx/nginx.conf

# ── Modes ────────────────────────────────────
i        → INSERT mode (before cursor)
a        → INSERT mode (after cursor)
o        → INSERT mode (new line below)
Esc      → back to NORMAL mode
v        → VISUAL mode (character)
V        → VISUAL mode (line)
Ctrl+v   → VISUAL BLOCK mode (column)
:        → COMMAND mode

# ── Save and Quit ─────────────────────────────
:w       → save
:q       → quit (fails if unsaved changes)
:wq      → save and quit
:q!      → quit WITHOUT saving (force)
:wqa     → save and quit ALL open files
ZZ       → save and quit (shortcut)
ZQ       → quit without saving (shortcut)

# ── Navigation ────────────────────────────────
h j k l  → left, down, up, right
w        → next word
b        → previous word
0        → start of line
$        → end of line
gg       → first line
G        → last line
:25      → go to line 25
Ctrl+f   → page down
Ctrl+b   → page up

# ── Search ────────────────────────────────────
/pattern   → search forward (n = next, N = previous)
?pattern   → search backward
:%s/old/new/g  → replace all in file
:s/old/new/g   → replace in current line

# ── Edit ──────────────────────────────────────
dd       → delete (cut) current line
d3d      → delete 3 lines
yy       → copy (yank) current line
y3y      → copy 3 lines
p        → paste after cursor
P        → paste before cursor
u        → undo
Ctrl+r   → redo
.        → repeat last action
x        → delete character under cursor
cw       → change word (delete and enter INSERT)
D        → delete from cursor to end of line
C        → change from cursor to end of line (delete + INSERT)

# ── Multiple Files ────────────────────────────
vim file1 file2
:n       → next file
:prev    → previous file
:sp file → split horizontally
:vsp file → split vertically
Ctrl+w w → switch between splits

# ── Useful Tricks ─────────────────────────────
:set number     → show line numbers
:set syntax=yaml  → syntax highlighting
:%y+            → copy entire file to clipboard
gg=G            → auto-indent entire file
```

---

## .vimrc — Your Vim Configuration

```vim
" ~/.vimrc
set number          " show line numbers
set tabstop=2       " 2 spaces for tab
set shiftwidth=2    " 2 spaces for indent
set expandtab       " use spaces not tabs
set autoindent      " auto indent new lines
set ruler           " show cursor position
set showcmd         " show incomplete commands
set hlsearch        " highlight search results
set incsearch       " search as you type
set ignorecase      " case-insensitive search
set smartcase       " case-sensitive if uppercase
set noswapfile      " no swap files
set cursorline      " highlight current line

" Better syntax highlighting
syntax enable

" YAML specific (important for Kubernetes!)
autocmd FileType yaml setlocal ts=2 sts=2 sw=2 expandtab
```

---

## Vim for DevOps — Common Tasks

```bash
# Edit a file quickly from command line
vim +42 file.sh           # open at line 42
vim +/pattern file.conf   # open at first match
vim -c "set number" file  # open with line numbers

# Compare two files
vimdiff file1.yaml file2.yaml
# Navigation in vimdiff:
# ]c → next difference
# [c → previous difference
# do → get difference from other file
# dp → put difference to other file

# Edit multiple files and run a command
vim -c ":%s/staging/production/g | :w" deployment.yaml
# This opens, replaces all "staging" with "production", saves, and closes

# Read command output into vim
vim -c "r !kubectl get pods -n production" output.txt

# Edit file on remote server
vim scp://ec2-user@10.0.1.5//etc/nginx/nginx.conf

# Quick fix: edit a line from terminal (no vim needed for simple changes)
sed -i 's/timeout: 30/timeout: 60/' config.yaml
```

---

## Interview Tip

If asked "do you know Vim?" in an interview:

> "Yes, I use Vim regularly on production servers where there's no GUI. I know the
> basic navigation, search/replace, and file editing workflows. For complex editing
> I prefer to use my local VS Code with alpaquitay-ai, but when SSHed into a server
> at 2 AM during an incident, knowing Vim is essential."

---

[← Back to Section](./README.md) | [Next: Jira and Agile →](./02-jira-agile.md)
