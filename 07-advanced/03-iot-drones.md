# DevOps for IoT and Drone Systems

> IoT and drone systems have unique requirements:
> real-time processing, edge computing, firmware OTA updates,
> and high reliability (a drone crash is not just downtime).

---

## IoT Architecture Patterns

```
Drone/Device (Edge)
    │ MQTT / CoAP / WebSocket
    ▼
IoT Gateway (field device or cloud)
    │ HTTPS / MQTT
    ▼
Message Broker (AWS IoT Core / Mosquitto)
    │
    ▼
Stream Processing (AWS Kinesis / Apache Kafka)
    │
    ▼
Storage (TimescaleDB / InfluxDB / S3)
    │
    ▼
Analytics / Dashboard (Grafana / QuickSight)
```

---

## AWS IoT Core — Managed MQTT Broker

```bash
# Register a drone as a thing
aws iot create-thing --thing-name "drone-001"

# Create certificate
aws iot create-keys-and-certificate \
    --set-as-active \
    --certificate-pem-outfile drone-001.cert.pem \
    --public-key-outfile drone-001.public.pem \
    --private-key-outfile drone-001.private.pem

# Create IoT policy (what the drone can do)
cat drone-policy.json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": "iot:Connect",
            "Resource": "arn:aws:iot:us-east-1:123456789:client/drone-*"
        },
        {
            "Effect": "Allow",
            "Action": "iot:Publish",
            "Resource": "arn:aws:iot:us-east-1:123456789:topic/drones/+/telemetry"
        },
        {
            "Effect": "Allow",
            "Action": "iot:Subscribe",
            "Resource": "arn:aws:iot:us-east-1:123456789:topicfilter/drones/+/commands"
        },
        {
            "Effect": "Allow",
            "Action": "iot:Receive",
            "Resource": "arn:aws:iot:us-east-1:123456789:topic/drones/+/commands"
        }
    ]
}

aws iot create-policy --policy-name DronePolicy --policy-document file://drone-policy.json

# Attach certificate to thing and policy
CERT_ARN=$(aws iot describe-certificate --certificate-id <id> --query certificateDescription.certificateArn)
aws iot attach-thing-principal --thing-name drone-001 --principal $CERT_ARN
aws iot attach-policy --policy-name DronePolicy --target $CERT_ARN
```

---

## Drone Telemetry — Real-Time Data Pipeline

```python
# Drone sends telemetry data every 100ms (10 Hz)
# drone_telemetry_publisher.py

import json
import time
import ssl
import paho.mqtt.client as mqtt

# Drone configuration
DRONE_ID = "drone-001"
AWS_IOT_ENDPOINT = "your-endpoint.iot.us-east-1.amazonaws.com"
TOPIC = f"drones/{DRONE_ID}/telemetry"

def get_telemetry():
    """Read from actual drone sensors in production."""
    return {
        "drone_id": DRONE_ID,
        "timestamp": time.time(),
        "position": {
            "lat": 37.7749 + (random.random() - 0.5) * 0.001,
            "lon": -122.4194 + (random.random() - 0.5) * 0.001,
            "altitude_m": 50.0,
            "accuracy_m": 0.3    # GPS accuracy (NASA requires < 1m)
        },
        "velocity": {
            "north_ms": 2.5,
            "east_ms": 0.8,
            "down_ms": 0.0
        },
        "orientation": {
            "roll_deg": 1.2,
            "pitch_deg": -0.8,
            "yaw_deg": 45.0
        },
        "battery": {
            "voltage_v": 22.4,
            "current_a": 12.3,
            "percent": 72
        },
        "flight_mode": "POSITION_HOLD",
        "gps_satellites": 12,
        "signal_strength_dbm": -65
    }

client = mqtt.Client(client_id=DRONE_ID)
client.tls_set(
    ca_certs="root-CA.crt",
    certfile="drone-001.cert.pem",
    keyfile="drone-001.private.pem",
    tls_version=ssl.PROTOCOL_TLSv1_2
)

client.connect(AWS_IOT_ENDPOINT, 8883)
client.loop_start()

while True:
    telemetry = get_telemetry()
    client.publish(TOPIC, json.dumps(telemetry), qos=1)
    time.sleep(0.1)  # 10 Hz
```

---

## Positioning System — NASA Grade Precision

For systems like NASA drone tracking (< 1m accuracy), combine:

```
RTK GPS    → Real-Time Kinematic GPS, accuracy 1-2cm
IMU        → Inertial Measurement Unit (accelerometer + gyro)
Barometer  → altitude backup
UWB        → Ultra-Wideband for indoor positioning (10-30cm accuracy)
Vision     → Computer vision for landing precision
```

