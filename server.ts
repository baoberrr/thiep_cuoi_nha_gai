import express, { Request, Response, NextFunction } from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';

const BASE_DIR = process.cwd();
const DIRECTORY = path.join(BASE_DIR, 'chungdoi.com');
const LIVE_HOST = 'https://chungdoi.com';
const RSVP_FILE = path.join(BASE_DIR, 'rsvp.json');
const ADMIN_FILE = path.join(BASE_DIR, 'admin.html');
const DEMO_HTML_FILE = path.join(DIRECTORY, 'vi', 'mau-thiep', 'song-long-do', 'demo');

// Middleware to parse JSON and urlencoded data
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CloudDB Helper for JSONBin / Local Sync
class CloudDB {
  static getBinUrl(): string | null {
    const binId = process.env.JSONBIN_BIN_ID;
    return binId ? `https://api.jsonbin.io/v3/b/${binId}` : null;
  }

  static getHeaders(): Record<string, string> {
    return {
      'X-Master-Key': process.env.JSONBIN_KEY || '',
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
    };
  }

  static async load(localFallbackPath: string, keyName?: string): Promise<any> {
    const url = CloudDB.getBinUrl();
    if (url && process.env.JSONBIN_KEY) {
      try {
        const response = await fetch(url, { headers: CloudDB.getHeaders() });
        if (response.ok) {
          const data = await response.json() as { record?: Record<string, any> };
          const record = data.record || {};
          if (keyName) {
            return { [keyName]: record[keyName] || [] };
          }
          return record;
        }
      } catch (e) {
        console.warn(`[CloudDB] Load Error from JSONBin: ${e}`);
      }
    }

    if (fs.existsSync(localFallbackPath)) {
      try {
        const content = fs.readFileSync(localFallbackPath, 'utf-8');
        return JSON.parse(content);
      } catch {}
    }
    return keyName ? { [keyName]: [] } : {};
  }

  static async save(localFallbackPath: string, newData: Record<string, any>, keyName?: string): Promise<void> {
    const url = CloudDB.getBinUrl();
    if (url && process.env.JSONBIN_KEY) {
      try {
        let currentData: Record<string, any> = {};
        try {
          const response = await fetch(url, { headers: CloudDB.getHeaders() });
          if (response.ok) {
            const data = await response.json() as { record?: Record<string, any> };
            currentData = data.record || {};
          }
        } catch {}

        if (keyName) {
          currentData[keyName] = newData[keyName] || [];
        } else {
          Object.assign(currentData, newData);
        }

        await fetch(url, {
          method: 'PUT',
          headers: CloudDB.getHeaders(),
          body: JSON.stringify(currentData)
        });
      } catch (e) {
        console.warn(`[CloudDB] Save Error to JSONBin: ${e}`);
      }
    }

    try {
      const dir = path.dirname(localFallbackPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(localFallbackPath, JSON.stringify(newData, null, 2), 'utf-8');
    } catch (e) {
      console.warn(`[CloudDB] Local Save Error: ${e}`);
    }
  }
}

// Admin Authentication check
function checkAdminAuth(req: Request, res: Response): boolean {
  let user = process.env.ADMIN_USER;
  let pwd = process.env.ADMIN_PASS;

  if (!user || !pwd) {
    const secretsPath = path.join(BASE_DIR, 'admin_secrets.json');
    if (fs.existsSync(secretsPath)) {
      try {
        const secrets = JSON.parse(fs.readFileSync(secretsPath, 'utf-8'));
        user = secrets.admin_user;
        pwd = secrets.admin_pass;
      } catch {}
    }
  }

  // Fallback credentials for testing/demo if not configured
  user = user || 'admin';
  pwd = pwd || 'admin123';

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Authentication required');
    return false;
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [reqUser, ...reqPwdParts] = credentials.split(':');
  const reqPwd = reqPwdParts.join(':');

  if (reqUser !== user || reqPwd !== pwd) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Admin Area"');
    res.status(401).send('Invalid credentials');
    return false;
  }

  return true;
}

