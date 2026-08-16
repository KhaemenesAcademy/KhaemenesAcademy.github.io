# STOS Gateway Protocol v1

## 1. Ticket issuance

Trusted broker only:

```text
POST /v1/tickets
Authorization: Bearer <backend-only broker secret>
Content-Type: application/json
```

Body:

```json
{
  "profileId": "terminal-1",
  "subject": "wix-admin",
  "requestId": "browser-request-id"
}
```

The response contains:

- random one-use ticket
- expiration time
- public WSS URL
- profile ID
- request ID

The default ticket lifetime is 45 seconds.

## 2. WebSocket upgrade

The browser opens the returned WSS URL with these WebSocket subprotocols:

```text
stos.v1
ticket.<ONE_USE_TICKET>
```

The ticket is **not** placed in the WebSocket query string.

During upgrade the gateway verifies:

1. exact STOS UI browser origin;
2. `stos.v1` protocol;
3. valid unexpired ticket;
4. one-use consumption;
5. profile availability;
6. gateway/session capacity.

## 3. Browser → gateway messages

```json
{"type":"input","data":"terminal bytes"}
{"type":"resize","cols":120,"rows":36}
{"type":"ping"}
{"type":"close"}
```

## 4. Gateway → browser messages

```json
{"type":"ready","sessionId":"...","profileId":"terminal-1","label":"Terminal 1","mode":"ssh"}
{"type":"output","data":"PTY bytes"}
{"type":"exit","code":0,"signal":null}
{"type":"error","message":"..."}
{"type":"pong","at":1234567890}
```

## 5. Profile authority

The browser selects only a profile ID.

It cannot provide:

- SSH host
- SSH port
- username
- private key path
- shell executable
- arbitrary host command
- Podman mount
- production filesystem path

Those values exist only in the private server-side profile file.
