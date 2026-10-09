# 🚀 SwiftUPI - Self-Hosted UPI Payment Gateway & Automation Platform

முழுமையான, சொந்த பிராண்டில் இயங்கும் **UPI Payment Gateway** தளம். இது நீங்கள் குறிப்பிட்ட `pay.mugavaigroups.in.net` / ZapUPI போர்ட்டலின் அனைத்து அம்சங்களையும் உள்ளடக்கியது.

---

## 🌟 முக்கிய அம்சங்கள் (Key Features)

1. **Merchant Portal & Authentication:**
   * மெர்ச்சன்ட் பதிவு (Register) & லாகின் (JWT Auth).
   * மெர்ச்சன்ட் API Key & API Secret மேலாண்மை.
   * UPI VPA (`example@paytm`, `business@okaxis`) & Merchant Display Name செட்டிங்ஸ்.
   * நேரலை வருவாய் (Live Revenue), வெற்றிகரமான ஆர்டர்கள் (Success Orders) புள்ளிவிவரங்கள்.
   * நேரலை பரிவர்த்தனை வரலாறு (Real-time Transaction History & Logs).

2. **Developer REST API (API Docs):**
   * `/api-docs.html` - முழுமையான ஆவணங்கள்.
   * `POST /api/create-order` - PHP, Node.js, Python, cURL குறியீட்டு மாதிரிகள்.
   * `POST /api/check-order-status` - பரிவர்த்தனை நிலை சரிபார்த்தல்.
   * `POST /api/webhook/notify` - தானியங்கி நோட்டிஃபிகேஷன் வெப்ஹூக்.
   * பிரவுசரிலேயே சோதிக்க **Live Interactive API Console**.

3. **Universal UPI Checkout Page (`/checkout.html`):**
   * Dynamic NPCI UPI QR Code (தொகையுடன் கூடிய க்யூஆர்).
   * மொபைலில் நேரடி ஆப் திறக்கும் பட்டன்கள் (Google Pay, PhonePe, Paytm, BHIM).
   * 5 நிமிட Countdown Timer.
   * 2.5 நொடிக்கு ஒருமுறை Auto-Polling - பணம் வந்தவுடன் தானாக பச்சை நிற வெற்றித்திரை தோன்றி Merchant `redirect_url`-க்கு செல்லும்.
   * 12-இலக்க UTR Fallback சரிபார்ப்பு வசதி.

4. **Security & Performance:**
   * HMAC-SHA256 Signed Webhook callbacks.
   * Built-in `node:sqlite` தரவுத்தளம் (எந்த வெளிப்புற C++ லைப்ரரியும் தேவையில்லை).
   * AWS VPS-ல் மிகக் குறைந்த RAM-ல் அதிவேகமாக இயங்கும்.

---

## 💻 உங்கள் கணினியில் பரிசோதிக்க (Local Run)

1. சர்வரை இயக்க:
```bash
node server.js
```

2. பிரவுசரில் திறக்க:
* **முகப்பு பக்கம் (Landing Page):** [http://localhost:5000](http://localhost:5000)
* **API Documentation:** [http://localhost:5000/api-docs.html](http://localhost:5000/api-docs.html)
* **Merchant Dashboard:** [http://localhost:5000/dashboard.html](http://localhost:5000/dashboard.html)
* **Login / Register:** [http://localhost:5000/login.html](http://localhost:5000/login.html)

3. தானியங்கி சோதனை (Automated Test):
```bash
node test-flow.js
```
