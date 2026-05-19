# Linux Fundamentals for DevOps

> Linux is everywhere in DevOps: servers, containers, CI/CD runners, cloud instances.
> You must know Linux to work as a DevOps engineer.

---

## Linux Distributions (Distros)

| Distro | Use Case | Package Manager |
|--------|----------|----------------|
| **Ubuntu** | Most popular for dev/DevOps | `apt` |
| **Debian** | Stable, used in production | `apt` |
| **CentOS / RHEL** | Enterprise, banking, fintech | `yum` / `dnf` |
| **Amazon Linux** | AWS EC2 instances | `yum` / `dnf` |
| **Alpine Linux** | Docker containers (tiny: 5MB) | `apk` |

---

## Essential Commands — Navigation

```bash
# Where am I?
pwd
# /home/devops

# List files
ls -la
# -l = long format  -a = show hidden files

# Change directory
cd /etc
cd ~          # go to home directory
cd ..         # go up one level
cd -          # go back to previous directory

# Create directory
mkdir my-project
mkdir -p /opt/app/config   # -p creates parent dirs too

# Remove files and directories
rm file.txt
rm -rf /tmp/old-folder     # CAREFUL: -rf removes everything

# Copy and move
cp file.txt /backup/file.txt
mv old-name.txt new-name.txt

# Find files
find / -name "nginx.conf" 2>/dev/null
find /var/log -name "*.log" -mtime -7   # logs modified in last 7 days
```

---

## Essential Commands — Files

```bash
# Read files
cat /etc/os-release          # show full file
less /var/log/syslog         # page through large files (q to quit)
head -20 app.log             # first 20 lines
tail -50 app.log             # last 50 lines
tail -f /var/log/nginx/error.log   # LIVE follow (Ctrl+C to stop)

# Edit files
nano /etc/hosts              # beginner-friendly editor
vim /etc/nginx/nginx.conf    # advanced editor (very common in production)

# Vim quick guide:
# i    = insert mode (start typing)
# Esc  = exit insert mode
# :w   = save
# :q   = quit
# :wq  = save and quit
# :q!  = quit without saving
# /text = search for "text"
# dd   = delete current line
# yy   = copy current line
# p    = paste

# Search inside files
grep "ERROR" app.log
grep -r "database_url" /etc/app/    # search in all files in directory
grep -n "timeout" nginx.conf        # show line numbers
grep -i "error" app.log             # case-insensitive

# Count lines
wc -l /var/log/app.log
```

---

## Process Management

```bash
# See running processes
ps aux
ps aux | grep nginx          # filter by name

# Real-time process monitor
top
htop                         # better version (install: apt install htop)

# Kill a process
kill 1234                    # graceful stop (send SIGTERM)
kill -9 1234                 # force kill (send SIGKILL)
pkill nginx                  # kill by name

# Run in background
./long-script.sh &           # run in background
nohup ./script.sh &          # run even after logout
disown                       # detach from terminal

# System services (systemd)
systemctl start nginx
systemctl stop nginx
systemctl restart nginx
systemctl status nginx
systemctl enable nginx       # start on boot
systemctl disable nginx
journalctl -u nginx          # view logs for a service
journalctl -u nginx -f       # follow logs live
journalctl -u nginx --since "1 hour ago"
```

---

## Networking Commands

```bash
# Network interfaces
ip addr show                 # show IP addresses
ifconfig                     # older command (still common)
ip route show                # show routing table

# Test connectivity
ping google.com
ping -c 4 192.168.1.1        # send only 4 packets

# DNS lookup
nslookup google.com
dig google.com
dig +short google.com

# Port and connection checks
netstat -tlnp                # show listening ports
ss -tlnp                     # modern version of netstat
lsof -i :8080                # who is using port 8080?

# Test HTTP connections
curl http://localhost:8080/health
curl -X POST http://api.example.com/data \
  -H "Content-Type: application/json" \
  -d '{"key": "value"}'

wget http://example.com/file.tar.gz

# Transfer files between servers
scp file.txt user@server:/path/to/dest/
scp -r /local/dir/ user@server:/remote/dir/
rsync -avz /local/ user@server:/remote/    # faster, only changed files
```

---

## Users, Permissions, and Security

```bash
# User management
whoami                       # current user
id                           # user and group IDs
sudo su -                    # switch to root
useradd -m devops            # create user with home directory
passwd devops                # set password
usermod -aG docker devops    # add user to docker group
groups devops                # see groups of user

# File permissions
ls -la
# -rwxr-xr-x  1 root root 1234 May 19 file.sh
#  |||  |||  |||
#  ||| owner group other
#  owner: rwx = read write execute
#  group: r-x = read execute
#  other: r-x = read execute

chmod +x script.sh           # add execute permission
chmod 755 script.sh          # rwxr-xr-x (owner all, group/other read+exec)
chmod 600 secret.key         # rw------- (only owner can read/write)
chown devops:devops file.txt # change owner

# SSH keys (very important for DevOps!)
ssh-keygen -t rsa -b 4096 -C "devops@mycompany.com"
# Creates: ~/.ssh/id_rsa (private) and ~/.ssh/id_rsa.pub (public)

# Copy public key to server
ssh-copy-id -i ~/.ssh/id_rsa.pub user@server
# Now you can login without password:
ssh user@server

# SSH config for multiple servers
cat ~/.ssh/config
# Host prod-web
#   HostName 10.0.1.10
#   User ec2-user
#   IdentityFile ~/.ssh/prod.pem

ssh prod-web    # connects using config above
```

