# Networking Fundamentals for DevOps

> You do not need to be a network engineer.
> But you need to know enough to debug connectivity issues
> and design cloud network architectures.

---

## The OSI Model (Simplified)

```
Layer 7 — Application    → HTTP, HTTPS, DNS, SMTP
Layer 4 — Transport      → TCP, UDP (ports live here)
Layer 3 — Network        → IP addresses, routing
Layer 2 — Data Link      → MAC addresses, switches
Layer 1 — Physical       → Cables, fiber, wifi
```

**In DevOps, you mostly work with Layers 3, 4, and 7.**

---

## IP Addresses

```bash
# IPv4 address format: 4 numbers from 0 to 255
192.168.1.100

# Private IP ranges (inside your network, not on the internet)
10.0.0.0/8         # big corporate networks
172.16.0.0/12      # medium networks
192.168.0.0/16     # home/office networks

# Public IP — visible on the internet
8.8.8.8            # Google DNS

# Loopback — the server talks to itself
127.0.0.1          # or "localhost"

# CIDR notation: /24 means 256 addresses
192.168.1.0/24     # 192.168.1.0 to 192.168.1.255
10.0.0.0/16        # 65,536 addresses

# Check your IP
ip addr show
curl ifconfig.me    # your public IP
```

---

## TCP vs UDP

| TCP | UDP |
|-----|-----|
| Reliable — confirms each packet | Fast — no confirmation |
| Order guaranteed | Order not guaranteed |
| Uses more overhead | Less overhead |
| HTTP, HTTPS, SSH, databases | DNS, video streaming, gaming |

```bash
# Test TCP connection to a port
nc -zv google.com 443       # is port 443 open?
telnet google.com 80        # older way

# See open ports
ss -tlnp                    # TCP listening ports
ss -ulnp                    # UDP listening ports
```

---

## Ports You Must Know

| Port | Protocol | Use Case |
|------|----------|----------|
| 22 | SSH | Remote server access |
| 80 | HTTP | Web traffic (unencrypted) |
| 443 | HTTPS | Web traffic (encrypted) |
| 3306 | MySQL | Database |
| 5432 | PostgreSQL | Database |
| 6379 | Redis | Cache |
| 27017 | MongoDB | Database |
| 8080 | HTTP alt | Applications, Jenkins |
| 9090 | Prometheus | Metrics |
| 3000 | Grafana | Dashboards |
| 9200 | Elasticsearch | Search |
| 5601 | Kibana | Log dashboard |

```bash
# Check what is on a port
lsof -i :8080
ss -tlnp | grep 8080
```

---

## DNS — Domain Name System

DNS translates names to IP addresses.

```bash
# How DNS works:
# You type: api.mycompany.com
# Your computer asks DNS server: "What is the IP for api.mycompany.com?"
# DNS says: "It is 54.23.189.44"
# Your computer connects to 54.23.189.44

# DNS lookup commands
nslookup api.mycompany.com
dig api.mycompany.com
dig +short api.mycompany.com       # just the IP
dig api.mycompany.com MX           # mail records
dig api.mycompany.com TXT          # text records (used for verification)

# DNS record types
# A     → hostname to IPv4 address
# AAAA  → hostname to IPv6 address
# CNAME → alias (one name points to another)
# MX    → mail server
# TXT   → text (used for SPF, DKIM, domain verification)
# NS    → name server

# Local DNS override (for testing)
sudo nano /etc/hosts
# Add:
# 127.0.0.1 myapp.local
# 10.0.0.5  database.internal
```

---

## HTTP and HTTPS

```bash
# HTTP methods
GET     → get data
POST    → send data (create)
PUT     → update data (full)
PATCH   → update data (partial)
DELETE  → delete data

# Common HTTP status codes (you MUST know these)
200 OK              → success
201 Created         → resource created
301 Moved Permanently → redirect
400 Bad Request     → client error, wrong data
401 Unauthorized    → not authenticated
403 Forbidden       → authenticated but no permission
404 Not Found       → resource does not exist
429 Too Many Requests → rate limit hit
500 Internal Server Error → server crashed
502 Bad Gateway     → proxy/load balancer cannot reach app
503 Service Unavailable → app is overloaded or down
504 Gateway Timeout → app did not respond in time

# Test HTTP with curl
curl -I https://api.example.com/health       # headers only
curl -v https://api.example.com/health       # verbose (show everything)
curl -X POST https://api.example.com/login \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer my-token" \
  -d '{"user":"admin","pass":"secret"}'

# Useful curl options
# -s    silent (no progress bar)
# -o    save to file
# -L    follow redirects
# -k    ignore SSL certificate errors (dev only!)
# -w    print response time
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" https://example.com
```

---

## Load Balancers

A load balancer distributes traffic between multiple servers.

```
Client → Load Balancer → Server 1
                       → Server 2
                       → Server 3
```

