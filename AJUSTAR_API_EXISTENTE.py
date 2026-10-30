#!/usr/bin/env python3
"""Atualiza somente autenticação do app.py ConecTorno que JÁ está instalado.
Não instala, não inicia e não cria outro servidor. Faz backup antes de gravar.
"""
from pathlib import Path
import shutil
import sys

AUTH_BLOCK = '@app.get("/api/auth/status")\ndef auth_status():\n    """Informa ao navegador se há conta configurada e se a sessão está autenticada."""\n    config = load_auth_config()\n    authenticated = teacher_is_authenticated()\n    csrf_token = ""\n    if authenticated:\n        # Token imprevisível por sessão, exigido em ações administrativas que alteram dados.\n        if not session.get("csrf_token"):\n            session["csrf_token"] = secrets.token_urlsafe(32)\n        csrf_token = session["csrf_token"]\n    return jsonify({\n        "ok": True,\n        "configured": bool(config),\n        "authenticated": authenticated,\n        "username": session.get("teacher_user", "") if authenticated else "",\n        # O primeiro cadastro fica liberado somente enquanto não existir conta.\n        # Depois que auth.json é criado, esta opção deixa de aparecer no navegador.\n        "setup_available": bool(not config),\n        "csrf_token": csrf_token,\n    }), 200, {"Cache-Control": "no-store"}\n\n\n@app.post("/api/setup")\n@same_origin_required\ndef setup_first_teacher():\n    """Cria a primeira conta do professor sem código externo, uma única vez."""\n    if load_auth_config():\n        return jsonify({"ok": False, "erro": "O acesso já foi configurado. Entre com a conta do professor."}), 409\n\n    ip = request.remote_addr or "desconhecido"\n    now = time.time()\n    # Limita tentativas de primeiro cadastro por endereço IP (janela de cinco minutos).\n    recent_setup_attempts = [stamp for stamp in SETUP_ATTEMPTS.get(ip, []) if now - stamp < 300]\n    if len(recent_setup_attempts) >= 5:\n        SETUP_ATTEMPTS[ip] = recent_setup_attempts\n        return jsonify({"ok": False, "erro": "Muitas tentativas de cadastro. Aguarde cinco minutos."}), 429, {"Retry-After": "300"}\n    recent_setup_attempts.append(now)\n    SETUP_ATTEMPTS[ip] = recent_setup_attempts\n\n    if request.content_length and request.content_length > 16_384:\n        return jsonify({"ok": False, "erro": "A requisição de cadastro é muito grande."}), 413\n\n    payload = request.get_json(silent=True) or {}\n    username = str(payload.get("username", "")).strip()\n    password = str(payload.get("password", ""))\n    confirmation = str(payload.get("confirmation", ""))\n\n    if not 3 <= len(username) <= 64:\n        return jsonify({"ok": False, "erro": "O usuário deve ter de 3 a 64 caracteres."}), 400\n    if len(password) < 8 or len(password) > 256:\n        return jsonify({"ok": False, "erro": "A senha precisa ter pelo menos 8 caracteres."}), 400\n    if not constant_time_equal(password, confirmation):\n        return jsonify({"ok": False, "erro": "As senhas não coincidem."}), 400\n\n    # O bloqueio impede que dois cadastros simultâneos criem contas diferentes.\n    with LOCK:\n        if load_auth_config():\n            return jsonify({"ok": False, "erro": "O acesso já foi configurado. Entre com a conta do professor."}), 409\n        write_json_atomic(AUTH_FILE, {\n            "username": username,\n            "password_hash": generate_password_hash(password),\n            "auth_version": 1,\n        })\n\n    SETUP_ATTEMPTS.pop(ip, None)\n    session.clear()\n    session["teacher_authenticated"] = True\n    session["teacher_user"] = username\n    session["auth_version"] = 1\n    session["csrf_token"] = secrets.token_urlsafe(32)\n    session.permanent = True\n    return jsonify({"ok": True, "username": username, "csrf_token": session["csrf_token"], "mensagem": "Acesso do professor criado com sucesso."}), 201\n\n'
OLD_CHANGE = '    if len(new_password) < 14 or len(new_password) > 256:\n        return jsonify({"ok": False, "erro": "Use uma nova senha com 14 a 256 caracteres."}), 400'
NEW_CHANGE = '    if len(new_password) < 8 or len(new_password) > 256:\n        return jsonify({"ok": False, "erro": "Use uma nova senha com pelo menos 8 caracteres."}), 400'


def main() -> int:
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "app.py").expanduser().resolve()
    if not target.is_file():
        print(f"ERRO: não encontrei o app.py: {target}")
        print("Uso: python3 AJUSTAR_API_EXISTENTE.py /caminho/para/app.py")
        return 2

    original = target.read_text(encoding="utf-8")
    if ('"setup_available": bool(not config)' in original
            and "setup_secret" not in original
            and "if len(password) < 8 or len(password) > 256:" in original
            and NEW_CHANGE in original):
        print("A API existente já está ajustada. Nenhuma alteração foi feita.")
        return 0

    start_marker = '@app.get("/api/auth/status")'
    end_marker = '@app.post("/api/login")'
    start = original.find(start_marker)
    end = original.find(end_marker, start + len(start_marker)) if start >= 0 else -1
    if start < 0 or end < 0:
        print("ERRO: não reconheci a seção de autenticação deste app.py. Nada foi alterado.")
        print("Envie o app.py atual para adaptar a versão correta.")
        return 3

    updated = original[:start] + AUTH_BLOCK + original[end:]
    if OLD_CHANGE in updated:
        updated = updated.replace(OLD_CHANGE, NEW_CHANGE, 1)
    elif NEW_CHANGE not in updated:
        print("ERRO: não reconheci a validação de troca de senha. Nada foi alterado.")
        return 4

    try:
        compile(updated, str(target), "exec")
    except SyntaxError as exc:
        print(f"ERRO de sintaxe: {exc}. Nada foi gravado.")
        return 5

    backup = target.with_name(target.name + ".backup-antes-primeiro-acesso")
    suffix = 1
    while backup.exists():
        backup = target.with_name(target.name + f".backup-antes-primeiro-acesso-{suffix}")
        suffix += 1
    shutil.copy2(target, backup)
    target.write_text(updated, encoding="utf-8")
    print("API existente ajustada com sucesso.")
    print(f"Backup criado em: {backup}")
    print("Nenhum servidor foi instalado ou iniciado. Reinicie o serviço que já existia.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
