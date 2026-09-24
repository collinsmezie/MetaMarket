# Channels — web and WhatsApp on the rebuilt runtime

Status: verified 2026-09-24 against the Phase 8 build.

## The rule

Every channel connects through adapters and ports, nothing else (ADR-001; MCOS v4.4 §24):

```
inbound adapter  ──HandleIncomingMessagePort──▶  MessageIngestion ▶ TurnAssembly ▶ queue ▶ LangGraph orchestrator
                                                                                              │
outbound         ◀── ChannelNotifierRegistry (durable, ordered, retried) ◀── ConversationDelivery ◀─┘
pull channels    ◀── ConversationStreamPort (subscribe/history) ◀── ConversationStreamService ◀── ChannelStreamBusPort
```

| | WhatsApp | Web |
| --- | --- | --- |
| Inbound adapter | `WhatsAppWebhookController` (`GET/POST /webhooks/whatsapp`) | `WebChannelController` (`POST /channels/web/messages`, `GET /channels/web/stream` SSE, `GET /channels/web/history`) |
| Depends on | `HANDLE_INCOMING_MESSAGE`, config | `HANDLE_INCOMING_MESSAGE`, `CONVERSATION_STREAM`, clock, logger |
| Identity | E.164 phone (`from`) | `sessionId`, or the phone when the client supplies it (same conversation across channels) |
| Idempotency | `wamid` (Meta retries) | `clientMessageId` scoped by session |
| Outbound adapter | `WhatsAppNotifier` (Graph API: text, ≤3 buttons, lists) | `WebChannelNotifier` → `ChannelStreamBusPort` (Redis pub/sub + presence) |
| Durability | `DurableChannelNotifier` write-ahead row + `OutboundDeliverySweeper` retries, per-conversation ordering | same; a reply with no browser attached is queued and delivered on reconnect |
| Typing | Graph API typing indicator | `typing` SSE event |

ESLint enforces the rule for `src/adapters/inbound/{web,whatsapp,paystack}`: no imports from application
services, outbound adapters, the runtime or the platform — ports and config only.

## What changed in this pass
- The web adapter used to reach into `ConversationContextManager` and `WebStreamHub` directly. It now depends on
  the new inbound `ConversationStreamPort` (resolve conversation, subscribe, history); `ConversationStreamService`
  implements it over the new outbound `ChannelStreamBusPort`, which `WebStreamHub` implements. The web notifier
  also depends on the bus port, not the hub class.
- Replies now go back on the channel the turn arrived on. The conversation's `lastChannel` was never updated after
  creation once the legacy turn processor was deleted, so a user who moved from WhatsApp to the browser was answered
  on WhatsApp. The orchestrator now records the switch and delivers on the current channel.
- The legacy buyer search named a requested *service* ("a plumber") as "your item"; it now uses the resolved service
  name. (Workflows consuming CSRE objects properly is Phase 12.)
- The legacy `whatsapp-pipeline` suite, which asserted the deleted core's behaviour, is replaced by
  `test/integration/channels.test.ts`: signature and handshake rejection, text → turn → reply on WhatsApp,
  correlated outbox events, webhook redelivery = one turn, media queued without blocking, web 202 → reply on web,
  history rehydration, `clientMessageId` dedupe, 400 on empty payloads, cross-channel continuation answered on the
  new channel.

## Live verification (dev, real model)
- Web: SSE stream received `typing`, the 25 s heartbeat `message`, and the final `message` for
  "I need a plumber in Warri"; history returned user + assistant; re-sending the same `clientMessageId` was ignored.
- WhatsApp: webhook `200`; duplicate `wamid` ignored; wrong verify token `403`; turn executed; outbound send reached
  Meta and was rejected with `Graph API 401: Authentication Error` and parked for reconciliation (see below).

## Operator checklist before go-live
1. **`WHATSAPP_ACCESS_TOKEN` is invalid or expired** in the current `.env` (Meta answers 401). Use a permanent
   System User token with `whatsapp_business_messaging`; the typing indicator fails with the same 401.
2. `WHATSAPP_VERIFY_SIGNATURE=false` in `.env` is a dev convenience. Production must run with `true` and the
   matching `WHATSAPP_APP_SECRET`; the code refuses unsigned webhooks in that mode.
3. Register the webhook URL `https://<host>/webhooks/whatsapp` with `WHATSAPP_VERIFY_TOKEN` and subscribe to the
   `messages` field. `WHATSAPP_PHONE_NUMBER_ID` must be the sending number.
4. `WEB_CLIENT_ORIGINS` must list the deployed frontend origin (currently `http://localhost:3000`); the frontend's
   `getApiBase()` already targets the Render backend when served from Render.
5. Redis must be shared by all replicas: web replies fan out through it, and presence decides whether a reply is
   pushed or queued.
6. `DEV_TRACE_API_ENABLED` must be false in production.
