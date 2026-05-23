import { Args, Mutation, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { UploadsService } from './uploads.service';
import { PresignedUploadUrl } from './graphql/upload.types';
import { GqlAuthGuard } from '../common/guards/gql-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

type ReqUser = { id: string };

@Resolver()
export class UploadsResolver {
  constructor(private uploadsService: UploadsService) {}

  @Mutation(() => PresignedUploadUrl)
  @UseGuards(GqlAuthGuard)
  async getImageUploadUrl(
    @CurrentUser() user: ReqUser,
    @Args('filename') _filename: string,
    @Args('contentType') contentType: string,
  ): Promise<PresignedUploadUrl> {
    return this.uploadsService.getImageUploadUrl(user.id, contentType);
  }
}
