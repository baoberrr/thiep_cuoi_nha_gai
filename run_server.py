import http.server
import socketserver
import os
import mimetypes
import posixpath
import urllib.request
import urllib.parse
import threading
import time
import json
import uuid
import datetime

# CẤU HÌNH QUAN TRỌNG CHO RENDER: Nhận cổng PORT động từ môi trường hệ thống, mặc định là 10000 nếu chạy local
PORT = int(os.environ.get("PORT", 10000))

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DIRECTORY = os.path.join(BASE_DIR, "chungdoi.com")
LIVE_HOST = "https://chungdoi.com"


class CloudDB:
    @staticmethod
    def _get_bin_url():
        bin_id = os.environ.get("JSONBIN_BIN_ID")
        if bin_id:
            return f"https://api.jsonbin.io/v3/b/{bin_id}"
        return None

    @staticmethod
    def _get_headers():
        return {
            "X-Master-Key": os.environ.get("JSONBIN_KEY"),
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
        }

    @staticmethod
    def load(local_fallback_path, key_name=None):
        url = CloudDB._get_bin_url()
        if url and os.environ.get("JSONBIN_KEY"):
            try:
                req = urllib.request.Request(url, headers={"X-Master-Key": os.environ.get("JSONBIN_KEY"), "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                with urllib.request.urlopen(req, timeout=10) as response:
                    data = json.loads(response.read().decode('utf-8'))
                    record = data.get("record", {})
                    if key_name:
                        return {key_name: record.get(key_name, [])}
                    return record
            except Exception as e:
                print(f"[CloudDB] Load Error from JSONBin: {e}")
        
        # Local fallback
        if os.path.exists(local_fallback_path):
            try:
                with open(local_fallback_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        return {key_name: []} if key_name else {}

    @staticmethod
    def save(local_fallback_path, new_data, key_name=None):
        url = CloudDB._get_bin_url()
        if url and os.environ.get("JSONBIN_KEY"):
            try:
                req = urllib.request.Request(url, headers={"X-Master-Key": os.environ.get("JSONBIN_KEY"), "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
                try:
                    with urllib.request.urlopen(req, timeout=10) as response:
                        current_data = json.loads(response.read().decode('utf-8')).get("record", {})
                except:
                    current_data = {}
                
                if key_name:
                    current_data[key_name] = new_data.get(key_name, [])
                else:
                    current_data.update(new_data)
                
                put_req = urllib.request.Request(url, data=json.dumps(current_data).encode('utf-8'), headers=CloudDB._get_headers(), method='PUT')
                with urllib.request.urlopen(put_req, timeout=10) as put_response:
                    pass
            except Exception as e:
                print(f"[CloudDB] Save Error to JSONBin: {e}")
                
        # Always write locally as a backup/fallback
        try:
            with open(local_fallback_path, 'w', encoding='utf-8') as f:
                json.dump(new_data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print(f"[CloudDB] Local Save Error: {e}")

class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def translate_path(self, path):
        translated = super().translate_path(path)
        if os.path.exists(translated):
            return translated

        req_path = path.split('?')[0].split('#')[0]
        clean_path = posixpath.normpath(req_path).lstrip('/')
        raw_local_path = os.path.join(DIRECTORY, clean_path.replace('/', os.sep))

        if os.path.exists(raw_local_path):
            return raw_local_path

        base_local_path = os.path.join(BASE_DIR, clean_path.replace('/', os.sep))
        if os.path.exists(base_local_path):
            return base_local_path

        return translated

    def end_headers(self):
        # Thiết lập Cache-Control tối ưu để web chạy mượt mà
        path_lower = self.path.lower()
        # Loại bỏ các tham số query khi kiểm tra định dạng file
        clean_path = path_lower.split('?')[0].split('#')[0]
        
        # Chỉ các yêu cầu động (HTML, API) mới không cache để luôn cập nhật tên khách mời mới
        is_dynamic = False
        if clean_path.startswith('/api/') or clean_path.startswith('/backend-api/'):
            is_dynamic = True
        elif clean_path == '/' or clean_path == '' or clean_path.endswith('.html') or not os.path.splitext(clean_path)[1]:
            is_dynamic = True
            
        if is_dynamic:
            self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        else:
            # Tài nguyên tĩnh
            if '_next/static/' in path_lower or '/fonts/' in path_lower:
                # Tài nguyên đã có hash tên file, cache vĩnh viễn (1 năm)
                self.send_header('Cache-Control', 'public, max-age=31536000, immutable')
            else:
                # Các tài nguyên tĩnh khác như ảnh, nhạc, icon (cache 1 ngày)
                self.send_header('Cache-Control', 'public, max-age=86400')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def check_admin_auth(self):
        import base64
        user = os.environ.get('ADMIN_USER')
        pwd = os.environ.get('ADMIN_PASS')
        if not user or not pwd:
            secrets_path = os.path.join(BASE_DIR, 'admin_secrets.json')
            if os.path.exists(secrets_path):
                try:
                    with open(secrets_path, 'r', encoding='utf-8') as f:
                        secrets = json.load(f)
                        user = secrets.get('admin_user', '')
                        pwd = secrets.get('admin_pass', '')
                except: pass
        
        if not user or not pwd:
            self.send_response(500)
            self.end_headers()
            self.wfile.write(b'Admin secrets not configured. Please set ADMIN_USER and ADMIN_PASS environment variables.')
            return False
            
        auth_str = f"{user}:{pwd}".encode('utf-8')
        expected_auth = 'Basic ' + base64.b64encode(auth_str).decode('utf-8')
        if self.headers.get('Authorization') != expected_auth:
            self.send_response(401)
            self.send_header('WWW-Authenticate', 'Basic realm="Admin Area"')
            self.send_header('Content-Length', '0')
            self.end_headers()
            return False
            
        return True

    def do_GET(self):
        # Disable caching by removing conditional request headers
        if 'If-Modified-Since' in self.headers:
            del self.headers['If-Modified-Since']
        if 'If-None-Match' in self.headers:
            del self.headers['If-None-Match']

        decoded_path = self.path.encode('latin-1').decode('utf-8', errors='ignore')
        parsed_url = urllib.parse.urlparse(decoded_path)

        # XÁC THỰC ADMIN (HTTP Basic Auth)
        if parsed_url.path.startswith('/admin'):
            if not self.check_admin_auth():
                return

        # 0. CHUYỂN HƯỚNG SANG ĐƯỜNG DẪN ĐẸP
        if parsed_url.path == '/' or parsed_url.path == '':
            self.send_response(302)
            location = '/thiep-cuoi-Huy-Trang'
            if parsed_url.query:
                params = urllib.parse.parse_qs(parsed_url.query)
                encoded_query = urllib.parse.urlencode(params, doseq=True)
                location += '?' + encoded_query
            self.send_header('Location', location)
            self.end_headers()
            return

        if parsed_url.path in ('/vi/mau-thiep/song-long-do/demo', '/vi/mau-thiep/song-long-do/demo/'):
            self.send_response(301)
            location = '/thiep-cuoi-Huy-Trang'
            if parsed_url.query:
                location += '?' + parsed_url.query
            self.send_header('Location', location)
            self.end_headers()
            return

        # Phục vụ đường dẫn đẹp bằng cách phục vụ trực tiếp demo HTML và chèn tên khách nếu có
        if parsed_url.path in ('/thiep-cuoi-Huy-Trang', '/thiep-cuoi-Huy-Trang/', '/thiep-cuoi-Trang-Huy', '/thiep-cuoi-Trang-Huy/') or parsed_url.path.startswith('/thiep-cuoi-Huy-Trang/') or parsed_url.path.startswith('/thiep-cuoi-Trang-Huy/'):
            demo_file = os.path.join(DIRECTORY, 'vi', 'mau-thiep', 'song-long-do', 'demo')
            if os.path.isfile(demo_file):
                with open(demo_file, 'r', encoding='utf-8') as f:
                    html_content = f.read()
                
                query_params = urllib.parse.parse_qs(parsed_url.query)
                guest_name = None
                for k in ['to', 'u', 'guest', 'name', 'k', 'khach', 'ten']:
                    if k in query_params and query_params[k]:
                        guest_name = query_params[k][0]
                        break
                if not guest_name and parsed_url.path.startswith('/thiep-cuoi-Huy-Trang/'):
                    path_sub = parsed_url.path[len('/thiep-cuoi-Huy-Trang/'):].strip('/')
                    if path_sub:
                        guest_name = urllib.parse.unquote(path_sub.replace('-', ' ').replace('_', ' '))
                
                if guest_name:
                    import re
                    clean_guest = guest_name.strip()
                    html_content = re.sub(r'<span id="guest-name-text">[^<]*</span>', f'<span id="guest-name-text">{clean_guest}</span>', html_content)
                    html_content = re.sub(r'\\\"guestName\\\":\s*\\\"[^\\\"]*\\\"', f'\\\"guestName\\\":\\\"{clean_guest}\\\"', html_content)
                
                data = html_content.encode('utf-8')
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
                return

        # 0a. TRANG ADMIN — phục vụ giao diện quản lý RSVP
        if parsed_url.path in ('/admin', '/admin/'):
            admin_path = os.path.join(BASE_DIR, 'admin.html')
            if os.path.isfile(admin_path):
                with open(admin_path, 'rb') as f:
                    data = f.read()
                self.send_response(200)
                self.send_header('Content-Type', 'text/html; charset=utf-8')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
                return

        # 0b. ADMIN API — trả dữ liệu RSVP cho trang admin
        if parsed_url.path in ('/admin-api/rsvp', '/admin-api/rsvp/'):
            rsvp_file_path = os.path.join(BASE_DIR, 'rsvp.json')
            rsvp_data = CloudDB.load(rsvp_file_path, 'rsvp')
            data = json.dumps(rsvp_data, ensure_ascii=False).encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-cache')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)
            return

        # 1a. VÔ HIỆU HÓA ANALYTICS / TRACKING của ChungDoi (GTM, GA4, Facebook Pixel, Bing)
        # Trả về 204 No Content để không gửi dữ liệu khách mời cho bên thứ ba
        BLOCKED_ANALYTICS_PATHS = [
            '/gtm.js', '/gtag/', '/analytics',
            'googletagmanager.com', 'google-analytics.com',
            'facebook.com/tr', 'bat.bing.com', '/collect',
            '/backend-api/api/track/', '/api/track/',
        ]
        path_lower = self.path.lower()
        if any(blocked in path_lower for blocked in BLOCKED_ANALYTICS_PATHS):
            self.send_response(204)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return

        # 1b. Xử lý các yêu cầu API (/backend-api/ hoặc /api/)
        is_api = False
        api_subpath = ""
        
        if self.path.startswith('/backend-api/'):
            is_api = True
            api_subpath = self.path[len('/backend-api'):]
        elif self.path.startswith('/api/'):
            is_api = True
            api_subpath = self.path
            
        if is_api:
            clean_api_path = api_subpath.split('?')[0].split('#')[0].lstrip('/')
            parts = clean_api_path.split('/')
            if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'invite':
                if len(parts) >= 3:
                    slug = parts[2]
                    if slug != 'quanghuy-thutrang-love' and slug != '':
                        parts[2] = 'quanghuy-thutrang-love'
                        clean_api_path = '/'.join(parts)
                        query_part = api_subpath.split('?')[1] if '?' in api_subpath else ''
                        api_subpath = '/' + clean_api_path
                        if query_part:
                            api_subpath += '?' + query_part
                            
            if len(parts) >= 2 and parts[0] == 'api' and parts[1] == 'template':
                print(f"Mocking template API for: {self.path}")
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                mock_data = b'{"success":true,"template":{"id":"double_dragon_red","name":"Song Long \xc4\x90\xe1\xbb\x8f","status":"active"}}'
                self.send_header('Content-Length', str(len(mock_data)))
                self.end_headers()
                self.wfile.write(mock_data)
                return

            local_api_dir = os.path.join(BASE_DIR, "api.chungdoi.com")
            local_api_path = os.path.join(local_api_dir, clean_api_path.replace('/', os.sep))
            
            if os.path.isdir(local_api_path):
                candidate_info_path = os.path.join(local_api_path, "info.json")
                if os.path.isfile(candidate_info_path):
                    local_api_path = candidate_info_path
            
            if os.path.isfile(local_api_path):
                print(f"Serving local API: {local_api_path}")
                try:
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                    self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                    if local_api_path.endswith('comments'):
                        data = json.dumps(CloudDB.load(local_api_path, 'comments')).encode('utf-8')
                    else:
                        with open(local_api_path, 'rb') as f:
                            data = f.read()
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
                except Exception as e:
                    print(f"Error serving local API {local_api_path}: {e}")
            
            live_api_subpath = api_subpath.replace('quanghuy-thutrang-love', 'hoangnam-thanhtu-love')
            live_api_url = "https://api.chungdoi.com" + live_api_subpath
            query_string = self.path.split('?')[1] if '?' in self.path else ''
            if query_string:
                live_api_url += '?' + query_string
                
            print(f"Proxying API request to live: {live_api_url}")
            try:
                req = urllib.request.Request(
                    live_api_url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    self.send_response(response.status)
                    for key, val in response.headers.items():
                        if key.lower() not in ['content-encoding', 'transfer-encoding', 'connection', 'content-length', 'access-control-allow-origin']:
                            self.send_header(key, val)
                    self.send_header('Access-Control-Allow-Origin', '*')
                    data = response.read()
                    
                    try:
                        text = data.decode('utf-8', errors='ignore')
                        text = text.replace('Hoàng Nam', 'Quang Huy')
                        text = text.replace('Thanh Tú', 'Thu Trang')
                        text = text.replace('hoangnam-thanhtu-love', 'quanghuy-thutrang-love')
                        data = text.encode('utf-8')
                    except Exception as e:
                        print(f"Error modifying proxied data: {e}")
                        
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    return
            except Exception as e:
                print(f"Proxy API failed for {live_api_url}: {e}")
                self.send_error(404, "API not found")
                return

        # 2. Xử lý các tệp tĩnh cục bộ, tải từ máy chủ thật nếu thiếu
        local_path = self.translate_path(self.path)
        
        if not os.path.exists(local_path) and not os.path.isdir(local_path):
            req_path = self.path.split('?')[0].split('#')[0]
            query_string = self.path.split('?')[1] if '?' in self.path else ''
            live_url = LIVE_HOST + req_path
            if query_string:
                live_url += '?' + query_string
                
            print(f"Proxying missing file from live: {live_url}")
            try:
                req = urllib.request.Request(
                    live_url,
                    headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}
                )
                with urllib.request.urlopen(req, timeout=10) as response:
                    self.send_response(response.status)
                    for key, val in response.headers.items():
                        if key.lower() not in ['content-encoding', 'transfer-encoding', 'connection', 'content-length']:
                            self.send_header(key, val)
                    data = response.read()
                    self.send_header('Content-Length', str(len(data)))
                    self.end_headers()
                    self.wfile.write(data)
                    
                    # Lưu cache cục bộ nếu tải thành công (status 200)
                    if response.status == 200:
                        try:
                            parent_dir = os.path.dirname(local_path)
                            os.makedirs(parent_dir, exist_ok=True)
                            with open(local_path, 'wb') as lf:
                                lf.write(data)
                            print(f"Cached proxied file locally: {local_path}")
                        except Exception as ce:
                            print(f"Failed to cache file locally {local_path}: {ce}")
                    return
            except Exception as e:
                print(f"Proxy failed for {live_url}: {e}")
        
        # 3. Phục vụ các tệp HTML (không đuôi mở rộng hoặc đuôi .html) nếu chứa cấu trúc HTML
        if os.path.isfile(local_path) and (not os.path.splitext(local_path)[1] or os.path.splitext(local_path)[1].lower() == '.html'):
            try:
                with open(local_path, 'rb') as f:
                    content = f.read(500)
                if b'<!DOCTYPE html' in content or b'<html' in content:
                    self.send_response(200)
                    self.send_header('Content-Type', 'text/html; charset=utf-8')
                    self.send_header('Access-Control-Allow-Origin', '*')
                    
                    with open(local_path, 'rb') as f:
                        file_data = f.read()
                            
                    self.send_header('Content-Length', str(len(file_data)))
                    self.end_headers()
                    self.wfile.write(file_data)
                    return
            except Exception as e:
                print(f"Error checking file content: {e}")
                
        return super().do_GET()

    def do_POST(self):
        decoded_path = self.path.encode('latin-1').decode('utf-8', errors='ignore')
        parsed_url = urllib.parse.urlparse(decoded_path)
        
        # XÁC THỰC ADMIN (HTTP Basic Auth)
        if parsed_url.path.startswith('/admin'):
            if not self.check_admin_auth():
                return

        # 0a. API Cập nhật hoặc Thêm RSVP từ trang admin (Sửa/Thêm khách, Mừng cưới)
        if parsed_url.path == '/admin-api/rsvp/update':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                target_id = data.get('id')
                
                if 'phone' in data and data['phone']:
                    phone_raw = str(data['phone'])
                    phone_digits = "".join(c for c in phone_raw if c.isdigit())
                    if len(phone_digits) != 10:
                        self.send_response(400)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.end_headers()
                        self.wfile.write(b'{"success":false, "error":"Phone must be 10 digits"}')
                        return
                    data['phone'] = phone_digits
                
                rsvp_file_path = os.path.join(BASE_DIR, 'rsvp.json')
                rsvp_data = CloudDB.load(rsvp_file_path, 'rsvp')
                
                if target_id:
                    # Update existing record
                    for r in rsvp_data.get('rsvp', []):
                        if r.get('id') == target_id:
                            for key in ['name', 'phone', 'attending', 'numberOfGuests', 'isCarpool', 'isVegetarian', 'message', 'gift']:
                                if key in data:
                                    r[key] = data[key]
                            break
                else:
                    # Add new record
                    new_id = str(uuid.uuid4())
                    new_r = {
                        'id': new_id,
                        'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
                        'name': data.get('name', ''),
                        'phone': data.get('phone', ''),
                        'attending': data.get('attending', 'yes'),
                        'numberOfGuests': data.get('numberOfGuests', 1),
                        'isCarpool': data.get('isCarpool', False),
                        'isVegetarian': data.get('isVegetarian', False),
                        'message': data.get('message', ''),
                        'gift': data.get('gift', ''),
                        'raw': data
                    }
                    rsvp_data.setdefault('rsvp', []).insert(0, new_r)
                
                CloudDB.save(rsvp_file_path, rsvp_data, 'rsvp')
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"success":true}')
                return
            except Exception as e:
                print(f"[Admin] Error updating RSVP: {e}")
                self.send_response(400)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"success":false}')
                return

        # 0. API Xóa RSVP từ trang admin
        if parsed_url.path == '/admin-api/rsvp/delete':
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                target_id = data.get('id')
                
                rsvp_file_path = os.path.join(BASE_DIR, 'rsvp.json')
                rsvp_data = CloudDB.load(rsvp_file_path, 'rsvp')
                if 'rsvp' in rsvp_data:
                    initial_len = len(rsvp_data['rsvp'])
                    rsvp_data['rsvp'] = [r for r in rsvp_data['rsvp'] if r.get('id') != target_id]
                    if len(rsvp_data['rsvp']) < initial_len:
                        CloudDB.save(rsvp_file_path, rsvp_data, 'rsvp')
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.end_headers()
                        self.wfile.write(b'{"success":true}')
                        return
            except Exception as e:
                print(f"[Admin] Error deleting RSVP: {e}")
            
            self.send_response(400)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'{"success":false}')
            return

        # 0b. API Upload Photo từ trang admin
        if parsed_url.path in ['/admin-api/upload-photo', '/api/upload-photo']:
            content_length = int(self.headers.get('Content-Length', 0))
            post_data = self.rfile.read(content_length)
            try:
                import base64, re
                data = json.loads(post_data.decode('utf-8'))
                image_base64 = data.get('imageBase64', '')
                target = data.get('target', 'groom')
                if not image_base64:
                    self.send_response(400)
                    self.send_header('Content-Type', 'application/json; charset=utf-8')
                    self.end_headers()
                    self.wfile.write(b'{"success":false, "error":"Missing imageBase64"}')
                    return

                clean_b64 = re.sub(r'^data:image/\w+;base64,', '', image_base64)
                img_bytes = base64.b64decode(clean_b64)
                file_name = 'co_dau.png' if target == 'bride' else 'chu_re.png'
                images_dir = os.path.join(DIRECTORY, 'images')
                os.makedirs(images_dir, exist_ok=True)
                target_path = os.path.join(images_dir, file_name)
                with open(target_path, 'wb') as f:
                    f.write(img_bytes)

                info_path = os.path.join(BASE_DIR, 'api.chungdoi.com', 'api', 'invite', 'quanghuy-thutrang-love', 'info.json')
                if os.path.exists(info_path):
                    try:
                        with open(info_path, 'r', encoding='utf-8') as f:
                            info = json.load(f)
                        if target == 'groom':
                            info['invitation']['data']['groomPhoto'] = f"/images/{file_name}"
                        else:
                            info['invitation']['data']['bridePhoto'] = f"/images/{file_name}"
                        with open(info_path, 'w', encoding='utf-8') as f:
                            json.dump(info, f, indent=2, ensure_ascii=False)
                    except Exception as ie:
                        print(f"[Upload] Error updating info.json: {ie}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                res_body = json.dumps({"success": True, "url": f"/images/{file_name}?t={int(time.time()*1000)}"}).encode('utf-8')
                self.wfile.write(res_body)
                return
            except Exception as e:
                print(f"[Upload] Error: {e}")
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(b'{"success":false}')
                return

        # 1. Xử lý các yêu cầu API (/backend-api/ hoặc /api/)
        is_api = False
        api_subpath = ""
        
        if self.path.startswith('/backend-api/'):
            is_api = True
            api_subpath = self.path[len('/backend-api'):]
        elif self.path.startswith('/api/'):
            is_api = True
            api_subpath = self.path
            
        if is_api:
            clean_api_path = api_subpath.split('?')[0].split('#')[0].lstrip('/')
            parts = clean_api_path.split('/')

            # ===== LƯU RSVP VÀO MÁY BẠN (rsvp.json) — UPSERT THEO SỐ ĐIỆN THOẠI =====
            # Bắt cả hai dạng endpoint RSVP:
            #   - /api/invite/{slug}/rsvp
            #   - /api/invitations/{uuid}/rsvp
            is_rsvp = (
                (len(parts) >= 4 and parts[0] == 'api' and parts[1] == 'invite' and parts[3] == 'rsvp')
                or (len(parts) >= 4 and parts[0] == 'api' and parts[1] == 'invitations' and parts[3] == 'rsvp')
            )
            if is_rsvp:
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                try:
                    data = json.loads(post_data.decode('utf-8'))
                    # Trích xuất số điện thoại (có thể gửi dưới nhiều key)
                    phone_raw = (
                        data.get('phone') or data.get('phoneNumber') or
                        data.get('phone_number') or data.get('sdt') or ''
                    ).strip()
                    phone = "".join(c for c in phone_raw if c.isdigit())
                    
                    if len(phone) != 10:
                        print(f"[RSVP] Rejected invalid phone number: {phone_raw}")
                        self.send_response(400)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.end_headers()
                        self.wfile.write(b'{"success":false, "error":"So dien thoai phai co dung 10 chu so"}')
                        return

                    new_rsvp = {
                        'id': str(uuid.uuid4()),
                        'timestamp': datetime.datetime.utcnow().isoformat() + 'Z',
                        'name': data.get('name', ''),
                        'phone': phone,
                        'attending': data.get('attending', data.get('isAttending', '')),
                        'numberOfGuests': data.get('numberOfGuests', data.get('guestCount', data.get('number_of_guests', 1))),
                        'isCarpool': data.get('isCarpool', data.get('is_carpool', False)),
                        'isVegetarian': data.get('isVegetarian', data.get('is_vegetarian', False)),
                        'message': data.get('message', ''),
                        'raw': data
                    }

                    rsvp_file_path = os.path.join(BASE_DIR, 'rsvp.json')
                    rsvp_data = CloudDB.load(rsvp_file_path, 'rsvp')

                    # UPSERT: nếu SĐT đã tồn tại thì cập nhật lần cuối, không thêm mới
                    if phone:
                        rsvp_data['rsvp'] = [
                            r for r in rsvp_data['rsvp'] if r.get('phone', '') != phone
                        ]
                    rsvp_data['rsvp'].insert(0, new_rsvp)

                    CloudDB.save(rsvp_file_path, rsvp_data, 'rsvp')
                    print(f"[RSVP] Saved: {new_rsvp['name']} ({phone}) - Attending: {new_rsvp['attending']}")
                except Exception as e:
                    print(f"[RSVP] Error saving RSVP: {e}")
                # Vẫn trả success để giao diện không bị lỗi
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                ok = b'{"success":true}'
                self.send_header('Content-Length', str(len(ok)))
                self.end_headers()
                self.wfile.write(ok)
                return

            # ===== LƯU LỜI CHÚC / SỔ LƯU BÚT =====
            if len(parts) >= 4 and parts[0] == 'api' and parts[1] == 'invite' and parts[3] == 'comments':
                content_length = int(self.headers.get('Content-Length', 0))
                post_data = self.rfile.read(content_length)
                
                try:
                    data = json.loads(post_data.decode('utf-8'))
                    name = data.get('name', '').strip()
                    message = data.get('message', '').strip()
                    
                    if name and message:
                        comments_file_path = os.path.join(
                            BASE_DIR, "api.chungdoi.com", "api", "invite",
                            "quanghuy-thutrang-love", "comments"
                        )
                        comments_data = CloudDB.load(comments_file_path, 'comments')
                        new_comment = {
                            "id": str(uuid.uuid4()),
                            "name": name,
                            "message": message,
                            "timestamp": datetime.datetime.utcnow().isoformat() + 'Z',
                            "guest_id": None
                        }
                        if "comments" not in comments_data:
                            comments_data["comments"] = []
                        comments_data["comments"].insert(0, new_comment)
                        CloudDB.save(comments_file_path, comments_data, 'comments')
                        self.send_response(200)
                        self.send_header('Content-Type', 'application/json; charset=utf-8')
                        self.send_header('Access-Control-Allow-Origin', '*')
                        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
                        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
                        response_data = json.dumps({"success": True, "comment": new_comment}).encode('utf-8')
                        self.send_header('Content-Length', str(len(response_data)))
                        self.end_headers()
                        self.wfile.write(response_data)
                        print(f"[Comment] Added from {name}: {message}")
                        return
                except Exception as e:
                    print(f"[Comment] Error: {e}")

            # Các POST API khác → trả success giả (analytics, view count...)
            self.send_response(200)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
            mock_res = b'{"success":true}'
            self.send_header('Content-Length', str(len(mock_res)))
            self.end_headers()
            self.wfile.write(mock_res)
            return
            
        self.send_error(404, "Not found")

# Định dạng các MIME type phổ biến
mimetypes.add_type('.woff', 'font/woff')
mimetypes.add_type('.woff2', 'font/woff2')
mimetypes.add_type('.otf', 'font/otf')
mimetypes.add_type('.ttf', 'font/ttf')
mimetypes.add_type('.js', 'application/javascript')
mimetypes.add_type('.css', 'text/css')
mimetypes.add_type('.webp', 'image/webp')

def self_ping(url):
    # Đợi 30 giây đầu tiên để server khởi động hoàn chỉnh hoàn toàn trên Render
    time.sleep(30)
    while True:
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Self-Ping-Bot'})
            with urllib.request.urlopen(req, timeout=10) as response:
                print(f"[Self-Ping] Ping successful: Status {response.status}")
        except Exception as e:
            print(f"[Self-Ping] Ping failed: {e}")
        
        # Cứ mỗi 5 phút (300 giây) tự gọi lại một lần để tránh Render tắt máy (idle timeout là 15 phút)
        time.sleep(300)

if __name__ == '__main__':
    server_address = ("", PORT)
    socketserver.TCPServer.allow_reuse_address = True
    httpd = http.server.ThreadingHTTPServer(server_address, CustomHTTPRequestHandler)
    print(f"Server started at http://localhost:{PORT}")
    
    # Khởi động luồng tự động ping chống ngủ đông trên Render
    if os.environ.get("RENDER") == "true" or os.environ.get("RENDER_EXTERNAL_URL"):
        render_url = os.environ.get("RENDER_EXTERNAL_URL", "https://thiep-cuoi-fbso.onrender.com")
        print(f"[Self-Ping] Detect Render environment. Starting self-ping thread for: {render_url}")
        threading.Thread(target=self_ping, args=(render_url,), daemon=True).start()
    else:
        print("[Self-Ping] Run locally. Self-ping thread is disabled.")
        
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")