// Global CORS & Cache headers middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const pathLower = req.path.toLowerCase();
  const isDynamic =
    pathLower.startsWith('/api/') ||
    pathLower.startsWith('/backend-api/') ||
    pathLower.startsWith('/admin-api/') ||
    pathLower === '/' ||
    pathLower === '' ||
    pathLower.endsWith('.html') ||
    !path.extname(pathLower);

  if (isDynamic) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else if (pathLower.includes('_next/static/') || pathLower.includes('/fonts/')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  } else {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }

  next();
});

// 1. Block analytics / tracking
const BLOCKED_ANALYTICS_PATHS = [
  '/gtm.js', '/gtag/', '/analytics',
  'googletagmanager.com', 'google-analytics.com',
  'facebook.com/tr', 'bat.bing.com', '/collect',
  '/backend-api/api/track/', '/api/track/'
];

app.use((req: Request, res: Response, next: NextFunction) => {
  const urlLower = req.originalUrl.toLowerCase();
  if (BLOCKED_ANALYTICS_PATHS.some(blocked => urlLower.includes(blocked))) {
    return res.status(204).end();
  }
  next();
});

// 2. Redirect root & demo to /thiep-cuoi-Huy-Trang
app.get('/', (req: Request, res: Response) => {
  const query = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  return res.redirect(302, `/thiep-cuoi-Huy-Trang${query}`);
});

app.get(['/vi/mau-thiep/song-long-do/demo', '/vi/mau-thiep/song-long-do/demo/'], (req: Request, res: Response) => {
  const query = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  return res.redirect(301, `/thiep-cuoi-Huy-Trang${query}`);
});

// 3. Serve main wedding invitation HTML
const handleInvitationHtml = (req: Request, res: Response) => {
  if (fs.existsSync(DEMO_HTML_FILE)) {
    let html = fs.readFileSync(DEMO_HTML_FILE, 'utf-8');
    const guestParam = (req.query.to || req.query.u || req.query.guest || req.query.name || req.query.k || req.query.khach || req.query.ten || req.params.guest || '') as string;
    if (guestParam) {
      try {
        const cleanGuest = decodeURIComponent(guestParam.replace(/[-_]/g, ' ')).trim();
        if (cleanGuest) {
          html = html.replace(/<span id="guest-name-text">[^<]*<\/span>/, `<span id="guest-name-text">${cleanGuest}</span>`);
          html = html.replace(/\\"guestName\\":\s*\\"[^\\"]*\\"/, `\\"guestName\\":\\"${cleanGuest}\\"`);
        }
      } catch {}
    }
    html = html.replace(/0979690880/g, '0966324566');
    html = html.replace(/6UtQqf8Rruich7ix7/g, 'cdWx62o2ruUL9uJy9');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  return res.status(404).send('Invitation template not found');
};

app.get(['/thiep-cuoi-Huy-Trang', '/thiep-cuoi-Huy-Trang/', '/thiep-cuoi-Huy-Trang/:guest', '/thiep-cuoi-Trang-Huy', '/thiep-cuoi-Trang-Huy/', '/thiep-cuoi-Trang-Huy/:guest'], handleInvitationHtml);

// 4. Admin HTML Page
app.get(['/admin', '/admin/'], (req: Request, res: Response) => {
  if (!checkAdminAuth(req, res)) return;
  if (fs.existsSync(ADMIN_FILE)) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.sendFile(ADMIN_FILE);
  }
  return res.status(404).send('Admin page not found');
});

// 5. Admin RSVP API
app.get(['/admin-api/rsvp', '/admin-api/rsvp/'], async (req: Request, res: Response) => {
  if (!checkAdminAuth(req, res)) return;
  const data = await CloudDB.load(RSVP_FILE, 'rsvp');
  return res.json(data);
});

