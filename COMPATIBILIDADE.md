# Compatibilidade da interface com a API ConecTorno existente

A interface usa caminhos relativos e espera ser entregue na mesma origem do servidor
Raspberry. Ela usa as rotas `/api/auth/status`, `/api/setup`, `/api/login`, `/api/logout`,
`/api/change-password`, `/api/state`, `/api/upload`, `/api/project/delete`, as rotas de
observação e as rotas `/api/monitor/<id>/...`.

O servidor de referência `ConecTorno_Raspberry_LAN_2.zip` possui essas rotas, mas sua
implementação de cadastro inicial exige `CONECTORNO_SETUP_TOKEN` e senha de 14 caracteres.
O utilitário `AJUSTAR_API_EXISTENTE.py` modifica apenas os handlers de primeiro acesso e
a validação de troca de senha na API já instalada: remove o código temporário, mantém o
cadastro permitido somente enquanto não existir conta e aplica mínimo de 8 caracteres.

Não contém `app.py`, dependências, tokens, configurações de Wi-Fi, dados ou uploads.
