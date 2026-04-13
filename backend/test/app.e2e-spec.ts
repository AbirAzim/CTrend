import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../src/app.module';

/**
 * Full e2e against GraphQL requires a running MongoDB (MONGODB_URI) and env vars.
 * Run manually: MONGODB_URI=... JWT_SECRET=... npm run test:e2e
 */
describe('AppModule (e2e smoke)', () => {
  it('compiles module graph when env is set', async () => {
    if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
      return;
    }
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    expect(moduleFixture).toBeDefined();
  });
});
