from flask import Flask, request, jsonify, session, send_from_directory, abort
from werkzeug.security import generate_password_hash, check_password_hash
from werkzeug.utils import secure_filename
from pathlib import Path
from functools import wraps
import json, secrets, time, uuid, hashlib, hmac
from collections import defaultdict, deque

BASE = Path(__file__).resolve().parent
STATIC = BASE / 'static'
UPLOADS = BASE / 'uploads'
DATA_FILE = BASE / 'dados_teste.json'
AUTH_FILE = BASE / 'auth_teste.json'
UPLOADS.mkdir(exist_ok=True)
app = Flask(__name__, static_folder=None)
SECRET_FILE = BASE / '.secret_key_teste'
if not SECRET_FILE.exists(): SECRET_FILE.write_text(secrets.token_hex(32), encoding='utf-8')
app.secret_key = SECRET_FILE.read_text(encoding='utf-8').strip()
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax')
_RECOVERY_ATTEMPTS = defaultdict(deque)
# Código mestre fixo: somente o hash fica no código-fonte; o código original é entregue ao responsável.
MASTER_RECOVERY_HASH = '57ee794efcbbeef84dd629e0ed384e66a804ac40128005b2c34dee122a020d4a'
app.config['MAX_CONTENT_LENGTH'] = 100 * 1024 * 1024


def read_json(path, default):
    try: return json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError): return default

def write_json(path, data):
    tmp = path.with_suffix(path.suffix + '.tmp')
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
    tmp.replace(path)

def initial_data():
    return {'project': None, 'monitors': {str(i): {'project': None, 'teacher_note': '', 'teacher_history': [], 'access_token': secrets.token_urlsafe(24), 'last_seen': 0, 'has_project_override': False} for i in range(1,7)}}

def data():
    d = read_json(DATA_FILE, None)
    if not d: d = initial_data(); write_json(DATA_FILE, d)
    for i in range(1,7):
        d.setdefault('monitors', {}).setdefault(str(i), {'project':None,'teacher_note':'','teacher_history':[],'access_token':secrets.token_urlsafe(24),'last_seen':0,'has_project_override':False})
    return d

def auth(): return read_json(AUTH_FILE, {})
def teacher_required(fn):
    @wraps(fn)
    def wrapper(*a, **kw):
        if not session.get('teacher'): return jsonify(ok=False, erro='Faça login novamente.'), 401
        return fn(*a, **kw)
    return wrapper

def monitor_required(fn):
    @wraps(fn)
    def wrapper(mid, *a, **kw):
        d=data(); m=d['monitors'].get(str(mid))
        if not m or not secrets.compare_digest(request.headers.get('X-Monitor-Token',''), m.get('access_token','')):
            return jsonify(ok=False, erro='Token do monitor inválido.'), 403
        return fn(mid, *a, **kw)
    return wrapper

def public_monitor(m):
    return {'online': bool(time.time()-m.get('last_seen',0)<35), 'teacher_note':m.get('teacher_note',''), 'teacher_history':m.get('teacher_history',[]), 'project':m.get('project'), 'has_project_override':m.get('has_project_override',False), 'access_token':m.get('access_token','')}

@app.get('/')
def home(): return send_from_directory(STATIC, 'index.html')
@app.get('/<path:name>')
def static_files(name):
    if name.startswith('api/') or name.startswith('uploads/'): abort(404)
    return send_from_directory(STATIC, name)
@app.get('/uploads/<path:name>')
def uploaded(name): return send_from_directory(UPLOADS, name)

@app.get('/api/auth/status')
def auth_status():
    a=auth(); return jsonify(ok=True, configured=bool(a), authenticated=bool(session.get('teacher')), username=session.get('teacher',''), setup_available=not bool(a), csrf_token='local-test')
@app.post('/api/setup')
def setup():
    if auth(): return jsonify(ok=False, erro='Já existe uma conta. Faça login.'),409
    p=request.get_json() or {}; u=str(p.get('username','')).strip(); pw=str(p.get('password',''))
    if len(u)<3 or len(pw)<8 or pw!=p.get('confirmation'): return jsonify(ok=False,erro='Confira usuário e senha (mínimo 8 caracteres).'),400
    write_json(AUTH_FILE, {'username':u,'password_hash':generate_password_hash(pw)})
    session['teacher']=u; return jsonify(ok=True,username=u,csrf_token='local-test')
@app.post('/api/login')
def login():
    p=request.get_json() or {}; a=auth()
    if not a or p.get('username')!=a.get('username') or not check_password_hash(a.get('password_hash',''),str(p.get('password',''))): return jsonify(ok=False,erro='Usuário ou senha incorretos.'),401
    session['teacher']=a['username']; return jsonify(ok=True,username=a['username'],csrf_token='local-test')
