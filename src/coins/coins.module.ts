import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { CoinLedger, CoinLedgerSchema } from './coin-ledger.schema';
import { User, UserSchema } from '../users/user.schema';
import { CoinsService } from './coins.service';
import { CoinsResolver } from './coins.resolver';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CoinLedger.name, schema: CoinLedgerSchema },
      { name: User.name, schema: UserSchema },
    ]),
    UsersModule,
  ],
  providers: [CoinsService, CoinsResolver],
  exports: [CoinsService],
})
export class CoinsModule {}
