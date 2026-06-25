# Plano de Storage Remoto/CDN

O storage local continua padrão. O banco salva `assetKey`, não path físico, permitindo troca futura de backend.

## Backends

- Atual: `POPLOG_STORAGE_DRIVER=local`.
- Futuro: `POPLOG_STORAGE_DRIVER=s3`.

## Variáveis S3-compatible

```env
POPLOG_STORAGE_DRIVER=s3
POPLOG_S3_ENDPOINT=
POPLOG_S3_REGION=us-east-1
POPLOG_S3_BUCKET=
POPLOG_S3_ACCESS_KEY_ID=
POPLOG_S3_SECRET_ACCESS_KEY=
POPLOG_S3_FORCE_PATH_STYLE=true
POPLOG_ASSET_PUBLIC_BASE_URL=https://cdn.seu-dominio.com
NEXT_PUBLIC_POPLOG_ASSET_PUBLIC_BASE_URL=https://cdn.seu-dominio.com
```

## Validação local/remota

```bash
npm run smoke:assets-local
```

Com `POPLOG_STORAGE_DRIVER=local`, o smoke escreve/lê/remove em `./storage`.

Com `POPLOG_STORAGE_DRIVER=s3` e credenciais configuradas, o mesmo smoke testa upload, leitura, existência, URL pública e remoção no bucket.

## Bucket S3-compatible validado localmente

Nesta rodada foi adicionado MinIO ao Docker Compose como bucket real S3-compatible:

```bash
docker compose up -d minio minio-init
npm run smoke:assets-s3-local
```

Configuração usada:

- endpoint: `http://127.0.0.1:9000`;
- bucket: `poplog-assets`;
- public base URL: `http://127.0.0.1:9000/poplog-assets`;
- driver: `POPLOG_STORAGE_DRIVER=s3`.

O smoke validou upload via S3, `exists`, leitura via S3, URL pública com download anônimo, remoção e retorno ao mesmo contrato `assetKey`.

Também foi executado smoke HTTP com o servidor local apontado para o driver S3/MinIO em porta temporária. Esse teste validou Home/cards, busca, página de título, providers, Radar, Admin e OG image usando a mesma configuração remota.

Para produção, trocar apenas as variáveis `POPLOG_S3_*` e `POPLOG_ASSET_PUBLIC_BASE_URL` pelo provedor/CDN escolhido.

## Rollback

1. Voltar `POPLOG_STORAGE_DRIVER=local`.
2. Voltar `POPLOG_ASSET_PUBLIC_BASE_URL=/storage`.
3. Manter `assetKey` no banco sem alteração.
4. Reexecutar worker de assets para repopular arquivos locais quando necessário.

## Regras

- Cards, página de título, Admin e OG image devem consumir `assetKey`.
- CDN não deve alterar identidade do asset no banco.
- Falha remota deve permitir retorno ao local sem migração de schema.