app.post('/admin-api/rsvp/update', async (req: Request, res: Response) => {
  if (!checkAdminAuth(req, res)) return;
  try {
    const data = req.body || {};
    const targetId = data.id;

    if (data.phone) {
      const phoneDigits = String(data.phone).replace(/\D/g, '');
      if (phoneDigits.length !== 10) {
        return res.status(400).json({ success: false, error: 'Phone must be 10 digits' });
      }
      data.phone = phoneDigits;
    }

    const rsvpData = await CloudDB.load(RSVP_FILE, 'rsvp');
    if (!Array.isArray(rsvpData.rsvp)) {
      rsvpData.rsvp = [];
    }

    if (targetId) {
      // Update existing record
      const item = rsvpData.rsvp.find((r: any) => r.id === targetId);
      if (item) {
        const allowedKeys = ['name', 'phone', 'attending', 'numberOfGuests', 'isCarpool', 'isVegetarian', 'message', 'gift'];
        for (const k of allowedKeys) {
          if (k in data) item[k] = data[k];
        }
      }
    } else {
      // Add new record
      const newRecord = {
        id: crypto.randomUUID(),
        timestamp: new Date().toISOString(),
        name: data.name || '',
        phone: data.phone || '',
        attending: data.attending || 'yes',
        numberOfGuests: Number(data.numberOfGuests) || 1,
        isCarpool: !!data.isCarpool,
        isVegetarian: !!data.isVegetarian,
        message: data.message || '',
        gift: data.gift || '',
        raw: data
      };
      rsvpData.rsvp.unshift(newRecord);
    }

    await CloudDB.save(RSVP_FILE, rsvpData, 'rsvp');
    return res.json({ success: true });
  } catch (e) {
    console.error('[Admin] Error updating RSVP:', e);
    return res.status(400).json({ success: false });
  }
});

app.post('/admin-api/rsvp/delete', async (req: Request, res: Response) => {
  if (!checkAdminAuth(req, res)) return;
  try {
    const { id } = req.body || {};
    const rsvpData = await CloudDB.load(RSVP_FILE, 'rsvp');
    if (Array.isArray(rsvpData.rsvp)) {
      const initialLen = rsvpData.rsvp.length;
      rsvpData.rsvp = rsvpData.rsvp.filter((r: any) => r.id !== id);
      if (rsvpData.rsvp.length < initialLen) {
        await CloudDB.save(RSVP_FILE, rsvpData, 'rsvp');
        return res.json({ success: true });
      }
    }
    return res.status(400).json({ success: false });
  } catch (e) {
    console.error('[Admin] Error deleting RSVP:', e);
    return res.status(400).json({ success: false });
  }
});

