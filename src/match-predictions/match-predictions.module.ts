import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  MatchPrediction,
  MatchPredictionSchema,
} from './match-prediction.schema';
import { Post, PostSchema } from '../posts/post.schema';
import { Fixture, FixtureSchema } from '../fixtures/fixture.schema';
import { MatchPredictionsService } from './match-predictions.service';
import { MatchPredictionsResolver } from './match-predictions.resolver';
import { UsersModule } from '../users/users.module';
import { CoinsModule } from '../coins/coins.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: MatchPrediction.name, schema: MatchPredictionSchema },
      { name: Post.name, schema: PostSchema },
      { name: Fixture.name, schema: FixtureSchema },
    ]),
    UsersModule,
    CoinsModule,
  ],
  providers: [MatchPredictionsService, MatchPredictionsResolver],
  exports: [MatchPredictionsService],
})
export class MatchPredictionsModule {}
