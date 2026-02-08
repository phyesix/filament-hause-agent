# Filament Hause Agent

Bambulab yazıcınızı cloud'a bağlayan Docker agent.

## Kurulum

### 1. Ortam Değişkenleri

`.env` dosyası oluşturun:

```bash
# Bambulab Yazıcı Bilgileri
PRINTER_IP=192.168.1.100
PRINTER_SERIAL=01P00A...
PRINTER_ACCESS_CODE=12345678

# Filament Hause Cloud
AGENT_TOKEN=your-agent-token-from-website
API_URL=https://filament-hause.vercel.app

# Opsiyonel
SYNC_INTERVAL=5000
```

### 2. Docker ile Çalıştırma

```bash
# Build
docker-compose build

# Çalıştır
docker-compose up -d

# Logları izle
docker-compose logs -f
```

### 3. Direkt Docker Komutu

```bash
docker run -d \
  --name filament-hause-agent \
  --restart unless-stopped \
  -e PRINTER_IP=192.168.1.100 \
  -e PRINTER_SERIAL=01P00A... \
  -e PRINTER_ACCESS_CODE=12345678 \
  -e AGENT_TOKEN=your-token \
  filament-hause-agent
```

## Loglar

```bash
# Docker Compose
docker-compose logs -f

# Docker
docker logs -f filament-hause-agent
```

## Sorun Giderme

### Yazıcıya bağlanamıyorum
- Yazıcı ve Docker host aynı ağda mı?
- Yazıcıda LAN Only Mode açık mı?
- Access Code doğru mu?
- Firewall 8883 portunu engelliyor mu?

### Cloud'a bağlanamıyorum
- Agent Token doğru mu?
- API_URL doğru mu?
- Internet bağlantısı var mı?