// Photo Upload Endpoint
app.post(['/admin-api/upload-photo', '/api/upload-photo'], async (req: Request, res: Response) => {
  try {
    const { imageBase64, target = 'groom' } = req.body || {};
    if (!imageBase64) {
      return res.status(400).json({ success: false, error: 'Thiếu dữ liệu ảnh (imageBase64)' });
    }

    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const fileName = target === 'bride' ? 'co_dau.png' : 'chu_re.png';
    const imagesDir = path.join(DIRECTORY, 'images');
    if (!fs.existsSync(imagesDir)) {
      fs.mkdirSync(imagesDir, { recursive: true });
    }

    const targetPath = path.join(imagesDir, fileName);
    fs.writeFileSync(targetPath, buffer);
    console.log(`[Upload] Đã cập nhật ảnh ${target}: ${targetPath} (${buffer.length} bytes)`);

    // Đồng bộ vào info.json
    const infoPath = path.join(BASE_DIR, 'api.chungdoi.com', 'api', 'invite', 'quanghuy-thutrang-love', 'info.json');
    if (fs.existsSync(infoPath)) {
      try {
        const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
        if (target === 'groom') {
          info.invitation.data.groomPhoto = `/images/${fileName}`;
        } else {
          info.invitation.data.bridePhoto = `/images/${fileName}`;
        }
        fs.writeFileSync(infoPath, JSON.stringify(info, null, 2), 'utf-8');
      } catch (e) {
        console.warn('[Upload] Không thể cập nhật info.json:', e);
      }
    }

    return res.json({ success: true, url: `/images/${fileName}?t=${Date.now()}` });
  } catch (err: any) {
    console.error('[Upload] Lỗi upload ảnh:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Template API Mock
app.all(['/api/template', '/api/template/*', '/backend-api/api/template', '/backend-api/api/template/*'], (req: Request, res: Response) => {
  return res.json({
    success: true,
    template: {
      id: 'double_dragon_red',
      name: 'Song Long Đỏ',
      status: 'active'
    }
  });
});

// 7. RSVP Submission API from user
const handleRsvpSubmit = async (req: Request, res: Response) => {
  try {
    const data = req.body || {};
    const phoneRaw = String(data.phone || data.phoneNumber || data.phone_number || data.sdt || '').trim();
    const phone = phoneRaw.replace(/\D/g, '');

    if (phone.length !== 10) {
      return res.status(400).json({ success: false, error: 'So dien thoai phai co dung 10 chu so' });
    }

    const newRsvp = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      name: data.name || '',
      phone: phone,
      attending: data.attending || data.isAttending || '',
      numberOfGuests: Number(data.numberOfGuests || data.guestCount || data.number_of_guests) || 1,
      isCarpool: !!(data.isCarpool || data.is_carpool),
      isVegetarian: !!(data.isVegetarian || data.is_vegetarian),
      message: data.message || '',
      raw: data
    };

    const rsvpData = await CloudDB.load(RSVP_FILE, 'rsvp');
    if (!Array.isArray(rsvpData.rsvp)) {
      rsvpData.rsvp = [];
    }

    // Upsert by phone number
    if (phone) {
      rsvpData.rsvp = rsvpData.rsvp.filter((r: any) => r.phone !== phone);
    }
    rsvpData.rsvp.unshift(newRsvp);

    await CloudDB.save(RSVP_FILE, rsvpData, 'rsvp');
    console.log(`[RSVP] Saved: ${newRsvp.name} (${phone}) - Attending: ${newRsvp.attending}`);
    return res.json({ success: true });
  } catch (e) {
    console.error('[RSVP] Error saving RSVP:', e);
    return res.json({ success: true });
  }
};

app.post('/api/invite/:slug/rsvp', handleRsvpSubmit);
app.post('/backend-api/api/invite/:slug/rsvp', handleRsvpSubmit);
app.post('/api/invitations/:id/rsvp', handleRsvpSubmit);
app.post('/backend-api/api/invitations/:id/rsvp', handleRsvpSubmit);

// 8. Comments / Guestbook API
const commentsFilePath = path.join(BASE_DIR, 'api.chungdoi.com', 'api', 'invite', 'quanghuy-thutrang-love', 'comments');

const handleCommentsGet = async (req: Request, res: Response) => {
  const commentsData = await CloudDB.load(commentsFilePath, 'comments');
  return res.json(commentsData);
};

const handleCommentsPost = async (req: Request, res: Response) => {
  try {
    const data = req.body || {};
    const name = String(data.name || '').trim();
    const message = String(data.message || '').trim();

    if (name && message) {
      const commentsData = await CloudDB.load(commentsFilePath, 'comments');
      if (!Array.isArray(commentsData.comments)) {
        commentsData.comments = [];
      }

      const newComment = {
        id: crypto.randomUUID(),
        name,
        message,
        timestamp: new Date().toISOString(),
        guest_id: null
      };

      commentsData.comments.unshift(newComment);
      await CloudDB.save(commentsFilePath, commentsData, 'comments');
      console.log(`[Comment] Added from ${name}: ${message}`);
      return res.json({ success: true, comment: newComment });
    }
  } catch (e) {
    console.error('[Comment] Error saving comment:', e);
  }
  return res.json({ success: false });
};

app.get('/api/invite/:slug/comments', handleCommentsGet);
app.get('/backend-api/api/invite/:slug/comments', handleCommentsGet);
app.post('/api/invite/:slug/comments', handleCommentsPost);
app.post('/backend-api/api/invite/:slug/comments', handleCommentsPost);

// 9. View counting & tracking endpoints
app.all(['/api/invite/:slug/view', '/backend-api/api/invite/:slug/view'], (req: Request, res: Response) => {
  const viewFilePath = path.join(BASE_DIR, 'api.chungdoi.com', 'api', 'invite', 'quanghuy-thutrang-love', 'view');
  if (fs.existsSync(viewFilePath)) {
    try {
      const viewData = JSON.parse(fs.readFileSync(viewFilePath, 'utf-8'));
      return res.json(viewData);
    } catch {}
  }
  return res.json({ message: 'Đã ghi nhận lượt xem', counted: true, unique_visitors: 9908 });
});

// 10. General API Router for local JSON files or live proxying
app.all(['/api/*', '/backend-api/*'], async (req: Request, res: Response) => {
  const isBackend = req.path.startsWith('/backend-api');
  let cleanApiPath = isBackend ? req.path.slice('/backend-api'.length) : req.path;
  cleanApiPath = cleanApiPath.replace(/^\/+/, '');

  // Normalize slug to quanghuy-thutrang-love
  const parts = cleanApiPath.split('/');
  if (parts.length >= 3 && parts[0] === 'api' && parts[1] === 'invite' && parts[2] !== 'quanghuy-thutrang-love') {
    parts[2] = 'quanghuy-thutrang-love';
    cleanApiPath = parts.join('/');
  }

  const localApiDir = path.join(BASE_DIR, 'api.chungdoi.com');
  let localApiPath = path.join(localApiDir, ...cleanApiPath.split('/'));

  if (fs.existsSync(localApiPath) && fs.statSync(localApiPath).isDirectory()) {
    const candidateInfo = path.join(localApiPath, 'info.json');
    if (fs.existsSync(candidateInfo)) {
      localApiPath = candidateInfo;
    }
  }

  if (fs.existsSync(localApiPath) && fs.statSync(localApiPath).isFile()) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.sendFile(localApiPath);
  }

  // Handle remaining POST APIs gracefully
  if (req.method === 'POST') {
    return res.json({ success: true });
  }

  // Proxy to live api.chungdoi.com with name replacements
  const liveSubpath = ('/' + cleanApiPath).replace('quanghuy-thutrang-love', 'hoangnam-thanhtu-love');
  const queryStr = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const liveApiUrl = `https://api.chungdoi.com${liveSubpath}${queryStr}`;

  try {
    const response = await fetch(liveApiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });
    if (response.ok) {
      let text = await response.text();
      text = text
        .replace(/Hoàng Nam/g, 'Quang Huy')
        .replace(/Thanh Tú/g, 'Thu Trang')
        .replace(/hoangnam-thanhtu-love/g, 'quanghuy-thutrang-love');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(text);
    }
  } catch (e) {
    console.warn(`[Proxy API] Failed for ${liveApiUrl}:`, e);
  }

  return res.status(404).json({ error: 'API not found' });
});

// 11. Static files from chungdoi.com or live proxy
app.use(async (req: Request, res: Response, next: NextFunction) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return next();
  }

  const cleanReqPath = req.path.replace(/^\/+/, '');
  const localFilePath = path.join(DIRECTORY, ...cleanReqPath.split('/'));

  if (fs.existsSync(localFilePath) && fs.statSync(localFilePath).isFile()) {
    return res.sendFile(localFilePath);
  }

  // Check if file is at root or other directories (e.g. accounts.google.com)
  const rootFilePath = path.join(BASE_DIR, ...cleanReqPath.split('/'));
  if (fs.existsSync(rootFilePath) && fs.statSync(rootFilePath).isFile()) {
    return res.sendFile(rootFilePath);
  }

  // Proxy missing assets from live chungdoi.com and cache locally
  const queryStr = req.url.includes('?') ? '?' + req.url.split('?')[1] : '';
  const liveFileUrl = `${LIVE_HOST}${req.path}${queryStr}`;

  try {
    const response = await fetch(liveFileUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const contentType = response.headers.get('content-type') || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);

      // Cache locally
      try {
        const parentDir = path.dirname(localFilePath);
        if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
        fs.writeFileSync(localFilePath, buffer);
        console.log(`[Cache] Saved remote file to ${localFilePath}`);
      } catch (ce) {
        console.warn(`[Cache] Could not write cache file: ${ce}`);
      }

      return res.send(buffer);
    }
  } catch (e) {
    // Proxy failed
  }

  return next();
});

// 404 fallback
app.use((req: Request, res: Response) => {
  res.status(404).send('Not Found');
});

app.listen(PORT, HOST, () => {
  console.log(`Server started on http://${HOST}:${PORT}`);
});