@app.post('/api/password/recover')
def recover_password():
    # Limita tentativas por IP para dificultar tentativas automatizadas.
    ip = request.remote_addr or 'unknown'; now = time.time(); attempts = _RECOVERY_ATTEMPTS[ip]
    while attempts and now - attempts[0] > 900: attempts.popleft()
    if len(attempts) >= 5:
        return jsonify(ok=False, erro='Muitas tentativas. Aguarde 15 minutos e tente novamente.'), 429
    attempts.append(now)
    p = request.get_json() or {}; a = auth()
    username = str(p.get('username','')).strip(); code = str(p.get('recovery_code','')).strip()
    supplied_hash = hashlib.sha256(code.encode('utf-8')).hexdigest()
    # O código mestre não muda após a recuperação. Compare somente hashes, nunca o texto do código.
    valid = bool(a and username == a.get('username') and hmac.compare_digest(supplied_hash, MASTER_RECOVERY_HASH))
    new_password = str(p.get('new_password','')); confirmation = str(p.get('confirmation',''))
    if not valid: return jsonify(ok=False, erro='Usuário ou código de recuperação inválido.'), 400
    if len(new_password) < 12 or new_password != confirmation:
        return jsonify(ok=False, erro='A nova senha deve ter pelo menos 12 caracteres e coincidir com a confirmação.'), 400
    a['password_hash'] = generate_password_hash(new_password)
    # O código mestre permanece fixo; somente a senha do professor é atualizada.
    a.pop('recovery_hash', None)
    write_json(AUTH_FILE, a); session.clear()
    return jsonify(ok=True, mensagem='Senha redefinida. O código mestre continua o mesmo. Entre novamente.')

@app.post('/api/logout')
def logout(): session.clear(); return jsonify(ok=True)
@app.post('/api/change-password')
@teacher_required
def change_password():
    p=request.get_json() or {}; a=auth()
    if not check_password_hash(a.get('password_hash',''),str(p.get('current_password',''))): return jsonify(ok=False,erro='Senha atual incorreta.'),400
    pw=str(p.get('new_password',''))
    if len(pw)<8: return jsonify(ok=False,erro='A nova senha precisa ter pelo menos 8 caracteres.'),400
    a['password_hash']=generate_password_hash(pw); write_json(AUTH_FILE,a); return jsonify(ok=True,mensagem='Senha alterada.')
@app.get('/api/state')
@teacher_required
def state():
    d=data(); mons={k:public_monitor(v) for k,v in d['monitors'].items()}
    return jsonify(project=d['project'],monitors=mons)
@app.post('/api/upload')
@teacher_required
def upload():
    f=request.files.get('arquivo')
    if not f or not f.filename: return jsonify(ok=False,erro='Selecione um arquivo.'),400
    ext=Path(f.filename).suffix.lower()
    if ext not in ['.pdf','.png','.jpg','.jpeg','.webp','.gif','.bmp']: return jsonify(ok=False,erro='Formato não permitido.'),400
    name=secrets.token_hex(8)+ext; f.save(UPLOADS/name)
    proj={'name':secure_filename(f.filename) or name,'url':'/uploads/'+name,'type':f.mimetype or 'application/octet-stream'}
    d=data(); dest=request.form.get('destino','todos')
    if dest=='todos':
        d['project']=proj
        for m in d['monitors'].values(): m['project']=None; m['has_project_override']=False
    elif dest in d['monitors']:
        d['monitors'][dest]['project']=proj; d['monitors'][dest]['has_project_override']=True
    write_json(DATA_FILE,d); return jsonify(ok=True,mensagem='Projeto publicado com sucesso.')
@app.post('/api/project/delete')
@teacher_required
def delete_project():
    d=data(); d['project']=None
    for m in d['monitors'].values(): m['project']=None; m['has_project_override']=False
    write_json(DATA_FILE,d); return jsonify(ok=True,mensagem='Projeto removido.')
@app.post('/api/monitor/<int:mid>/project/reset')
@teacher_required
def reset_project(mid):
    d=data(); m=d['monitors'].get(str(mid))
    if not m: abort(404)
    m['project']=None; m['has_project_override']=False; write_json(DATA_FILE,d); return jsonify(ok=True,mensagem='Monitor voltou ao projeto geral.')
@app.post('/api/monitor/<int:mid>/note')
@teacher_required
def add_note(mid):
    d=data(); m=d['monitors'].get(str(mid)); p=request.get_json() or {}; note=str(p.get('note',p.get('text',''))).strip()
    if not m or not note: return jsonify(ok=False,erro='Observação vazia ou monitor inválido.'),400
    item={'id':uuid.uuid4().hex,'text':note,'created_at':time.time()}; m['teacher_history'].append(item); m['teacher_note']=note; write_json(DATA_FILE,d); return jsonify(ok=True,mensagem='Observação salva.')
@app.delete('/api/monitor/<int:mid>/note/<note_id>')
@teacher_required
def delete_note(mid,note_id):
    d=data(); m=d['monitors'].get(str(mid))
    if not m: abort(404)
    m['teacher_history']=[x for x in m['teacher_history'] if x.get('id')!=note_id]
    m['teacher_note']=m['teacher_history'][-1]['text'] if m['teacher_history'] else ''
    write_json(DATA_FILE,d); return jsonify(ok=True,mensagem='Observação apagada.')
@app.post('/api/monitor/<int:mid>/heartbeat')
@monitor_required
def heartbeat(mid):
    d=data(); d['monitors'][str(mid)]['last_seen']=time.time(); write_json(DATA_FILE,d); return jsonify(ok=True)
@app.get('/api/monitor/<int:mid>/display')
@monitor_required
def display(mid):
    d=data(); m=d['monitors'][str(mid)]; return jsonify(ok=True,monitor={'teacher_note':m.get('teacher_note','')},project=m.get('project') or d.get('project'))

if __name__ == '__main__':
    print('\nConecTorno - TESTE LOCAL\nAbra: http://127.0.0.1:5000\nPara testar em outro dispositivo na mesma rede: http://IP-DESTE-PC:5000\nPressione CTRL+C para parar.\n')
    app.run(host='0.0.0.0', port=5000, debug=False)
