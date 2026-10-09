# ☁️ AWS VPS Deployment & Android Auto-Verification Guide

இந்த வழிகாட்டி மூலம் உங்கள் AWS VPS (Ubuntu) சர்வரில் இந்த UPI Payment Gateway தளத்தை 10 நிமிடங்களில் முழுமையாக லைவ் செய்யலாம்.

---

## 📌 STEP 1: AWS VPS சர்வரில் Node.js & Nginx நிறுவுதல்

உங்கள் AWS EC2 Ubuntu சர்வரில் SSH மூலம் லாகின் செய்து பின்வரும் கட்டளைகளை இயக்கவும்:

```bash
# 1. Update Packages
sudo apt update && sudo apt upgrade -y

# 2. Install Node.js v20+ & Git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git nginx

# 3. Check version
node -v
npm -v

# 4. Install PM2 (Server எப்போதுமே பின்னணியில் இயங்க)
sudo npm install -g pm2
```

---

## 📌 STEP 2: கோப்புகளை சர்வருக்கு ஏற்றுதல் (Upload / Copy)

உங்கள் சர்வரில் ஒரு போல்டர் உருவாக்கி இந்த `upi-gateway` கோப்புகளை அங்கே வைக்கவும்:

```bash
mkdir -p /var/www/upi-gateway
cd /var/www/upi-gateway

# உங்கள் கோப்புகளை இங்கே copy / git clone செய்த பின்:
npm install --production
```

`.env` கோப்பை எடிட் செய்யவும்:
```bash
nano .env
```
இதை மாற்றவும்:
```env
PORT=5000
NODE_ENV=production
JWT_SECRET=உங்கள்_ரகசிய_வார்த்தை_இங்கே_கொடுக்கவும்
BASE_URL=https://pay.yourdomain.com
NOTIFICATION_SECRET_KEY=உங்கள்_நோட்டிபிகேஷன்_ரகசிய_கீ
DATABASE_PATH=./data/gateway.db
```
(`Ctrl + O` கொடுத்து Enter தட்டி, `Ctrl + X` கொடுத்து வெளியேறவும்).

---

## 📌 STEP 3: PM2 மூலம் சர்வரை பின்னணியில் இயக்குதல்

```bash
cd /var/www/upi-gateway
pm2 start server.js --name "upi-gateway"
pm2 save
pm2 startup
```

இப்போது சர்வர் தானாகவே 24/7 இயங்கத் தொடங்கிவிடும்.

---

## 📌 STEP 4: டொமைன் DNS செட்டிங்ஸ் (Cloudflare / GoDaddy / Namecheap)

1. உங்கள் டொமைன் DNS மேலாண்மை பக்கத்திற்குச் செல்லவும்.
2. ஒரு புதிய **A Record** சேர்க்கவும்:
   * **Name:** `pay` (அல்லது `@` முழு டொமைனுக்கு)
   * **IPv4 Address:** உங்கள் AWS VPS Public Elastic IP முகவரி
   * **TTL:** Auto

---

## 📌 STEP 5: Nginx Reverse Proxy அமைத்தல்

Nginx மூலம் Port 5000-ல் இயங்கும் சர்வரை உங்கள் டொமைனுடன் இணைக்கவும்:

```bash
sudo nano /etc/nginx/sites-available/upi-gateway
```

கீழே உள்ளதை பேஸ்ட் செய்யவும் (உங்கள் டொமைன் பெயரை மாற்றிக் கொள்ளவும்):

```nginx
server {
    listen 80;
    server_name pay.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

இணைப்பைச் செயல்படுத்தி Nginx-ஐ ரீஸ்டார்ட் செய்யவும்:
```bash
sudo ln -s /etc/nginx/sites-available/upi-gateway /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## 📌 STEP 6: இலவச SSL சான்றிதழ் (HTTPS / Let's Encrypt)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d pay.yourdomain.com
```

இப்போது உங்கள் தளம் `https://pay.yourdomain.com` என பாதுகாப்பான பூட்டு சின்னத்துடன் (SSL) இயங்கும்!

---

## 📌 STEP 7: தானியங்கி பேமெண்ட் சரிபார்ப்பு (Android Auto-Verification)

வாடிக்கையாளர் பணம் செலுத்தியவுடன் சர்வரில் தானாக UTR உறுதி செய்யப்பட்டு வெப்சைட்டுக்கு Webhook செல்ல:

### இலவச முறை (MacroDroid அல்லது SMS Forwarder App):
1. உங்கள் கடை/பிசினஸ் UPI ID உள்ள Android போனில் **MacroDroid** அல்லது **SMS to URL / Webhook Forwarder** ஆப்பை நிறுவவும்.
2. **Trigger:** "SMS Received" (வங்கி SMS: "credited by INR ... Ref/UTR ...") அல்லது "Notification Received" (PhonePe/Paytm/GPay Business App Notification).
3. **Action:** "HTTP POST Request"
   * **URL:** `https://pay.yourdomain.com/api/webhook/notify`
   * **Headers:** `Content-Type: application/json`
   * **Body:**
   ```json
   {
     "secret_key": "உங்கள்_NOTIFICATION_SECRET_KEY",
     "amount": "{sms_extracted_amount}",
     "utr": "{sms_extracted_utr}"
   }
   ```
4. இது வங்கி SMS அல்லது PhonePe நோட்டிஃபிகேஷன் வந்தவுடன் 0.5 நொடியில் உங்கள் சர்வரைத் தொடர்புகொண்டு ஆர்டரை `SUCCESS` என்று மாற்றிவிடும்!