```python
# Extended Kalman Filter — sensor fusion for accurate positioning
import numpy as np

class PositionFilter:
    """
    Fuse GPS + IMU data for accurate position estimation.
    Used in NASA UTM (Unmanned Aircraft System Traffic Management).
    """

    def __init__(self):
        # State: [x, y, z, vx, vy, vz, ax, ay, az]
        self.state = np.zeros(9)

        # Covariance matrix
        self.P = np.eye(9) * 0.1

        # Process noise
        self.Q = np.eye(9) * 0.01

        # Measurement noise for GPS (higher = less trust)
        self.R_gps = np.eye(3) * 0.5  # 0.5m GPS noise

        # Measurement noise for RTK GPS (lower = more trust)
        self.R_rtk = np.eye(3) * 0.001  # 0.001m RTK noise

    def predict(self, dt, acceleration):
        """IMU prediction step (runs at 100-200 Hz)."""
        F = self._transition_matrix(dt)
        B = self._control_matrix(dt)

        self.state = F @ self.state + B @ acceleration
        self.P = F @ self.P @ F.T + self.Q

    def update_gps(self, gps_position, use_rtk=False):
        """GPS measurement update (runs at 1-10 Hz)."""
        H = np.zeros((3, 9))
        H[0, 0] = H[1, 1] = H[2, 2] = 1

        R = self.R_rtk if use_rtk else self.R_gps

        innovation = gps_position - H @ self.state
        S = H @ self.P @ H.T + R
        K = self.P @ H.T @ np.linalg.inv(S)  # Kalman gain

        self.state = self.state + K @ innovation
        self.P = (np.eye(9) - K @ H) @ self.P

        return {
            'position': self.state[:3],
            'velocity': self.state[3:6],
            'accuracy_m': np.sqrt(np.trace(self.P[:3, :3]))
        }
```

---

## Over-the-Air (OTA) Firmware Updates

Critical for drone fleets. Never have drones running different firmware versions.

```python
# AWS IoT Jobs for OTA updates
import boto3
import json

iot_client = boto3.client('iot')

def create_ota_job(firmware_version, target_drones, s3_bucket, s3_key):
    """
    Send firmware update to a fleet of drones.
    Rolls out to 10% first, then full fleet if successful.
    """
    job = iot_client.create_job(
        jobId=f"firmware-update-{firmware_version}",
        targets=target_drones,
        document=json.dumps({
            "operation": "update-firmware",
            "version": firmware_version,
            "firmware_url": f"https://{s3_bucket}.s3.amazonaws.com/{s3_key}",
            "checksum_sha256": calculate_checksum(s3_bucket, s3_key),
            "rollback_version": get_current_version()
        }),
        jobExecutionsRolloutConfig={
            "exponentialRate": {
                "baseRatePerMinute": 5,        # start: 5 drones/min
                "incrementFactor": 1.5,        # grow 1.5x each step
                "rateIncreaseCriteria": {
                    "numberOfSucceededThings": 10   # after 10 succeed
                }
            }
        },
        abortConfig={
            "criteriaList": [
                {
                    "failureType": "FAILED",
                    "action": "CANCEL",
                    "thresholdPercentage": 5.0,   # abort if 5% fail
                    "minNumberOfExecutedThings": 10
                }
            ]
        },
        description=f"Firmware update to {firmware_version}",
        targetSelection="SNAPSHOT"
    )

    return job['jobId']
```

---

## Edge Computing for Drones

```yaml
# K3s (lightweight Kubernetes) on drone ground station
# Runs on Raspberry Pi 4 or Jetson Nano

# Install K3s edge cluster
curl -sfL https://get.k3s.io | sh -

# Deploy real-time processing at the edge
apiVersion: apps/v1
kind: Deployment
metadata:
  name: telemetry-processor
spec:
  replicas: 1
  template:
    spec:
      nodeSelector:
        edge-device: "true"
      containers:
        - name: processor
          image: myregistry/telemetry-processor:latest
          resources:
            limits:
              memory: "512Mi"
              cpu: "500m"
          env:
            - name: PROCESSING_MODE
              value: "edge"
            - name: LATENCY_THRESHOLD_MS
              value: "10"    # must process in under 10ms
          volumeMounts:
            - name: drone-data
              mountPath: /data
```

---

## Drone CI/CD Pipeline

```yaml
# .github/workflows/drone-firmware.yml
name: Drone Firmware CI/CD

on:
  push:
    branches: [main]
    paths:
      - 'firmware/**'

jobs:
  build-firmware:
    runs-on: ubuntu-latest
    container:
      image: px4io/px4-dev-ros2-foxy:latest  # PX4 build environment

    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive    # PX4 has many submodules

      - name: Build firmware
        run: |
          cd firmware/PX4-Autopilot
          make px4_fmu-v5_default

      - name: Run SITL simulation tests
        run: |
          cd firmware/PX4-Autopilot
          HEADLESS=1 make px4_sitl_default gazebo
          python3 tests/run_mission.py

      - name: Sign firmware
        run: |
          openssl dgst -sha256 -sign private.pem \
              -out firmware.sig \
              build/px4_fmu-v5_default/px4_fmu-v5_default.px4

      - name: Upload to S3
        run: |
          aws s3 cp firmware.px4 \
              s3://drone-firmware/v${{ github.run_number }}/firmware.px4
          aws s3 cp firmware.sig \
              s3://drone-firmware/v${{ github.run_number }}/firmware.sig

      - name: Create OTA job (10% rollout)
        run: |
          python3 scripts/create_ota_job.py \
              --version v${{ github.run_number }} \
              --environment staging \
              --rollout-percent 10
```

