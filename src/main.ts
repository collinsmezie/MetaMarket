import { lookup, resolve4, setDefaultResultOrder, setServers } from 'node:dns';
import { setDefaultAutoSelectFamily } from 'node:net';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as express from 'express';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

// Enforce reliable DNS servers (8.8.8.8, 1.1.1.1) and IPv4 resolution across Nest and native fetch
try {
  setServers(['8.8.8.8', '1.1.1.1']);
} catch {
  // Ignore if setServers fails in constrained environments
}
setDefaultResultOrder('ipv4first');
setDefaultAutoSelectFamily(false);

const originalLookup = lookup;
// Override dns.lookup so Node's internal undici fetch uses reliable DNS resolution
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(lookup as any) = function (hostname: string, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  resolve4(hostname, (err, addresses) => {
    if (!err && addresses && addresses.length > 0) {
      if (typeof options === 'object' && options?.all) {
        return callback(
          null,
          addresses.map((a) => ({ address: a, family: 4 })),
        );
      }
      return callback(null, addresses[0], 4);
    }
    return originalLookup(hostname, options, callback);
  });
};

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

  app.enableShutdownHooks();

  await app.listen(config.port);

  logger.log(`MetaMarket listening on port ${config.port} (${config.nodeEnv})`);
  logger.log(`WhatsApp webhook: POST /webhooks/whatsapp`);
  logger.log(`Health: GET /health`);
}

void bootstrap();