---

## Disk and System Resources

```bash
# Disk usage
df -h                        # disk free (human readable)
du -sh /var/log/             # size of a directory
du -sh /var/log/* | sort -h  # sort directories by size

# Memory
free -h                      # RAM usage
cat /proc/meminfo

# CPU info
nproc                        # number of CPU cores
cat /proc/cpuinfo

# System info
uname -a                     # kernel version
cat /etc/os-release          # OS version
uptime                       # how long running, load average
hostname                     # server name
```

---

## Package Management

```bash
# Ubuntu / Debian
sudo apt update              # refresh package list
sudo apt install nginx -y
sudo apt remove nginx
sudo apt upgrade             # upgrade all packages

# CentOS / RHEL / Amazon Linux
sudo yum update
sudo yum install nginx -y
sudo dnf install nginx -y    # newer systems

# Install from source (when package not available)
wget https://example.com/app-1.0.tar.gz
tar -xzf app-1.0.tar.gz
cd app-1.0
./configure && make && make install
```

---

## Logs — The Most Important Skill in Production

```bash
# System logs
/var/log/syslog              # Ubuntu system log
/var/log/messages            # CentOS system log
/var/log/auth.log            # SSH and auth attempts
/var/log/kern.log            # Kernel messages

# Application logs (common locations)
/var/log/nginx/access.log
/var/log/nginx/error.log
/var/log/apache2/error.log

# Follow logs in real time during an incident
tail -f /var/log/nginx/error.log

# Find ERROR lines in last 100 lines
tail -100 /var/log/app/app.log | grep -i "error\|exception\|fatal"

# Count errors per minute (useful during incidents)
awk '{print $4}' /var/log/nginx/access.log | cut -d: -f1-3 | uniq -c

# View systemd journal (modern Linux)
journalctl -n 100 --no-pager
journalctl --since "2026-05-19 14:00" --until "2026-05-19 15:00"
journalctl -p err              # only errors
```

---

## Cron Jobs — Scheduling Tasks

```bash
# Edit cron jobs
crontab -e

# Cron format:
# minute hour day-of-month month day-of-week command
# *      *    *            *     *

# Examples:
# Run backup every day at 2:30 AM
30 2 * * * /opt/scripts/backup.sh >> /var/log/backup.log 2>&1

# Run cleanup every Sunday at midnight
0 0 * * 0 /opt/scripts/cleanup.sh

# Run health check every 5 minutes
*/5 * * * * curl -s http://localhost:8080/health >> /var/log/health.log

# List cron jobs
crontab -l
```

---

## Environment Variables

```bash
# View all variables
env
printenv

# Set a variable
export DATABASE_URL="postgres://user:pass@localhost:5432/mydb"
export APP_ENV="production"

# Use in script
echo "Connecting to: $DATABASE_URL"

# Make permanent (add to ~/.bashrc or /etc/environment)
echo 'export APP_ENV="production"' >> ~/.bashrc
source ~/.bashrc

# .env files (common in applications)
cat /opt/app/.env
# DATABASE_URL=postgres://...
# APP_ENV=production

# Load .env in bash
set -a
source /opt/app/.env
set +a
```

---

## Quick Reference: Linux Distributions in the Field

```bash
# Check which distro you are on
cat /etc/os-release

# Ubuntu/Debian
ubuntu@server:~$ lsb_release -a

# CentOS/RHEL
[ec2-user@server ~]$ cat /etc/redhat-release

# Amazon Linux (on AWS EC2)
[ec2-user@ip-10-0-1-5 ~]$ cat /etc/system-release
# Amazon Linux release 2023
```

---

## Interview Questions — Linux

**Q: A service is not responding. Walk me through how you diagnose it.**
> "First, check if the process is running: `systemctl status my-service`. Then check
> logs: `journalctl -u my-service -n 50`. Check if the port is listening: `ss -tlnp | grep 8080`.
> Check disk space: `df -h`. Check memory: `free -h`. Check if there are connection errors
> in the application logs. If the service is crashed, restart it and investigate the root cause."

**Q: What is the difference between kill and kill -9?**
> "`kill` sends SIGTERM — a polite request to stop. The process can clean up before
> stopping. `kill -9` sends SIGKILL — immediate, forced termination. The process cannot
> catch or ignore it. Always try SIGTERM first."

**Q: How do you add a cron job?**
> "With `crontab -e`. The format is: minute, hour, day, month, weekday, command.
> For example, `0 2 * * * /scripts/backup.sh` runs at 2 AM every day.
> I always redirect output to a log file: `>> /var/log/backup.log 2>&1`."

---

[← Back to Section](./README.md) | [Next: Networking →](./03-networking-basics.md)
