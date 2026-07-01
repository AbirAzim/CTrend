import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CoinLedger, CoinLedgerSchema } from './coin-ledger.schema';
import {
  CoinMonthlySnapshot,
  CoinMonthlySnapshotSchema,
} from './coin-monthly-snapshot.schema';
import { User, UserSchema } from '../users/user.schema';
import { CoinsService } from './coins.service';
import { CoinsResolver } from './coins.resolver';
import { CoinsMonthlyResetService } from './coins-monthly-reset.service';
import { UsersModule } from '../users/users.module';
import { PlatformSettingsModule } from '../platform-settings/platform-settings.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CoinLedger.name, schema: CoinLedgerSchema },
      { name: CoinMonthlySnapshot.name, schema: CoinMonthlySnapshotSchema },
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
    PlatformSettingsModule,
  ],
  providers: [CoinsService, CoinsResolver, CoinsMonthlyResetService],
  exports: [CoinsService, CoinsMonthlyResetService],
})
export class CoinsModule {}
