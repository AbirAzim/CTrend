import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
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
