import { ExecutionContext, Injectable } from '@nestjs/common';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ThrottlerGuard } from '@nestjs/throttler';
import { Request, Response } from 'express';

const noopRes: Pick<Response, 'header' | 'setHeader'> = {
  header() {
    return this as unknown as Response;
  },
  setHeader() {
    return this as unknown as Response;
  },
};

/**
 * ThrottlerGuard reads IP from `req`; GraphQL resolvers have no HTTP context unless
 * we take `req`/`res` from the GraphQL context (see GraphQLModule `context` in app.module).
 */
@Injectable()
export class GqlThrottlerGuard extends ThrottlerGuard {
  getRequestResponse(context: ExecutionContext) {
    try {
      const gql = GqlExecutionContext.create(context);
      const gqlCtx = gql.getContext<{ req?: Request; res?: Response }>();
      if (gqlCtx?.req) {
        const res = gqlCtx.res ?? (noopRes as Response);
        return { req: gqlCtx.req, res };
      }
    } catch {
      /* not a GraphQL context */
    }
    return super.getRequestResponse(context);
  }
}
