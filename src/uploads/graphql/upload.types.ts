import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class PresignedUploadUrl {
  @Field()
  uploadUrl: string;

  @Field()
  publicUrl: string;

  @Field()
  key: string;
}
