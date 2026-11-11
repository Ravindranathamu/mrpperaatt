'use strict';

require('dotenv').config({ quiet: true });

const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');

function usage() {
  console.log('');
  console.log('Usage: npm run qr -- https://your-app.onrender.com "Main entrance"');
  console.log('');
  console.log('The first argument is the URL embedded in the QR code.');
  console.log('The optional second argument labels where the poster will be hung.');
  process.exit(1);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function main() {
  const url = process.argv[2];
  const locationLabel = process.argv[3] || 'Main entrance';

  if (!url) usage();

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    console.error(`Not a valid URL: ${url}`);
    usage();
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    console.error('The QR link must start with http:// or https://');
    process.exit(1);
  }
  if (parsed.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
    console.warn(
      'WARNING: Phones block location and Google sign-in on plain HTTP. Use an HTTPS URL for the printed poster.',
    );
  }

  const targetUrl = parsed.toString();
  const companyName = process.env.COMPANY_NAME || 'Office Attendance';
  const copyrightName = process.env.COPYRIGHT_NAME || companyName;
  const contactPhone = String(process.env.CONTACT_PHONE || '').trim();
  const contactEmail = String(process.env.CONTACT_EMAIL || '').trim();
  const contactLine = [contactPhone, contactEmail].filter(Boolean).map(escapeHtml).join(' · ');
  const year = new Date().getFullYear();
  const outDir = path.resolve(__dirname, '..', 'qr');
  fs.mkdirSync(outDir, { recursive: true });

  const pngPath = path.join(outDir, 'attendance-qr.png');
  const svgPath = path.join(outDir, 'attendance-qr.svg');
  const posterPath = path.join(outDir, 'attendance-poster.html');

  const qrOptions = {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 1400,
    color: { dark: '#0f172a', light: '#ffffff' },
  };

  await QRCode.toFile(pngPath, targetUrl, { ...qrOptions, type: 'png' });
  const svg = await QRCode.toString(targetUrl, { ...qrOptions, type: 'svg' });
  fs.writeFileSync(svgPath, svg, 'utf8');

  const poster = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(companyName)} — Scan to record attendance</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: flex;
      justify-content: center;
      background: #eef4f3;
      color: #0f172a;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      display: flex;
      flex-direction: column;
      background: #fff;
      overflow: hidden;
    }
    .top {
      position: relative;
      padding: 15mm 18mm 13mm;
      background: linear-gradient(135deg, #115e59, #0f766e 55%, #0d9488);
      color: #fff;
      overflow: hidden;
    }
    .top::after {
      content: "";
      position: absolute;
      width: 70mm;
      height: 70mm;
      right: -24mm;
      top: -30mm;
      border: 12mm solid rgba(255, 255, 255, 0.09);
      border-radius: 50%;
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 4mm;
      font-size: 4.2mm;
      font-weight: 700;
      letter-spacing: 0.01em;
      opacity: 0.95;
    }
    .mark {
      display: grid;
      place-items: center;
      width: 11mm;
      height: 11mm;
      border-radius: 3.2mm;
      background: rgba(255, 255, 255, 0.16);
      border: 1px solid rgba(255, 255, 255, 0.28);
    }
    h1 {
      margin: 9mm 0 3mm;
      max-width: 145mm;
      font-size: 13mm;
      line-height: 1.02;
      letter-spacing: -0.04em;
      font-weight: 800;
    }
    .lede {
      margin: 0;
      max-width: 130mm;
      color: #b7f3e8;
      font-size: 4.3mm;
      line-height: 1.45;
    }
    .body {
      flex: 1;
      display: grid;
      grid-template-columns: 1fr;
      justify-items: center;
      align-content: center;
      padding: 10mm 18mm 8mm;
      text-align: center;
    }
    .scan-label {
      margin: 0 0 4mm;
      color: #0f766e;
      font-size: 4.6mm;
      font-weight: 800;
      letter-spacing: 0.18em;
      text-transform: uppercase;
    }
    .qr-card {
      padding: 6mm;
      border: 0.6mm solid #d9e6e4;
      border-radius: 7mm;
      background: #fff;
      box-shadow: 0 0 0 5mm #f1f8f6, 0 3mm 8mm rgba(15, 23, 42, 0.07);
    }
    .qr-card img {
      display: block;
      width: 92mm;
      height: 92mm;
    }
    .location {
      margin: 7mm 0 0;
      padding: 2.2mm 4.5mm;
      border-radius: 999px;
      background: #f1f8f6;
      border: 0.4mm solid #cde9e3;
      color: #115e59;
      font-size: 3.9mm;
      font-weight: 650;
    }
    .steps {
      width: 150mm;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 5mm;
      margin: 11mm 0 0;
      text-align: left;
    }
    .step {
      padding-top: 3.5mm;
      border-top: 0.5mm solid #d9e6e4;
    }
    .step-num {
      display: inline-grid;
      place-items: center;
      width: 7mm;
      height: 7mm;
      margin-bottom: 2.5mm;
      border-radius: 2.2mm;
      background: #ccfbf1;
      color: #0f766e;
      font-size: 3.6mm;
      font-weight: 800;
    }
    .step strong {
      display: block;
      margin-bottom: 1.2mm;
      font-size: 3.9mm;
    }
    .step p {
      margin: 0;
      color: #526477;
      font-size: 3.4mm;
      line-height: 1.45;
    }
    .footer {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: space-between;
      gap: 8mm;
      padding: 6mm 18mm;
      border-top: 0.5mm solid #e4eceb;
      background: #fbfdfd;
      color: #6a7b8c;
      font-size: 3.3mm;
    }
    .footer code {
      display: block;
      margin-top: 0.8mm;
      color: #115e59;
      font-size: 3.1mm;
      white-space: nowrap;
    }
    .footer .contact {
      display: block;
      margin-top: 1mm;
      color: #115e59;
    }
    .print-note {
      position: fixed;
      right: 10mm;
      bottom: 10mm;
      padding: 2.5mm 4mm;
      border-radius: 2.5mm;
      background: #0f172a;
      color: #fff;
      font-size: 3.4mm;
      box-shadow: 0 2mm 6mm rgba(15, 23, 42, 0.2);
    }
    @media print {
      body { background: #fff; }
      .page { width: 210mm; height: 297mm; }
      .print-note { display: none; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header class="top">
      <div class="brand">
        <span class="mark">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="8.25"></circle>
            <path d="M12 7.75V12l2.9 1.85"></path>
          </svg>
        </span>
        ${escapeHtml(companyName)}
      </div>
      <h1>Scan. Tap.<br>Done.</h1>
      <p class="lede">Record your check-in and check-out in seconds. Use your phone camera — no app to install.</p>
    </header>

    <section class="body">
      <p class="scan-label">Scan here</p>
      <div class="qr-card">
        <img src="attendance-qr.png" alt="QR code for ${escapeHtml(companyName)} attendance">
      </div>
      <p class="location">${escapeHtml(locationLabel)}</p>

      <div class="steps">
        <div class="step">
          <span class="step-num">1</span>
          <strong>Open your camera</strong>
          <p>Point your phone's own camera app at the QR code.</p>
        </div>
        <div class="step">
          <span class="step-num">2</span>
          <strong>Sign in once</strong>
          <p>Use your work Google account. Allow precise location.</p>
        </div>
        <div class="step">
          <span class="step-num">3</span>
          <strong>Tap once</strong>
          <p>Tap Check in when you arrive. Tap again when you leave.</p>
        </div>
      </div>
    </section>

    <footer class="footer">
      <span>Keep this QR at the office entrance. It will not work from home.
        <code>${escapeHtml(targetUrl)}</code>
      </span>
      <span>© ${year} ${escapeHtml(copyrightName)}. All rights reserved.${
        contactLine ? `<span class="contact">${contactLine}</span>` : ''
      }</span>
    </footer>
  </main>
  <div class="print-note">Print this page at 100% scale (A4)</div>
</body>
</html>`;

  fs.writeFileSync(posterPath, poster, 'utf8');
  fs.writeFileSync(
    path.join(outDir, 'README.txt'),
    `QR attendance poster\n\nCompany: ${companyName}\nLocation: ${locationLabel}\nURL: ${targetUrl}\nCopyright: © ${year} ${copyrightName}. All rights reserved.\n${
      contactLine ? `Contact: ${contactPhone}${contactPhone && contactEmail ? ' | ' : ''}${contactEmail}\n` : ''
    }\nOpen attendance-poster.html in a browser and print at 100% (A4).\n`,
    'utf8',
  );

  console.log('');
  console.log('QR code generated:');
  console.log(`  ${pngPath}`);
  console.log(`  ${svgPath}`);
  console.log(`  ${posterPath}`);
  console.log('');
  console.log('Open attendance-poster.html in a browser and print it at 100% scale (A4).');
}

main().catch((error) => {
  console.error('Could not generate the QR code:', error);
  process.exit(1);
});
