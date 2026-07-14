const http = require('http');
const https = require('https');
const url = require('url');

const PORT = 3000;

const TKGM_BASES = [
  'https://cbsapi.tkgm.gov.tr/megsiswebapi.v3.1/api',
  'https://cbsservis.tkgm.gov.tr/megsiswebapi.v3/api'
];

// ── TKGM'ye istek at ─────────────────────────────────────
function tkgmGet(path) {
  return new Promise((resolve, reject) => {
    let i = 0;
    function next() {
      if (i >= TKGM_BASES.length) { reject(new Error('TKGM API ulaşılamıyor — tüm sunucular denendi')); return; }
      const fullUrl = TKGM_BASES[i++] + path;
      console.log('[TKGM] GET', fullUrl);
      const req = https.get(fullUrl, {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://parselsorgu.tkgm.gov.tr/',
          'Origin': 'https://parselsorgu.tkgm.gov.tr'
        }
      }, res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          console.log('[TKGM] status', res.statusCode, 'bytes', data.length);
          if (res.statusCode === 200 && data.length > 2) {
            try {
              const parsed = JSON.parse(data);
              // Debug: ilk feature'ın properties'ini logla
              if (parsed?.features?.[0]) {
                console.log('[TKGM] sample properties:', JSON.stringify(parsed.features[0].properties));
              }
              resolve(parsed);
            } catch(e) {
              console.log('[TKGM] JSON parse hatası:', e.message, data.slice(0,200));
              next();
            }
          } else {
            console.log('[TKGM] başarısız, sonraki deneniyor. Body:', data.slice(0,100));
            next();
          }
        });
      });
      req.on('error', e => { console.log('[TKGM] bağlantı hatası:', e.message); next(); });
      req.setTimeout(12000, () => { console.log('[TKGM] timeout'); req.destroy(); next(); });
    }
    next();
  });
}

// ── Open-Elevation ─────────────────────────────────────
function getElevation(locations) {
  return new Promise((resolve, reject) => {
    // POST isteği — daha güvenilir
    const body = JSON.stringify({ locations });
    const options = {
      hostname: 'api.open-elevation.com',
      path: '/api/v1/lookup',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    console.log('[ELEV] POST locations sayısı:', locations.length);
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        console.log('[ELEV] status:', res.statusCode, 'bytes:', data.length);
        if (res.statusCode === 200) {
          try { resolve(JSON.parse(data)); }
          catch(e) { reject(new Error('Elevation JSON parse hatası')); }
        } else {
          reject(new Error('Elevation HTTP ' + res.statusCode));
        }
      });
    });
    req.on('error', e => reject(e));
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Elevation timeout')); });
    req.write(body);
    req.end();
  });
}

// ── HTTP Server ──────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const path = parsed.pathname;
  console.log('\n[REQ]', req.method, path);

  try {
    // İl listesi
    if (path === '/api/iller') {
      const d = await tkgmGet('/idariYapi/ilListe');
      res.end(JSON.stringify(d));
    }
    // İlçe listesi
    else if (path.startsWith('/api/ilceler/')) {
      const ilId = path.split('/')[3];
      const d = await tkgmGet('/idariYapi/ilceListe/' + ilId);
      res.end(JSON.stringify(d));
    }
    // Mahalle listesi
    else if (path.startsWith('/api/mahalleler/')) {
      const ilceId = path.split('/')[3];
      const d = await tkgmGet('/idariYapi/mahalleListe/' + ilceId);
      res.end(JSON.stringify(d));
    }
    // Parsel sorgusu
    else if (path.startsWith('/api/parsel/')) {
      const parts = path.split('/');
      // /api/parsel/{mahId}/{ada}/{parsel}
      const mahId = parts[3], ada = parts[4], parsel = parts[5];
      console.log('[PARSEL] mahId:', mahId, 'ada:', ada, 'parsel:', parsel);
      const d = await tkgmGet(`/parsel/${mahId}/${ada}/${parsel}`);
      // Parsel response'unu logla
      if (d?.properties) console.log('[PARSEL] properties:', JSON.stringify(d.properties));
      if (d?.geometry) console.log('[PARSEL] geometry type:', d.geometry.type, 'coords count:', d.geometry.coordinates?.[0]?.length || 0);
      res.end(JSON.stringify(d));
    }
    // Eğim (elevation)
    else if (path === '/api/egim' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', async () => {
        const { locations } = JSON.parse(body);
        const d = await getElevation(locations);
        res.end(JSON.stringify(d));
      });
    }
    else {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found: ' + path }));
    }
  } catch(e) {
    console.error('[HATA]', e.message);
    res.writeHead(500);
    res.end(JSON.stringify({ error: e.message }));
  }
});

server.listen(PORT, () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  Parsel & Eğim Proxy Server');
  console.log('  http://localhost:' + PORT);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});