---

## Observability for Drone Fleets

```python
# Custom Prometheus metrics for drone fleet
from prometheus_client import Gauge, Counter, Histogram, start_http_server

# Fleet-level metrics
drones_online = Gauge('drones_online_total', 'Number of drones currently online')
drones_flying = Gauge('drones_flying_total', 'Number of drones currently in flight')
battery_low = Gauge('drones_battery_low_total', 'Drones with battery < 20%')

# Per-drone metrics
drone_battery = Gauge('drone_battery_percent', 'Battery level', ['drone_id'])
drone_altitude = Gauge('drone_altitude_meters', 'Current altitude', ['drone_id'])
drone_signal = Gauge('drone_signal_strength_dbm', 'Signal strength', ['drone_id'])
gps_accuracy = Gauge('drone_gps_accuracy_meters', 'GPS accuracy', ['drone_id'])

# Flight metrics
flight_duration = Histogram(
    'drone_flight_duration_seconds',
    'Flight duration histogram',
    ['drone_id'],
    buckets=[60, 300, 600, 1200, 1800, 3600]
)

mission_completion = Counter(
    'drone_missions_total',
    'Mission completions',
    ['drone_id', 'status']  # status: completed, aborted, failed
)

# Alerts (Prometheus alerting rules)
ALERT_RULES = """
groups:
  - name: drone-alerts
    rules:
      - alert: DroneBatteryLow
        expr: drone_battery_percent < 20
        for: 1m
        labels:
          severity: warning
        annotations:
          summary: "Drone {{ $labels.drone_id }} battery low ({{ $value }}%)"
          description: "Drone should return to base"

      - alert: DroneSignalLost
        expr: time() - drone_last_telemetry_timestamp > 10
        for: 30s
        labels:
          severity: critical
        annotations:
          summary: "Drone {{ $labels.drone_id }} lost contact"
          description: "No telemetry for more than 10 seconds"

      - alert: GPSAccuracyDegraded
        expr: drone_gps_accuracy_meters > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Drone {{ $labels.drone_id }} GPS accuracy degraded ({{ $value }}m)"
"""
```

---

## Kafka — High-Throughput IoT Data Pipeline

```yaml
# 1000 drones sending 10 messages/sec = 10,000 messages/sec
# Use Kafka for high throughput

# docker-compose for local dev
services:
  kafka:
    image: confluentinc/cp-kafka:latest
    environment:
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: "true"
      KAFKA_NUM_PARTITIONS: 12          # one partition per group of drones
      KAFKA_REPLICATION_FACTOR: 3       # 3 copies for durability

# Create topics
kafka-topics --create \
    --topic drone-telemetry \
    --partitions 12 \
    --replication-factor 3 \
    --config retention.ms=86400000     # 24 hours

kafka-topics --create \
    --topic drone-commands \
    --partitions 12 \
    --replication-factor 3 \
    --config retention.ms=3600000      # 1 hour

# Monitor lag (how far behind consumers are)
kafka-consumer-groups --describe \
    --group telemetry-processor \
    --bootstrap-server kafka:9092
```

---

## Interview Questions — IoT and Drones

**Q: How do you manage firmware updates for a fleet of 500 drones?**
> "I use AWS IoT Jobs with exponential rollout — start with 5 drones/minute, growing
> 1.5x every step. I set an abort condition: if 5% fail, cancel and auto-rollback.
> Firmware is signed with an RSA key before upload — drones verify the signature before
> applying. I track firmware version distribution in Prometheus and alert if more than
> 5% of the fleet is on an old version after 24 hours. Rollback is tested in CI using
> Hardware-in-the-Loop (HITL) simulation."

**Q: How do you ensure sub-meter GPS accuracy for a NASA-grade application?**
> "Standard consumer GPS gives 3-5m accuracy. For sub-meter, I use RTK GPS — which
> corrects errors using a reference base station and achieves 1-2cm accuracy. I combine
> RTK GPS with IMU data using an Extended Kalman Filter, which maintains accuracy between
> GPS updates (up to 200Hz). For indoor operations, I use UWB positioning systems that
> achieve 10-30cm accuracy without GPS."

---

[← Back to Section](./README.md) | [Next: AI Agent Orchestration →](./04-agent-orchestration.md)