**Types:**
- **Layer 4** (TCP/UDP): Routes by IP and port (fast, simple)
- **Layer 7** (HTTP): Routes by URL, headers, content (smart)

**Algorithms:**
- Round Robin: 1, 2, 3, 1, 2, 3...
- Least Connections: sends to server with fewest active connections
- IP Hash: same client always goes to same server (session stickiness)

```bash
# Check Nginx as load balancer
cat /etc/nginx/nginx.conf

# Upstream block defines the servers
upstream api_servers {
    server 10.0.1.10:8080;
    server 10.0.1.11:8080;
    server 10.0.1.12:8080;
}
```

---

## Firewalls

```bash
# UFW (Ubuntu Firewall — simple)
sudo ufw status
sudo ufw allow 22/tcp        # allow SSH
sudo ufw allow 80/tcp        # allow HTTP
sudo ufw allow 443/tcp       # allow HTTPS
sudo ufw deny 3306/tcp       # block MySQL from outside
sudo ufw enable

# iptables (lower level, more powerful)
sudo iptables -L -n -v
sudo iptables -A INPUT -p tcp --dport 8080 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 3306 -s 10.0.0.0/24 -j ACCEPT  # MySQL only from internal
sudo iptables -A INPUT -p tcp --dport 3306 -j DROP    # block all other MySQL

# AWS Security Groups (cloud firewall)
# Defined in Terraform:
resource "aws_security_group" "web" {
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]    # from anywhere
  }
  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["10.0.0.0/8"]   # SSH only from internal network
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]    # allow all outbound
  }
}
```

---

## VPN and Private Networks

```bash
# VPN options
OpenVPN    → open source, self-hosted
WireGuard  → modern, fast, simple config
AWS VPN    → connect your office to AWS VPC

# Check VPN connection
ip route show          # see if VPN routes are added
ping 10.0.0.1          # try to reach internal server

# Site-to-Site VPN (office to AWS)
# Your office network: 192.168.0.0/16
# AWS VPC: 10.0.0.0/16
# VPN connects both networks
# Servers in AWS can reach your office servers
```

---

## Vagrant — Local Network Lab

Vagrant creates virtual machines for testing.

```bash
# Install Vagrant + VirtualBox
# Then create a Vagrantfile:

cat Vagrantfile
# Vagrant.configure("2") do |config|
#   config.vm.define "web" do |web|
#     web.vm.box = "ubuntu/focal64"
#     web.vm.network "private_network", ip: "192.168.56.10"
#   end
#   config.vm.define "db" do |db|
#     db.vm.box = "ubuntu/focal64"
#     db.vm.network "private_network", ip: "192.168.56.11"
#   end
# end

vagrant up               # start VMs
vagrant ssh web          # SSH into web VM
vagrant halt             # stop VMs
vagrant destroy          # delete VMs
```

---

## Network Troubleshooting — Step by Step

When something cannot connect:

```bash
# 1. Can I reach the server at all?
ping 10.0.0.5

# 2. Is the port open?
nc -zv 10.0.0.5 8080
# or
telnet 10.0.0.5 8080

# 3. Is my app listening on that port?
ss -tlnp | grep 8080

# 4. Is the firewall blocking?
sudo ufw status
sudo iptables -L -n -v | grep 8080

# 5. Can the server resolve the DNS name?
dig api.mycompany.com

# 6. Trace the network path
traceroute api.mycompany.com
mtr api.mycompany.com        # better than traceroute

# 7. Check SSL certificate
openssl s_client -connect api.mycompany.com:443 -showcerts

# 8. See what traffic is on the network
sudo tcpdump -i eth0 port 8080 -n
sudo tcpdump -i eth0 host 10.0.0.5 -n
```

---

## Interview Questions — Networking

**Q: What happens when you type "google.com" in your browser?**
> "Your browser asks the DNS resolver for the IP of google.com. The resolver checks its
> cache. If not cached, it asks the root DNS, then the .com DNS, then Google's DNS server.
> It gets back an IP like 142.250.80.46. The browser opens a TCP connection on port 443.
> The TLS handshake happens to establish encryption. Then the HTTP request is sent and the
> page loads. In AWS, this is similar but Route 53 handles the DNS."

**Q: What is the difference between a Security Group and a Network ACL in AWS?**
> "Security Groups are stateful and attached to instances — you allow traffic and the
> response is automatically allowed back. ACLs are stateless and attached to subnets —
> you must explicitly allow both inbound and outbound. Security Groups are the first line
> of defense; ACLs are used for broader subnet-level rules."

**Q: Port 502 is the response. What do you do?**
> "502 Bad Gateway means the load balancer or reverse proxy cannot reach the backend server.
> I check if the backend is running: `systemctl status app`. Check logs: `journalctl -u app`.
> Check if it is listening on the correct port. Check if the health check is passing.
> Check security group rules between the load balancer and the server."

---

[← Back to Section](./README.md) | [Next: Bash Scripting →](./04-bash-scripting.md)
