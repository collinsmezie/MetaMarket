import { setDefaultResultOrder } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

// Enforce IPv4 resolution across Nest and native fetch to prevent IPv6 timeout hangs
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);

/**
 * Application bootstrap.
 *
 * The one non-obvious piece here is raw-body capture: Meta signs the exact bytes it sends,
 * so verifying against a re-serialised object would accept payloads that were tampered with
 * in ways JSON round-tripping hides.
 */
async function bootstrap(): Promise<void> {
  // `bodyParser: false` is essential, not cosmetic: Nest's built-in parser would run before
  // the middleware below and consume the stream, leaving `rawBody` unset and every webhook
  // signature check failing.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });

  const config = app.get(AppConfigService);
  const logger = new Logger('Bootstrap');

  app.use(
    express.json({
      limit: '2mb',
      verify: (request: express.Request & { rawBody?: Buffer }, _response, buffer: Buffer) => {
        // Retained for HMAC verification in the WhatsApp webhook controller.
        request.rawBody = Buffer.from(buffer);
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      // Webhook providers add fields without notice; rejecting unknown properties would
      // start failing deliveries the day Meta ships a new field.
      forbidNonWhitelisted: false,
    }),
  );

  const webOrigins = config.webClientOrigins;

  if (webOrigins.length > 0) {
    // The web client is deployed separately and is therefore always cross-origin. Credentials
    // stay off: identity travels in the request body, not a cookie, so there is nothing for a
    // third-party page to replay.
    app.enableCors({
      origin: [...webOrigins],
      methods: ['GET', 'POST'],
      credentials: false,
    });
  }

  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.log(`MetaMarket listening on port ${config.port} (${config.nodeEnv})`);
  logger.log(`WhatsApp webhook: POST /webhooks/whatsapp`);
  logger.log(`Web channel: POST /channels/web/messages, GET /channels/web/stream`);
  logger.log(
    webOrigins.length > 0
      ? `Web CORS origins: ${webOrigins.join(', ')}`
      : 'Web CORS disabled (set WEB_CLIENT_ORIGINS to enable browser access)',
  );
  logger.log(`Health: GET /health`);
}

void bootstrap();
