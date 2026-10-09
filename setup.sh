#!/usr/bin/env bash
set -e

echo "==============================================="
echo "🚀 Setting up ThuruvanPay Gateway on Lightsail..."
echo "==============================================="

# 1. Update system & install Node.js + PM2 if needed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs nginx git
fi

if ! command -v pm2 &> /dev/null; then
    echo "📦 Installing PM2 process manager..."
    sudo npm install -g pm2
fi

# 2. Install project dependencies
echo "📦 Installing application dependencies..."
npm install --production

# 3. Start or Restart with PM2
echo "⚡ Starting ThuruvanPay server with PM2..."
pm2 delete thuruvanpay 2>/dev/null || true
pm2 start server.js --name "thuruvanpay"
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp /home/$USER 2>/dev/null || true

# 4. Configure Nginx
echo "🌐 Configuring Nginx reverse proxy for thuruvanpay.in..."
sudo tee /etc/nginx/sites-available/thuruvanpay > /dev/null << 'EOF'
server {
    listen 80;
    server_name thuruvanpay.in pay.thuruvanpay.in www.thuruvanpay.in;

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
EOF

sudo ln -sf /etc/nginx/sites-available/thuruvanpay /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "==============================================="
echo "🎉 THURUVANPAY IS NOW LIVE!"
echo "🌐 Website: https://thuruvanpay.in"
echo "📚 API Docs: https://thuruvanpay.in/api-docs.html"
echo "💼 Dashboard: https://thuruvanpay.in/dashboard.html"
echo "👑 Admin Panel: https://thuruvanpay.in/admin-login.html"
echo "==============================================="
