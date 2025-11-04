# CoveCRM Socket Service

A minimal Socket.IO server for CoveCRM.

## Env Vars

- `PORT` (default `8080`)
- `CORS_ORIGIN` (comma-separated list; default `https://www.covecrm.com`)
- `SOCKET_PATH` (default `/socket`)

The Socket.IO client must connect with `path: "/socket"`.
