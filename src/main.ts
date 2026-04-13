import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((s) => s.trim()) ?? true,
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'Accept',
      'Apollo-Require-Preflight',
      'apollographql-client-name',
      'apollographql-client-version',
    ],
    exposedHeaders: ['Content-Type'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = Number(process.env.PORT) || 4000;
  await app.listen(port);
  const base = `http://localhost:${port}`;
  Logger.log(`Application: ${base}`, 'Bootstrap');
  Logger.log(`GraphQL:       ${base}/graphql`, 'Bootstrap');
  Logger.log(`Stripe webhook: ${base}/webhooks/stripe`, 'Bootstrap');
}
bootstrap();
