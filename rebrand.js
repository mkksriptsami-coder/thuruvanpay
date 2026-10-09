const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'public');
fs.readdirSync(dir).filter(f => f.endsWith('.html')).forEach(f => {
  const fp = path.join(dir, f);
  let c = fs.readFileSync(fp, 'utf8');
  c = c.replaceAll('SwiftUPI', 'ThuruvanPay')
       .replaceAll('Swift<span class="text-indigo-600">UPI</span>', 'Thuruvan<span class="text-indigo-600">Pay</span>')
       .replaceAll('Swift<span class="text-indigo-400">UPI</span>', 'Thuruvan<span class="text-indigo-400">Pay</span>')
       .replaceAll('admin@swiftupi.com', 'admin@thuruvanpay.in');
  fs.writeFileSync(fp, c, 'utf8');
  console.log('Rebranded:', f);
});
